import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const migration=new URL('../supabase/migrations/20260908190000_atomic_billing_subscription_transition.sql',import.meta.url);
const script=fileURLToPath(new URL('../scripts/test-billing-transition-postgres.mjs',import.meta.url));

test('billing transition SQL binds an existing subscription with service-only atomic CAS and receipt',()=>{
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/SET LOCAL lock_timeout/);assert.match(sql,/SET LOCAL statement_timeout/);
  assert.match(sql,/SECURITY DEFINER\s+SET search_path = ''\s+SET timezone = 'UTC'/);
  assert.match(sql,/current_setting\('role', true\)/);assert.match(sql,/r\.rolsuper OR r\.rolbypassrls/);
  assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.apply_billing_subscription_transition\(uuid,text,text,jsonb,jsonb,text,text,text\) FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.apply_billing_subscription_transition\(uuid,text,text,jsonb,jsonb,text,text,text\) TO service_role/);
  assert.match(sql,/event_id text PRIMARY KEY/);assert.match(sql,/billing_transition_receipts_user_idx/);
  assert.match(sql,/REVOKE ALL ON survey_private\.billing_transition_receipts FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql,/current_row IS DISTINCT FROM expected_row/);
  assert.match(sql,/saved\.event_digest IS DISTINCT FROM p_event_digest/);
  assert.equal((sql.match(/'outcome','duplicate'/g)||[]).length,2,'recheck receipt both before and after quota lock');
  const parent=sql.indexOf('FOR KEY SHARE NOWAIT');
  const project=sql.indexOf('INSERT INTO survey_private.project_quota_guards');
  const document=sql.indexOf('INSERT INTO survey_private.document_quota_guards');
  const storage=sql.indexOf('INSERT INTO survey_private.storage_quota_guards');
  assert.ok(parent>=0&&parent<project&&project<document&&document<storage);
  assert.match(sql,/FOR UPDATE NOWAIT/);assert.match(sql,/IF NOT FOUND THEN\s+RAISE EXCEPTION 'Subscription update did not persist' USING ERRCODE='40001'/);
  assert.match(sql,/GREATEST\(count\(\*\)-1,0\)/);assert.match(sql,/GREATEST\(count\(\*\)-5,0\)/);
  assert.match(sql,/ORDER BY updated_at ASC NULLS LAST,id ASC/);
  assert.doesNotMatch(sql,/(?:UPDATE|DELETE FROM|TRUNCATE)\s+storage\.objects|SET\s+archived\s*=\s*false|user_archived_at\s*=|(?:CREATE|DROP|ALTER)\s+POLICY/i);
  assert.doesNotMatch(sql,/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:document_collaborators|project_collaborators)/i);
});

test('billing fixture uses tracked subscription and quota SQL with isolated installed PostgreSQL only',()=>{
  const source=readFileSync(script,'utf8');
  for(const file of ['20241223000001_create_user_subscriptions.sql','20260215170000_fix_subscription_type_dependency.sql',
    '20260818010000_kal390_storage_quota_trigger.sql','20260908130000_project_quota_guard.sql','20260908160000_document_quota_guard.sql','20260908161000_storage_quota_guard.sql'])assert.ok(source.includes(file));
  assert.match(source,/process\.getuid\?\.\(\)===0/);assert.match(source,/filter\(\(\[key\]\)=>!\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);assert.match(source,/\['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres'/);
  assert.match(source,/READ COMMITTED','REPEATABLE READ','SERIALIZABLE/);
  assert.match(source,/\['project','document','storage'\]/);
  assert.match(source,/fixture_suppress_billing_update/);assert.match(source,/fixture_archive_failure/);
  assert.match(source,/owned local server stopped before cleanup/);assert.match(source,/rmSync\(temp,\{recursive:true,force:true\}\)/);
  assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('billing transition passes actual disposable PostgreSQL rollback/replay/concurrency checks',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Billing transition PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});

test('billing transition passes separate disposable PostgreSQL restore and account-delete interleavings',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const concurrencyScript=fileURLToPath(new URL('../scripts/test-billing-transition-concurrency-postgres.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[concurrencyScript],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/PASS ACTUAL RPC: billing user fence blocks account cascade until commit/);
  assert.match(result.stdout,/Disposable database confirmed stopped and removed; logs at/);
});
