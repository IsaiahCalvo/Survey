import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const migration = new URL('../supabase/migrations/20260909050000_legacy_annotation_revision.sql',import.meta.url);
const sql = readFileSync(migration,'utf8');
test('legacy revision scope and lock/counter contracts are explicit', () => {
  assert.match(sql,/Excludes survey_items/);
  assert.match(sql,/doc_yjs_state','doc_yjs_updates/);
  assert.match(sql,/pg_try_advisory_xact_lock/);
  assert.match(sql,/FOR NO KEY UPDATE NOWAIT/);
  assert.match(sql,/READ COMMITTED/);
  assert.match(sql,/REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows/);
  assert.match(sql,/revision=r\.revision\+1/);
  assert.match(sql,/REVOKE TRUNCATE/);
  assert.doesNotMatch(sql,/GRANT .*document_legacy_revisions/);
});
test('actual disposable PostgreSQL revision/cascade/concurrency contracts', {skip:process.env.SURVEY_RUN_LOCAL_POSTGRES_TESTS !== '1'}, () => {
  const result = spawnSync(process.execPath,[new URL('../scripts/test-legacy-annotation-revision-postgres.mjs',import.meta.url).pathname],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/"result":"passed"/);
});
