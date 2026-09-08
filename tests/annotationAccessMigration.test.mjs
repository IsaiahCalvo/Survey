import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migration = new URL('../supabase/migrations/20260909040000_annotation_write_authorization.sql', import.meta.url);
const script = fileURLToPath(new URL('../scripts/test-annotation-access-postgres.mjs', import.meta.url));

test('annotation authorization retains parent authority for new writes without changing existing RPC receipts', () => {
  const sql = readFileSync(migration, 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /user_can_access_document\(NEW\.document_id, 'editor'\)/);
  assert.match(sql, /kal49_document_is_locked\(NEW\.document_id\)/);
  assert.match(sql, /transaction_isolation[\s\S]*25001/);
  assert.match(sql, /pg_try_advisory_xact_lock/);
  assert.match(sql, /FOR SHARE NOWAIT/);
  assert.match(sql, /ORDER BY [dp]\.id FOR UPDATE NOWAIT/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON public\.document_collaborators/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON public\.project_collaborators/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.(append_annotation_update|store_annotation_snapshot|user_can_access_document)/);
  assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY|auth\.role\(/);
});

test('permission fixture uses actual tracked role helper and full WAL migrations, not an always-true access stub', () => {
  const source = readFileSync(script, 'utf8');
  for (const name of ['20260802000000_kal426_user_archive_foundation.sql',
    '20260522000000_kal49_document_lock_state.sql', '20260606120000_rebuild_yjs_source_of_truth.sql',
    '20260727131230_annotation_wal_concurrency.sql', '20260909040000_annotation_write_authorization.sql']) assert.ok(source.includes(name), name);
  assert.match(source, /withDisposablePostgres/);
  assert.match(source, /trackedFunction\(accessSource, 'user_can_access_document'\)/);
  assert.match(source, /BASELINE/);
  assert.match(source, /revoke first/);
  assert.match(source, /same-project different-document/);
  assert.match(source, /two inherited-only writers/);
  assert.match(source, /synthetic fixture/);
  assert.doesNotMatch(source, /test\.annotation_access|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|bot-credentials|brew install|npm install/);
});

test('the local fixture rejects extra arguments before starting PostgreSQL', () => {
  const result = spawnSync(process.execPath, [script, '--baseline-only', 'unexpected-target'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node scripts\/test-annotation-access-postgres/);
  assert.doesNotMatch(result.stdout, /PASS|PostgreSQL checks passed/);
});

test('real PostgreSQL annotation authorization fences revocation and preserves sharing and receipts', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL',
}, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Annotation access baseline PostgreSQL checks passed:/);
  assert.match(result.stdout, /Annotation access PostgreSQL checks passed:/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
