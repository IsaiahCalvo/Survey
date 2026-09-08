import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync, writeFileSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';

// Disposable local PostgreSQL only: never use a configured database or network.
if (process.getuid?.() === 0) throw new Error('Run this local fixture as a non-root user.');
if (process.argv.length !== 2) throw new Error('No arguments or database URLs are accepted.');
const root = resolve(import.meta.dirname, '..');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
const invoke = (command, argv) => spawnSync(command, argv, { env, encoding: 'utf8', timeout: 20000 });
for (const command of ['initdb', 'pg_ctl', 'psql']) {
  const result = invoke(command, ['--version']);
  assert.ok(!result.error && result.status === 0, `Installed ${command} is required; no temporary database was created.`);
}
const base = mkdtempSync('/tmp/survey-billing-transition-concurrency-');
const ownedBase = realpathSync(base);
const messages = [];
const log = message => { messages.push(message); console.log(message); };
const data = `${base}/data`;
function assertOwnedData() {
  assert.match(base, /^\/tmp\/survey-billing-transition-concurrency-[A-Za-z0-9]{6}$/);
  assert.equal(dirname(resolve(data)), base); assert.equal(basename(data), 'data');
  assert.ok(lstatSync(base).isDirectory() && !lstatSync(base).isSymbolicLink());
  assert.equal(realpathSync(base), ownedBase);
  assert.ok(lstatSync(data).isDirectory() && !lstatSync(data).isSymbolicLink());
  assert.equal(realpathSync(data), join(ownedBase, 'data'));
}
const args = ['-X', '-h', base, '-p', '6543', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
const actor = '11111111-1111-4111-8111-111111111111';
const doc = '22222222-2222-4222-8222-222222222222';
function run(command, argv) {
  const result = invoke(command, argv);
  assert.ok(!result.error && result.status === 0, result.stderr || result.error?.message || `${command} exited ${result.status}`);
  return result.stdout.trim();
}
const sql = text => run('psql', [...args, '-c', text]);
const children = new Set();
function session(name) {
  const child = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let out = '', err = '', processError = null, closed = false;
  const captureError = error => { processError ||= error; err += `\n${error.message}`; };
  child.on('error', captureError);
  child.stdin.on('error', captureError); // EPIPE is reported through the awaited session, never thrown asynchronously.
  child.stdout.on('error', captureError); child.stderr.on('error', captureError);
  child.stdout.on('data', value => { out += value; });
  child.stderr.on('data', value => { err += value; });
  const complete = new Promise(resolve => child.on('close', code => {
    closed = true; children.delete(child); resolve({ code: processError ? code || 1 : code, out, err });
  }));
  const send = value => {
    if (processError) throw processError;
    if (closed || child.stdin.destroyed) throw new Error(`Session ${name} closed before its next statement: ${err}`);
    child.stdin.write(value + '\n');
  };
  send(`SET application_name='${name}'; SET deadlock_timeout='100ms'; BEGIN;`);
  return { send, complete, end: () => { if (!child.stdin.destroyed) child.stdin.end(); }, async marker(text) {
    const deadline = Date.now() + 5000;
    while (!out.includes(text)) {
      if (processError) throw processError;
      assert.ok(!closed, `Session ${name} closed before marker ${text}: ${err}`);
      assert.ok(Date.now() < deadline, `No marker ${text}: ${err}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } };
}
async function blocked(name) {
  const deadline = Date.now() + 5000;
  while (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock'`) !== '1') {
    assert.ok(Date.now() < deadline, `No blocked ${name}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const guard = `INSERT INTO survey_private.document_quota_guards AS g(user_id,revision) VALUES('${actor}',1) ON CONFLICT(user_id) DO UPDATE SET revision=g.revision+1;`;
const restore = `UPDATE public.documents SET archived=false WHERE id='${doc}';`;
let initialized = false, startAttempted = false, startSucceeded = false;
try {
  run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8']);
  initialized = true;
  assertOwnedData();
  startAttempted = true; // pg_ctl may launch postgres even if its wait later fails/times out.
  run('pg_ctl', ['-D', data, '-l', `${base}/postgres.log`, '-o', `-c listen_addresses='' -k ${base} -p 6543`, '-w', 'start']);
  startSucceeded = true;
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.user_subscriptions(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, tier text, status text, storage_used_bytes bigint DEFAULT 0);
    CREATE TABLE public.documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,archived boolean DEFAULT false,file_size bigint);
    CREATE FUNCTION public.get_document_limit(uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 5 $$;
    CREATE FUNCTION public.get_storage_limit(uuid) RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT 1000000::bigint $$;
    CREATE FUNCTION public.get_actual_storage_usage(uuid) RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT 0::bigint $$;
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Users can upload documents within limits" ON public.documents FOR INSERT WITH CHECK(true);
    INSERT INTO auth.users VALUES('${actor}'); INSERT INTO public.user_subscriptions(user_id,tier,status) VALUES('${actor}','pro','active');
    INSERT INTO public.documents VALUES('${doc}','${actor}',true,10);`);
  sql(readFileSync(join(root, 'supabase/migrations/20260908160000_document_quota_guard.sql'), 'utf8'));
  sql(guard);
  const billing = session('billing-deadlock');
  billing.send(`${guard} SELECT 'guard-held';`); await billing.marker('guard-held');
  const restoreTx = session('restore-deadlock');
  restoreTx.send(`${restore} COMMIT;`); restoreTx.end(); await blocked('restore-deadlock');
  billing.send(`SELECT id FROM public.documents WHERE user_id='${actor}' ORDER BY id FOR UPDATE; COMMIT;`); billing.end();
  const first = await Promise.all([billing.complete, restoreTx.complete]);
  assert.ok(first.some(result => /40P01:/.test(result.err)), JSON.stringify(first));
  log('PASS BEFORE-FIX HAND-SQL: actual tracked BEFORE guard + billing guard-first FOR UPDATE produces 40P01');
  sql(`UPDATE public.documents SET archived=true; UPDATE public.user_subscriptions SET tier='pro';`);
  const retryBilling = session('billing-nowait');
  retryBilling.send(`${guard} SELECT 'guard-held';`); await retryBilling.marker('guard-held');
  const retryRestore = session('restore-nowait');
  retryRestore.send(`${restore} COMMIT;`); retryRestore.end(); await blocked('restore-nowait');
  retryBilling.send(`SELECT id FROM public.documents WHERE user_id='${actor}' ORDER BY id FOR UPDATE NOWAIT;
    UPDATE public.user_subscriptions SET tier='free'; UPDATE public.documents SET archived=true; COMMIT;`); retryBilling.end();
  const [failedBilling, completedRestore] = await Promise.all([retryBilling.complete, retryRestore.complete]);
  assert.match(failedBilling.err, /55P03:/); assert.equal(completedRestore.code, 0, completedRestore.err);
  assert.equal(sql('SELECT tier FROM public.user_subscriptions'), 'pro');
  assert.equal(sql('SELECT count(*) FROM public.documents WHERE archived=false'), '1');
  log('PASS PROPOSED-PROTOCOL HAND-SQL: NOWAIT fails 55P03 before subscription/archive mutation, releases guard and lets restore commit');
  const expected = sql('SELECT to_jsonb(s)::text FROM public.user_subscriptions s');
  sql(`BEGIN; ${guard}
    SELECT id FROM public.documents WHERE user_id='${actor}' ORDER BY id FOR UPDATE NOWAIT;
    SELECT user_id FROM public.user_subscriptions WHERE user_id='${actor}' FOR UPDATE;
    DO $$ BEGIN IF (SELECT to_jsonb(s) FROM public.user_subscriptions s WHERE user_id='${actor}') IS DISTINCT FROM '${expected}'::jsonb THEN RAISE EXCEPTION 'stale'; END IF; END $$;
    UPDATE public.user_subscriptions SET tier='free'; UPDATE public.documents SET archived=true WHERE user_id='${actor}'; COMMIT;`);
  assert.equal(sql('SELECT tier FROM public.user_subscriptions'), 'free');
  assert.equal(sql('SELECT count(*) FROM public.documents WHERE archived=false'), '0');
  assert.equal(sql('SELECT count(*) FROM public.documents'), '1');
  log('PASS PROPOSED-PROTOCOL HAND-SQL: fresh full-row CAS retry completes subscription+archive atomically: 1 retained row, 0 active');
  // The tracked project/document guards both cascade from auth.users. A guard
  // that does not yet exist needs an FK key-share on the auth row at insertion.
  // A concurrent account cascade can hold that row while waiting on an earlier
  // existing guard, before billing ever reaches its NOWAIT data-lock stage.
  sql(`CREATE TABLE survey_private.project_quota_guards(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,revision bigint NOT NULL DEFAULT 0);
    INSERT INTO survey_private.project_quota_guards VALUES('${actor}',0);
    DELETE FROM survey_private.document_quota_guards WHERE user_id='${actor}';`);
  const cascadeBilling = session('billing-guard-fk');
  cascadeBilling.send(`UPDATE survey_private.project_quota_guards SET revision=revision+1 WHERE user_id='${actor}'; SELECT 'first-guard-held';`);
  await cascadeBilling.marker('first-guard-held');
  const accountDelete = session('account-cascade');
  accountDelete.send(`DELETE FROM auth.users WHERE id='${actor}'; COMMIT;`); accountDelete.end();
  await blocked('account-cascade');
  cascadeBilling.send(`${guard} COMMIT;`); cascadeBilling.end();
  const cascade = await Promise.all([cascadeBilling.complete, accountDelete.complete]);
  assert.ok(cascade.some(result => /40P01:/.test(result.err)), JSON.stringify(cascade));
  log('PASS BEFORE-FIX HAND-SQL: residual 40P01 reproduced during guard FK acquisition versus auth.users cascade, before data-row NOWAIT');
  sql(`INSERT INTO auth.users VALUES('${actor}') ON CONFLICT DO NOTHING;
    INSERT INTO survey_private.project_quota_guards VALUES('${actor}',0) ON CONFLICT DO NOTHING;
    DELETE FROM survey_private.document_quota_guards WHERE user_id='${actor}';`);
  const lifecycleLock = `SELECT id FROM auth.users WHERE id='${actor}' FOR KEY SHARE NOWAIT;`;
  const guardState = () => sql(`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') FROM survey_private.project_quota_guards g; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') FROM survey_private.document_quota_guards g;`);
  const beforeGuard = guardState();
  const deleting = session('delete-first-fenced');
  deleting.send(`DELETE FROM auth.users WHERE id='${actor}'; SELECT 'deleted-not-committed';`); await deleting.marker('deleted-not-committed');
  const rejectedLifecycle = session('billing-after-delete');
  rejectedLifecycle.send(`${lifecycleLock} ${guard} COMMIT;`); rejectedLifecycle.end();
  const rejection = await rejectedLifecycle.complete;
  assert.match(rejection.err, /55P03:/);
  assert.equal(guardState(), beforeGuard, 'failed user gate changed no guards');
  deleting.send('ROLLBACK;'); deleting.end(); await deleting.complete;
  log('PASS PROPOSED-PROTOCOL HAND-SQL: DELETE first: early user KEY SHARE NOWAIT fails55P03 before any guard write');

  const userFencedBilling = session('billing-first-fenced');
  userFencedBilling.send(`${lifecycleLock} SELECT 'user-fenced';`); await userFencedBilling.marker('user-fenced');
  const waitsForUser = session('delete-after-fence');
  waitsForUser.send(`DELETE FROM auth.users WHERE id='${actor}'; SELECT 'cascade-finished';`);
  await blocked('delete-after-fence');
  userFencedBilling.send(`UPDATE survey_private.project_quota_guards SET revision=revision+1 WHERE user_id='${actor}'; ${guard} COMMIT;`);
  userFencedBilling.end(); assert.equal((await userFencedBilling.complete).code, 0);
  await waitsForUser.marker('cascade-finished');
  waitsForUser.send('ROLLBACK;'); waitsForUser.end(); assert.equal((await waitsForUser.complete).code, 0);
  assert.equal(sql(`SELECT count(*) FROM survey_private.document_quota_guards WHERE user_id='${actor}'`), '1');
  log('PASS PROPOSED-PROTOCOL HAND-SQL: billing first: user KEY SHARE blocks account cascade until guards insert and billing commits');

  // Supply only the tables/columns the tracked RPC needs, then run its real SQL.
  sql(`ALTER TABLE public.user_subscriptions ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN stripe_customer_id text,
    ADD COLUMN stripe_subscription_id text, ADD COLUMN stripe_price_id text, ADD COLUMN trial_ends_at timestamptz,
    ADD COLUMN current_period_start timestamptz, ADD COLUMN current_period_end timestamptz,
    ADD COLUMN metadata jsonb DEFAULT '{}', ADD COLUMN updated_at timestamptz DEFAULT now();
    INSERT INTO public.user_subscriptions(user_id,tier,status) VALUES('${actor}','pro','active') ON CONFLICT DO NOTHING;
    UPDATE public.user_subscriptions SET tier='pro',stripe_customer_id='cus_review',stripe_subscription_id='sub_review',stripe_price_id='price_review';
    ALTER TABLE public.documents ADD COLUMN updated_at timestamptz DEFAULT now();
    CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, archived boolean DEFAULT false,updated_at timestamptz DEFAULT now());
    CREATE TABLE survey_private.storage_quota_guards(owner_id uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 0);
    DELETE FROM public.documents;
    INSERT INTO public.documents(id,user_id,archived,file_size) VALUES('${doc}','${actor}',true,10);
    INSERT INTO public.documents(id,user_id,archived,file_size) SELECT ('33333333-3333-4333-8333-'||lpad(g::text,12,'0'))::uuid,'${actor}',false,10 FROM generate_series(1,6) g;`);
  sql(readFileSync(join(root, 'supabase/migrations/20260908190000_atomic_billing_subscription_transition.sql'), 'utf8'));
  const patch = JSON.stringify({ tier: 'free', status: 'active', stripe_subscription_id: 'sub_review', stripe_price_id: 'price_review',
    trial_ends_at: null, current_period_start: null, current_period_end: null, cancel_at: null });
  const actualRpc = (event, expected = sql('SELECT to_jsonb(s)::text FROM public.user_subscriptions s'), userId = actor) =>
    `SET ROLE service_role; SELECT public.apply_billing_subscription_transition('${userId}','cus_review','sub_review','${expected}'::jsonb,'${patch}'::jsonb,'evt_${event}','customer.subscription.updated','${'a'.repeat(64)}');`;
  const holdActive = session('active-document-held');
  holdActive.send(`SELECT id FROM public.documents WHERE archived=false ORDER BY id LIMIT 1 FOR UPDATE; SELECT 'active-held';`); await holdActive.marker('active-held');
  const actualFail = session('actual-billing-nowait'); actualFail.send(actualRpc('nowait') + ' COMMIT;'); actualFail.end();
  assert.match((await actualFail.complete).err, /55P03:/);
  assert.equal(sql('SELECT tier FROM public.user_subscriptions'), 'pro');
  assert.equal(sql('SELECT count(*) FROM survey_private.billing_transition_receipts'), '0');
  holdActive.send('ROLLBACK;'); holdActive.end(); await holdActive.complete;
  const actualApplied = JSON.parse(sql(actualRpc('nowait')));
  assert.equal(actualApplied.outcome, 'applied'); assert.equal(actualApplied.documents_archived_count, 1);
  assert.equal(sql('SELECT count(*) FROM public.documents WHERE archived=false'), '5');
  assert.equal(sql('SELECT count(*) FROM survey_private.billing_transition_receipts'), '1');
  log('PASS actual190000 RPC: active tuple NOWAIT fails with no billing/receipt changes; fresh retry archives exactly1 of6');

  // A pending restore's committed preimage is archived=true, hence the real
  // RPC skips it. Its guard serializes the final trigger quota recheck instead.
  sql(`UPDATE public.user_subscriptions SET tier='pro';
    CREATE OR REPLACE FUNCTION public.get_document_limit(uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT CASE WHEN tier='free' THEN 5 ELSE 100 END FROM public.user_subscriptions WHERE user_id=$1 $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT,UPDATE ON public.documents TO authenticated;
    CREATE POLICY review_document_select ON public.documents FOR SELECT USING(true);
    CREATE POLICY review_document_update ON public.documents FOR UPDATE USING(true) WITH CHECK(true);`);
  const actualExpected = sql('SELECT to_jsonb(s)::text FROM public.user_subscriptions s');
  const actualBilling = session('actual-billing-restore');
  actualBilling.send(`${lifecycleLock} ${guard} SELECT 'guard-held';`); await actualBilling.marker('guard-held');
  const actualRestore = session('actual-restore-waits');
  actualRestore.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${actor}',true); ${restore} COMMIT;`); actualRestore.end();
  await blocked('actual-restore-waits');
  actualBilling.send(actualRpc('restore', actualExpected) + ' COMMIT;'); actualBilling.end();
  const [rpcRestoreResult, deniedRestore] = await Promise.all([actualBilling.complete, actualRestore.complete]);
  assert.equal(rpcRestoreResult.code, 0, rpcRestoreResult.err);
  assert.match(deniedRestore.err, /42501:/);
  assert.match(deniedRestore.err, /Document limit reached/);
  assert.equal(sql('SELECT count(*) FROM public.documents WHERE archived=false'), '5');
  assert.equal(sql(`SELECT archived FROM public.documents WHERE id='${doc}'`), 't');
  log('PASS actual190000 RPC: queued inactive restore sees fresh free quota after billing and rejects42501; count remains5');

  const beforeLifecycle = {
    guards: guardState(),
    row: sql('SELECT to_jsonb(s)::text FROM public.user_subscriptions s'),
    receipts: sql('SELECT count(*) FROM survey_private.billing_transition_receipts'),
  };
  const actualDeleting = session('actual-delete-first');
  actualDeleting.send(`DELETE FROM auth.users WHERE id='${actor}'; SELECT 'delete-held';`);
  await actualDeleting.marker('delete-held');
  const rejectedActualBilling = session('actual-rpc-delete-first');
  rejectedActualBilling.send(actualRpc('deletefirst', beforeLifecycle.row) + ' COMMIT;');
  rejectedActualBilling.end();
  assert.match((await rejectedActualBilling.complete).err, /55P03:/);
  assert.equal(guardState(), beforeLifecycle.guards);
  assert.equal(sql('SELECT to_jsonb(s)::text FROM public.user_subscriptions s'), beforeLifecycle.row);
  assert.equal(sql('SELECT count(*) FROM survey_private.billing_transition_receipts'), beforeLifecycle.receipts);
  actualDeleting.send('ROLLBACK;'); actualDeleting.end(); await actualDeleting.complete;
  log('PASS ACTUAL RPC: DELETE holds user first;55P03 before guard, subscription or receipt changes');

  const absentActor = '44444444-4444-4444-8444-444444444444';
  const absentExpected = JSON.stringify({ ...JSON.parse(beforeLifecycle.row), user_id: absentActor });
  assert.equal(JSON.parse(sql(actualRpc('missingactor', absentExpected, absentActor))).outcome, 'stale');
  assert.equal(guardState(), beforeLifecycle.guards);
  assert.equal(sql(`SELECT count(*) FROM survey_private.storage_quota_guards WHERE owner_id='${absentActor}'`), '0');
  assert.equal(sql('SELECT count(*) FROM survey_private.billing_transition_receipts'), beforeLifecycle.receipts);
  log('PASS ACTUAL RPC: absent actor returns stale and creates no guard or receipt');

  sql(`DELETE FROM survey_private.document_quota_guards WHERE user_id='${actor}';`);
  const actualFencedBilling = session('actual-rpc-billing-first');
  actualFencedBilling.send(actualRpc('billingfirst') + " SELECT 'rpc-awaiting-commit';");
  await actualFencedBilling.marker('rpc-awaiting-commit');
  const actualCascade = session('actual-delete-after-rpc');
  actualCascade.send(`DELETE FROM auth.users WHERE id='${actor}'; SELECT 'actual-cascade-complete';`);
  await blocked('actual-delete-after-rpc');
  actualFencedBilling.send('COMMIT;'); actualFencedBilling.end();
  assert.equal((await actualFencedBilling.complete).code, 0);
  await actualCascade.marker('actual-cascade-complete');
  actualCascade.send('ROLLBACK;'); actualCascade.end(); assert.equal((await actualCascade.complete).code, 0);
  assert.equal(sql(`SELECT count(*) FROM survey_private.document_quota_guards WHERE user_id='${actor}'`), '1');
  assert.equal(sql(`SELECT count(*) FROM survey_private.billing_transition_receipts WHERE event_id='evt_billingfirst'`), '1');
  assert.equal(sql('SELECT count(*) FROM public.documents WHERE archived=false'), '5');
  log('PASS ACTUAL RPC: billing user fence blocks account cascade until commit, including missing guard insertion');
} finally {
  for (const child of children) { try { child.kill('SIGTERM'); } catch { /* pg_ctl owns the server shutdown below. */ } }
  let removed = false;
  try {
    assert.ok(initialized, 'Initialization did not finish; retain the partial data directory.');
    assertOwnedData();
    let status = invoke('pg_ctl', ['-D', data, 'status']);
    if (!status.error && status.status === 0) {
      // Check status even when start failed: it may already have launched the
      // exact owned server. A successful stop alone is not deletion permission.
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      status = invoke('pg_ctl', ['-D', data, 'status']);
    } else {
      assert.ok(!startAttempted || startSucceeded,
        'Startup did not report success and no running server was confirmed; retain data rather than race a late start.');
    }
    assert.ok(!status.error && status.status === 3, 'Server stop/status is uncertain; retain its data directory.');
    assertOwnedData();
    rmSync(data, { recursive: true }); removed = true;
  } catch (error) {
    process.exitCode = 1;
    log(`CLEANUP RETAINED ${data}: ${error.message}`);
  }
  writeFileSync(join(base, 'results.log'), messages.join('\n') + '\n');
  console.log(`Disposable database ${removed ? 'confirmed stopped and removed' : 'retained for inspection'}; logs at ${base}`);
}
