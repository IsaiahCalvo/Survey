import test from 'node:test';
import { match, ok } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260802010000_allow_last_owner_document_cascade.sql',
);

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

function deleteBranch(sql) {
  const start = sql.indexOf("ELSIF (TG_OP = 'DELETE')");
  const end = sql.indexOf('    RETURN COALESCE(NEW, OLD);', start);
  ok(start >= 0 && end > start, 'migration must retain an explicit DELETE trigger branch');
  return sql.slice(start, end);
}

test('last-owner guard permits document FK cascades after the parent row is gone', () => {
  const sql = readMigration();
  const branch = deleteBranch(sql);

  match(sql, /CREATE OR REPLACE FUNCTION public\.kal31_guard_last_owner\(\)/);
  match(branch, /target_doc := OLD\.document_id;[\s\S]+IF NOT EXISTS \([\s\S]+FROM public\.documents[\s\S]+WHERE id = target_doc[\s\S]+RETURN OLD;[\s\S]+END IF;/);
  ok(
    branch.indexOf('IF NOT EXISTS') < branch.indexOf("IF affected_old_role = 'owner'"),
    'parent-absence bypass must run before direct-delete owner enforcement',
  );
});

test('last-owner guard still rejects a direct delete while the parent exists', () => {
  const branch = deleteBranch(readMigration());

  match(branch, /IF affected_old_role = 'owner'[\s\S]+SELECT COUNT\(\*\) INTO remaining_owners[\s\S]+FROM public\.document_collaborators[\s\S]+document_id = target_doc[\s\S]+role = 'owner'[\s\S]+status = 'active'[\s\S]+user_id <> OLD\.user_id/);
  match(branch, /IF remaining_owners < 1 THEN[\s\S]+RAISE EXCEPTION 'kal31_guard_last_owner: cannot remove last owner of document %'[\s\S]+ERRCODE = 'check_violation'/);
});

test('last-owner guard replacement preserves function hardening and grants', () => {
  const sql = readMigration();

  match(sql, /LANGUAGE plpgsql[\s\S]+SECURITY DEFINER[\s\S]+SET search_path = ''/);
  match(sql, /REVOKE ALL ON FUNCTION public\.kal31_guard_last_owner\(\) FROM PUBLIC/);
  match(sql, /GRANT EXECUTE ON FUNCTION public\.kal31_guard_last_owner\(\) TO authenticated, service_role/);
  match(sql, /REVOKE EXECUTE ON FUNCTION public\.kal31_guard_last_owner\(\) FROM anon/);
});
