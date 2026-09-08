import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const migration = new URL('../supabase/migrations/20260909071000_annotation_destructive_write_fence.sql', import.meta.url);
const sql = readFileSync(migration, 'utf8');
test('destructive annotation fence is private, bounded and does not grant new write authority', () => {
  assert.match(sql, /BEFORE DELETE ON public\.annotation_updates/);
  assert.match(sql, /BEFORE DELETE ON public\.annotation_snapshots/);
  assert.match(sql, /BEFORE UPDATE ON public\.annotation_updates/);
  assert.match(sql, /Annotation WAL rows are immutable/);
  assert.match(sql, /pg_try_advisory_xact_lock\(hashtextextended\(OLD\.document_id::text,0\)\)/);
  assert.match(sql, /READ COMMITTED/);
  assert.match(sql, /ERRCODE='25001'/);
  assert.match(sql, /ERRCODE='40001'/);
  assert.match(sql, /REVOKE TRUNCATE ON public\.annotation_updates,public\.annotation_snapshots/);
  assert.equal((sql.match(/BEFORE TRUNCATE ON public\./g) || []).length, 2);
  assert.doesNotMatch(sql, /\bGRANT\b|CREATE (?:OR REPLACE )?POLICY|CREATE (?:OR REPLACE )?FUNCTION public\./);
});
test('actual PostgreSQL destructive annotation races, cascade and unchanged RPC behavior', {
  skip: process.env.SURVEY_RUN_LOCAL_POSTGRES_TESTS !== '1',
}, () => {
  const result = spawnSync(process.execPath, [new URL('../scripts/test-annotation-destructive-write-fence-postgres.mjs', import.meta.url).pathname],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /BASELINE.*unfenced/);
  assert.match(result.stdout, /"result":"passed"/);
});
