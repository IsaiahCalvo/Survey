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
  for(const name of ['20241223000001_create_user_subscriptions.sql','20260703010000_secure_user_subscriptions_rls.sql','20260215170000_fix_subscription_type_dependency.sql',
    '20260818010000_kal390_storage_quota_trigger.sql','20260908130000_project_quota_guard.sql',
    '20260908160000_document_quota_guard.sql','20260908161000_storage_quota_guard.sql',
    '20260908190000_atomic_billing_subscription_transition.sql','20260908191000_billing_reconciliation_outbox.sql',
    '20260908230000_account_storage_closing.sql','20260909010000_billing_account_lifecycle.sql',
    '20260909020000_billing_operation_recovery.sql','20260909030000_billing_customer_reuse.sql'])assert.ok(source.includes(name),name);
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
  assert.match(result.stdout,/Billing reconciliation PostgreSQL checks passed: 75/);
  assert.match(result.stdout,/Billing lifecycle PostgreSQL checks passed: 25/);
  assert.match(result.stdout,/Billing recovery PostgreSQL checks passed: 13/);
  assert.match(result.stdout,/Billing reuse PostgreSQL checks passed: 14/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
test('billing reuse preserves permanent binding facts and bounds exact recovery without inferring provider proof',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20260909030000_billing_customer_reuse.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
  assert.match(sql,/ever_bound boolean NOT NULL DEFAULT true/);assert.match(sql,/ever_bound SET DEFAULT false/);
  assert.doesNotMatch(sql,/SET ever_bound=false|SET customer_binding_state='available'|\bhttp_(?:get|post)\b|REFERENCES\s+auth\.users/i);
  assert.match(sql,/customer_binding_state text NOT NULL DEFAULT 'untracked'/);assert.match(sql,/BILLING_CUSTOMER_REUSE_REQUIRED/);
  assert.match(sql,/ORDER BY operation_id LIMIT 1 FOR SHARE NOWAIT/);assert.match(sql,/LIMIT 2 FOR UPDATE NOWAIT/);
  for(const name of ['read_reusable_billing_customer','retire_reusable_billing_customer'])assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  assert.match(sql,/current_customer=p_customer_id OR operation\.customer_binding_state NOT IN/);
  assert.match(sql,/Removed billing customer cannot be rebound/);assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
});

test('billing recovery reads cannot admit provider work and confirmed deletion revokes only known-customer calls',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20260909020000_billing_operation_recovery.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
  for(const name of ['read_billing_operation','scan_pending_billing_operations','rotate_billing_customer','advance_billing_operation_recovery_cursor','claim_billing_customer_cleanup','ack_billing_customer_cleanup','settle_billing_operation'])assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  assert.match(sql,/PERFORM survey_private\.require_billing_lifecycle_call\(p_user_id\)/);
  assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);assert.match(sql,/TO service_role/);
  assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role|\bhttp_(?:get|post)\b/);
  const scan=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.scan_pending_billing_operations'),sql.indexOf('CREATE OR REPLACE FUNCTION public.rotate_billing_customer'));
  assert.match(scan,/operation_id>cursor_id ORDER BY operation_id LIMIT p_limit/);assert.match(scan,/p_limit NOT BETWEEN 1 AND 20/);
  assert.doesNotMatch(scan,/INSERT INTO survey_private\.billing_operations|SET state=|SET removed=/);
  const ack=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.ack_billing_customer_cleanup'),sql.indexOf('CREATE OR REPLACE FUNCTION public.settle_billing_operation'));
  assert.match(ack,/kind IN \('checkout_create','portal_create'\)/);assert.match(ack,/LIMIT 100 FOR UPDATE NOWAIT/);
  assert.match(ack,/revoked<>cardinality\(selected_ids\)/);assert.match(ack,/closing_xid=pg_current_xact_id\(\)/);
  assert.match(sql,/operation\.recovery_cursor IS DISTINCT FROM p_expected_cursor/);
  assert.match(sql,/stripe_customer_id IS NOT DISTINCT FROM p_expected_customer_id/);
  assert.match(sql,/saved\.result->>'outcome'='customer_removed'/);
  assert.match(sql,/WHERE user_id=p_user_id AND kind=p_kind AND state='pending'/);
  assert.match(sql,/BILLING_OPERATION_PENDING/);
});

test('billing lifecycle exposes only service RPCs and keeps receipts outside auth cascades',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20260909010000_billing_account_lifecycle.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
  for(const name of ['begin_billing_operation','settle_billing_operation','begin_billing_account_closure',
    'claim_billing_customer_cleanup','ack_billing_customer_cleanup','read_billing_account_closure']){
    assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  }
  assert.doesNotMatch(sql,/REFERENCES\s+auth\.users|(?:CREATE|DROP|ALTER)\s+(?:TABLE|TRIGGER)[^;]*\bauth\.users|\bhttp_(?:get|post)\b/i);
  assert.doesNotMatch(sql,/auth\.role\(|request\.jwt\.claim\.role/);
  assert.match(sql,/survey_private\.require_billing_service\(\)/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/NOWAIT/);
  assert.match(sql,/'has_pending_operations'/);assert.match(sql,/'has_pending_customers'/);
  assert.match(sql,/SELECT EXISTS\(SELECT 1 FROM survey_private\.billing_operations/);
  assert.match(sql,/ROW\(provider_scope,customer_id\)>ROW\(cursor_scope,cursor_customer\)/);
  assert.match(sql,/LIMIT p_limit/);assert.match(sql,/closing_xid=pg_current_xact_id\(\)/);
});
