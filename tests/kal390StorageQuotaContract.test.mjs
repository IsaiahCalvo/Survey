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
const groundTruthMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260819010000_kal390_usage_meter_ground_truth.sql',
);
const usageHookPath = path.join(repoRoot, 'src/hooks/useSubscriptionLimits.js');

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

function readTriggerMigration() {
  return fs.readFileSync(triggerMigrationPath, 'utf8');
}

function readGroundTruthMigration() {
  return fs.readFileSync(groundTruthMigrationPath, 'utf8');
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

test('20260817010000 shipped the documents policy with a client-supplied file_size term', () => {
  // Historical pin only. This file is applied to production and must not be
  // edited; 20260819010000 supersedes the storage clause asserted here (the
  // `+ COALESCE(file_size, 0)` term was client-controlled AND double-counted on
  // the bytes-first upload paths). See the ground-truth tests further down.
  const sql = readMigration();
  const start = sql.indexOf('CREATE POLICY "Users can upload documents within limits"');
  const end = sql.indexOf('COMMENT ON POLICY "Users can upload documents within limits"', start);
  ok(start >= 0 && end > start, 'migration must recreate the documents INSERT policy');
  const policy = sql.slice(start, end);

  // Count cap unchanged (Fix 26 shape) — KAL-390 must not touch COUNT caps.
  match(policy, /SELECT COUNT\(\*\)[\s\S]+FROM public\.documents[\s\S]+archived = FALSE[\s\S]+< public\.get_document_limit\(auth\.uid\(\)\)/);
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

// ---------------------------------------------------------------------------
// 20260819010000 — the last two surfaces that still trusted client numbers:
// the documents INSERT policy's file_size term, and the usage meter's read of
// user_subscriptions.storage_used_bytes.
// ---------------------------------------------------------------------------

test('the documents INSERT policy storage clause has no client-supplied term', () => {
  const sql = readGroundTruthMigration();
  const start = sql.indexOf('CREATE POLICY "Users can upload documents within limits"');
  const end = sql.indexOf('COMMENT ON POLICY "Users can upload documents within limits"', start);
  ok(start >= 0 && end > start, 'migration must recreate the documents INSERT policy');
  const policy = sql.slice(start, end);

  // Count cap copied through verbatim — KAL-390 must never touch COUNT caps.
  match(policy, /SELECT COUNT\(\*\)[\s\S]+FROM public\.documents[\s\S]+archived = FALSE[\s\S]+< public\.get_document_limit\(auth\.uid\(\)\)/);

  // Ground truth only: live usage against the tier limit, nothing else.
  match(
    policy,
    /AND public\.get_actual_storage_usage\(auth\.uid\(\)\)\s+<= public\.get_storage_limit\(auth\.uid\(\)\)/,
  );
  // The three client-influenced inputs must all be gone from the clause.
  doesNotMatch(policy, /file_size/);
  doesNotMatch(policy, /storage_used_bytes/);
  doesNotMatch(policy, /user_subscriptions/);

  // `<=`, never `<`: the bytes-first upload paths land the object BEFORE the
  // documents row, so an exactly-filling upload leaves usage == limit and `<`
  // would reject a row for bytes the trigger already accepted.
  doesNotMatch(policy, /get_actual_storage_usage\(auth\.uid\(\)\)\s+< public\.get_storage_limit/);
});

test('the reconciliation helpers compute the legacy counter from storage.objects', () => {
  const sql = readGroundTruthMigration();

  for (const signature of [
    'CREATE OR REPLACE FUNCTION public.recalculate_user_storage(p_user_id UUID)',
    'CREATE OR REPLACE FUNCTION public.recalculate_all_user_storage()',
  ]) {
    ok(sql.includes(signature), `migration must redefine ${signature}`);
  }

  const single = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.recalculate_user_storage'),
    sql.indexOf('COMMENT ON FUNCTION public.recalculate_user_storage'),
  );
  const all = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.recalculate_all_user_storage'),
    sql.indexOf('COMMENT ON FUNCTION public.recalculate_all_user_storage'),
  );

  for (const body of [single, all]) {
    // Ground truth, not SUM(documents.file_size) as the 20241226000001 originals did.
    match(body, /FROM storage\.objects o/);
    match(body, /SUM\(\(o\.metadata->>'size'\)::bigint\)/);
    match(body, /o\.bucket_id = 'documents'/);
    doesNotMatch(body, /file_size/);
    doesNotMatch(body, /FROM public\.documents/);
    // Pre-existing SECURITY DEFINER hardening gap closed while repointing them.
    match(body, /SECURITY DEFINER\s+SET search_path = ''/);
  }

  // Self-scoping, same idiom as get_actual_storage_usage: an authenticated
  // caller can only ever reconcile their own row.
  match(single, /COALESCE\(auth\.uid\(\), p_user_id\)/);

  // Whole-table maintenance must not be reachable by an end user. It was
  // EXECUTE-granted to `authenticated` with no scoping before this migration.
  match(sql, /GRANT EXECUTE ON FUNCTION public\.recalculate_all_user_storage\(\) TO service_role/);
  match(sql, /REVOKE EXECUTE ON FUNCTION public\.recalculate_all_user_storage\(\) FROM anon, authenticated/);
  match(sql, /GRANT EXECUTE ON FUNCTION public\.recalculate_user_storage\(UUID\) TO authenticated, service_role/);
});

test('the legacy display counter is marked non-authoritative in the schema', () => {
  const sql = readGroundTruthMigration();

  match(sql, /COMMENT ON COLUMN public\.user_subscriptions\.storage_used_bytes IS/);
  match(sql, /LEGACY \/ NON-AUTHORITATIVE \(KAL-390\)/);
  match(sql, /public\.get_actual_storage_usage\(uid\) instead/);
});

test('this migration does not redefine anything the applied migrations own', () => {
  const sql = readGroundTruthMigration();
  // Strip `--` comments AND the bodies of COMMENT ON string literals: both
  // legitimately name the objects this test is checking are not REDEFINED.
  const ddl = sql
    .replace(/--[^\n]*/g, '')
    .replace(/COMMENT ON [\s\S]*?';/g, '');

  // The byte gate stays where 20260818010000 put it.
  doesNotMatch(ddl, /CREATE (OR REPLACE )?TRIGGER/);
  doesNotMatch(ddl, /FUNCTION public\.enforce_documents_storage_quota/);
  // The storage.objects policies (and the table itself) are untouched.
  doesNotMatch(ddl, /ON storage\.objects/);
  doesNotMatch(ddl, /documents_owner_(insert|update)/);
  // The live-usage helpers from 20260817010000 are consumed, never redefined.
  doesNotMatch(ddl, /FUNCTION public\.get_actual_storage_usage\s*\(/);
  doesNotMatch(ddl, /FUNCTION public\.get_stored_object_size\s*\(/);
  // The documents-table triggers that keep the legacy counter populated stay.
  doesNotMatch(ddl, /FUNCTION public\.update_user_storage/);
  doesNotMatch(ddl, /update_storage_on_(insert|delete)/);
  // No data write: a backfill would be re-drifted by those triggers anyway.
  doesNotMatch(ddl, /SELECT public\.recalculate_all_user_storage\(\)/);
});

test('the usage meter reads live storage, never the drifting counter', () => {
  const source = fs.readFileSync(usageHookPath, 'utf8');
  // The header comment explains at length why storage_used_bytes is not used,
  // so the "must not appear" assertions have to run against code only.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // The meter's storage figure comes from the ground-truth RPC.
  match(code, /supabase\.rpc\('get_actual_storage_usage', \{ p_user_id: userId \}\)/);
  // and never from the display-only counter.
  doesNotMatch(code, /storage_used_bytes/);
  doesNotMatch(code, /user_subscriptions/);
  // A failed RPC must surface, not silently fall back to a known-wrong number.
  match(code, /if \(storageRes\.error\) throw storageRes\.error;/);
  // Valid bigint strings are coerced, but null/malformed totals must not turn
  // into a fabricated zero. The mounted tests exercise those payloads too.
  match(code, /const rawStorage = storageRes\.data;/);
  match(code, /Number\(rawStorage\)/);
  match(code, /!Number\.isFinite\(storageBytes\)/);
  match(code, /!Number\.isInteger\(storageBytes\)/);
  match(code, /storageBytes < 0/);
  match(code, /throw new Error\('Invalid storage usage total'\)/);
  match(code, /storage: storageBytes/);
  doesNotMatch(code, /storage:\s*Number\([^)]*\)\s*\|\|\s*0/);
  // The live scan must not be re-triggered by AuthContext re-emitting an equal
  // user object — its scope changes only with the id, not the object itself.
  match(code, /scopeRef\.current\.userId !== userId/);
  match(code, /\}, \[scope, userId\]\);/);
});
