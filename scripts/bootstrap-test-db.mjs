#!/usr/bin/env node
// scripts/bootstrap-test-db.mjs — KAL-257 guarded test-database bootstrap.
//
// Applies scripts/bootstrap-test-db.sql to an ALLOWLISTED Supabase TEST
// project via the Management API SQL endpoint. This wrapper is the only
// sanctioned way to run that DDL — it structurally refuses production.
//
// Why it exists: the repo's migration chain cannot replay on a blank database
// (the `documents` table predates the chain), so `supabase db reset/push`
// cannot provision a test project; this script bootstraps exactly the schema
// the phase27 integration tests pin.
//
// Auth: SUPABASE_ACCESS_TOKEN env var ONLY (obtain via `supabase login`; the
// CLI stores it in the macOS keychain under "Supabase CLI"). The token is
// never stored and never printed.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=… node scripts/bootstrap-test-db.mjs --ref zgdkyslxbkusexmkfvgd [--reset]
//
// --reset drops the bootstrap-owned objects first so the committed artifact
// provably derives the entire cloud state from a clean slate.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ALLOWED_TEST_REFS = ['zgdkyslxbkusexmkfvgd']; // survey-test (created 2026-06-10)
const PROD_REF = 'cvamwtpsuvxvjdnotbeg'; // production Survey — listed only to refuse it by name

const args = process.argv.slice(2);
const refIdx = args.indexOf('--ref');
const ref = refIdx !== -1 ? args[refIdx + 1] : null;
const reset = args.includes('--reset');

if (!ref) {
  console.error('Usage: SUPABASE_ACCESS_TOKEN=… node scripts/bootstrap-test-db.mjs --ref <test-project-ref> [--reset]');
  process.exit(1);
}
if (ref === PROD_REF) {
  console.error('REFUSED: that ref is the PRODUCTION Survey project. This script never touches production.');
  process.exit(1);
}
if (!ALLOWED_TEST_REFS.includes(ref)) {
  console.error(`REFUSED: "${ref}" is not an allowlisted test project ref (${ALLOWED_TEST_REFS.join(', ')}).`);
  process.exit(1);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is required (never stored, never logged). Run `supabase login` to obtain one.');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ddl = readFileSync(resolve(__dirname, 'bootstrap-test-db.sql'), 'utf8');

// Drop order matters: children before the FK parent; CASCADE on documents
// would also work, but explicit drops keep the reset auditable.
const RESET_SQL = `
DROP VIEW IF EXISTS public.test_schema_columns;
DROP TABLE IF EXISTS public.doc_yjs_updates;
DROP TABLE IF EXISTS public.doc_yjs_state;
DROP TABLE IF EXISTS public.activity_log;
DROP TABLE IF EXISTS public.documents CASCADE;
`;

const VERIFY_SQL = `
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('documents','doc_yjs_updates','doc_yjs_state','activity_log','test_schema_columns')) AS objects_present,
  (SELECT count(*) FROM public.documents)        AS documents_rows,
  (SELECT count(*) FROM public.doc_yjs_updates)  AS doc_yjs_updates_rows,
  (SELECT count(*) FROM public.activity_log)     AS activity_log_rows;
`;

const masked = `${ref.slice(0, 4)}…`;

async function runSql(label, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[bootstrap-test-db] ${label} FAILED on ${masked}: HTTP ${res.status} ${body.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[bootstrap-test-db] ${label}: HTTP ${res.status}`);
  return body;
}

console.log(`[bootstrap-test-db] target TEST project ${masked} (reset=${reset})`);
if (reset) await runSql('reset (drop bootstrap objects)', RESET_SQL);
await runSql('apply bootstrap DDL', ddl);
const verifyBody = await runSql('verify objects + row counts', VERIFY_SQL);
const verifyRows = JSON.parse(verifyBody);
const v = Array.isArray(verifyRows) ? verifyRows[0] : verifyRows;
console.log(`[bootstrap-test-db] objects_present=${v.objects_present}/5 documents_rows=${v.documents_rows} doc_yjs_updates_rows=${v.doc_yjs_updates_rows} activity_log_rows=${v.activity_log_rows}`);
if (Number(v.objects_present) !== 5) {
  console.error('[bootstrap-test-db] FAILED: expected 5 bootstrap objects present.');
  process.exit(1);
}
// After a --reset the slate must be provably clean — nonzero rows mean the
// reset did not actually derive the state from scratch.
if (reset) {
  const rowCounts = [v.documents_rows, v.doc_yjs_updates_rows, v.activity_log_rows].map(Number);
  if (rowCounts.some((n) => n !== 0)) {
    console.error('[bootstrap-test-db] FAILED: --reset verification found nonzero row counts.');
    process.exit(1);
  }
}
console.log('[bootstrap-test-db] bootstrap verified OK');
