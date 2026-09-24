#!/usr/bin/env node
// Written: 2026-09-24 (w26)
//
// Reset ONE document's annotation store so its PDF's own embedded markup is
// imported again (chunked into WAL rows under 256 KB by the w26 build).
//
// Why: before w26, opening "Package 2 - Rev 4 -- IC.pdf" imported its 3,055
// embedded ink marks as one WAL row per page (0.8 to 8.8 MB each). Those rows
// are still in annotation_updates after the snapshot, so every open has to
// read them back; on production that read hit the statement timeout and the
// document could not open. The marks come from the PDF file itself and the
// owner ruled the data disposable, so the recovery is: make the document's
// store start empty again, and let the next editor open re-import it.
//
// How (no SQL, no deletes): the WAL is append-only (DELETE is revoked even
// for service_role), so the reset writes a new EMPTY checkpoint through the
// normal store_annotation_snapshot RPC with at_seq = the current WAL head.
// Opens read the checkpoint and only the rows after it, so the old rows are
// never read again. The RPC requires an EDITOR of the document (it checks
// auth.uid()), so --apply runs with that person's own session token
// (RESET_EDITOR_ACCESS_TOKEN — copied from their signed-in browser by the
// person who decides to run it). The script never handles a password.
//
// What is lost: EVERYTHING in this document's store — the imported marks,
// any marks drawn on it, its Survey Markers, spaces and callout list (owner
// ruling 2026-09-24: no users, data disposable). The PDF file, the document
// row and its project placement stay.
//
// Other devices: a browser that has this document cached locally re-sends
// its cached marks on the next open (split into small rows). That brings the
// same imported marks back without a re-import; clearing the site data on
// that device instead gives a fresh import. Close the document everywhere
// before --apply.
//
// Alternative with no script: delete the document in the app and upload the
// PDF again (the delete cascades its WAL rows and checkpoint).
//
// Usage (from the main checkout, which holds .env / .env.local):
//   node scripts/w26-reset-document-annotation-store.mjs --name "Package 2 - Rev 4 -- IC.pdf"
//       dry run: lists matching documents and, for one --document-id,
//       read-only row counts and sizes. Changes nothing.
//   node scripts/w26-reset-document-annotation-store.mjs --document-id <uuid>
//   RESET_EDITOR_ACCESS_TOKEN=<editor's access token> \
//   node scripts/w26-reset-document-annotation-store.mjs --document-id <uuid> \
//       --apply --confirm <uuid>
//   --env-dir <path>  where .env / .env.local / .env.test live (default: cwd)

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import * as Y from 'yjs';

const WAL_ROW_BUDGET_BYTES = 256 * 1024;

function parseArgs(argv) {
  const args = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--document-id') args.documentId = argv[++index];
    else if (arg === '--name') args.name = argv[++index];
    else if (arg === '--confirm') args.confirm = argv[++index];
    else if (arg === '--env-dir') args.envDir = argv[++index];
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

function loadEnv(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function requireEnv(key) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
  return process.env[key];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read-only size figures through the Management API. Only SELECTs are sent.
async function readOnlySql(projectRef, token, query) {
  if (!/^\s*select\b/i.test(query) || /;\s*\S/.test(query)) {
    throw new Error('refusing to send anything but a single SELECT');
  }
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`size query failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

const kb = (bytes) => `${(Number(bytes || 0) / 1024).toFixed(0)} KB`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envDir = args.envDir || process.cwd();
  for (const file of ['.env', '.env.local', '.env.test']) loadEnv(envDir, file);
  const url = requireEnv('VITE_SUPABASE_URL');
  const service = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const projectRef = new URL(url).hostname.split('.')[0];

  if (args.name) {
    const { data, error } = await service
      .from('documents')
      .select('id, name, user_id, created_at, embedded_import_completed_at')
      .eq('name', args.name)
      .order('created_at', { ascending: true });
    if (error) throw error;
    console.log(`Documents named ${JSON.stringify(args.name)}: ${data.length}`);
    for (const row of data) {
      console.log(`  ${row.id}  owner ${row.user_id}  created ${row.created_at}  old import stamp ${row.embedded_import_completed_at || '-'}`);
    }
    if (!args.documentId) return;
  }

  const documentId = args.documentId;
  if (!documentId || !UUID_RE.test(documentId)) throw new Error('--document-id <uuid> is required');

  const { data: document, error: documentError } = await service
    .from('documents')
    .select('id, name, user_id')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError) throw documentError;
  if (!document) throw new Error(`document ${documentId} not found`);
  console.log(`\nDocument ${document.id}  ${JSON.stringify(document.name)}  owner ${document.user_id}`);

  const { data: snapshot, error: snapshotError } = await service
    .from('annotation_snapshots')
    .select('at_seq, encoding_version, writer_id, writer_epoch, updated_at')
    .eq('document_id', documentId)
    .maybeSingle();
  if (snapshotError) throw snapshotError;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token) {
    const [wal] = await readOnlySql(projectRef, token, `select count(*)::int as rows,
        coalesce(sum(octet_length(data)), 0)::bigint as bytes,
        coalesce(max(octet_length(data)), 0)::bigint as max_bytes,
        count(*) filter (where octet_length(data) > ${WAL_ROW_BUDGET_BYTES})::int as over_budget,
        min(seq) as min_seq, max(seq) as max_seq
      from public.annotation_updates where document_id = '${documentId}'`);
    const after = snapshot ? Number(snapshot.at_seq) : 0;
    const [tail] = await readOnlySql(projectRef, token, `select count(*)::int as rows,
        coalesce(sum(octet_length(data)), 0)::bigint as bytes,
        coalesce(max(octet_length(data)), 0)::bigint as max_bytes,
        count(*) filter (where octet_length(data) > ${WAL_ROW_BUDGET_BYTES})::int as over_budget
      from public.annotation_updates where document_id = '${documentId}' and seq > ${after}`);
    const big = await readOnlySql(projectRef, token, `select seq, octet_length(data)::bigint as bytes, created_at
      from public.annotation_updates where document_id = '${documentId}'
        and octet_length(data) > ${WAL_ROW_BUDGET_BYTES} order by seq`);
    const [snapSize] = await readOnlySql(projectRef, token, `select coalesce(octet_length(snapshot), 0)::bigint as bytes
      from public.annotation_snapshots where document_id = '${documentId}'`).then((rows) => (rows.length ? rows : [{ bytes: 0 }]));
    console.log(`WAL rows: ${wal.rows} (seq ${wal.min_seq}..${wal.max_seq}), ${kb(wal.bytes)} total, largest ${kb(wal.max_bytes)}, ${wal.over_budget} over ${kb(WAL_ROW_BUDGET_BYTES)}`);
    console.log(`Rows an open must read (after the checkpoint): ${tail.rows}, ${kb(tail.bytes)}, largest ${kb(tail.max_bytes)}, ${tail.over_budget} over budget`);
    for (const row of big) console.log(`  oversized row seq ${row.seq}: ${kb(row.bytes)} (${row.created_at})`);
    console.log(`Checkpoint: ${snapshot ? `at seq ${snapshot.at_seq}, ${kb(snapSize.bytes)} stored (gzip ${snapshot.encoding_version === 2 ? 'yes' : 'no'}), writer ${snapshot.writer_id} epoch ${snapshot.writer_epoch}, saved ${snapshot.updated_at}` : 'none'}`);
  } else {
    console.log('SUPABASE_ACCESS_TOKEN not set: skipping byte sizes.');
    console.log(`Checkpoint: ${snapshot ? `at seq ${snapshot.at_seq}, writer ${snapshot.writer_id} epoch ${snapshot.writer_epoch}` : 'none'}`);
  }

  if (!args.apply) {
    console.log('\nDry run only. Nothing was changed.');
    console.log('--apply would write an EMPTY checkpoint at the current WAL head, so the next editor open starts from an empty store and re-imports the PDF markup (in rows under 256 KB).');
    return;
  }

  if (args.confirm !== documentId) throw new Error('--apply needs --confirm <the same document id>');
  const accessToken = requireEnv('RESET_EDITOR_ACCESS_TOKEN');
  const editor = createClient(url, requireEnv('VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  // The WAL head the empty checkpoint claims (the RPC refuses any other value).
  const { data: headRows, error: headError } = await editor
    .from('annotation_updates')
    .select('seq')
    .eq('document_id', documentId)
    .order('seq', { ascending: false })
    .limit(1);
  if (headError) throw headError;
  const head = Number(headRows?.[0]?.seq) || 0;

  const empty = gzipSync(Y.encodeStateAsUpdate(new Y.Doc()));
  const hex = `\\x${Buffer.from(empty).toString('hex')}`;
  const writerEpoch = (Number(snapshot?.writer_epoch) || 0) + 1;
  const { data: accepted, error: writeError } = await editor.rpc('store_annotation_snapshot', {
    p_document_id: documentId,
    p_at_seq: head,
    p_snapshot: hex,
    p_encoding_version: 2,
    p_writer_id: 'w26-reset',
    p_writer_epoch: writerEpoch,
    p_expected_at_seq: snapshot ? Number(snapshot.at_seq) : null,
    p_expected_writer_id: snapshot ? snapshot.writer_id : null,
    p_expected_writer_epoch: snapshot ? Number(snapshot.writer_epoch) || 0 : 0,
  });
  if (writeError) throw writeError;
  const ok = Array.isArray(accepted) ? accepted[0] : accepted;
  if (!ok) throw new Error('the checkpoint was refused (a newer row or checkpoint landed; close the document everywhere and run again)');
  console.log(`Reset: empty checkpoint stored at seq ${head}. The next editor open re-imports the PDF's markup.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
