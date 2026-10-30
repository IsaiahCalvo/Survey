#!/usr/bin/env node
// scripts/r2-copy-pdfs.mjs — copy stored PDFs into Cloudflare R2 (docs/PDF-R2.md).
//
// Every R2 operation is first reserved with public.r2_reserve, the same
// free-tier guard pdf-file-url uses; past it, nothing more is copied.
//
// Optional: pdf-file-url copies each PDF the first time it is opened, so
// nothing breaks if this never runs. Run it to warm R2 before turning the
// 'pdf-r2' flag on for everyone, to set the bucket's CORS rule, or to remove
// copies whose PDF is gone.
//
//   node scripts/r2-copy-pdfs.mjs --cors        # set the bucket CORS rule the app needs
//   node scripts/r2-copy-pdfs.mjs --dry-run     # count what would be copied
//   node scripts/r2-copy-pdfs.mjs               # copy every PDF R2 lacks or holds an old version of
//   node scripts/r2-copy-pdfs.mjs --prune       # also delete R2 copies with no PDF in Storage
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ENDPOINT, R2_BUCKET,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (R2_REGION optional). A non-local
// SUPABASE_URL needs --production, so a stray shell variable cannot point a
// test run at the live project.

import {
  deleteObject, headObject, listObjects, putBucketCors, putObjectStream, r2ConfigFromEnv, r2KeyForDocument,
} from '../supabase/functions/_shared/r2.js';
import { copyWriteOps, normalizeEtag } from '../supabase/functions/_shared/pdfFileUrl.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const prune = args.has('--prune');
const CONCURRENCY = 4;
const BUCKET = 'documents';

const fail = (message) => {
  console.error(`[r2-copy] ${message}`);
  process.exit(1);
};
const log = (...parts) => console.log('[r2-copy]', ...parts);

const config = r2ConfigFromEnv((name) => process.env[name]);
if (!config) fail('Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');

if (args.has('--cors')) {
  await putBucketCors(config);
  log(`CORS rule set on bucket ${config.bucket}.`);
  if (args.size === 1) process.exit(0);
}

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!supabaseUrl || !serviceKey) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl);
if (!local && !args.has('--production')) fail(`${supabaseUrl} is not local; add --production to really use it.`);

const asService = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// Every object in the bucket, walking folders (Storage lists one level at a time).
async function listStored(prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...asService, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) fail(`Storage list ${res.status}: ${await res.text()}`);
    const page = await res.json();
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id == null) found.push(...await listStored(path));
      else found.push({ path, etag: normalizeEtag(item.metadata?.eTag), size: Number(item.metadata?.size) });
    }
    if (page.length < 1000) return found;
  }
}

// The free-tier ledger (migration 20261028090000). false = over the cap.
async function reserve(classA, classB, path = null, bytes = 0) {
  if (dryRun && path) return true;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/r2_reserve`, {
    method: 'POST',
    headers: { ...asService, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_class_a: classA, p_class_b: classB, p_path: path, p_bytes: bytes }),
  });
  if (!res.ok) fail(`r2_reserve ${res.status}: ${await res.text()}`);
  return (await res.json()) === true;
}

const forget = (path) => fetch(`${supabaseUrl}/rest/v1/pdf_r2_copies?path=eq.${encodeURIComponent(path)}`, {
  method: 'DELETE', headers: asService,
}).then((res) => res.body?.cancel());

async function copyOne(object) {
  const key = r2KeyForDocument(object.path);
  if (!await reserve(0, 1)) return 'over_budget';
  const copy = await headObject(config, key);
  if (copy.exists && normalizeEtag(copy.meta['src-etag']) === object.etag && copy.size === object.size) return 'current';
  if (dryRun) return 'would_copy';
  if (!await reserve(copyWriteOps(object.size), 0, object.path, object.size)) return 'over_budget';
  const res = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/${BUCKET}/${encodePath(object.path)}`, { headers: asService });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    if (!copy.exists) await forget(object.path);
    return `download_${res.status}`;
  }
  const etag = normalizeEtag(res.headers.get('etag')) ?? object.etag;
  try {
    await putObjectStream(config, key, res.body, { meta: { 'src-etag': etag } });
  } catch (error) {
    if (!copy.exists) await forget(object.path);
    throw error;
  }
  return 'copied';
}

const stored = (await listStored()).filter((o) => /\.pdf$/i.test(o.path));
log(`${stored.length} PDFs in Storage (${(stored.reduce((n, o) => n + (o.size || 0), 0) / 1e9).toFixed(2)} GB).`);

const counts = {};
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < stored.length) {
    const object = stored[next++];
    let outcome;
    try {
      outcome = await copyOne(object);
    } catch (error) {
      outcome = 'failed';
      console.error(`[r2-copy] ${object.path}: ${error.message}`);
    }
    counts[outcome] = (counts[outcome] || 0) + 1;
  }
}));
log('copy:', JSON.stringify(counts));

if (prune) {
  const live = new Set(stored.map((o) => r2KeyForDocument(o.path)));
  let removed = 0;
  let extra = 0;
  let token = null;
  do {
    if (!await reserve(1, 0)) fail('prune: over the R2 free-tier cap; stopped.');
    const page = await listObjects(config, `${BUCKET}/`, { continuationToken: token });
    for (const key of page.keys) {
      if (live.has(key)) continue;
      extra += 1;
      if (!dryRun) {
        await deleteObject(config, key);
        await forget(key.slice(BUCKET.length + 1));
        removed += 1;
      }
    }
    token = page.next;
  } while (token);
  log(`prune: ${extra} copies with no PDF in Storage, ${removed} deleted.`);
}

if (counts.over_budget) log('Stopped short: the R2 free-tier cap (80%) was reached; the rest stays on Supabase.');
if (counts.failed || Object.keys(counts).some((k) => k.startsWith('download_'))) process.exit(1);
