import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/test-archive-helper-permissions-postgres.mjs', import.meta.url));
const migration = new URL('../supabase/migrations/20260908171000_archive_helpers_service_only.sql', import.meta.url);
const signatures = ['handle_downgrade_to_free(uuid)', 'archive_excess_projects(uuid,integer)',
  'archive_excess_projects(uuid,uuid)', 'archive_excess_documents(uuid,integer)'];

test('archive helper permission patch is transactional and touches only four exact ACLs', () => {
  const sql = readFileSync(migration, 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /^\s*BEGIN;/); assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /SET LOCAL lock_timeout/); assert.match(sql, /SET LOCAL statement_timeout/);
  const revokes = sql.match(/REVOKE\s+ALL\s+ON\s+FUNCTION[^;]*;/gi) || [];
  const grants = sql.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*;/gi) || [];
  assert.equal(revokes.length, 4); assert.equal(grants.length, 4);
  for (const signature of signatures) {
    assert.ok(revokes.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`));
    assert.ok(grants.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`));
  }
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|ALTER\s+(?:FUNCTION|TABLE|POLICY)|(?:INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)|CREATE\s+(?:TABLE|POLICY)/i);
  assert.ok(sql.indexOf('p.prosecdef') < sql.indexOf('REVOKE ALL'));
  assert.match(sql, /r\.rolname\s*=\s*'postgres'/);
  for (const signature of signatures) assert.ok(sql.includes(`'public.${signature}'::regprocedure`));
});

test('local permission fixture loads real definitions and guards its disposable socket cluster', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /process\.getuid\?\.\(\) === 0/);
  assert.match(source, /filter\(\(\[key\]\) => !\/\^PG\/i\.test\(key\)\)/);
  assert.match(source, /listen_addresses=''/);
  assert.match(source, /\['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres'/);
  assert.match(source, /20241223000003_create_project_status\.sql/); assert.match(source, /20241226000002_add_archived_columns\.sql/);
  assert.match(source, /42501/); assert.match(source, /for \(let pass = 0; pass < 2; pass\+\+\)/);
  assert.match(source, /functionSnapshot\(\), functionsBefore/); assert.match(source, /policySnapshot\(\), policiesBefore/);
  assert.match(source, /dataSnapshot\(\), rowsBefore/); assert.match(source, /unchangedFields\(\), originalFields/);
  assert.match(source, /UPDATE projects SET user_archived_at='2025-02-01'/);
  assert.match(source, /UPDATE documents SET user_archived_at='2025-02-02'/);
  assert.match(source, /SET search_path = public/);
  assert.match(source, /preflight rejects a changed owner before any helper ACL changes/);
  assert.match(source, /owned local server stopped before cleanup/);
  assert.match(source, /rmSync\(temp, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('archive helper permissions pass actual disposable PostgreSQL checks', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
}, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Archive helper permissions PostgreSQL checks passed:/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
