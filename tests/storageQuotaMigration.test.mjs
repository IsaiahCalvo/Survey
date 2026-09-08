import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migration = new URL('../supabase/migrations/20260908161000_storage_quota_guard.sql', import.meta.url);
const script = fileURLToPath(new URL('../scripts/test-storage-quota-postgres.mjs', import.meta.url));

test('storage quota changes only its exact trigger and private guard, not API policies or limits', () => {
  const sql = readFileSync(migration, 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /CREATE OR REPLACE TRIGGER enforce_documents_storage_quota\s+AFTER INSERT OR UPDATE ON storage\.objects/i);
  assert.doesNotMatch(sql, /DROP\s+TRIGGER|(?:CREATE|ALTER|DROP)\s+POLICY|DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.get_storage_limit/i);
  assert.doesNotMatch(sql, /REFERENCES\s+auth\.users|auth\.uid\s*\(|auth\.role\s*\(|pg_advisory/i);
  assert.match(sql, /VOLATILE SECURITY DEFINER/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /storage_quota_guards/);
  assert.match(sql, /OLD\.metadata/);
  assert.match(sql, /ERRCODE = '42501'/);
});

test('storage quota harness uses only a scrubbed disposable Unix-socket database', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /!\/\^PG\/i\.test\(key\)/);
  assert.match(source, /listen_addresses=''/);
  assert.match(source, /process\.getuid\?\.\(\) === 0/);
  assert.match(source, /40001/);
  assert.match(source, /REPEATABLE READ/);
  assert.match(source, /SERIALIZABLE/);
  assert.match(source, /exact temporary cluster removed/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install|npx /);
});

test('storage quota actual PostgreSQL races and save compatibility', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
}, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Storage quota PostgreSQL checks passed:/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
