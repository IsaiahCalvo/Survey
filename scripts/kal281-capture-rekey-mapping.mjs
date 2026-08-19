#!/usr/bin/env node
// KAL-281 — capture the reversal mapping BEFORE the storage re-key runs.
//
// The re-key copies each legacy-named PDF to its content-addressed path and
// then DELETES the original. This Supabase project has no point-in-time
// recovery, so the old-path -> new-path mapping written here is the only way
// to reverse that. It is written, then read back and structurally re-checked
// in the same run; the script exits non-zero if the file on disk does not
// round-trip.
//
//   node scripts/kal281-capture-rekey-mapping.mjs [outDir]
//
// Read-only against production. Writes JSON only.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../agent-cli/lib/env.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'documents';

loadEnv();
const url = process.env.SUPABASE_MAINT_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_MAINT_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing Supabase URL or service key.');
  process.exit(1);
}
const base = url.replace(/\/+$/, '');
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...headers, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`REST ${pathAndQuery} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function storageList(prefix, offset) {
  const res = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!res.ok) throw new Error(`storage list ${prefix} -> ${res.status}`);
  return res.json();
}

async function fetchAllRows() {
  const rows = [];
  for (let from = 0; ;) {
    const page = await rest(
      'documents?select=id,user_id,project_id,name,file_path,file_size,content_sha256,archived,created_at&order=created_at.asc',
      { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } }
    );
    rows.push(...page);
    if (page.length === 0) break;
    from += page.length;
  }
  return rows;
}

// Full object inventory, including size/metadata so a restore can sanity-check bytes.
async function listAllObjects() {
  const objects = [];
  const queue = [''];
  while (queue.length) {
    const prefix = queue.shift();
    for (let offset = 0; ;) {
      const entries = await storageList(prefix, offset);
      for (const e of entries) {
        const full = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) queue.push(full);
        else objects.push({
          path: full,
          id: e.id,
          size: e.metadata?.size ?? null,
          mimetype: e.metadata?.mimetype ?? null,
          created_at: e.created_at ?? null,
          updated_at: e.updated_at ?? null,
        });
      }
      if (entries.length === 0) break;
      offset += entries.length;
    }
  }
  return objects;
}

const outDir = process.argv[2] || join(REPO_ROOT, 'debug', 'backups', '2026-08-19');

const [rows, objects] = await Promise.all([fetchAllRows(), listAllObjects()]);
const objectPaths = new Set(objects.map((o) => o.path));

const mapping = [];
for (const r of rows) {
  if (!r.content_sha256 || !r.file_path) continue;
  if (!String(r.file_path).startsWith(`${r.user_id}/`)) continue; // rekey skips these
  const to = `${r.user_id}/${r.content_sha256}.pdf`;
  if (r.file_path === to) continue;
  mapping.push({
    document_id: r.id,
    document_name: r.name,
    user_id: r.user_id,
    project_id: r.project_id,
    archived: r.archived,
    from: r.file_path,
    to,
    sha256: r.content_sha256,
    from_object_size: objects.find((o) => o.path === r.file_path)?.size ?? null,
    from_object_present: objectPaths.has(r.file_path),
    to_object_already_present: objectPaths.has(to),
  });
}

const payload = {
  purpose: 'KAL-281 storage re-key — pre-move inventory and reversal mapping',
  captured_at: new Date().toISOString(),
  host: new URL(base).host,
  bucket: BUCKET,
  how_to_reverse:
    'For each entry: copy `to` back to `from` in the documents bucket, PATCH documents.file_path back to `from` (service_role bypasses the file_path-immutable trigger), then delete `to`. sha256 is the expected content hash on both sides.',
  counts: {
    document_rows: rows.length,
    document_rows_active: rows.filter((r) => !r.archived).length,
    document_rows_archived: rows.filter((r) => r.archived).length,
    storage_objects: objects.length,
    planned_moves: mapping.length,
    moves_with_source_present: mapping.filter((m) => m.from_object_present).length,
    moves_with_destination_already_present: mapping.filter((m) => m.to_object_already_present).length,
  },
  mapping,
  storage_inventory: objects,
  document_rows: rows,
};

await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = join(outDir, `kal281-rekey-mapping-${stamp}.json`);
await writeFile(file, JSON.stringify(payload, null, 2));

// Read it back and re-check it: an unreadable or short mapping file is the one
// failure mode that would leave the re-key irreversible.
const reread = JSON.parse(await readFile(file, 'utf8'));
const problems = [];
if (reread.mapping.length !== mapping.length) problems.push('mapping length changed on re-read');
if (reread.storage_inventory.length !== objects.length) problems.push('inventory length changed on re-read');
if (reread.document_rows.length !== rows.length) problems.push('document rows length changed on re-read');
for (const m of reread.mapping) {
  if (!m.from || !m.to || !/^[0-9a-f]{64}$/.test(m.sha256 || '')) problems.push(`incomplete entry ${m.document_id}`);
  if (!objectPaths.has(m.from)) problems.push(`source object missing for ${m.document_id} (${m.from})`);
}

console.log(JSON.stringify({ file, counts: payload.counts, problems }, null, 2));
if (problems.length) {
  console.error('\nMapping backup FAILED verification — do not run the re-key.');
  process.exit(1);
}
console.log('\nMapping backup written and verified re-readable.');
