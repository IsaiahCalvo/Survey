// Disposable local PostgreSQL only. No Supabase URL, service key, or saved DB.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const migration = join(root, 'supabase/migrations/20260908130000_project_quota_guard.sql');
if (process.getuid?.() === 0) throw new Error('Run this disposable PostgreSQL harness as a non-root user.');
if (!existsSync(migration)) throw new Error(`Required local migration is missing: ${migration}`);
// libpq must not inherit a remote connection, service file, options, or password.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
for (const command of ['initdb', 'pg_ctl', 'psql']) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Installed ${command} is required; nothing was installed and no database was contacted.`);
}
const temp = mkdtempSync('/tmp/survey-project-quota-');
const data = join(temp, 'data');
const socket = temp;
const port = '6543'; // Each cluster has its own socket directory; no TCP listener.
const psqlArgs = ['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'];
const children = new Set();
let started = false;
let assertions = 0;

function run(command, args, required = true) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  if (required && (result.error || result.status !== 0)) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return { status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}
const sql = (statement, required = true) => run('psql', [...psqlArgs, '-c', statement], required);
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorContext = (actor, role = 'authenticated') => `SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${actor || ''}',false); SELECT set_config('request.jwt.claim.role','${role}',false);`;
const asActor = (actor, statement, required = true, role = 'authenticated') => sql(`${actorContext(actor, role)} ${statement}`, required);
const insert = (actor, name = 'project', returning = false) => `INSERT INTO public.projects(user_id,name) VALUES('${actor}','${name}')${returning ? ' RETURNING id,name' : ''}`;
const count = actor => Number(sql(`SELECT count(*) FROM public.projects WHERE user_id='${actor}' AND archived=false`).stdout);
function check(label, action) { action(); assertions++; console.log(`PASS ${label}`); }
function expectSqlState(result, state) {
  assert.notEqual(result.status, 0, `expected SQLSTATE ${state}, got success: ${result.stdout}`);
  assert.match(result.stderr, new RegExp(`\\b${state}:`));
}
function createActor(n, tier = 'free', limit = tier === 'free' ? 1 : 999999) {
  const actor = uuid(n);
  sql(`INSERT INTO auth.users(id) VALUES('${actor}'); INSERT INTO public.test_actor_limits VALUES('${actor}','${tier}',${limit});`);
  return actor;
}
const policySnapshot = () => sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname),'[]'::jsonb) FROM
  (SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('projects','project_collaborators') AND cmd <> 'INSERT') p`).stdout;

function session(name, actor, isolation = 'READ COMMITTED', role = 'authenticated') {
  const child = spawn('psql', psqlArgs, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '', stderr = '', exited = false;
  const waiters = new Set();
  const flush = () => { for (const next of waiters) next(); };
  child.stdout.on('data', chunk => { stdout += chunk; flush(); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const complete = new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', status => { exited = true; children.delete(child); flush(); resolvePromise({ status, stdout, stderr }); });
  });
  function waitFor(marker) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { waiters.delete(changed); reject(new Error(`Session ${name} did not reach ${marker}: ${stderr}`)); }, 10_000);
      const changed = () => {
        if (!stdout.includes(marker) && !exited) return;
        clearTimeout(timer); waiters.delete(changed);
        if (stdout.includes(marker)) resolvePromise(); else reject(new Error(`Session ${name} exited before ${marker}: ${stderr}`));
      };
      waiters.add(changed); changed();
    });
  }
  const send = statement => child.stdin.write(`${statement}\n`);
  send(`${actorContext(actor, role)} SELECT set_config('application_name','${name}',false); BEGIN ISOLATION LEVEL ${isolation};`);
  return { name, send, waitFor, complete, end: () => child.stdin.end() };
}
async function waitUntilBlocked(name) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock'`).stdout === '1') return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 15));
  }
  throw new Error(`Session ${name} did not wait on the actor quota write.`);
}

try {
  run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8']);
  started = true;
  run('pg_ctl', ['-D', data, '-l', join(temp, 'postgres.log'), '-o', `-c listen_addresses='' -k ${socket} -p ${port}`, '-w', 'start']);
  console.log(sql('SELECT version()').stdout);
  sql(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE quota_direct_member LOGIN IN ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
    GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO authenticated,service_role,anon;
    CREATE TYPE public.subscription_tier AS ENUM ('free','pro','enterprise','developer');
    CREATE TABLE public.test_actor_limits(actor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,tier public.subscription_tier NOT NULL,project_limit integer NOT NULL);
    -- Controlled tier limits let a two-row Pro fixture exercise a finite cap
    -- without seeding 999999 rows. The migration must not alter this helper.
    CREATE FUNCTION public.get_project_limit(p_user_id uuid) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
      BEGIN RETURN coalesce((SELECT project_limit FROM public.test_actor_limits WHERE actor_id=p_user_id),1); END $$;
    CREATE FUNCTION public.get_user_tier(p_user_id uuid) RETURNS public.subscription_tier LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
      BEGIN RETURN coalesce((SELECT tier FROM public.test_actor_limits WHERE actor_id=p_user_id),'free'::public.subscription_tier); END $$;
    CREATE TABLE public.projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,name text NOT NULL,
      archived boolean DEFAULT false, user_archived_at timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.project_status(project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE public.project_collaborators(project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text NOT NULL,status text NOT NULL,
      PRIMARY KEY(project_id,user_id));
    CREATE FUNCTION public.user_can_access_project(proj_id uuid,required_role text DEFAULT 'viewer') RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
    DECLARE project_owner uuid; member_role text; project_archived_at timestamptz;
    BEGIN
      SELECT user_id,user_archived_at INTO project_owner,project_archived_at FROM public.projects WHERE id=proj_id;
      IF project_owner=auth.uid() THEN RETURN true; END IF;
      IF project_archived_at IS NOT NULL THEN RETURN false; END IF;
      SELECT role INTO member_role FROM public.project_collaborators WHERE project_id=proj_id AND user_id=auth.uid() AND status='active';
      IF member_role IS NULL THEN RETURN false; END IF;
      CASE required_role WHEN 'viewer' THEN RETURN true; WHEN 'editor' THEN RETURN member_role IN ('editor','owner'); WHEN 'owner' THEN RETURN member_role='owner'; ELSE RETURN false; END CASE;
    END $$;
    CREATE FUNCTION public.is_project_accessible(p_project_id uuid,p_user_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
      BEGIN RETURN EXISTS(SELECT 1 FROM public.projects p LEFT JOIN public.project_status s ON s.project_id=p.id WHERE p.id=p_project_id AND p.user_id=p_user_id AND coalesce(s.is_active,true)); END $$;
    ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.projects,public.project_collaborators TO authenticated,service_role;
    CREATE POLICY "Users can view own projects" ON public.projects FOR SELECT USING ((SELECT auth.uid())=user_id OR public.user_can_access_project(id,'viewer'));
    CREATE POLICY "Users can update own projects" ON public.projects FOR UPDATE USING (
      ((SELECT auth.uid())=user_id AND (public.get_user_tier((SELECT auth.uid()))=ANY(ARRAY['pro','enterprise','developer']::public.subscription_tier[]) OR public.is_project_accessible(id,(SELECT auth.uid()))))
      OR ((SELECT auth.uid())<>user_id AND public.user_can_access_project(id,'editor')));
    CREATE POLICY "Users can delete own projects" ON public.projects FOR DELETE USING ((SELECT auth.uid())=user_id OR public.user_can_access_project(id,'owner'));
    CREATE POLICY "Users can create projects within limit" ON public.projects FOR INSERT WITH CHECK (
      (SELECT auth.uid())=user_id AND (SELECT count(*) FROM public.projects WHERE user_id=(SELECT auth.uid()) AND archived=false)<public.get_project_limit((SELECT auth.uid())));
    CREATE POLICY "Users can view collaborators on accessible projects" ON public.project_collaborators FOR SELECT USING (public.user_can_access_project(project_id,'viewer'));
    CREATE POLICY "Project owners can add collaborators" ON public.project_collaborators FOR INSERT WITH CHECK (public.user_can_access_project(project_id,'owner'));
    CREATE POLICY "Project owners can update collaborators" ON public.project_collaborators FOR UPDATE USING (public.user_can_access_project(project_id,'owner'));
    CREATE POLICY "Project owners can remove collaborators" ON public.project_collaborators FOR DELETE USING (public.user_can_access_project(project_id,'owner'));
    CREATE TABLE public.test_project_metric_events(project_id uuid NOT NULL,user_id uuid NOT NULL,event text NOT NULL);
    CREATE FUNCTION public.test_add_project_owner() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
      INSERT INTO public.project_collaborators(project_id,user_id,role,status) VALUES(NEW.id,NEW.user_id,'owner','active') ON CONFLICT DO NOTHING;
      RETURN NEW; END $$;
    CREATE FUNCTION public.test_create_project_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      INSERT INTO public.project_status(project_id,is_active) VALUES(NEW.id,true); RETURN NEW; END $$;
    CREATE FUNCTION public.test_record_project_metric() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      INSERT INTO public.test_project_metric_events VALUES(NEW.id,NEW.user_id,'project_created'); RETURN NEW; END $$;
    CREATE TRIGGER test_add_project_owner AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.test_add_project_owner();
    CREATE TRIGGER test_create_project_status AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.test_create_project_status();
    CREATE TRIGGER test_record_project_metric AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.test_record_project_metric();
  `);
  const baseline = createActor(1);
  for (const returning of [false,true]) check(`pre-migration INSERT${returning ? ' RETURNING' : ''} reproduces 42P17`, () => {
    expectSqlState(asActor(baseline, insert(baseline, 'baseline', returning), false), '42P17');
  });
  const policiesBefore = policySnapshot();
  const limitBefore = sql(`SELECT pg_get_functiondef('public.get_project_limit(uuid)'::regprocedure)`).stdout;
  for (let pass = 0; pass < 2; pass++) run('psql', [...psqlArgs, '-f', migration]);
  check('migration is idempotent and leaves non-INSERT policies and tier helper unchanged', () => {
    assert.equal(policySnapshot(), policiesBefore);
    assert.equal(sql(`SELECT pg_get_functiondef('public.get_project_limit(uuid)'::regprocedure)`).stdout, limitBefore);
  });
  check('API roles cannot access private guards or invoke the trigger; only authenticated can call the self-scoped helper', () => {
    const privileges = sql(`SELECT concat_ws(',',
      has_function_privilege('authenticated','public.can_create_own_project()','EXECUTE'),
      has_function_privilege('anon','public.can_create_own_project()','EXECUTE'),
      has_function_privilege('service_role','public.can_create_own_project()','EXECUTE'),
      has_schema_privilege('authenticated','survey_private','USAGE'),
      has_table_privilege('authenticated','survey_private.project_quota_guards','SELECT'),
      has_table_privilege('service_role','survey_private.project_quota_guards','UPDATE'),
      has_function_privilege('authenticated','survey_private.enforce_project_quota()','EXECUTE'),
      has_function_privilege('anon','survey_private.enforce_project_quota()','EXECUTE'))`).stdout;
    assert.equal(privileges, 't,f,f,f,f,f,f,f');
    expectSqlState(asActor(null, 'SELECT public.can_create_own_project()', false, 'anon'), '42501');
    expectSqlState(asActor(baseline, 'SELECT * FROM survey_private.project_quota_guards', false), '42501');
    expectSqlState(asActor(baseline, `SELECT public.can_create_own_project('${uuid(999)}')`, false), '42883');
  });

  check('own first free INSERT RETURNING succeeds; the second is rejected with 42501', () => {
    assert.match(asActor(baseline, insert(baseline, 'first', true)).stdout, /first/);
    expectSqlState(asActor(baseline, insert(baseline, 'second', true), false), '42501');
    assert.equal(count(baseline), 1);
    assert.equal(sql(`SELECT count(*) FROM public.project_collaborators WHERE user_id='${baseline}' AND role='owner'`).stdout, '1');
    assert.equal(sql(`SELECT count(*) FROM public.project_status s JOIN public.projects p ON p.id=s.project_id WHERE p.user_id='${baseline}'`).stdout, '1');
    assert.equal(sql(`SELECT count(*) FROM public.test_project_metric_events WHERE user_id='${baseline}'`).stdout, '1');
  });
  const other = createActor(2);
  check('wrong actor and missing actor cannot insert owned rows', () => {
    const beforeGuards = sql('SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY user_id),\'[]\'::jsonb) FROM survey_private.project_quota_guards g').stdout;
    const fullTarget = asActor(other, insert(baseline), false);
    const emptyTarget = asActor(baseline, insert(other), false);
    expectSqlState(fullTarget, '42501'); expectSqlState(emptyTarget, '42501');
    assert.equal(fullTarget.stderr.split('\n')[0], emptyTarget.stderr.split('\n')[0], 'wrong-owner errors cannot disclose target capacity');
    expectSqlState(asActor(null, insert(other), false), '42501');
    assert.equal(count(other), 0);
    assert.equal(sql('SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY user_id),\'[]\'::jsonb) FROM survey_private.project_quota_guards g').stdout, beforeGuards);
  });
  check('a two-row free bulk insert fails atomically, never leaving its first row', () => {
    expectSqlState(asActor(other, `INSERT INTO public.projects(user_id,name) VALUES('${other}','bulk-a'),('${other}','bulk-b') RETURNING id`, false), '42501');
    assert.equal(count(other), 0);
    assert.equal(sql(`SELECT count(*) FROM public.project_collaborators WHERE user_id='${other}'`).stdout, '0');
    assert.equal(sql(`SELECT count(*) FROM public.test_project_metric_events WHERE user_id='${other}'`).stdout, '0');
    assert.equal(sql(`SELECT count(*) FROM public.project_status WHERE project_id NOT IN(SELECT id FROM public.projects)`).stdout, '0');
  });
  check('user archive does not release quota; system archive does; restoring at cap is denied', () => {
    asActor(baseline, `UPDATE public.projects SET user_archived_at=now() WHERE user_id='${baseline}'`);
    expectSqlState(asActor(baseline, insert(baseline), false), '42501');
    asActor(baseline, `UPDATE public.projects SET archived=true WHERE user_id='${baseline}'`);
    asActor(baseline, insert(baseline, 'replacement'));
    expectSqlState(asActor(baseline, `UPDATE public.projects SET archived=false WHERE user_id='${baseline}' AND archived=true`, false), '42501');
    assert.equal(count(baseline), 1);
    asActor(baseline, `DELETE FROM public.projects WHERE user_id='${baseline}' AND archived=false`);
    asActor(baseline, `UPDATE public.projects SET archived=false WHERE user_id='${baseline}' AND archived=true`);
    assert.equal(count(baseline), 1);
  });
  const pro = createActor(3, 'pro', 2);
  check('same-actor Pro bulk rows obey the supplied finite cap inside one statement', () => {
    expectSqlState(asActor(pro, `INSERT INTO public.projects(user_id,name) VALUES('${pro}','pro-a'),('${pro}','pro-b'),('${pro}','pro-c') RETURNING id`, false), '42501');
    assert.equal(count(pro), 0, 'the over-cap Pro bulk statement rolls back every row');
    asActor(pro, `INSERT INTO public.projects(user_id,name) VALUES('${pro}','pro-a'),('${pro}','pro-b') RETURNING id`);
    expectSqlState(asActor(pro, insert(pro, 'over cap'), false), '42501');
    assert.equal(count(pro), 2);
  });
  check('inactive free project owner cannot update, while the paid owner still can', () => {
    sql(`UPDATE public.project_status SET is_active=false WHERE project_id IN(SELECT id FROM public.projects WHERE user_id IN('${baseline}','${pro}'))`);
    const before = sql(`SELECT name FROM public.projects WHERE user_id='${baseline}'`).stdout;
    asActor(baseline, `UPDATE public.projects SET name='blocked inactive rename' WHERE user_id='${baseline}' RETURNING name`);
    assert.equal(sql(`SELECT name FROM public.projects WHERE user_id='${baseline}'`).stdout, before);
    assert.match(asActor(pro, `UPDATE public.projects SET name='paid inactive rename' WHERE user_id='${pro}' RETURNING name`).stdout, /paid inactive rename/);
  });
  const serviceActor = createActor(4);
  check('service and postgres bypass plan limits without skipping count-change serialization', () => {
    asActor(null, `INSERT INTO public.projects(user_id,name) VALUES('${serviceActor}','service-a'),('${serviceActor}','service-b')`, true, 'service_role');
    sql(insert(serviceActor, 'admin-c'));
    assert.equal(count(serviceActor), 3);
    expectSqlState(asActor(serviceActor, insert(serviceActor), false), '42501');
  });
  const directActor = createActor(5);
  check('direct non-bypass login with role none is quota-limited; forged JWT roles do not bypass the SQL role', () => {
    const direct = statement => run('psql', [...psqlArgs, '-U', 'quota_direct_member', '-c',
      `SELECT set_config('request.jwt.claim.sub','${directActor}',false); SELECT current_setting('role'); ${statement}`], false);
    const first = direct(insert(directActor, 'direct login', true));
    assert.equal(first.status, 0, first.stderr); assert.match(first.stdout, /none/);
    expectSqlState(direct(insert(directActor, 'over direct cap')), '42501');
    expectSqlState(asActor(directActor, `SELECT set_config('request.jwt.claim.role','service_role',false);
      SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); ${insert(directActor, 'forged role')}`, false), '42501');
  });

  // Collaboration guards stay observable, not merely text-identical.
  const owner = createActor(10, 'pro');
  const viewer = createActor(11), editor = createActor(12), coOwner = createActor(13), revoked = createActor(14), pending = createActor(15), stranger = createActor(16);
  const sharedId = uuid(1000);
  asActor(owner, `INSERT INTO public.projects(id,user_id,name) VALUES('${sharedId}','${owner}','shared')`);
  for (const [member,role,status] of [[viewer,'viewer','active'],[editor,'editor','active'],[coOwner,'owner','active'],[revoked,'editor','revoked'],[pending,'editor','pending']]) {
    asActor(owner, `INSERT INTO public.project_collaborators VALUES('${sharedId}','${member}','${role}','${status}')`);
  }
  check('active viewers see shared projects; revoked, pending, and unrelated actors do not', () => {
    assert.equal(asActor(viewer, `SELECT count(*) FROM public.projects WHERE id='${sharedId}'`).stdout.split('\n').at(-1), '1');
    for (const actor of [revoked,pending,stranger]) assert.equal(asActor(actor, `SELECT count(*) FROM public.projects WHERE id='${sharedId}'`).stdout.split('\n').at(-1), '0');
    asActor(viewer, insert(viewer, 'own despite share'));
    assert.equal(count(viewer), 1);
  });
  check('user-archived shared projects remain visible only to the permanent owner', () => {
    asActor(owner, `UPDATE public.projects SET user_archived_at=now() WHERE id='${sharedId}'`);
    for (const member of [viewer,editor,coOwner]) assert.equal(asActor(member, `SELECT count(*) FROM public.projects WHERE id='${sharedId}'`).stdout.split('\n').at(-1), '0');
    assert.equal(asActor(owner, `SELECT count(*) FROM public.projects WHERE id='${sharedId}'`).stdout.split('\n').at(-1), '1');
    asActor(owner, `UPDATE public.projects SET user_archived_at=null WHERE id='${sharedId}'`);
  });
  check('viewer cannot update/delete; editor can rename/archive; only co-owner can delete', () => {
    asActor(viewer, `UPDATE public.projects SET name='viewer-forbidden' WHERE id='${sharedId}'; DELETE FROM public.projects WHERE id='${sharedId}'`);
    assert.equal(sql(`SELECT name FROM public.projects WHERE id='${sharedId}'`).stdout, 'shared');
    asActor(editor, `UPDATE public.projects SET name='editor-ok',archived=true WHERE id='${sharedId}'`);
    assert.equal(sql(`SELECT name||':'||archived::text FROM public.projects WHERE id='${sharedId}'`).stdout, 'editor-ok:true');
    asActor(editor, `UPDATE public.projects SET archived=false WHERE id='${sharedId}'; DELETE FROM public.projects WHERE id='${sharedId}'`);
    assert.equal(sql(`SELECT count(*) FROM public.projects WHERE id='${sharedId}'`).stdout, '1');
    asActor(coOwner, `DELETE FROM public.projects WHERE id='${sharedId}'`);
    assert.equal(sql(`SELECT count(*) FROM public.projects WHERE id='${sharedId}'`).stdout, '0');
  });

  const nullActor = createActor(17), restoreActor = createActor(18);
  sql(`INSERT INTO public.projects(user_id,name,archived) VALUES('${nullActor}','null slot',NULL),('${nullActor}','active slot',false),
    ('${restoreActor}','restore-a',true),('${restoreActor}','restore-b',true)`);
  check('NULL archived to false allocates a slot, and bulk restore at cap rolls back every row', () => {
    expectSqlState(asActor(nullActor, `UPDATE public.projects SET archived=false WHERE user_id='${nullActor}' AND archived IS NULL`, false), '42501');
    assert.equal(sql(`SELECT count(*) FROM public.projects WHERE user_id='${nullActor}' AND archived IS NULL`).stdout, '1');
    expectSqlState(asActor(restoreActor, `UPDATE public.projects SET archived=false WHERE user_id='${restoreActor}' RETURNING id`, false), '42501');
    assert.equal(count(restoreActor), 0);
    assert.equal(sql(`SELECT count(*) FROM public.projects WHERE user_id='${restoreActor}' AND archived=true`).stdout, '2');
  });

  const transferOwner = createActor(30, 'pro'), transferEditor = createActor(31), fullDestination = createActor(32), emptyDestination = createActor(33);
  const transferId = uuid(1001);
  asActor(transferOwner, `INSERT INTO public.projects(id,user_id,name) VALUES('${transferId}','${transferOwner}','transfer fixture')`);
  asActor(fullDestination, insert(fullDestination, 'destination full'));
  asActor(transferOwner, `INSERT INTO public.project_collaborators VALUES('${transferId}','${transferEditor}','editor','active')`);
  check('authorized editor ownership transfer observes destination quota without changing its existing permission', () => {
    expectSqlState(asActor(transferEditor, `UPDATE public.projects SET user_id='${fullDestination}' WHERE id='${transferId}' RETURNING id`, false), '42501');
    assert.equal(sql(`SELECT user_id FROM public.projects WHERE id='${transferId}'`).stdout, transferOwner);
    asActor(transferEditor, `UPDATE public.projects SET user_id='${emptyDestination}' WHERE id='${transferId}' RETURNING id`);
    assert.equal(sql(`SELECT user_id FROM public.projects WHERE id='${transferId}'`).stdout, emptyDestination);
    assert.equal(count(transferOwner), 0); assert.equal(count(emptyDestination), 1);
  });

  // Concurrent statement tests use real independent libpq sessions, with a
  // marker after the first write and catalog-confirmed lock wait before commit.
  const rcActor = createActor(20);
  const first = session('quota-rc-first', rcActor), second = session('quota-rc-second', rcActor);
  first.send(`${insert(rcActor, 'rc-first')};\n\\echo RC_FIRST_WRITTEN`); await first.waitFor('RC_FIRST_WRITTEN');
  second.send(`${insert(rcActor, 'rc-second')}; COMMIT;`); second.end();
  await waitUntilBlocked(second.name);
  first.send('COMMIT;'); first.end();
  const [rcOne,rcTwo] = await Promise.all([first.complete,second.complete]);
  check('concurrent READ COMMITTED accepts one insert and denies one at the limit', () => {
    assert.equal(rcOne.status, 0); expectSqlState(rcTwo, '42501'); assert.equal(count(rcActor), 1);
  });

  const rollbackActor = createActor(21);
  const rollback = session('quota-rollback-first', rollbackActor), waiting = session('quota-rollback-second', rollbackActor);
  rollback.send(`${insert(rollbackActor, 'will-rollback')};\n\\echo ROLLBACK_WRITTEN`); await rollback.waitFor('ROLLBACK_WRITTEN');
  waiting.send(`${insert(rollbackActor, 'after-rollback')}; COMMIT;`); waiting.end(); await waitUntilBlocked(waiting.name);
  rollback.send('ROLLBACK;'); rollback.end();
  const [rolled,waited] = await Promise.all([rollback.complete,waiting.complete]);
  check('rolled-back guard writes do not consume quota for a waiting insert', () => {
    assert.equal(rolled.status, 0); assert.equal(waited.status, 0); assert.equal(count(rollbackActor), 1);
  });

  const rrActor = createActor(22);
  const rr = session('quota-rr-stale', rrActor, 'REPEATABLE READ');
  rr.send('SELECT count(*) FROM public.projects;\n\\echo RR_SNAPSHOT'); await rr.waitFor('RR_SNAPSHOT');
  const rrWriter = session('quota-rr-writer', rrActor);
  rrWriter.send(`${insert(rrActor, 'rr-winner')};\n\\echo RR_WRITTEN`); await rrWriter.waitFor('RR_WRITTEN');
  rr.send(`${insert(rrActor, 'rr-stale')}; COMMIT;`); rr.end(); await waitUntilBlocked(rr.name);
  rrWriter.send('COMMIT;'); rrWriter.end();
  const [rrResult,writerResult] = await Promise.all([rr.complete,rrWriter.complete]);
  check('REPEATABLE READ rejects stale quota snapshots with serialization failure', () => {
    assert.equal(writerResult.status, 0); expectSqlState(rrResult, '40001'); assert.equal(count(rrActor), 1);
  });

  const heldActor = createActor(23), independentActor = createActor(24);
  const held = session('quota-independent-holder', heldActor);
  held.send(`${insert(heldActor, 'held')};\n\\echo INDEPENDENT_HELD`); await held.waitFor('INDEPENDENT_HELD');
  const independent = asActor(independentActor, `SET lock_timeout='300ms'; ${insert(independentActor, 'independent')}`, false);
  held.send('ROLLBACK;'); held.end(); await held.complete;
  check('independent actors do not share a global quota lock', () => { assert.equal(independent.status, 0, independent.stderr); assert.equal(count(independentActor), 1); });

  const bypassActor = createActor(25);
  const serviceWriter = session('quota-service-holder', null, 'READ COMMITTED', 'service_role');
  serviceWriter.send(`${insert(bypassActor, 'service pending')};\n\\echo SERVICE_HELD`); await serviceWriter.waitFor('SERVICE_HELD');
  const authWaiter = session('quota-service-waiter', bypassActor);
  authWaiter.send(`${insert(bypassActor, 'auth competing')}; COMMIT;`); authWaiter.end(); await waitUntilBlocked(authWaiter.name);
  serviceWriter.send('COMMIT;'); serviceWriter.end();
  const [serviceResult,authResult] = await Promise.all([serviceWriter.complete,authWaiter.complete]);
  check('a privileged addition still locks the actor guard and cannot race an authenticated addition', () => {
    assert.equal(serviceResult.status, 0, serviceResult.stderr); expectSqlState(authResult, '42501'); assert.equal(count(bypassActor), 1);
  });

  const spoofHolder = session('quota-spoof-holder', null, 'READ COMMITTED', 'postgres');
  spoofHolder.send(`UPDATE survey_private.project_quota_guards SET revision=revision+1 WHERE user_id='${baseline}';\n\\echo SPOOF_GUARD_HELD`);
  await spoofHolder.waitFor('SPOOF_GUARD_HELD');
  const spoofWhileLocked = asActor(other, `SET lock_timeout='300ms'; ${insert(baseline, 'wrong-owner-locked')}`, false);
  spoofHolder.send('ROLLBACK;'); spoofHolder.end(); await spoofHolder.complete;
  check('spoofed ownership is rejected before waiting on the target actor quota lock', () => { expectSqlState(spoofWhileLocked, '42501'); });

  const restoreRaceActor = createActor(34);
  sql(`INSERT INTO public.projects(user_id,name,archived) VALUES('${restoreRaceActor}','pending restore',true)`);
  const restoring = session('quota-restore-holder', restoreRaceActor), insertWaiting = session('quota-restore-waiter', restoreRaceActor);
  restoring.send(`UPDATE public.projects SET archived=false WHERE user_id='${restoreRaceActor}';\n\\echo RESTORE_HELD`); await restoring.waitFor('RESTORE_HELD');
  insertWaiting.send(`${insert(restoreRaceActor, 'competing with restore')}; COMMIT;`); insertWaiting.end(); await waitUntilBlocked(insertWaiting.name);
  restoring.send('COMMIT;'); restoring.end();
  const [restoreResult,insertResult] = await Promise.all([restoring.complete,insertWaiting.complete]);
  check('restore and concurrent insert allocate from the same actor capacity', () => {
    assert.equal(restoreResult.status, 0, restoreResult.stderr); expectSqlState(insertResult, '42501'); assert.equal(count(restoreRaceActor), 1);
  });

  for (const [n,isolation,writerRole] of [[40,'SERIALIZABLE','authenticated'],[41,'REPEATABLE READ','service_role']]) {
    const actor = createActor(n);
    const stale = session(`quota-stale-${n}`, actor, isolation);
    stale.send(`SELECT count(*) FROM public.projects;\n\\echo SNAPSHOT_${n}`); await stale.waitFor(`SNAPSHOT_${n}`);
    const writer = session(`quota-writer-${n}`, writerRole === 'service_role' ? null : actor, 'READ COMMITTED', writerRole);
    writer.send(`${insert(actor, 'concurrent accepted')};\n\\echo WRITTEN_${n}`); await writer.waitFor(`WRITTEN_${n}`);
    stale.send(`${insert(actor, 'stale capacity')}; COMMIT;`); stale.end(); await waitUntilBlocked(stale.name);
    writer.send('COMMIT;'); writer.end();
    const [staleResult,acceptedResult] = await Promise.all([stale.complete,writer.complete]);
    check(`${isolation} stale writer conflicts with ${writerRole} guard mutation`, () => {
      assert.equal(acceptedResult.status, 0, acceptedResult.stderr); expectSqlState(staleResult, '40001'); assert.equal(count(actor), 1);
    });
  }

  const cascadeActor = createActor(26);
  asActor(cascadeActor, insert(cascadeActor, 'cascade fixture'));
  check('auth-user deletion cascades projects, memberships, statuses, and private guard without a quota failure', () => {
    sql(`DELETE FROM auth.users WHERE id='${cascadeActor}'`);
    assert.equal(count(cascadeActor), 0);
    assert.equal(sql(`SELECT count(*) FROM survey_private.project_quota_guards WHERE user_id='${cascadeActor}'`).stdout, '0');
    assert.equal(sql(`SELECT count(*) FROM public.project_collaborators WHERE user_id='${cascadeActor}'`).stdout, '0');
    assert.equal(sql('SELECT count(*) FROM public.project_status WHERE project_id NOT IN (SELECT id FROM public.projects)').stdout, '0');
  });

  const downgradeActor = createActor(27, 'pro', 2);
  asActor(downgradeActor, insert(downgradeActor, 'before downgrade'));
  const downgrade = session('quota-downgrade-gap', downgradeActor);
  downgrade.send(`${insert(downgradeActor, 'accepted before downgrade')};\n\\echo DOWNGRADE_ACCEPTED`); await downgrade.waitFor('DOWNGRADE_ACCEPTED');
  sql(`UPDATE public.test_actor_limits SET tier='free',project_limit=1 WHERE actor_id='${downgradeActor}'`);
  downgrade.send('COMMIT;'); downgrade.end();
  const downgradeResult = await downgrade.complete;
  check('known boundary: separate tier downgrade does not retroactively serialize an accepted insert', () => {
    assert.equal(downgradeResult.status, 0); assert.equal(count(downgradeActor), 2);
    assert.equal(sql(`SELECT public.get_project_limit('${downgradeActor}')`).stdout, '1');
    expectSqlState(asActor(downgradeActor, insert(downgradeActor, 'after downgrade'), false), '42501');
  });

  console.log(`Project quota PostgreSQL checks passed: ${assertions}`);
} finally {
  for (const child of children) child.kill('SIGTERM');
  if (started) {
    if (run('pg_ctl', ['-D', data, 'status'], false).status === 0) {
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    }
    assert.equal(run('pg_ctl', ['-D', data, 'status'], false).status, 3, 'owned local server stopped before cleanup');
  }
  // `temp` is the exact private mkdtemp result, never a caller-supplied path.
  assert.ok(temp.startsWith('/tmp/survey-project-quota-') && data === join(temp, 'data'));
  rmSync(temp, { recursive: true, force: true });
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
