import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(new URL('../supabase/migrations/20260909104000_remove_duplicate_document_owner_index.sql', import.meta.url), 'utf8');
const tool = command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
const unsupportedHost = process.platform === 'win32' || process.getuid?.() === 0;
const postgresUnavailable = !tool('initdb') || !tool('pg_ctl') || !tool('psql');

test('duplicate document owner index cleanup is exact, bounded, and fail closed', () => {
  assert.match(migration, /SET LOCAL lock_timeout = '3s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '30s'/);
  assert.match(migration, /LOCK TABLE public\.documents IN ACCESS EXCLUSIVE MODE NOWAIT/);
  assert.match(migration, /set_config\('lock_timeout', '3s', true\)/);
  assert.match(migration, /duplicate_oid := to_regclass\('public\.idx_documents_user_id'\)/);
  assert.match(migration, /survivor_oid := to_regclass\('public\.documents_user_id_idx'\)/);
  assert.match(migration, /duplicate_index\.relname = 'idx_documents_user_id'/);
  assert.match(migration, /survivor_index\.relname = 'documents_user_id_idx'/);
  assert.match(migration, /duplicate_access_method\.amname = 'btree'/);
  assert.match(migration, /duplicate_meta\.indnatts = 1 AND survivor_meta\.indnatts = 1/);
  assert.match(migration, /duplicate_meta\.indkey::text = survivor_meta\.indkey::text/);
  assert.match(migration, /duplicate_meta\.indcollation::text = survivor_meta\.indcollation::text/);
  assert.match(migration, /duplicate_meta\.indclass::text = survivor_meta\.indclass::text/);
  assert.match(migration, /duplicate_meta\.indoption::text = survivor_meta\.indoption::text/);
  assert.match(migration, /duplicate_meta\.indexprs IS NULL AND survivor_meta\.indexprs IS NULL/);
  assert.match(migration, /duplicate_meta\.indpred IS NULL AND survivor_meta\.indpred IS NULL/);
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_constraint WHERE conindid = duplicate_oid\)/);
  assert.match(migration, /DROP INDEX public\.idx_documents_user_id/);
  assert.match(migration, /pg_catalog\.pg_class WHERE oid = duplicate_oid/);
  assert.match(migration, /to_regclass\('public\.documents_user_id_idx'\) IS DISTINCT FROM survivor_oid/);
  assert.doesNotMatch(migration, /CASCADE/);
});

test('duplicate document owner index cleanup passes disposable PostgreSQL cases', {
  skip: (unsupportedHost || postgresUnavailable) && 'requires installed PostgreSQL under a non-root Unix user',
  timeout: 90_000,
}, () => {
  const script = fileURLToPath(new URL('../scripts/test-duplicate-document-owner-index-postgres.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /13\/13 passed; cleanup complete/);
});
