import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const migration = new URL('../supabase/migrations/20260909072000_document_publication_source_capture.sql', import.meta.url);
const script = new URL('../scripts/test-document-publication-source-capture-postgres.mjs', import.meta.url);

test('SQL source capture stays private and explicitly separate from provider/publication authority', () => {
  const sql = readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql, /survey_private\.capture_document_publication_sources/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role/i);
  assert.match(sql, /'sql-only'/); assert.match(sql, /54000/); assert.match(sql, /pg_try_advisory_xact_lock/);
  assert.doesNotMatch(sql, /GRANT\s+EXECUTE|CREATE(?: OR REPLACE)? FUNCTION public\./i);
});

test('capture fixture uses safe local helper and actual tracked source/guard migrations', () => {
  const source = readFileSync(script,'utf8');
  assert.match(source, /withDisposablePostgres/);
  for (const name of ['20260909040000_annotation_write_authorization.sql','20260909050000_legacy_annotation_revision.sql',
    '20260909060000_document_survey_revision.sql','20260909071000_annotation_destructive_write_fence.sql',
    '20260909072000_document_publication_source_capture.sql','20241230000001_create_survey_realtime_tables.sql']) assert.ok(source.includes(name), name);
  assert.doesNotMatch(source, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|npm install|brew install/);
});

test('actual local PostgreSQL verifies complete source capture, permissions, bounds and two-session races', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for isolated local PostgreSQL',
}, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(script)], { encoding:'utf8', timeout:120000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Document publication source capture PostgreSQL checks passed:/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
