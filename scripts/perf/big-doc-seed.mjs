#!/usr/bin/env node
// Seeds a big drawing set into the LOCAL e2e Supabase stack for open-path
// profiling (scripts/perf/big-doc-open.mjs): a generated multi-page PDF owned by
// the e2e owner account, plus thousands of markups spread across its pages.
// Refuses any host but 127.0.0.1/localhost.
//
//   BIG_DOC_PAGES=240 BIG_DOC_MARKUPS=4000 node scripts/perf/big-doc-seed.mjs
import fs from 'node:fs';
import { crc32, deflateSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as Y from 'yjs';
import { syncByPageToDoc } from '../../src/services/annotationDocStore.js';
import { serializeFabricObjectToRow } from '../../src/services/annotationTypeSerializers.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from '../../tests/e2e-signed-in/accounts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BIG_DOC = {
  id: 'e2eb1600-0000-4000-8000-000000000201',
  name: 'Big Drawing Set.pdf',
};
const PAGES = Number(process.env.BIG_DOC_PAGES || 240);
const MARKUPS = Number(process.env.BIG_DOC_MARKUPS || 4000);
// BIG_DOC_SHEET_KB=<n> adds an n-KB raster (a scanned detail) to every sheet.
// Generated vector sheets compress to almost nothing (240 sheets = 0.8 MB);
// real drawing sets run 20-100 MB, which is what a phone has to download.
const SHEET_KB = Number(process.env.BIG_DOC_SHEET_KB || 0);

// A grayscale noise PNG of about `kb` KB (noise does not compress).
function noisePng(kb, seed) {
  const width = 512;
  const height = Math.max(1, Math.round((kb * 1024) / width));
  const raw = Buffer.alloc((width + 1) * height);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < raw.length; i += 1) {
    if (i % (width + 1) === 0) { raw[i] = 0; continue; }
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    raw[i] = 128 + (x & 127);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function readEnv() {
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.e2e'), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const url = env.VITE_SUPABASE_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url || '')) throw new Error(`refusing non-local Supabase URL ${url}`);
  return { url, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.VITE_SUPABASE_ANON_KEY };
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

// Arch-D sheet (36x24 in) with a title block and a dense grid of vector linework,
// close to what a real construction drawing set costs pdf.js to render.
async function buildPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= PAGES; p += 1) {
    const page = doc.addPage([2592, 1728]);
    for (let i = 0; i < 160; i += 1) {
      const x = 60 + ((i * 97 + p * 13) % 2300);
      const y = 60 + ((i * 53 + p * 29) % 1500);
      page.drawLine({ start: { x, y }, end: { x: x + 180, y: y + ((i % 7) - 3) * 30 }, thickness: 1 + (i % 3), color: rgb(0, 0, 0) });
      if (i % 4 === 0) page.drawRectangle({ x, y, width: 120, height: 80, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
      if (i % 8 === 0) page.drawText(`ROOM ${p}-${i}`, { x: x + 6, y: y + 6, size: 14, font });
    }
    page.drawRectangle({ x: 2200, y: 40, width: 350, height: 200, borderColor: rgb(0, 0, 0), borderWidth: 3 });
    page.drawText(`SHEET A-${String(p).padStart(3, '0')}`, { x: 2220, y: 180, size: 28, font });
    if (SHEET_KB > 0) {
      const image = await doc.embedPng(noisePng(SHEET_KB, p));
      page.drawImage(image, { x: 1700, y: 40, width: 480, height: 480 * (image.height / image.width) });
    }
  }
  return Buffer.from(await doc.save());
}

function markup(i, docId, userId) {
  const pageNumber = (i % PAGES) + 1;
  const id = `bigdoc-${i}`;
  const left = 80 + ((i * 37) % 2200);
  const top = 80 + ((i * 61) % 1400);
  let obj;
  switch (i % 4) {
    case 0: {
      const pathCmds = [['M', left, top]];
      for (let k = 1; k < 120; k += 1) pathCmds.push(['Q', left + k * 2, top + (k % 9) * 3, left + k * 2 + 1, top + (k % 7) * 3]);
      obj = { type: 'path', path: pathCmds, left, top, width: 240, height: 30, stroke: '#d22', fill: null, strokeWidth: 3, data: { id, type: 'ink' } };
      break;
    }
    case 1:
      obj = { type: 'rect', left, top, width: 120, height: 80, stroke: '#1565c0', fill: 'transparent', strokeWidth: 2, data: { id } };
      break;
    case 2:
      obj = { type: 'ellipse', left, top, rx: 50, ry: 30, stroke: '#2e7d32', fill: 'transparent', strokeWidth: 2, data: { id } };
      break;
    default:
      obj = { type: 'textbox', text: `Note ${i}: verify dimension`, left, top, width: 220, fontSize: 16, fontFamily: 'Helvetica', fill: '#222', data: { id } };
  }
  return serializeFabricObjectToRow(obj, { documentId: docId, userId, pageNumber, annotationId: id });
}

async function main() {
  const { url, serviceKey, anonKey } = readEnv();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const listed = await must('list users', admin.auth.admin.listUsers({ page: 1, perPage: 1000 }));
  const owner = listed.users.find((u) => u.email === E2E_ACCOUNTS.owner.email);
  if (!owner) throw new Error('run `npm run e2e:seed` first');

  const pdf = await buildPdf();
  const filePath = `${owner.id}/${BIG_DOC.id}.pdf`;
  await must('upload pdf', admin.storage.from('documents').upload(filePath, new Blob([pdf], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true }));
  // Start from a clean document row every time (markups, WAL and snapshots
  // cascade with it); file_path is immutable, so delete + insert.
  await must('drop document', admin.from('documents').delete().eq('id', BIG_DOC.id));
  const now = new Date().toISOString();
  await must('document', admin.from('documents').insert({
    id: BIG_DOC.id, user_id: owner.id, project_id: E2E_PROJECT.id, name: BIG_DOC.name, file_path: filePath,
    file_size: pdf.length, page_count: PAGES, content_sha256: createHash('sha256').update(pdf).digest('hex'),
    cutover_completed_at: now, embedded_import_completed_at: now,
  }));
  const rows = [];
  for (let i = 0; i < MARKUPS; i += 1) rows.push(markup(i, BIG_DOC.id, owner.id));
  // Legacy dual-write rows (what the app still writes next to the Y.Doc).
  for (let at = 0; at < rows.length; at += 200) {
    await must('markups', admin.from('document_annotations').upsert(rows.slice(at, at + 200), { onConflict: 'document_id,annotation_id' }));
  }
  // Source of truth: the Yjs op log, written through the app's own store
  // mapping and appended as the owner, one update per batch of marks.
  const owned = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await must('owner sign-in', owned.auth.signInWithPassword({ email: E2E_ACCOUNTS.owner.email, password: E2E_ACCOUNTS.owner.password }));
  const doc = new Y.Doc();
  const byPage = {};
  const clientId = `bigdoc-seed-${Date.now()}`;
  let seq = 0;
  let pending = [];
  doc.on('update', (u) => { pending.push(u); });
  const BATCH = 50;
  for (let at = 0; at < rows.length; at += BATCH) {
    for (const row of rows.slice(at, at + BATCH)) {
      const page = (byPage[row.page_number] ||= { objects: [] });
      page.objects.push(row.annotation_data.fabricObject);
    }
    pending = [];
    syncByPageToDoc(doc, byPage);
    if (!pending.length) continue;
    const update = Y.mergeUpdates(pending);
    seq += 1;
    await must('append update', owned.rpc('append_annotation_update', {
      p_document_id: BIG_DOC.id, p_client_id: clientId, p_client_seq: seq, p_data: `\\x${Buffer.from(update).toString('hex')}`,
    }));
  }
  // Steady state of a heavily marked document: the app checkpoints a full
  // snapshot every ~40 own rows, so an open reads one snapshot plus a short
  // tail. Store the snapshot at the head of the log, then a 12-row tail.
  const head = await must('head seq', admin.from('annotation_updates').select('seq').eq('document_id', BIG_DOC.id).order('seq', { ascending: false }).limit(1));
  const snap = gzipSync(Y.encodeStateAsUpdate(doc));
  const stored = await must('snapshot', owned.rpc('store_annotation_snapshot', {
    p_document_id: BIG_DOC.id, p_at_seq: head[0].seq, p_snapshot: `\\x${snap.toString('hex')}`, p_encoding_version: 2,
    p_writer_id: clientId, p_writer_epoch: 1, p_expected_at_seq: null, p_expected_writer_id: null, p_expected_writer_epoch: 0,
  }));
  for (let t = 0; t < 12; t += 1) {
    const obj = byPage[(t % PAGES) + 1].objects[0];
    obj.left += 5;
    pending = [];
    syncByPageToDoc(doc, byPage);
    if (!pending.length) continue;
    seq += 1;
    await must('tail update', owned.rpc('append_annotation_update', {
      p_document_id: BIG_DOC.id, p_client_id: clientId, p_client_seq: seq, p_data: `\\x${Buffer.from(Y.mergeUpdates(pending)).toString('hex')}`,
    }));
  }
  console.log('[big-doc] snapshot', (snap.length / 1e6).toFixed(2), 'MB gz', JSON.stringify(stored));
  console.log(`[big-doc] ${BIG_DOC.name}: ${PAGES} pages (${(pdf.length / 1e6).toFixed(1)} MB), ${rows.length} markups`);
}

main().catch((e) => { console.error(e); process.exit(1); });
