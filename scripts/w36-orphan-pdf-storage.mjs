#!/usr/bin/env node
// Written: 2026-09-25 (w36, stay inside Supabase Free)
//
// Stored PDFs no document points at. On 2026-09-25 prod "Survey" held 61 such
// objects in the "documents" bucket, 380 MB of its 562 MB (Free: 1 GB), all
// uploaded 2026-02-01..06-06 under the old timestamp paths
// (<user>/<project>/<epoch>.pdf), before uploads became content-addressed and
// before deletes unlinked their file. No documents row, template or survey
// session references any of them (read-only SQL, 2026-09-25):
//
//   select o.name, o.metadata->>'size', o.created_at from storage.objects o
//    where o.bucket_id = 'documents'
//      and not exists (select 1 from public.documents d where d.file_path = o.name)
//      and not exists (select 1 from public.templates t
//                       where t.file_path = o.name or t.linked_excel_path = o.name)
//      and not exists (select 1 from public.survey_sessions s where s.excel_file_path = o.name);
//
// OWNER DECISION: removing them cannot be undone. Dry run by default.
//
//   node scripts/w36-orphan-pdf-storage.mjs                     # list, change nothing
//   node scripts/w36-orphan-pdf-storage.mjs --apply --confirm <N>   # remove exactly N
//
// Needs SUPABASE_SERVICE_ROLE_KEY for prod in the environment (every user's
// folder is listed; Storage deletes go through the Storage API, never SQL).
// VITE_SUPABASE_URL is read from .env in the working directory when unset.
// Only objects older than 7 days are ever removed (an upload whose documents
// row is still being written is never touched).

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const confirmIndex = args.indexOf('--confirm');
const CONFIRM = confirmIndex >= 0 ? Number(args[confirmIndex + 1]) : null;
const MIN_AGE_MS = 7 * 24 * 3600 * 1000;

function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = fs.readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') : null;
  } catch { return null; }
}
const url = envValue('VITE_SUPABASE_URL');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (and VITE_SUPABASE_URL) first.');
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function allRows(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function listAll(prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from('documents').list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id == null) out.push(...await listAll(path)); // a folder
      else out.push({ path, size: Number(entry.metadata?.size) || 0, createdAt: entry.created_at });
    }
    if (data.length < 1000) return out;
  }
}

const referenced = new Set();
for (const row of await allRows('documents', 'file_path')) if (row.file_path) referenced.add(row.file_path);
for (const row of await allRows('templates', 'file_path, linked_excel_path')) {
  if (row.file_path) referenced.add(row.file_path);
  if (row.linked_excel_path) referenced.add(row.linked_excel_path);
}
for (const row of await allRows('survey_sessions', 'excel_file_path')) if (row.excel_file_path) referenced.add(row.excel_file_path);

const objects = await listAll();
const now = Date.now();
const orphans = objects.filter((o) => !referenced.has(o.path) && now - Date.parse(o.createdAt) > MIN_AGE_MS);
const total = orphans.reduce((sum, o) => sum + o.size, 0);
for (const o of orphans) console.log(`${o.createdAt?.slice(0, 10)}  ${(o.size / 1e6).toFixed(2).padStart(8)} MB  ${o.path}`);
console.log(`\n${objects.length} stored objects; ${orphans.length} referenced by nothing and older than 7 days: ${(total / 1e6).toFixed(1)} MB.`);

if (!APPLY) {
  console.log(`Dry run. To remove exactly these: --apply --confirm ${orphans.length}`);
  process.exit(0);
}
if (CONFIRM !== orphans.length) {
  console.error(`Refusing: --confirm ${CONFIRM} does not match the ${orphans.length} objects found now.`);
  process.exit(1);
}
let removed = 0;
for (let i = 0; i < orphans.length; i += 100) {
  const batch = orphans.slice(i, i + 100).map((o) => o.path);
  const { data, error } = await supabase.storage.from('documents').remove(batch);
  if (error) { console.error('remove failed:', error.message); process.exit(1); }
  removed += data?.length || 0;
}
console.log(`Removed ${removed} objects (${(total / 1e6).toFixed(1)} MB).`);
