import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20260915105000_document_definition_realtime_wake.sql', import.meta.url);
const migration = readFileSync(migrationUrl, 'utf8');
const tool = command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
const unsupported = process.platform === 'win32' || process.getuid?.() === 0;
const postgresUnavailable = !tool('initdb') || !tool('pg_ctl') || !tool('psql');

test('definition head wake stays private and updates only the owning document timestamp', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF current_revision, current_digest/);
  assert.match(migration, /NEW\.current_revision IS NOT DISTINCT FROM OLD\.current_revision/);
  assert.match(migration, /NEW\.current_digest IS NOT DISTINCT FROM OLD\.current_digest/);
  assert.match(migration, /UPDATE public\.documents\s+SET updated_at = clock_timestamp\(\)\s+WHERE id = NEW\.document_id/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /ALTER PUBLICATION|GRANT /);
});

test('definition head wake passes disposable PostgreSQL transaction and replay cases', {
  skip: (unsupported || postgresUnavailable) && 'requires installed PostgreSQL under a non-root Unix user',
  timeout: 90_000,
}, () => {
  const script = fileURLToPath(new URL(
    '../scripts/test-document-definition-realtime-wake-postgres.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Document definition Realtime wake PostgreSQL checks passed/);
});
