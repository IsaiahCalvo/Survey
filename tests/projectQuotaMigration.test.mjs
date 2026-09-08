import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/test-project-quota-postgres.mjs', import.meta.url));
const migration = new URL('../supabase/migrations/20260908130000_project_quota_guard.sql', import.meta.url);

test('project quota migration keeps RLS enabled and moves the self-count out of the INSERT policy', () => {
  const sql = readFileSync(migration, 'utf8').replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sql, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.match(sql, /SECURITY\s+DEFINER/i);
  assert.match(sql, /SET\s+search_path\s*=\s*''/i);
  assert.match(sql, /VOLATILE/i);
  assert.match(sql, /CREATE\s+TRIGGER/i);
  assert.match(sql, /get_project_limit\s*\(/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.get_project_limit/i);
  const policies = sql.match(/(?:CREATE|ALTER)\s+POLICY[\s\S]*?;/gi) || [];
  assert.ok(policies.length > 0, 'migration must replace the recursive quota policy');
  for (const policy of policies) {
    assert.match(policy, /Users can create projects within limit/);
    assert.match(policy, /auth\.uid\s*\(/);
    assert.match(policy, /user_id/);
    assert.doesNotMatch(policy, /SELECT\s+count\s*\(\*\)\s+FROM\s+(?:public\.)?projects/i);
  }
});

test('quota verification is wired to a guarded disposable UNIX-socket PostgreSQL cluster', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /process\.getuid\?\.\(\) === 0/);
  assert.match(source, /filter\(\(\[key\]\) => !\/\^PG\/i\.test\(key\)\)/);
  assert.match(source, /listen_addresses=''/);
  assert.match(source, /\['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres'/);
  assert.match(source, /for \(let pass = 0; pass < 2; pass\+\+\)/);
  assert.match(source, /policySnapshot\(\), policiesBefore/);
  assert.match(source, /42P17/);
  assert.match(source, /42501/);
  assert.match(source, /40001/);
  assert.match(source, /waitUntilBlocked/);
  assert.match(source, /exact temporary cluster removed/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npx|npm install|brew install/);
});

test('project quota migration passes actual local PostgreSQL concurrency and collaboration guards', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
}, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Project quota PostgreSQL checks passed:/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
