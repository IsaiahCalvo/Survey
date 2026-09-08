import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/test-billing-reconciliation-postgres.mjs',import.meta.url));
const migration=new URL('../supabase/migrations/20260908191000_billing_reconciliation_outbox.sql',import.meta.url);

test('reconciliation migration keeps snapshot, reconciliation and notification RPCs service-only',()=>{
  const sql=readFileSync(migration,'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  for(const name of ['read_billing_subscription_snapshot','lookup_billing_event','reconcile_billing_subscription_event','claim_billing_notification','complete_billing_notification']){
    assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC,\\s*anon,\\s*authenticated`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role`));
  }
  assert.match(sql,/p_expected_revision bigint/);
  assert.match(sql,/interval '25 minutes'/);assert.match(sql,/interval '2 minutes'/);
  assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.doesNotMatch(sql,/(?:UPDATE|DELETE FROM|TRUNCATE)\s+storage\.objects|SET\s+archived\s*=\s*false|user_archived_at\s*=|(?:CREATE|DROP|ALTER)\s+POLICY/i);
});

test('billing reconciliation fixture uses installed private-socket PostgreSQL and tracked subscription/quota SQL',()=>{
  const source=readFileSync(script,'utf8');
  for(const name of ['20241223000001_create_user_subscriptions.sql','20260215170000_fix_subscription_type_dependency.sql',
    '20260818010000_kal390_storage_quota_trigger.sql','20260908130000_project_quota_guard.sql',
    '20260908160000_document_quota_guard.sql','20260908161000_storage_quota_guard.sql',
    '20260908190000_atomic_billing_subscription_transition.sql','20260908191000_billing_reconciliation_outbox.sql'])assert.ok(source.includes(name),name);
  assert.match(source,/process\.getuid\?\.\(\)===0/);
  assert.match(source,/filter\(\(\[key\]\)=>!\/\^PG\/i\.test\(key\)\)/);
  assert.match(source,/listen_addresses=''/);
  assert.match(source,/\['-X','-h',socket,'-p',port,'-U','postgres','-d','postgres'/);
  assert.match(source,/owned local server stopped before cleanup/);
  assert.match(source,/rmSync\(temp,\{recursive:true,force:true\}\)/);
  assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('billing reconciliation and notification outbox pass actual isolated PostgreSQL cases',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120_000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Billing reconciliation PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
