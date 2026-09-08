import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/test-project-status-api-postgres.mjs',import.meta.url));
const migration = new URL('../supabase/migrations/20260908180000_project_status_api_guard.sql',import.meta.url);

test('project-status migration keeps API scope and swap serialization separate from archive and sharing state', () => {
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/^\s*BEGIN;/); assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/SET LOCAL lock_timeout/); assert.match(sql,/SET LOCAL statement_timeout/);
  assert.ok(sql.indexOf('p.prosecdef') < sql.indexOf('CREATE SCHEMA'));
  assert.match(sql,/r\.rolname='postgres'/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS survey_private\.project_swap_guards/);
  assert.match(sql,/user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  assert.match(sql,/ALTER TABLE survey_private\.project_swap_guards ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON survey_private\.project_swap_guards FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql,/current_setting\('role', true\)/); assert.match(sql,/session_user/);
  assert.match(sql,/r\.rolsuper OR r\.rolbypassrls/);
  assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/ON CONFLICT\(user_id\) DO UPDATE SET revision=g\.revision\+1/);
  assert.match(sql,/ORDER BY p\.id FOR SHARE/); assert.match(sql,/ORDER BY ps\.project_id FOR UPDATE/);
  assert.match(sql,/max\(ps\.last_active_swap\)/);
  assert.match(sql,/swap_at := clock_timestamp\(\)/);
  assert.match(sql,/last_swap_at=GREATEST\(last_swap,swap_at\)/);
  assert.match(sql,/REVOKE ALL ON public\.project_status FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/REVOKE ALL \(%s\) ON public\.project_status FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT SELECT ON public\.project_status TO anon, authenticated/);
  assert.match(sql,/GRANT UPDATE\(metadata\) ON public\.project_status TO authenticated/);
  assert.doesNotMatch(sql,/(?:CREATE|DROP|ALTER)\s+POLICY|(?:UPDATE|DELETE FROM|TRUNCATE)\s+(?:public\.)?(?:projects|documents|project_collaborators|document_collaborators)\b/i);
  assert.doesNotMatch(sql,/user_archived_at\s*=/i);
});

test('local project-status fixture loads tracked bodies and runs safe bounded role/concurrency checks', () => {
  const source=readFileSync(script,'utf8');
  assert.match(source,/process\.getuid\?\.\(\) === 0/);
  assert.match(source,/filter\(\(\[key\]\) => !\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);
  assert.match(source,/\['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres'/);
  for (const file of ['20241223000003_create_project_status.sql','20260215170000_fix_subscription_type_dependency.sql','20260701120000_project_template_sharing.sql']) assert.ok(source.includes(file));
  assert.match(source,/READ COMMITTED','REPEATABLE READ','SERIALIZABLE/);
  assert.match(source,/for \(const seeded of \[false,true\]\)/);
  assert.match(source,/40001:/); assert.match(source,/42501:/);
  assert.match(source,/forged service JWT field/); assert.match(source,/direct-login inherited authenticated/);
  assert.match(source,/deleting swapped projects cannot erase the actor cooldown/);
  assert.match(source,/real shared-project policies retain editor updates and viewer rejection/);
  assert.match(source,/successful operation time, not transaction start/);
  assert.match(source,/snapshot\(protectedTables\),protectedState/);
  assert.match(source,/owned local server stopped before cleanup/);
  assert.match(source,/rmSync\(temp,\{recursive:true,force:true\}\)/);
  assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('project-status API passes actual disposable PostgreSQL role and concurrent transaction checks', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
}, () => {
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout,/Project status API PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
