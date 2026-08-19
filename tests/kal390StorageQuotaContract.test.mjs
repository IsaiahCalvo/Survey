import test from 'node:test';
import { match, ok, doesNotMatch } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260817010000_kal390_storage_quota_enforcement.sql',
);
const triggerMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260818010000_kal390_storage_quota_trigger.sql',
);

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

function readTriggerMigration() {
  return fs.readFileSync(triggerMigrationPath, 'utf8');
}

// ---------------------------------------------------------------------------
// 20260817010000 — the helper functions it introduced are still live. Its
// storage.objects POLICIES are superseded by 20260818010000 (see below): they
// gated on `metadata->>'size'`, which is always NULL inside an RLS policy
// because the storage service checks permissions in a probe transaction whose
// metadata carries only {mimetype, contentLength}. The file itself is already
// applied to production and must not be edited, so these assertions pin the
// shape it shipped with.
// ---------------------------------------------------------------------------

test('live usage helper sums storage.objects, not client-reported numbers', () => {
  const sql = readMigration();

  match(sql, /CREATE OR REPLACE FUNCTION public\.get_actual_storage_usage\(p_user_id UUID\)/);
  // Self-scoping: authenticated callers always read their OWN folder; only
  // JWT-less service callers can target p_user_id.
  match(sql, /FROM storage\.objects o[\s\S]+WHERE o\.bucket_id = 'documents'[\s\S]+o\.name LIKE COALESCE\(auth\.uid\(\), p_user_id\)::text \|\| '\/%'/);
  match(sql, /COALESCE\(SUM\(\(o\.metadata->>'size'\)::bigint\), 0\)/);
  // The helper must never read the display-only counter or documents.file_size.
  const helperBody = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.get_actual_storage_usage'),
    sql.indexOf('COMMENT ON FUNCTION public.get_actual_storage_usage'),
  );
  doesNotMatch(helperBody, /storage_used_bytes/);
  doesNotMatch(helperBody, /file_size/);
});

test('live usage helper keeps the house function hardening and grants', () => {
  const sql = readMigration();

  match(sql, /SECURITY DEFINER[\s\S]+SET search_path = ''/);
  match(sql, /REVOKE ALL ON FUNCTION public\.get_actual_storage_usage\(UUID\) FROM PUBLIC/);
  match(sql, /GRANT EXECUTE ON FUNCTION public\.get_actual_storage_usage\(UUID\) TO authenticated, service_role/);
  match(sql, /REVOKE EXECUTE ON FUNCTION public\.get_actual_storage_usage\(UUID\) FROM anon/);
});

test('documents INSERT policy keeps the count cap but sources storage from live usage', () => {
  const sql = readMigration();
  const start = sql.indexOf('CREATE POLICY "Users can upload documents within limits"');
  const end = sql.indexOf('COMMENT ON POLICY "Users can upload documents within limits"', start);
  ok(start >= 0 && end > start, 'migration must recreate the documents INSERT policy');
  const policy = sql.slice(start, end);

  // Count cap unchanged (Fix 26 shape) — KAL-390 must not touch COUNT caps.
  match(policy, /SELECT COUNT\(\*\)[\s\S]+FROM public\.documents[\s\S]+archived = FALSE[\s\S]+< public\.get_document_limit\(auth\.uid\(\)\)/);
  // Storage clause reads live usage, not user_subscriptions.storage_used_bytes.
  match(policy, /public\.get_actual_storage_usage\(auth\.uid\(\)\)[\s\S]+\+ COALESCE\(file_size, 0\)[\s\S]+<= public\.get_storage_limit\(auth\.uid\(\)\)/);
  doesNotMatch(policy, /storage_used_bytes/);
  doesNotMatch(policy, /user_subscriptions/);
});

test('stored-object-size helper is folder-scoped for authenticated callers', () => {
  const sql = readMigration();

  match(sql, /CREATE OR REPLACE FUNCTION public\.get_stored_object_size\(p_bucket_id TEXT, p_name TEXT\)/);
  match(sql, /auth\.uid\(\) IS NULL OR o\.name LIKE auth\.uid\(\)::text \|\| '\/%'/);
  match(sql, /REVOKE ALL ON FUNCTION public\.get_stored_object_size\(TEXT, TEXT\) FROM PUBLIC/);
  match(sql, /GRANT EXECUTE ON FUNCTION public\.get_stored_object_size\(TEXT, TEXT\) TO authenticated, service_role/);
  match(sql, /REVOKE EXECUTE ON FUNCTION public\.get_stored_object_size\(TEXT, TEXT\) FROM anon/);
});

// ---------------------------------------------------------------------------
// 20260818010000 — the live contract. The byte gate is a TRIGGER, because RLS
// never sees the uploaded object's size.
// ---------------------------------------------------------------------------

test('the authoritative byte gate is a trigger on storage.objects', () => {
  const sql = readTriggerMigration();

  match(sql, /CREATE OR REPLACE FUNCTION public\.enforce_documents_storage_quota\(\)/);
  match(sql, /RETURNS TRIGGER/);
  match(sql, /SECURITY DEFINER[\s\S]+SET search_path = ''/);
  // CREATE OR REPLACE TRIGGER, not DROP+CREATE: DROP TRIGGER needs ownership of
  // storage.objects, which belongs to supabase_storage_admin.
  match(sql, /CREATE OR REPLACE TRIGGER enforce_documents_storage_quota\s+BEFORE INSERT OR UPDATE ON storage\.objects\s+FOR EACH ROW/);
  match(sql, /EXECUTE FUNCTION public\.enforce_documents_storage_quota\(\)/);
  doesNotMatch(sql.replace(/--[^\n]*/g, ''), /DROP TRIGGER/);
});

test('the trigger reads the REAL object size and attributes it by folder', () => {
  const sql = readTriggerMigration();
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.enforce_documents_storage_quota');
  const end = sql.indexOf('COMMENT ON FUNCTION public.enforce_documents_storage_quota', start);
  ok(start >= 0 && end > start, 'migration must define the trigger function');
  const body = sql.slice(start, end);

  // The true size, which only the trigger ever sees.
  match(body, /v_new_size\s*:=\s*\(NEW\.metadata->>'size'\)::bigint/);
  // Ownership from the path: the size-carrying write has no end-user JWT, so
  // auth.uid() is unusable here.
  match(body, /\(storage\.foldername\(NEW\.name\)\)\[1\]::uuid/);
  const executable = body.replace(/--[^\n]*/g, '');
  doesNotMatch(executable, /auth\.uid\(\)/);
  // Scoped to the documents bucket only.
  match(body, /NEW\.bucket_id IS DISTINCT FROM 'documents'[\s\S]+RETURN NEW/);
  match(body, /public\.get_storage_limit\(v_owner\)/);
  // 42501 maps to a clean AccessDenied in the storage service.
  match(body, /RAISE EXCEPTION[\s\S]+USING ERRCODE\s*=\s*'42501'/);
});

test('the trigger never blocks a non-growing write, so saves cannot break', () => {
  const sql = readTriggerMigration();
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.enforce_documents_storage_quota');
  const end = sql.indexOf('COMMENT ON FUNCTION public.enforce_documents_storage_quota', start);
  const body = sql.slice(start, end);

  // Unknown incoming size => size-neutral, never blocked.
  match(body, /IF v_new_size IS NULL THEN\s+RETURN NEW;/);
  // Same-size and shrinking writes always pass, even over the limit.
  match(body, /IF v_new_size <= v_old_size THEN\s+RETURN NEW;/);
  // The row being replaced is excluded by NAME, so both passes of an upsert
  // (BEFORE INSERT then BEFORE UPDATE) compute the same total.
  match(body, /FILTER \(WHERE o\.name <> NEW\.name\)/);
  match(body, /FILTER \(WHERE o\.name\s+= NEW\.name\)/);
});

test('concurrent growing writes are serialized per owner', () => {
  const sql = readTriggerMigration();

  match(sql, /pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\('kal390:' \|\| v_owner::text, 0\)\)/);
  // The lock must sit AFTER the non-growing fast path, so ordinary saves stay
  // lock-free.
  const lockAt = sql.indexOf('pg_advisory_xact_lock');
  const fastPathAt = sql.indexOf('IF v_new_size <= v_old_size THEN');
  ok(fastPathAt >= 0 && lockAt > fastPathAt, 'the advisory lock must come after the non-growing fast path');
});

test('the RLS policies are an early advisory gate that cannot lock out saves', () => {
  const sql = readTriggerMigration();

  for (const name of ['documents_owner_insert', 'documents_owner_update']) {
    const start = sql.indexOf(`CREATE POLICY ${name}`);
    const end = sql.indexOf(`COMMENT ON POLICY ${name}`, start);
    ok(start >= 0 && end > start, `migration must recreate ${name}`);
    const policy = sql.slice(start, end);

    // Owner-folder scoping from 20260703030000 preserved.
    match(policy, /bucket_id = 'documents'/);
    match(policy, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
    // The policy must read contentLength — the only size key present at check
    // time — never `size`, which is always NULL there.
    match(policy, /metadata->>'contentLength'/);
    doesNotMatch(policy, /metadata->>'size'/);
    // A non-growing write is always permitted, so an over-quota account can
    // still save and shrink.
    match(policy, /COALESCE\(\(metadata->>'contentLength'\)::bigint, 0\)\s+<= public\.get_stored_object_size\(bucket_id, name\)\s+OR/);
  }
});
