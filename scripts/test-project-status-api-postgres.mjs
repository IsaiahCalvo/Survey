// Installed, disposable local PostgreSQL only. No existing database or network.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const migration = join(root, 'supabase/migrations/20260908180000_project_status_api_guard.sql');
if (process.argv.length !== 2) throw new Error('This local fixture takes no arguments.');
if (process.getuid?.() === 0) throw new Error('Run this disposable PostgreSQL harness as a non-root user.');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
for (const command of ['initdb', 'pg_ctl', 'psql']) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Installed ${command} is required; nothing was installed and no database was contacted.`);
}
const temp = mkdtempSync('/tmp/survey-project-status-api-');
const data = join(temp, 'data'), socket = temp, port = '6543';
const psqlArgs = ['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'];
let started = false, assertions = 0;
const children = new Set();
const run = (command, args, required = true) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  if (required && (result.error || result.status !== 0)) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return { status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
};
const sql = (statement, required = true) => run('psql', [...psqlArgs, '-c', statement], required);
const scalar = statement => sql(statement).stdout;
const apply = () => run('psql', [...psqlArgs, '-f', migration]);
const check = async (label, action) => { await action(); assertions++; console.log(`PASS ${label}`); };
const uuid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = uuid(1), b = uuid(2), paid = uuid(3);
const pid = (actor, n) => uuid(actor * 100 + n);
const claim = (role, actor) => `SET ROLE ${role}; SET request.jwt.claim.sub='${actor || ''}'; SET request.jwt.claim.role='${role}';`;
const asRole = (role, actor, statement, required = true) => sql(`${claim(role, actor)} ${statement}`, required);
const swap = (actor, old, next) => `SELECT public.swap_active_project('${actor}'::uuid,'${old}'::uuid,'${next}'::uuid)`;
const active = actor => `SELECT project_id FROM public.get_active_projects('${actor}'::uuid)`;
const accessible = (actor, project) => `SELECT public.is_project_accessible('${project}'::uuid,'${actor}'::uuid)`;
const tables = ['auth.users', 'public.user_subscriptions', 'public.projects', 'public.documents', 'public.project_status', 'public.project_collaborators', 'public.document_collaborators', 'storage.objects'];
const snapshot = (names = tables) => names.map(table => scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));
const policySnapshot = () => scalar(`SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p`);
const triggerSnapshot = () => scalar(`SELECT jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'definition',pg_get_triggerdef(oid)) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal`);
const assertError = (result, pattern) => { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); };
const resetStatuses = () => sql(`UPDATE project_status SET is_active=project_id IN ('${pid(1,1)}','${pid(2,1)}','${pid(3,1)}'),archived_at=null,archived_reason=null,last_active_swap=null;`);
function sourceFunction(file, name) {
  const source = readFileSync(join(root, 'supabase/migrations', file), 'utf8');
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql SECURITY DEFINER;`, 'i'));
  assert.ok(match, `tracked definition ${name} is present`); return match[0];
}
function asyncSql(statement) {
  const child = spawn('psql', [...psqlArgs, '-c', statement], { cwd: root, env, stdio: ['ignore','pipe','pipe'] });
  children.add(child); let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
    child.once('close', status => { clearTimeout(timer); children.delete(child); resolveResult({ status, stdout: stdout.trim(), stderr: stderr.trim() }); });
  });
}
async function waitForSleep(name) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep'`) === '1') return;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw new Error(`Owned fixture session ${name} did not reach its transaction barrier`);
}

try {
  run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8']); started = true;
  run('pg_ctl', ['-D', data, '-l', join(temp, 'postgres.log'), '-o', `-c listen_addresses='' -k ${socket} -p ${port}`, '-w', 'start']);
  console.log(scalar('SELECT version()'));
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE fixture_member LOGIN IN ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
    CREATE TYPE subscription_tier AS ENUM ('free','pro','enterprise','developer');
    CREATE TABLE user_subscriptions(user_id uuid PRIMARY KEY REFERENCES auth.users(id),tier subscription_tier);
    CREATE FUNCTION get_user_tier(p_user_id uuid) RETURNS subscription_tier LANGUAGE sql SECURITY DEFINER AS $$ SELECT tier FROM user_subscriptions WHERE user_id=p_user_id $$;
    CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),name varchar NOT NULL,updated_at timestamptz DEFAULT now(),archived boolean DEFAULT false,user_archived_at timestamptz,metadata jsonb);
    CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),project_id uuid REFERENCES projects(id),archived boolean DEFAULT false,user_archived_at timestamptz,annotations jsonb,file_path text);
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id),user_id uuid REFERENCES auth.users(id),role text);
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id),user_id uuid REFERENCES auth.users(id),role text);
    CREATE TABLE storage.objects(name text PRIMARY KEY,bytes bytea);
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_owner_read ON projects FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE POLICY fixture_owner_insert ON projects FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
    CREATE POLICY fixture_owner_delete ON projects FOR DELETE TO authenticated USING(user_id=auth.uid());
    GRANT SELECT,INSERT,UPDATE,DELETE ON projects TO authenticated;
    GRANT SELECT ON projects TO anon;
    INSERT INTO auth.users VALUES('${a}'),('${b}'),('${paid}');
    INSERT INTO user_subscriptions VALUES('${a}','free'),('${b}','free'),('${paid}','pro');`);
  sql(readFileSync(join(root,'supabase/migrations/20241223000003_create_project_status.sql'),'utf8'));
  for (const name of ['get_user_tier','swap_active_project','is_project_accessible']) sql(sourceFunction('20260215170000_fix_subscription_type_dependency.sql', name));
  // Match the confirmed deployed dependencies while retaining tracked bodies.
  for (const signature of ['get_user_tier(uuid)','create_project_status()','update_project_status_updated_at()']) sql(`ALTER FUNCTION ${signature} SET search_path=public`);
  // Explicit fixture membership resolver; the SELECT/UPDATE policies are the
  // real tracked shared-project policies, not a test replacement for them.
  sql(`CREATE FUNCTION public.user_can_access_project(p_project_id uuid,p_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM project_collaborators pc WHERE pc.project_id=p_project_id AND pc.user_id=auth.uid()
        AND CASE p_role WHEN 'viewer' THEN pc.role IN ('viewer','editor','owner') WHEN 'editor' THEN pc.role IN ('editor','owner') ELSE pc.role='owner' END)
    $$; DROP POLICY fixture_owner_read ON projects;`);
  const sharedPolicies = readFileSync(join(root,'supabase/migrations/20260701120000_project_template_sharing.sql'),'utf8');
  sql(sharedPolicies.slice(sharedPolicies.indexOf('DROP POLICY IF EXISTS "Users can view own projects"'), sharedPolicies.indexOf('-- 4d.')));
  const policySource = readFileSync(join(root,'supabase/migrations/20260211224047_fix_permissive_rls_policies.sql'),'utf8');
  sql(policySource.slice(policySource.indexOf('DROP POLICY'), policySource.indexOf('-- 2.')));
  const signatures = ['get_active_projects(uuid)','swap_active_project(uuid,uuid,uuid)','is_project_accessible(uuid,uuid)'];
  for (const signature of signatures) sql(`ALTER FUNCTION public.${signature} SET search_path=public; REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated,service_role`);
  sql(`GRANT EXECUTE ON FUNCTION is_project_accessible(uuid,uuid) TO anon;
    GRANT ALL ON project_status TO anon,authenticated,service_role;
    GRANT UPDATE(last_active_swap,is_active) ON project_status TO authenticated,anon;
    GRANT ALL ON projects,documents TO service_role;
    INSERT INTO projects(id,user_id,name,metadata)
    SELECT ('20000000-0000-4000-8000-'||lpad((a*100+n)::text,12,'0'))::uuid,
      ('20000000-0000-4000-8000-'||lpad(a::text,12,'0'))::uuid,'project-'||a||'-'||n,jsonb_build_object('keep',a||'-'||n)
    FROM generate_series(1,3) a CROSS JOIN generate_series(1,5) n;
    UPDATE projects SET archived=true,user_archived_at='2025-02-01' WHERE id IN ('${pid(1,5)}','${pid(2,5)}');
    INSERT INTO documents VALUES('${uuid(1001)}','${a}','${pid(1,1)}',true,'2025-02-02','{"keep":"annotations"}','fixture/pdf-a');
    INSERT INTO project_collaborators VALUES('${pid(1,1)}','${b}','editor');
    INSERT INTO project_collaborators VALUES('${pid(1,1)}','${paid}','viewer');
    INSERT INTO document_collaborators VALUES('${uuid(1001)}','${b}','viewer');
    INSERT INTO storage.objects VALUES('fixture/pdf-a',decode('255044462d66697874757265','hex'));`);
  resetStatuses();
  await check('baseline authenticated caller reads another actor active projects', () => assert.equal(asRole('authenticated',a,active(b)).stdout,pid(2,1)));
  await check('baseline authenticated caller swaps another actor projects', () => {
    assert.equal(asRole('authenticated',a,swap(b,pid(2,1),pid(2,2))).stdout,'t');
    assert.equal(scalar(`SELECT is_active FROM project_status WHERE project_id='${pid(2,2)}'`),'t');
  });
  await check('baseline direct own UPDATE clears cooldown then permits a second swap', () => {
    asRole('authenticated',a,swap(a,pid(1,1),pid(1,2)));
    assertError(asRole('authenticated',a,swap(a,pid(1,2),pid(1,3)),false),/once per month/);
    asRole('authenticated',a,`UPDATE project_status SET last_active_swap=null WHERE project_id='${pid(1,2)}'`);
    assert.equal(asRole('authenticated',a,swap(a,pid(1,2),pid(1,3))).stdout,'t');
  });
  await check('baseline anonymous accessibility leaks another actor active state', () => assert.equal(asRole('anon',null,accessible(b,pid(2,2))).stdout,'t'));
  resetStatuses();
  const baselineRows = snapshot(), baselinePolicies = policySnapshot(), baselineTriggers = triggerSnapshot();
  for (let pass=1; pass<=2; pass++) await check(`migration pass ${pass} leaves existing rows, policies and triggers intact`, () => {
    apply(); assert.deepEqual(snapshot(),baselineRows); assert.equal(policySnapshot(),baselinePolicies); assert.equal(triggerSnapshot(),baselineTriggers);
  });
  const guardTable = 'survey_private.project_swap_guards';
  const reset = () => { resetStatuses(); sql(`TRUNCATE ${guardTable}`); };
  const allState = () => snapshot([...tables,guardTable]);
  const protectedTables = tables.filter(table => table !== 'public.project_status');
  const protectedState = snapshot(protectedTables);
  for (const actor of [a,null]) await check(`authenticated ${actor ? 'cross-account' : 'missing-identity'} calls fail closed without writes`, () => {
    const before = allState();
    assertError(asRole('authenticated',actor,active(b),false),/42501:/);
    assertError(asRole('authenticated',actor,swap(b,pid(2,1),pid(2,2)),false),/42501:/);
    assert.equal(asRole('authenticated',actor,accessible(b,pid(2,1))).stdout,'f');
    assert.deepEqual(allState(),before);
  });
  await check('forged service JWT field does not grant service SQL-role authority', () => {
    const before=allState();
    assertError(sql(`${claim('authenticated',a)} SET request.jwt.claim.role='service_role'; ${swap(b,pid(2,1),pid(2,2))}`,false),/42501:/);
    assert.deepEqual(allState(),before);
  });
  await check('direct-login inherited authenticated role with role=none remains self-scoped', () => {
    const args=[...psqlArgs]; args[args.indexOf('-U')+1]='fixture_member';
    const loginSql=statement=>run('psql',[...args,'-c',`SET request.jwt.claim.sub='${a}'; ${statement}`],false);
    assert.equal(loginSql(`SELECT current_setting('role'); ${active(a)}`).stdout,`none\n${pid(1,1)}`);
    assertError(loginSql(active(b)),/42501:/);
    assertError(loginSql(`SET request.jwt.claim.role='service_role'; ${swap(b,pid(2,1),pid(2,2))}`),/42501:/);
  });
  await check('anonymous accessibility remains callable but reveals no other user state', () => {
    assert.equal(asRole('anon',null,accessible(b,pid(2,1))).stdout,'f');
    for (const statement of [active(b),swap(b,pid(2,1),pid(2,2))]) assertError(asRole('anon',null,statement,false),/42501:/);
  });
  await check('own reads retain active rows and missing/null accessibility is false', () => {
    assert.equal(asRole('authenticated',a,active(a)).stdout,pid(1,1));
    for (const [project,expected] of [[pid(1,1),'t'],[pid(1,2),'f'],[uuid(9999),'f'],[pid(2,1),'f']]) {
      assert.equal(asRole('authenticated',a,accessible(a,project)).stdout,expected);
    }
    assert.equal(asRole('authenticated',a,`SELECT is_project_accessible(NULL,'${a}'),is_project_accessible('${pid(1,1)}',NULL)`).stdout,'f|f');
  });
  await check('clients retain only SELECT and owner metadata UPDATE, including explicit old column grants', () => {
    for (const role of ['anon','authenticated']) {
      assert.equal(scalar(`SELECT has_table_privilege('${role}','project_status','SELECT')`),'t');
      for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal(scalar(`SELECT has_table_privilege('${role}','project_status','${privilege}')`),'f');
      for (const column of ['is_active','last_active_swap','project_id','archived_at','updated_at','created_at','archived_reason']) {
        assert.equal(scalar(`SELECT has_column_privilege('${role}','project_status','${column}','UPDATE')`),'f');
      }
    }
    assert.equal(scalar(`SELECT has_column_privilege('authenticated','project_status','metadata','UPDATE')`),'t');
    assert.equal(scalar(`SELECT has_column_privilege('anon','project_status','metadata','UPDATE')`),'f');
    const before=allState();
    for (const statement of [
      `UPDATE project_status SET last_active_swap=NULL WHERE project_id='${pid(1,1)}'`,
      `UPDATE project_status SET is_active=true WHERE project_id='${pid(1,2)}'`,
      `DELETE FROM project_status WHERE project_id='${pid(1,1)}'`,
      'TRUNCATE project_status',
      `INSERT INTO project_status(project_id) VALUES('${uuid(9999)}')`,
    ]) assertError(asRole('authenticated',a,statement,false),/42501:/);
    assert.deepEqual(allState(),before);
    assert.equal(asRole('authenticated',a,'SELECT count(*) FROM project_status').stdout,'5');
    assert.equal(asRole('anon',null,'SELECT count(*) FROM project_status').stdout,'0');
    asRole('authenticated',a,`UPDATE project_status SET metadata='{"panel":"kept"}' WHERE project_id='${pid(1,1)}'`);
    assert.equal(scalar(`SELECT metadata->>'panel' FROM project_status WHERE project_id='${pid(1,1)}'`),'kept');
    assert.equal(asRole('authenticated',a,`UPDATE project_status SET metadata='{"bad":true}' WHERE project_id='${pid(2,1)}' RETURNING project_id`).stdout,'');
  });
  await check('private guard and helper are inaccessible to direct API roles', () => {
    for (const role of ['anon','authenticated','service_role']) {
      for (const statement of [`SELECT * FROM ${guardTable}`,`UPDATE ${guardTable} SET last_swap_at=NULL`,`SELECT survey_private.can_use_project_status('${a}')`]) {
        assertError(asRole(role,a,statement,false),/42501:/);
      }
    }
  });
  await check('invalid selections and missing status fail atomically without consuming guard revision', () => {
    reset();
    for (const [old,next] of [[pid(1,1),pid(1,1)],[pid(1,1),uuid(9999)],[pid(1,1),pid(2,2)],[pid(1,2),pid(1,3)]]) {
      const before=allState(); assertError(asRole('authenticated',a,swap(a,old,next),false),/Invalid project selection/); assert.deepEqual(allState(),before);
    }
    const before=allState();
    assertError(asRole('authenticated',a,`SELECT swap_active_project('${a}',NULL,'${pid(1,2)}')`,false),/Invalid project selection/); assert.deepEqual(allState(),before);
    sql(`DELETE FROM project_status WHERE project_id='${pid(1,2)}'`); const missing=allState();
    assertError(asRole('authenticated',a,swap(a,pid(1,1),pid(1,2)),false),/Invalid project selection/); assert.deepEqual(allState(),missing);
    sql(`INSERT INTO project_status(project_id,is_active) VALUES('${pid(1,2)}',false)`);
  });
  await check('free swap stamps both rows and guard; replay and second swap cannot clear cooldown', () => {
    reset(); assert.equal(asRole('authenticated',a,swap(a,pid(1,1),pid(1,2))).stdout,'t');
    assert.equal(scalar(`SELECT revision=1 AND last_swap_at IS NOT NULL FROM ${guardTable} WHERE user_id='${a}'`),'t');
    assert.equal(scalar(`SELECT bool_and(last_active_swap IS NOT NULL) FROM project_status WHERE project_id IN ('${pid(1,1)}','${pid(1,2)}')`),'t');
    const before=allState();
    assertError(asRole('authenticated',a,swap(a,pid(1,1),pid(1,2)),false),/Invalid project selection/);
    assertError(asRole('authenticated',a,swap(a,pid(1,2),pid(1,3)),false),/once per month/);
    assert.deepEqual(allState(),before);
  });
  await check('all legacy status timestamps participate even outside the selected pair', () => {
    reset(); sql(`UPDATE project_status SET last_active_swap=now() WHERE project_id='${pid(1,4)}'`);
    const before=allState(); assertError(asRole('authenticated',a,swap(a,pid(1,1),pid(1,2)),false),/once per month/); assert.deepEqual(allState(),before);
    sql(`UPDATE project_status SET last_active_swap=now()-interval '31 days' WHERE project_id='${pid(1,4)}'`);
    assert.equal(asRole('authenticated',a,swap(a,pid(1,1),pid(1,2))).stdout,'t');
  });
  await check('explicit rollback restores both statuses and the durable guard', () => {
    reset(); const before=allState(); asRole('authenticated',a,`BEGIN; ${swap(a,pid(1,1),pid(1,2))}; ROLLBACK;`);
    assert.deepEqual(allState(),before); assert.equal(asRole('authenticated',a,swap(a,pid(1,1),pid(1,2))).stdout,'t');
  });
  await check('paid actors can swap both-active projects repeatedly without a free-tier cap', () => {
    reset(); sql(`UPDATE project_status SET is_active=true WHERE project_id IN ('${pid(3,2)}','${pid(3,3)}')`);
    for (const [old,next] of [[1,2],[2,3],[3,1]]) assert.equal(asRole('authenticated',paid,swap(paid,pid(3,old),pid(3,next))).stdout,'t');
    assert.equal(scalar(`SELECT revision FROM ${guardTable} WHERE user_id='${paid}'`),'3');
  });
  await check('paid future legacy timestamps cannot move the account guard backwards', () => {
    reset(); sql(`UPDATE project_status SET last_active_swap=clock_timestamp()+interval '2 days' WHERE project_id='${pid(3,4)}'`);
    const future=scalar(`SELECT last_active_swap::text FROM project_status WHERE project_id='${pid(3,4)}'`);
    asRole('authenticated',paid,swap(paid,pid(3,1),pid(3,2)));
    assert.equal(scalar(`SELECT last_swap_at::text FROM ${guardTable} WHERE user_id='${paid}'`),future);
    sql(`UPDATE project_status SET last_active_swap=NULL WHERE project_id='${pid(3,4)}'`);
    asRole('authenticated',paid,swap(paid,pid(3,2),pid(3,3)));
    assert.equal(scalar(`SELECT last_swap_at::text FROM ${guardTable} WHERE user_id='${paid}'`),future);
  });
  await check('a delayed transaction uses successful operation time, not transaction start', () => {
    reset();
    const output=asRole('authenticated',a,`BEGIN; SELECT extract(epoch FROM now()); SELECT pg_sleep(0.25); ${swap(a,pid(1,1),pid(1,2))}; COMMIT;`).stdout;
    const began=Number(output.split('\n')[0]);
    const stamped=Number(scalar(`SELECT extract(epoch FROM last_swap_at) FROM ${guardTable} WHERE user_id='${a}'`));
    assert.ok(stamped-began>=0.20,`operation stamp must follow deliberate transaction delay: ${stamped-began}`);
    assert.equal(scalar(`SELECT bool_and(ps.last_active_swap=g.last_swap_at) FROM project_status ps CROSS JOIN ${guardTable} g WHERE g.user_id='${a}' AND ps.project_id IN ('${pid(1,1)}','${pid(1,2)}')`),'t');
  });
  await check('a project lock wait cannot backdate the free cooldown', async () => {
    reset();
    const holder=asyncSql(`SET application_name='fixture_stamp_lock'; BEGIN; SELECT id FROM projects WHERE id='${pid(1,1)}' FOR UPDATE; SELECT pg_sleep(1); COMMIT;`);
    await waitForSleep('fixture_stamp_lock');
    const waiter=asyncSql(`${claim('authenticated',a)} BEGIN; SELECT extract(epoch FROM now()); ${swap(a,pid(1,1),pid(1,2))}; COMMIT;`);
    const [held,waited]=await Promise.all([holder,waiter]); assert.equal(held.status,0,held.stderr); assert.equal(waited.status,0,waited.stderr);
    const began=Number(waited.stdout.split('\n')[0]);
    const stamped=Number(scalar(`SELECT extract(epoch FROM last_swap_at) FROM ${guardTable} WHERE user_id='${a}'`));
    assert.ok(stamped-began>=0.5,`cooldown stamp must follow lock wait: ${stamped-began}`);
  });
  for (const role of ['service_role','postgres']) await check(`${role} works without JWT identity but still obeys target free-tier cooldown`, () => {
    reset(); assert.equal(asRole(role,null,active(b)).stdout,pid(2,1)); assert.equal(asRole(role,null,accessible(b,pid(2,1))).stdout,'t');
    assert.equal(asRole(role,null,swap(b,pid(2,1),pid(2,2))).stdout,'t');
    assertError(asRole(role,null,swap(b,pid(2,2),pid(2,3)),false),/once per month/);
  });
  for (const isolation of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE']) for (const seeded of [false,true]) await check(`${isolation} concurrent disjoint swaps serialize (${seeded ? 'existing' : 'new'} guard)`, async () => {
    reset(); sql(`UPDATE project_status SET is_active=true WHERE project_id='${pid(1,3)}'`);
    if (seeded) sql(`INSERT INTO ${guardTable}(user_id) VALUES('${a}')`);
    const name=`fixture_${isolation.replaceAll(' ','_')}_${seeded}`;
    const first=asyncSql(`${claim('authenticated',a)} SET application_name='${name}'; BEGIN; ${swap(a,pid(1,1),pid(1,2))}; SELECT pg_sleep(1.5); COMMIT;`);
    await waitForSleep(name);
    const second=asyncSql(`${claim('authenticated',a)} BEGIN ISOLATION LEVEL ${isolation}; SELECT count(*) FROM project_status; ${swap(a,pid(1,3),pid(1,4))}; COMMIT;`);
    const [one,two]=await Promise.all([first,second]); assert.equal(one.status,0,one.stderr);
    assertError(two,isolation==='READ COMMITTED' ? /once per month/ : /40001:/);
    assert.equal(scalar(`SELECT revision FROM ${guardTable} WHERE user_id='${a}'`),'1');
    assert.equal(scalar(`SELECT is_active FROM project_status WHERE project_id='${pid(1,3)}'`),'t');
    assert.equal(scalar(`SELECT is_active FROM project_status WHERE project_id='${pid(1,4)}'`),'f');
  });
  await check('successful and rejected swaps preserve PDF bytes, shares, project archive flags and user archives', () => assert.deepEqual(snapshot(protectedTables),protectedState));
  for (const action of ['transfer','delete']) await check(`concurrent project ${action} is rechecked after the ownership lock wait`, async () => {
    reset(); const target=pid(2,2);
    const saved=JSON.parse(scalar(`SELECT to_jsonb(p) FROM projects p WHERE id='${target}'`));
    const change=action==='transfer' ? `UPDATE projects SET user_id='${a}' WHERE id='${target}'` : `DELETE FROM projects WHERE id='${target}'`;
    const holder=asyncSql(`SET application_name='fixture_owner_${action}'; BEGIN; ${change}; SELECT pg_sleep(1); COMMIT;`);
    await waitForSleep(`fixture_owner_${action}`);
    const waiter=asyncSql(`${claim('authenticated',b)} ${swap(b,pid(2,1),target)}`);
    const [held,waited]=await Promise.all([holder,waiter]); assert.equal(held.status,0,held.stderr); assertError(waited,/Invalid project selection/);
    assert.equal(scalar(`SELECT count(*) FROM ${guardTable} WHERE user_id='${b}'`),'0');
    assert.equal(scalar(`SELECT is_active AND last_active_swap IS NULL FROM project_status WHERE project_id='${pid(2,1)}'`),'t');
    if(action==='transfer') sql(`UPDATE projects SET user_id='${b}' WHERE id='${target}'`);
    else sql(`INSERT INTO projects SELECT * FROM jsonb_populate_record(NULL::projects,'${JSON.stringify(saved).replaceAll("'","''")}'::jsonb)`);
  });
  await check('projects UPDATE policy still permits own active edit, denies inactive and foreign edits', () => {
    reset();
    assert.equal(asRole('authenticated',a,`UPDATE projects SET name='own-active-edit' WHERE id='${pid(1,1)}' RETURNING id`).stdout,pid(1,1));
    for (const project of [pid(1,2),pid(2,1)]) assert.equal(asRole('authenticated',a,`UPDATE projects SET name='denied-edit' WHERE id='${project}' RETURNING id`).stdout,'');
  });
  await check('real shared-project policies retain editor updates and viewer rejection', () => {
    // Even when owner status is inactive, the distinct shared-editor policy
    // branch must not throw from the self-scoped accessibility helper.
    sql(`UPDATE project_status SET is_active=false WHERE project_id='${pid(1,1)}'`);
    for (const actor of [b,paid]) assert.equal(asRole('authenticated',actor,`SELECT id FROM projects WHERE id='${pid(1,1)}'`).stdout,pid(1,1));
    assert.equal(asRole('authenticated',b,`UPDATE projects SET name='shared-editor-edit' WHERE id='${pid(1,1)}' RETURNING id`).stdout,pid(1,1));
    assert.equal(asRole('authenticated',paid,`UPDATE projects SET name='viewer-denied' WHERE id='${pid(1,1)}' RETURNING id`).stdout,'');
    assert.equal(scalar(`SELECT name FROM projects WHERE id='${pid(1,1)}'`),'shared-editor-edit');
    assert.equal(asRole('authenticated',b,`UPDATE project_status SET metadata='{"foreign":true}' WHERE project_id='${pid(1,1)}' RETURNING project_id`).stdout,'');
  });
  await check('project creation trigger and direct service status maintenance still work', () => {
    asRole('authenticated',a,`INSERT INTO projects(id,user_id,name) VALUES('${uuid(901)}','${a}','created-by-owner')`);
    assert.equal(scalar(`SELECT is_active FROM project_status WHERE project_id='${uuid(901)}'`),'t');
    asRole('service_role',null,`UPDATE project_status SET is_active=false,last_active_swap=now() WHERE project_id='${uuid(901)}'`);
    assert.equal(scalar(`SELECT NOT is_active AND last_active_swap IS NOT NULL FROM project_status WHERE project_id='${uuid(901)}'`),'t');
  });
  await check('deleting swapped projects cannot erase the actor cooldown', () => {
    reset(); asRole('authenticated',b,swap(b,pid(2,1),pid(2,2)));
    asRole('authenticated',b,`DELETE FROM projects WHERE id IN ('${pid(2,1)}','${pid(2,2)}')`);
    sql(`UPDATE project_status SET is_active=true WHERE project_id='${pid(2,3)}'`);
    const before=allState(); assertError(asRole('authenticated',b,swap(b,pid(2,3),pid(2,4)),false),/once per month/); assert.deepEqual(allState(),before);
  });
  await check('reapplying migration preserves an existing successful guard and all current data', () => {
    const before=allState(); apply(); assert.deepEqual(allState(),before); assert.equal(policySnapshot(),baselinePolicies); assert.equal(triggerSnapshot(),baselineTriggers);
  });
  console.log(`Project status API PostgreSQL checks passed: ${assertions}`);
} finally {
  for (const child of children) child.kill('SIGKILL');
  if (started) {
    if (run('pg_ctl',['-D',data,'status'],false).status === 0) run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
    assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');
  }
  assert.ok(temp.startsWith('/tmp/survey-project-status-api-') && data === join(temp,'data'));
  rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
