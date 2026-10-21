#!/usr/bin/env node
// scripts/db-load-test.mjs — signed-in database load test against the LOCAL
// Supabase stack (npm run e2e:stack:up). Never points at production: it reads
// .env.e2e and refuses any host but 127.0.0.1 / localhost.
//
//   node scripts/db-load-test.mjs                      # defaults below
//   LOAD_STAGES=10,50,100 LOAD_STAGE_SECONDS=30 node scripts/db-load-test.mjs
//
// Each virtual user is a real signed-in account with its own project, document
// and seeded markups. With no pause between requests it loops over what the app
// does most, with the same filters the app sends (src/hooks/useDatabase.js,
// src/services/annotationCloudSync.js): save a markup, reload a document's
// markups, list my documents and projects, read feature flags. Stages
// step up how many users run at once; the report shows throughput, wait times
// and errors per stage, so the knee (where waits climb) is easy to see.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { serializeFabricObjectToRow } from '../src/services/annotationTypeSerializers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGES = (process.env.LOAD_STAGES || '10,25,50,100,200').split(',').map(Number);
const STAGE_SECONDS = Number(process.env.LOAD_STAGE_SECONDS || 20);
const SEED_MARKUPS = Number(process.env.LOAD_SEED_MARKUPS || 300);
const USERS = Math.max(...STAGES);
const PASSWORD = 'Load-local-only-123!';
const OUT = process.env.LOAD_OUT || path.join(ROOT, '.e2e/db-load-test.md');
const READ_COLUMNS = 'id, user_id, annotation_id, annotation_type, page_number, annotation_data, created_at, updated_at';

function readEnv() {
  const file = path.join(ROOT, '.env.e2e');
  if (!fs.existsSync(file)) throw new Error('no .env.e2e; start the stack with npm run e2e:stack:up');
  const env = Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const url = env.VITE_SUPABASE_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url || '')) throw new Error(`refusing non-local Supabase URL ${url}`);
  return { url, anonKey: env.VITE_SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A pen stroke of ~120 points, close to what a real ink markup weighs.
function inkStroke(id, seed) {
  const pathCmds = [['M', seed % 500, 100]];
  for (let i = 1; i < 120; i += 1) pathCmds.push(['Q', (seed + i * 3) % 600, 100 + i, (seed + i * 3 + 1) % 600, 101 + i]);
  return { type: 'path', path: pathCmds, left: seed % 500, top: 100, width: 360, height: 120, stroke: '#d22', fill: null, strokeWidth: 3, data: { id, type: 'ink' } };
}

function markupRow(docId, userId, annotationId, seed) {
  try {
    return serializeFabricObjectToRow(inkStroke(annotationId, seed), { documentId: docId, userId, pageNumber: 1, annotationId });
  } catch {
    return serializeFabricObjectToRow({ type: 'rect', left: seed % 500, top: 50, width: 40, height: 30, stroke: '#d22', strokeWidth: 2, data: { id: annotationId } },
      { documentId: docId, userId, pageNumber: 1, annotationId });
  }
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function setup({ url, serviceKey, anonKey }) {
  const admin = createClient(url, serviceKey, noSession);
  const existing = new Map();
  for (let page = 1; ; page += 1) {
    const { users } = await must('list users', admin.auth.admin.listUsers({ page, perPage: 1000 }));
    users.forEach((user) => existing.set(user.email, user));
    if (users.length < 1000) break;
  }
  const accounts = [];
  for (let i = 0; i < USERS; i += 1) {
    const email = `load-${String(i).padStart(4, '0')}@example.com`;
    let user = existing.get(email);
    if (!user) user = (await must(`create ${email}`, admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true }))).user;
    const projectId = uuid('10ad0000', i);
    const documentId = uuid('10ad0001', i);
    await must('subscription', admin.from('user_subscriptions').upsert({ user_id: user.id, tier: 'pro', status: 'active' }, { onConflict: 'user_id' }));
    await must('project', admin.from('projects').upsert({ id: projectId, user_id: user.id, name: `Load project ${i}` }, { onConflict: 'id' }));
    await must('document', admin.from('documents').upsert({
      id: documentId, user_id: user.id, project_id: projectId, name: `Load drawing ${i}.pdf`,
      file_path: `${user.id}/${documentId}.pdf`, file_size: 1024, page_count: 1,
    }, { onConflict: 'id', ignoreDuplicates: true }));
    const rows = [];
    for (let m = 0; m < SEED_MARKUPS; m += 1) rows.push(markupRow(documentId, user.id, `seed-${i}-${m}`, m * 7 + i));
    for (let at = 0; at < rows.length; at += 100) {
      await must('seed markups', admin.from('document_annotations').upsert(rows.slice(at, at + 100), { onConflict: 'document_id,annotation_id' }));
    }
    accounts.push({ email, userId: user.id, projectId, documentId });
  }

  // Sign in for real, a few at a time (local stack only; production limits
  // sign-ins per IP, which real users never share).
  for (let at = 0; at < accounts.length; at += 10) {
    await Promise.all(accounts.slice(at, at + 10).map(async (account) => {
      const client = createClient(url, anonKey, noSession);
      await must(`sign in ${account.email}`, client.auth.signInWithPassword({ email: account.email, password: PASSWORD }));
      account.client = client;
    }));
  }
  return accounts;
}

// Remove every load account and its rows so the stack is left as seeded.
// Finds them by email, so it also cleans up after a run that failed midway.
async function cleanup({ url, serviceKey }) {
  const admin = createClient(url, serviceKey, noSession);
  const ids = [];
  for (let page = 1; ; page += 1) {
    const { users } = await must('list users', admin.auth.admin.listUsers({ page, perPage: 1000 }));
    users.filter((user) => /^load-\d+@example\.com$/.test(user.email || '')).forEach((user) => ids.push(user.id));
    if (users.length < 1000) break;
  }
  for (let at = 0; at < ids.length; at += 100) {
    const batch = ids.slice(at, at + 100);
    const docs = await must('find documents', admin.from('documents').select('id').in('user_id', batch));
    const docIds = docs.map((doc) => doc.id);
    if (docIds.length) {
      await must('drop markups', admin.from('document_annotations').delete().in('document_id', docIds));
      await must('drop documents', admin.from('documents').delete().in('id', docIds));
    }
    await must('drop projects', admin.from('projects').delete().in('user_id', batch));
    await must('drop subscriptions', admin.from('user_subscriptions').delete().in('user_id', batch));
    // handle_new_user() adds a profile row with no cascade from auth.users.
    await must('drop profiles', admin.from('users').delete().in('id', batch));
  }
  for (const id of ids) await must(`delete user ${id}`, admin.auth.admin.deleteUser(id));
  return ids.length;
}

// Same keyset paging as loadPagedAnnotationRows() in annotationCloudSync.js.
async function openMarkups(account) {
  let cursor = null;
  for (;;) {
    let query = account.client.from('document_annotations')
      .select(READ_COLUMNS).eq('document_id', account.documentId).order('id', { ascending: true }).limit(1000);
    if (cursor !== null) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error || data.length < 1000) return { error };
    cursor = data[data.length - 1].id;
  }
}

const OPS = [
  ['save markup', 55, (a, n) => a.client.from('document_annotations')
    .upsert(markupRow(a.documentId, a.userId, `live-${n % 50}`, n), { onConflict: 'document_id,annotation_id', ignoreDuplicates: false })
    .select('annotation_id, updated_at').single()],
  ['open document markups', 10, (a) => openMarkups(a)],
  ['list documents', 15, (a) => a.client.from('documents')
    .select('*').eq('user_id', a.userId).eq('archived', false)],
  ['list projects', 12, (a) => a.client.from('projects').select('*').eq('user_id', a.userId)],
  ['feature flags', 8, (a) => a.client.rpc('get_my_feature_flags')],
];
const TOTAL_WEIGHT = OPS.reduce((sum, op) => sum + op[1], 0);
function pickOp(n) {
  let roll = (n * 2654435761) % TOTAL_WEIGHT;
  for (const op of OPS) { if (roll < op[1]) return op; roll -= op[1]; }
  return OPS[0];
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

async function runStage(accounts, concurrency) {
  const stats = new Map(OPS.map(([name]) => [name, { times: [], errors: 0, sample: null }]));
  const stopAt = Date.now() + STAGE_SECONDS * 1000;
  let counter = 0;
  await Promise.all(accounts.slice(0, concurrency).map(async (account) => {
    while (Date.now() < stopAt) {
      counter += 1;
      const [name, , fn] = pickOp(counter);
      const start = performance.now();
      let error;
      try { ({ error } = await fn(account, counter)); } catch (thrown) { error = thrown; }
      const stat = stats.get(name);
      stat.times.push(performance.now() - start);
      if (error) { stat.errors += 1; stat.sample ||= error.message || String(error); }
    }
  }));
  const all = [...stats.values()].flatMap((s) => s.times).sort((x, y) => x - y);
  return {
    concurrency,
    total: all.length,
    perSecond: all.length / STAGE_SECONDS,
    p50: pct(all, 0.5), p95: pct(all, 0.95), p99: pct(all, 0.99),
    errors: [...stats.values()].reduce((sum, s) => sum + s.errors, 0),
    ops: [...stats.entries()].map(([name, s]) => {
      const sorted = s.times.sort((x, y) => x - y);
      return { name, count: sorted.length, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), errors: s.errors, sample: s.sample };
    }),
  };
}

const ms = (value) => `${Math.round(value)} ms`;

async function main() {
  const env = readEnv();
  console.log(`[db-load] setting up ${USERS} signed-in users with ${SEED_MARKUPS} markups each`);
  let accounts;
  try {
    accounts = await setup(env);
  } catch (error) {
    console.log(`[db-load] setup failed; removed ${await cleanup(env)} load accounts`);
    throw error;
  }
  const results = [];
  for (const concurrency of STAGES) {
    console.log(`[db-load] ${concurrency} users at once for ${STAGE_SECONDS}s`);
    const result = await runStage(accounts, concurrency);
    results.push(result);
    console.log(`[db-load]   ${Math.round(result.perSecond)} req/s, middle ${ms(result.p50)}, slow 5% ${ms(result.p95)}, errors ${result.errors}`);
  }
  const lines = [
    `# Signed-in database load test (local stack)`,
    '',
    `${USERS} accounts, ${SEED_MARKUPS} seeded markups each, ${STAGE_SECONDS} s per stage, no pause between requests.`,
    '',
    '| Users at once | Requests/s | Middle wait | Slowest 5% | Slowest 1% | Errors |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.concurrency} | ${Math.round(r.perSecond)} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} | ${r.errors} |`),
    '',
  ];
  for (const r of results) {
    lines.push(`## ${r.concurrency} users at once`, '', '| Action | Count | Middle | Slowest 5% | Errors |', '|---|---|---|---|---|');
    for (const op of r.ops) lines.push(`| ${op.name} | ${op.count} | ${ms(op.p50)} | ${ms(op.p95)} | ${op.errors}${op.sample ? ` (${op.sample.slice(0, 80)})` : ''} |`);
    lines.push('');
  }
  console.log(`[db-load] removed ${await cleanup(env)} load accounts`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`[db-load] report written to ${path.relative(ROOT, OUT)}`);
}

main().catch((error) => { console.error(`[db-load] ${error.stack || error.message}`); process.exit(1); });
