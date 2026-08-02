#!/usr/bin/env node
// scripts/apply-kal426-to-test-db.mjs — the KAL-426 user-Archive foundation
// applied to the allowlisted cloud TEST project via the Supabase Management API.
// Mirrors scripts/apply-kal309-to-test-db.mjs.
//
// Reads the authoritative migration file (no inline drift).
//
// Usage: node --env-file=.env.test scripts/apply-kal426-to-test-db.mjs
// NEVER touches the production project (cvamwtpsuvxvjdnotbeg).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ALLOWED_TEST_REFS = ['zgdkyslxbkusexmkfvgd']; // survey-test
const PROD_REF          = 'cvamwtpsuvxvjdnotbeg';   // production — listed only to refuse it
const TEST_REF          = 'zgdkyslxbkusexmkfvgd';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN required (use --env-file=.env.test).'); process.exit(1); }
if (TEST_REF === PROD_REF) { console.error('REFUSED: TEST_REF === PROD_REF.'); process.exit(1); }
if (!ALLOWED_TEST_REFS.includes(TEST_REF)) { console.error(`REFUSED: ${TEST_REF} not allowlisted.`); process.exit(1); }
const masked = `${TEST_REF.slice(0, 4)}…`;
console.log(`[kal426-apply] target TEST project ${masked} (prod ${PROD_REF.slice(0, 4)}… structurally blocked)`);

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(__dirname, '..', 'supabase/migrations/20260802000000_kal426_user_archive_foundation.sql');
const KAL426_SQL = readFileSync(MIGRATION, 'utf8');

// survey-test predates the sharing migration, so the collaborator tables the
// access helpers read may be missing. gen_random_uuid() needs pgcrypto.
const PREREQ_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
`;

const VERIFY_SQL = `
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND column_name IN
       ('user_archived_at','user_archive_expires_at','user_archived_by','archive_group_id')
       AND table_name IN ('documents','projects','templates')) AS archive_columns,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN
       ('archive_document','restore_document','archive_project','restore_project',
        'archive_template','restore_template','purge_archived_document',
        'purge_archived_project','purge_archived_template')) AS operations,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='archive_retention_interval') AS retention_fn,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
     AND indexname LIKE 'idx_%archive%') AS archive_indexes;
`;

async function runSql(label, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${TEST_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[kal426-apply] ${label} FAILED on ${masked}: HTTP ${res.status}`);
    console.error(body.slice(0, 800));
    process.exit(1);
  }
  console.log(`[kal426-apply] ${label}: HTTP ${res.status} OK`);
  return body;
}

await runSql('apply prerequisites (pgcrypto)', PREREQ_SQL);
await runSql('apply KAL-426 migration (columns + access helpers + operations)', KAL426_SQL);

const verifyBody = await runSql('verify schema objects', VERIFY_SQL);
let v;
try { const parsed = JSON.parse(verifyBody); v = Array.isArray(parsed) ? parsed[0] : parsed; }
catch { console.error('[kal426-apply] could not parse verify:', verifyBody.slice(0, 200)); process.exit(1); }
console.log(`[kal426-apply] archive_columns=${v.archive_columns}/12 operations=${v.operations}/9 retention_fn=${v.retention_fn} indexes=${v.archive_indexes}`);
if (Number(v.archive_columns) < 12 || Number(v.operations) < 9 || Number(v.retention_fn) < 1) {
  console.error('[kal426-apply] FAILED: expected objects missing after apply.'); process.exit(1);
}
console.log('[kal426-apply] KAL-426 applied + verified on TEST project.');
