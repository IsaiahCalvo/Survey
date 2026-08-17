import test from 'node:test';
import { match, ok, doesNotMatch } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260817010000_kal390_storage_quota_enforcement.sql',
);

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

test('live usage helper sums storage.objects, not client-reported numbers', () => {
  const sql = readMigration();

  match(sql, /CREATE OR REPLACE FUNCTION public\.get_actual_storage_usage\(p_user_id UUID\)/);
  match(sql, /FROM storage\.objects o[\s\S]+WHERE o\.bucket_id = 'documents'[\s\S]+o\.name LIKE p_user_id::text \|\| '\/%'/);
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

test('storage bucket INSERT policy is the authoritative quota gate', () => {
  const sql = readMigration();
  const start = sql.indexOf('CREATE POLICY documents_owner_insert');
  const end = sql.indexOf('COMMENT ON POLICY documents_owner_insert', start);
  ok(start >= 0 && end > start, 'migration must recreate documents_owner_insert');
  const policy = sql.slice(start, end);

  // Owner-folder scoping from 20260703030000 must be preserved verbatim.
  match(policy, /bucket_id = 'documents'/);
  match(policy, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  // Quota clause: live usage plus incoming size (unknown size counts as 1 byte
  // so an at-limit user is still blocked).
  match(policy, /public\.get_actual_storage_usage\(auth\.uid\(\)\)[\s\S]+\+ COALESCE\(\(metadata->>'size'\)::bigint, 1\)[\s\S]+<= public\.get_storage_limit\(auth\.uid\(\)\)/);
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

test('save-flow overwrites stay quota-exempt: the UPDATE policy is not touched', () => {
  const sql = readMigration();

  // replaceDocument/uploadDataFile upsert onto the SAME object path; gating
  // UPDATE at quota would lock users out of saving existing work.
  doesNotMatch(sql, /DROP POLICY IF EXISTS documents_owner_update/);
  doesNotMatch(sql, /CREATE POLICY documents_owner_update/);
});
