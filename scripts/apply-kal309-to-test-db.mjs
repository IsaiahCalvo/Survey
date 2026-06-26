#!/usr/bin/env node
// scripts/apply-kal309-to-test-db.mjs — KAL-309 keystone migration applied to the
// allowlisted cloud TEST project via the Supabase Management API. Mirrors
// scripts/apply-kal308a-to-test-db.mjs.
//
// Reads the authoritative migration file (no inline drift). Ensures the one
// prerequisite survey-test lacks (documents.locked_at + kal49_document_is_locked);
// KAL-307 (registrations + user_can_access_document + document_collaborators) and
// KAL-308a (rowid_signing_secrets) are assumed already applied.
//
// Usage: node --env-file=.env.test scripts/apply-kal309-to-test-db.mjs
// NEVER touches the production project (cvamwtpsuvxvjdnotbeg).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ALLOWED_TEST_REFS = ['zgdkyslxbkusexmkfvgd']; // survey-test
const PROD_REF           = 'cvamwtpsuvxvjdnotbeg';  // production — listed only to refuse it
const TEST_REF           = 'zgdkyslxbkusexmkfvgd';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN required (use --env-file=.env.test).'); process.exit(1); }
if (TEST_REF === PROD_REF) { console.error('REFUSED: TEST_REF === PROD_REF.'); process.exit(1); }
if (!ALLOWED_TEST_REFS.includes(TEST_REF)) { console.error(`REFUSED: ${TEST_REF} not allowlisted.`); process.exit(1); }
const masked = `${TEST_REF.slice(0, 4)}…`;
console.log(`[kal309-apply] target TEST project ${masked} (prod ${PROD_REF.slice(0,4)}… structurally blocked)`);

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(__dirname, '..', 'supabase/migrations/20260625120000_kal309_excel_sync.sql');
const KAL309_SQL = readFileSync(MIGRATION, 'utf8');

// Prereq survey-test lacks: documents.locked_at + the lock helper (real body from KAL-49).
const PREREQ_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION public.kal49_document_is_locked(doc_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT locked_at FROM public.documents WHERE id = doc_id), NULL) IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.kal49_document_is_locked(UUID) TO authenticated;
`;

const VERIFY_SQL = `
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN
       ('excel_sync_head','excel_sync_state','excel_sync_ops','excel_sync_changesets','excel_sync_audit')) AS tables_present,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='kal308_apply_changeset') AS apply_rpc,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'kal309_%') AS helper_rpcs,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE c.relname='excel_sync_audit' AND NOT t.tgisinternal) AS audit_triggers;
`;

async function runSql(label, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${TEST_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[kal309-apply] ${label} FAILED on ${masked}: HTTP ${res.status}`);
    console.error(body.slice(0, 800));
    process.exit(1);
  }
  console.log(`[kal309-apply] ${label}: HTTP ${res.status} OK`);
  return body;
}

await runSql('apply prerequisites (locked_at + kal49)', PREREQ_SQL);
await runSql('apply KAL-309 migration (5 tables + apply RPC + helpers + trigger)', KAL309_SQL);

const verifyBody = await runSql('verify schema objects', VERIFY_SQL);
let v;
try { const parsed = JSON.parse(verifyBody); v = Array.isArray(parsed) ? parsed[0] : parsed; }
catch { console.error('[kal309-apply] could not parse verify:', verifyBody.slice(0, 200)); process.exit(1); }
console.log(`[kal309-apply] tables=${v.tables_present}/5 apply_rpc=${v.apply_rpc} helper_rpcs=${v.helper_rpcs} audit_triggers=${v.audit_triggers}`);
if (Number(v.tables_present) < 5 || Number(v.apply_rpc) < 1 || Number(v.helper_rpcs) < 5 || Number(v.audit_triggers) < 1) {
  console.error('[kal309-apply] FAILED: expected objects missing after apply.'); process.exit(1);
}
console.log('[kal309-apply] KAL-309 applied + verified on TEST project. Ready for integration tests.');
