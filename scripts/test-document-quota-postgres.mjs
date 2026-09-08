// Disposable local PostgreSQL only. No Supabase URL, service key, or saved DB.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const migration = join(root, 'supabase/migrations/20260908160000_document_quota_guard.sql');
const withStorageGuard = process.argv.includes('--with-storage-guard');
const storageGuardMigration = join(root, 'supabase/migrations/20260908161000_storage_quota_guard.sql');
if (process.argv.slice(2).some(arg => arg !== '--with-storage-guard')) throw new Error('Only --with-storage-guard is supported.');
if (process.getuid?.() === 0) throw new Error('Run this disposable PostgreSQL harness as a non-root user.');
if (!existsSync(migration)) throw new Error(`Required local migration is missing: ${migration}`);
if (withStorageGuard && !existsSync(storageGuardMigration)) throw new Error(`Required local storage migration is missing: ${storageGuardMigration}`);
// libpq must not inherit a remote connection, service file, options, or password.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
for (const command of ['initdb', 'pg_ctl', 'psql']) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Installed ${command} is required; nothing was installed and no database was contacted.`);
}
const temp = mkdtempSync('/tmp/survey-document-quota-');
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
const insert = (actor, name = 'document', returning = false) => `INSERT INTO public.documents(user_id,name) VALUES('${actor}','${name}')${returning ? ' RETURNING id,name' : ''}`;
const count = actor => Number(sql(`SELECT count(*) FROM public.documents WHERE user_id='${actor}' AND archived=false`).stdout);
function check(label, action) { action(); assertions++; console.log(`PASS ${label}`); }
function expectSqlState(result, state) {
  assert.notEqual(result.status, 0, `expected SQLSTATE ${state}, got success: ${result.stdout}`);
  assert.match(result.stderr, new RegExp(`\\b${state}:`));
}
function createActor(n, tier = 'free', limit = tier === 'free' ? 5 : 999999) {
  const actor = uuid(n);
  sql(`INSERT INTO auth.users(id) VALUES('${actor}'); INSERT INTO public.test_actor_limits VALUES('${actor}','${tier}',${limit},104857600);`);
  return actor;
}
const policySnapshot = () => sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname),'[]'::jsonb) FROM
  (SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
   WHERE NOT (schemaname='public' AND tablename='documents' AND cmd='INSERT')) p`).stdout;

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

const activeRows = (actor, amount, name = 'seed') => asActor(actor,
  `INSERT INTO public.documents(user_id,name) SELECT '${actor}','${name}-'||g FROM generate_series(1,${amount}) g`);
const last = result => result.stdout.split('\n').at(-1);
const guardSnapshot = () => sql("SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY user_id),'[]'::jsonb) FROM survey_private.document_quota_guards g").stdout;
const preservedFunctions = ['get_document_limit(uuid)','get_storage_limit(uuid)','get_actual_storage_usage(uuid)',
  'get_stored_object_size(text,text)','enforce_documents_storage_quota()','enforce_documents_file_path_immutable()','user_can_access_document(uuid,text)'];
const functionSnapshot = () => preservedFunctions.map(name => sql(`SELECT pg_get_functiondef('public.${name}'::regprocedure)`).stdout);
const triggerSnapshot = () => sql(`SELECT coalesce(jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname <> 'enforce_document_quota'`).stdout;
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
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
    GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO authenticated,service_role,anon;
    CREATE TABLE public.test_actor_limits(actor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,tier text NOT NULL,document_limit integer NOT NULL,storage_limit bigint NOT NULL);
    -- Finite paid limits are controlled fixture values; production helpers are
    -- not changed by the migration. Free keeps the actual five-document cap.
    CREATE FUNCTION public.get_document_limit(p_user_id uuid) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
      BEGIN RETURN coalesce((SELECT document_limit FROM public.test_actor_limits WHERE actor_id=p_user_id),5); END $$;
    CREATE FUNCTION public.get_storage_limit(p_user_id uuid) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
      BEGIN RETURN coalesce((SELECT storage_limit FROM public.test_actor_limits WHERE actor_id=p_user_id),104857600); END $$;
    CREATE TABLE public.projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE TABLE public.documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      project_id uuid REFERENCES public.projects(id),name text NOT NULL,file_path text,file_size bigint,annotations jsonb DEFAULT '{}',
      archived boolean DEFAULT false,user_archived_at timestamptz);
    CREATE TABLE public.document_collaborators(document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text,status text,PRIMARY KEY(document_id,user_id));
    CREATE TABLE public.project_collaborators(project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text,status text,PRIMARY KEY(project_id,user_id));
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,PRIMARY KEY(bucket_id,name));
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    CREATE FUNCTION public.get_actual_storage_usage(p_user_id uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT coalesce(sum((o.metadata->>'size')::bigint),0) FROM storage.objects o
      WHERE o.bucket_id='documents' AND o.name LIKE coalesce(auth.uid(),p_user_id)::text || '/%' $$;
    CREATE FUNCTION public.get_stored_object_size(p_bucket_id text,p_name text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT coalesce((SELECT (o.metadata->>'size')::bigint FROM storage.objects o WHERE o.bucket_id=p_bucket_id AND o.name=p_name
      AND (auth.uid() IS NULL OR o.name LIKE auth.uid()::text||'/%') LIMIT 1),0) $$;
    CREATE FUNCTION public.user_can_access_document(doc_id uuid,required_role text DEFAULT 'viewer') RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
    DECLARE doc_owner_id uuid; doc_project_id uuid; doc_archived_at timestamptz; user_role text;
    BEGIN
      SELECT user_id,project_id,user_archived_at INTO doc_owner_id,doc_project_id,doc_archived_at FROM public.documents WHERE id=doc_id;
      IF doc_owner_id IS NULL THEN RETURN FALSE; END IF;
      IF doc_archived_at IS NOT NULL THEN RETURN doc_owner_id=auth.uid(); END IF;
      IF doc_owner_id=auth.uid() THEN RETURN TRUE; END IF;
      SELECT role INTO user_role FROM public.document_collaborators WHERE document_id=doc_id AND user_id=auth.uid() AND status='active';
      IF user_role IS NULL AND doc_project_id IS NOT NULL THEN
        SELECT role INTO user_role FROM public.project_collaborators WHERE project_id=doc_project_id AND user_id=auth.uid() AND status='active';
        IF user_role IS NULL THEN
          SELECT 'owner' INTO user_role FROM public.projects WHERE id=doc_project_id AND user_id=auth.uid();
        END IF;
      END IF;
      IF user_role IS NULL THEN RETURN FALSE; END IF;
      RETURN CASE required_role WHEN 'viewer' THEN user_role IN ('viewer','editor','owner')
        WHEN 'editor' THEN user_role IN ('editor','owner') WHEN 'owner' THEN user_role='owner' ELSE FALSE END;
    END $$;
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.document_collaborators ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.documents,public.document_collaborators TO authenticated,service_role;
    CREATE POLICY "Users can view accessible documents" ON public.documents FOR SELECT USING ((SELECT auth.uid())=user_id OR public.user_can_access_document(id,'viewer'));
    CREATE POLICY "Users can update own documents" ON public.documents FOR UPDATE USING ((SELECT auth.uid())=user_id OR public.user_can_access_document(id,'owner'));
    CREATE POLICY "Users can delete own documents" ON public.documents FOR DELETE USING ((SELECT auth.uid())=user_id OR public.user_can_access_document(id,'owner'));
    CREATE POLICY "Users can upload documents within limits" ON public.documents FOR INSERT WITH CHECK (
      (SELECT auth.uid())=user_id AND (SELECT count(*) FROM public.documents WHERE user_id=(SELECT auth.uid()) AND archived=false)<public.get_document_limit((SELECT auth.uid()))
      AND public.get_actual_storage_usage((SELECT auth.uid()))<=public.get_storage_limit((SELECT auth.uid())));
    CREATE POLICY "Read document collaborators" ON public.document_collaborators FOR SELECT USING (public.user_can_access_document(document_id,'viewer'));
    CREATE POLICY "Add document collaborators" ON public.document_collaborators FOR INSERT WITH CHECK (public.user_can_access_document(document_id,'owner'));
    CREATE POLICY "Update document collaborators" ON public.document_collaborators FOR UPDATE USING (public.user_can_access_document(document_id,'owner'));
    CREATE POLICY "Delete document collaborators" ON public.document_collaborators FOR DELETE USING (public.user_can_access_document(document_id,'owner'));
    CREATE TABLE public.test_document_metric_events(document_id uuid,user_id uuid,event text);
    CREATE FUNCTION public.test_add_document_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      INSERT INTO public.document_collaborators VALUES(NEW.id,NEW.user_id,'owner','active') ON CONFLICT DO NOTHING;
      INSERT INTO public.test_document_metric_events VALUES(NEW.id,NEW.user_id,'document_created'); RETURN NEW; END $$;
    CREATE TRIGGER test_add_document_owner AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.test_add_document_owner();
  `);
  // Use the tracked authoritative storage trigger and path guard verbatim,
  // without applying their unrelated policy/legacy-meter migrations.
  const storageSource = readFileSync(join(root,'supabase/migrations/20260818010000_kal390_storage_quota_trigger.sql'),'utf8');
  const storageStart = storageSource.indexOf('CREATE OR REPLACE FUNCTION public.enforce_documents_storage_quota()');
  const storageEnd = storageSource.indexOf('EXECUTE FUNCTION public.enforce_documents_storage_quota();',storageStart);
  assert.ok(storageStart>=0 && storageEnd>storageStart, 'tracked storage trigger source must resolve exactly');
  sql(storageSource.slice(storageStart,storageEnd+'EXECUTE FUNCTION public.enforce_documents_storage_quota();'.length));
  run('psql',[...psqlArgs,'-f',join(root,'supabase/migrations/20260703020000_documents_file_path_immutable.sql')]);
  if (withStorageGuard) {
    run('psql', [...psqlArgs, '-f', storageGuardMigration]);
    console.log('Combined mode: storage guard migration applied before document preservation snapshots.');
  }
  const baseline = createActor(1);
  for (const returning of [false,true]) check(`pre-migration INSERT${returning?' RETURNING':''} reproduces 42P17`, () => {
    expectSqlState(asActor(baseline,insert(baseline,'baseline',returning),false),'42P17');
  });
  const policiesBefore=policySnapshot(), functionsBefore=functionSnapshot(), triggersBefore=triggerSnapshot();
  for (let pass = 0; pass < 2; pass++) run('psql',[...psqlArgs,'-f',migration]);
  check('migration twice preserves every other policy, storage function, access helper, and existing trigger',()=>{
    assert.equal(policySnapshot(), policiesBefore); assert.deepEqual(functionSnapshot(),functionsBefore); assert.equal(triggerSnapshot(),triggersBefore);
  });
  check('only authenticated has the no-argument count helper; API roles cannot access private guards',()=>{
    assert.equal(sql(`SELECT concat_ws(',',has_function_privilege('authenticated','public.can_upload_own_document()','EXECUTE'),has_function_privilege('anon','public.can_upload_own_document()','EXECUTE'),has_function_privilege('service_role','public.can_upload_own_document()','EXECUTE'),has_schema_privilege('authenticated','survey_private','USAGE'),has_table_privilege('authenticated','survey_private.document_quota_guards','SELECT'),has_table_privilege('service_role','survey_private.document_quota_guards','UPDATE'),has_function_privilege('authenticated','survey_private.enforce_document_quota()','EXECUTE'))`).stdout,'t,f,f,f,f,f,f');
    expectSqlState(asActor(null,'SELECT public.can_upload_own_document()',false,'anon'),'42501');
    assert.equal(last(asActor(null,'SELECT public.can_upload_own_document()')),'f');
    expectSqlState(asActor(baseline,'SELECT * FROM survey_private.document_quota_guards',false),'42501');
    expectSqlState(asActor(baseline,`SELECT public.can_upload_own_document('${uuid(999)}')`,false),'42883');
  });
  check('five free documents succeed including RETURNING; sixth is rejected',()=>{
    assert.match(asActor(baseline,insert(baseline,'first',true)).stdout,/first/);
    activeRows(baseline,4);
    expectSqlState(asActor(baseline,insert(baseline,'sixth',true),false),'42501'); assert.equal(count(baseline),5);
    assert.equal(sql(`SELECT count(*) FROM public.document_collaborators WHERE user_id='${baseline}'`).stdout,'5');
  });
  const other=createActor(2);
  check('wrong-owner full and empty targets disclose the same error and never mutate their guard',()=>{
    const before=guardSnapshot(),full=asActor(other,insert(baseline),false),empty=asActor(baseline,insert(other),false);
    expectSqlState(full,'42501');expectSqlState(empty,'42501');
    assert.equal(full.stderr.split('\n')[0],empty.stderr.split('\n')[0]);
    for(const archived of ['false','true','NULL']) expectSqlState(asActor(null,`INSERT INTO public.documents(user_id,name,archived) VALUES('${other}','missing actor',${archived})`,false),'42501');
    assert.equal(guardSnapshot(),before); assert.equal(count(other),0);
  });
  check('six-row bulk INSERT rolls back all rows, owner memberships, metrics and guard writes',()=>{
    const before=guardSnapshot();
    expectSqlState(asActor(other,`INSERT INTO public.documents(user_id,name) SELECT '${other}','bulk-'||g FROM generate_series(1,6) g RETURNING id`,false),'42501');
    assert.equal(count(other),0);assert.equal(guardSnapshot(),before);
    assert.equal(sql(`SELECT count(*) FROM public.document_collaborators WHERE user_id='${other}'`).stdout,'0');
    assert.equal(sql(`SELECT count(*) FROM public.test_document_metric_events WHERE user_id='${other}'`).stdout,'0');
  });
  check('user archive keeps five slots; system archive releases one; restore at cap fails; delete allows restore',()=>{
    asActor(baseline,`UPDATE public.documents SET user_archived_at=now() WHERE user_id='${baseline}'`);
    expectSqlState(asActor(baseline,insert(baseline),false),'42501');
    asActor(baseline,`UPDATE public.documents SET archived=true WHERE user_id='${baseline}' AND name='first'`);
    asActor(baseline,insert(baseline,'replacement'));
    expectSqlState(asActor(baseline,`UPDATE public.documents SET archived=false WHERE user_id='${baseline}' AND archived=true`,false),'42501');
    asActor(baseline,`DELETE FROM public.documents WHERE user_id='${baseline}' AND name='replacement'; UPDATE public.documents SET archived=false WHERE user_id='${baseline}' AND archived=true`);
    assert.equal(count(baseline),5);
  });
  const nullable=createActor(3),restoreBulk=createActor(4);
  activeRows(nullable,5);activeRows(restoreBulk,4);
  sql(`INSERT INTO public.documents(user_id,name,archived) VALUES('${nullable}','null',NULL),('${restoreBulk}','restore-a',true),('${restoreBulk}','restore-b',true)`);
  check('NULL to active and multi-row restore cannot exceed five and rollback atomically',()=>{
    expectSqlState(asActor(nullable,`UPDATE public.documents SET archived=false WHERE user_id='${nullable}' AND archived IS NULL`,false),'42501');
    expectSqlState(asActor(restoreBulk,`UPDATE public.documents SET archived=false WHERE user_id='${restoreBulk}' AND archived=true`,false),'42501');
    assert.equal(count(nullable),5);assert.equal(count(restoreBulk),4);
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE user_id='${restoreBulk}' AND archived=true`).stdout,'2');
  });
  const pro=createActor(5,'pro',7);
  check('paid bulk rows use the supplied finite plan limit without changing plan definitions',()=>{
    activeRows(pro,6);
    expectSqlState(asActor(pro,`INSERT INTO public.documents(user_id,name) VALUES('${pro}','seventh'),('${pro}','eighth')`,false),'42501');
    assert.equal(count(pro),6);asActor(pro,insert(pro,'seventh'));assert.equal(count(pro),7);
  });
  const storageActor=createActor(6);
  sql(`INSERT INTO storage.objects VALUES('documents','${storageActor}/bytes.pdf','{"size":104857600}');`);
  check('storage equal-limit remains allowed; above-limit rejects null/zero file_size while helper stays count-only',()=>{
    asActor(storageActor,`INSERT INTO public.documents(user_id,name,file_size) VALUES('${storageActor}','at byte boundary',999999999)`);
    sql(`UPDATE public.test_actor_limits SET storage_limit=104857599 WHERE actor_id='${storageActor}'`);
    assert.equal(last(asActor(storageActor,'SELECT public.can_upload_own_document()')),'t');
    for(const size of ['NULL','0']) expectSqlState(asActor(storageActor,`INSERT INTO public.documents(user_id,name,file_size) VALUES('${storageActor}','above bytes',${size})`,false),'42501');
    assert.equal(count(storageActor),1);
  });
  check('existing storage trigger rejects growing bytes even as postgres and permits same-size/shrinking saves',()=>{
    expectSqlState(sql(`UPDATE storage.objects SET metadata='{"size":104857601}' WHERE name='${storageActor}/bytes.pdf'`,false),'42501');
    sql(`UPDATE storage.objects SET metadata='{"size":104857600}' WHERE name='${storageActor}/bytes.pdf'; UPDATE storage.objects SET metadata='{"size":104857599}' WHERE name='${storageActor}/bytes.pdf'`);
    assert.equal(sql(`SELECT public.get_actual_storage_usage('${storageActor}')`).stdout,'104857599');
  });
  check('metadata and annotation saves at cap do not touch the count guard; immutable file paths stay protected',()=>{
    const before=guardSnapshot();
    asActor(baseline,`UPDATE public.documents SET name='saved',annotations='{"note":"retained"}' WHERE user_id='${baseline}'`);
    assert.equal(guardSnapshot(),before);
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE user_id='${baseline}' AND annotations->>'note'='retained'`).stdout,'5');
    expectSqlState(asActor(baseline,`UPDATE public.documents SET file_path='${other}/victim.pdf' WHERE user_id='${baseline}'`,false),'P0001');
    asActor(null,`UPDATE public.documents SET file_path='${baseline}/admin.pdf' WHERE user_id='${baseline}'`,true,'service_role');
  });
  const serviceActor=createActor(7),directActor=createActor(8);
  check('service and admin can exceed cap but each active allocation writes its guard',()=>{
    activeRows(serviceActor,5);
    asActor(null,insert(serviceActor,'service sixth'),true,'service_role');sql(insert(serviceActor,'admin seventh'));
    assert.equal(count(serviceActor),7);
    assert.equal(sql(`SELECT revision FROM survey_private.document_quota_guards WHERE user_id='${serviceActor}'`).stdout,'7');
    expectSqlState(asActor(serviceActor,insert(serviceActor),false),'42501');
  });
  check('direct login with role none remains capped and a forged JWT role does not bypass quota',()=>{
    const direct=statement=>run('psql',[...psqlArgs,'-U','quota_direct_member','-c',`SELECT set_config('request.jwt.claim.sub','${directActor}',false); SELECT current_setting('role'); ${statement}`],false);
    activeRows(directActor,4);const fifth=direct(insert(directActor,'direct fifth',true));assert.equal(fifth.status,0,fifth.stderr);assert.match(fifth.stdout,/none/);
    expectSqlState(direct(insert(directActor)),'42501');
    expectSqlState(asActor(directActor,`SELECT set_config('request.jwt.claim.role','service_role',false); SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); ${insert(directActor)}`,false),'42501');
  });

  const owner=createActor(10,'pro'),viewer=createActor(11),editor=createActor(12),coOwner=createActor(13),revoked=createActor(14),pending=createActor(15),stranger=createActor(16);
  const projectOwner=createActor(17),projectEditor=createActor(18),projectViewer=createActor(19),explicitViewer=createActor(30);
  const sharedId=uuid(1000),projectId=uuid(1001);
  sql(`INSERT INTO public.projects(id,user_id) VALUES('${projectId}','${projectOwner}');
    INSERT INTO public.project_collaborators VALUES('${projectId}','${projectEditor}','editor','active'),('${projectId}','${projectViewer}','viewer','active'),('${projectId}','${explicitViewer}','owner','active')`);
  asActor(owner,`INSERT INTO public.documents(id,user_id,project_id,name) VALUES('${sharedId}','${owner}','${projectId}','shared')`);
  for(const [actor,role,status] of [[viewer,'viewer','active'],[editor,'editor','active'],[coOwner,'owner','active'],[revoked,'owner','revoked'],[pending,'owner','pending'],[explicitViewer,'viewer','active']]) {
    asActor(owner,`INSERT INTO public.document_collaborators VALUES('${sharedId}','${actor}','${role}','${status}')`);
  }
  check('active direct and inherited members read shared documents; revoked/pending/unrelated actors do not',()=>{
    for(const actor of [owner,viewer,editor,coOwner,projectOwner,projectEditor,projectViewer,explicitViewer]) assert.equal(last(asActor(actor,`SELECT count(*) FROM public.documents WHERE id='${sharedId}'`)),'1');
    for(const actor of [revoked,pending,stranger]) assert.equal(last(asActor(actor,`SELECT count(*) FROM public.documents WHERE id='${sharedId}'`)),'0');
    activeRows(viewer,5);assert.equal(count(viewer),5,'shared document does not consume owned quota');
  });
  check('viewer/editor cannot metadata UPDATE or DELETE; explicit document viewer overrides inherited project owner',()=>{
    for(const actor of [viewer,editor,projectEditor,projectViewer,explicitViewer]) {
      asActor(actor,`UPDATE public.documents SET name='forbidden',archived=true WHERE id='${sharedId}'; DELETE FROM public.documents WHERE id='${sharedId}'`);
      assert.equal(sql(`SELECT name||':'||archived::text FROM public.documents WHERE id='${sharedId}'`).stdout,'shared:false');
    }
    asActor(projectOwner,`UPDATE public.documents SET name='project-owner-save' WHERE id='${sharedId}'`);
    asActor(coOwner,`UPDATE public.documents SET name='shared',annotations='{"shared":true}' WHERE id='${sharedId}'`);
    assert.equal(sql(`SELECT annotations->>'shared' FROM public.documents WHERE id='${sharedId}'`).stdout,'true');
  });
  check('user-archived document is visible only to permanent owner, even for direct and project co-owners',()=>{
    asActor(owner,`UPDATE public.documents SET user_archived_at=now() WHERE id='${sharedId}'`);
    for(const actor of [viewer,editor,coOwner,projectOwner,projectEditor]) assert.equal(last(asActor(actor,`SELECT count(*) FROM public.documents WHERE id='${sharedId}'`)),'0');
    assert.equal(last(asActor(owner,`SELECT count(*) FROM public.documents WHERE id='${sharedId}'`)),'1');
    asActor(owner,`UPDATE public.documents SET user_archived_at=null WHERE id='${sharedId}'`);
  });
  const fullDestination=createActor(31),emptyDestination=createActor(32);
  activeRows(fullDestination,5);
  check('authorized document co-owner transfer checks destination capacity and preserves existing ownership policy',()=>{
    expectSqlState(asActor(coOwner,`UPDATE public.documents SET user_id='${fullDestination}' WHERE id='${sharedId}' RETURNING id`,false),'42501');
    assert.equal(sql(`SELECT user_id FROM public.documents WHERE id='${sharedId}'`).stdout,owner);
    asActor(coOwner,`UPDATE public.documents SET user_id='${emptyDestination}' WHERE id='${sharedId}' RETURNING id`);
    assert.equal(count(emptyDestination),1);assert.equal(count(owner),0);
    asActor(coOwner,`DELETE FROM public.documents WHERE id='${sharedId}'`);
    assert.equal(count(emptyDestination),0,'co-owner DELETE remains allowed');
  });
  const restoreOwner=createActor(33),restoreCoOwner=createActor(34),restoreId=uuid(1002);
  activeRows(restoreOwner,5);
  sql(`INSERT INTO public.documents(id,user_id,name,archived) VALUES('${restoreId}','${restoreOwner}','co-owner restore',true);
    INSERT INTO public.document_collaborators VALUES('${restoreId}','${restoreCoOwner}','owner','active')`);
  check('co-owner restore at permanent owner cap is denied; releasing capacity allows the same restore',()=>{
    expectSqlState(asActor(restoreCoOwner,`UPDATE public.documents SET archived=false WHERE id='${restoreId}'`,false),'42501');
    asActor(restoreOwner,`DELETE FROM public.documents WHERE id=(SELECT id FROM public.documents WHERE user_id='${restoreOwner}' AND archived=false LIMIT 1)`);
    asActor(restoreCoOwner,`UPDATE public.documents SET archived=false WHERE id='${restoreId}'`);
    assert.equal(count(restoreOwner),5);assert.equal(count(restoreCoOwner),0);
  });

  // Independent libpq sessions establish snapshots, then wait on catalog-
  // confirmed row locks before the winner commits. No timing-only race proof.
  for(const [n,isolation,writerRole,rollback,restore] of [
    [40,'READ COMMITTED','authenticated',false,false],
    [41,'READ COMMITTED','authenticated',true,false],
    [42,'REPEATABLE READ','authenticated',false,false],
    [43,'SERIALIZABLE','authenticated',false,false],
    [44,'REPEATABLE READ','service_role',false,false],
    [45,'READ COMMITTED','service_role',false,false],
    [46,'READ COMMITTED','authenticated',false,true],
  ]) {
    const actor=createActor(n);activeRows(actor,4);
    if(restore) sql(`INSERT INTO public.documents(user_id,name,archived) VALUES('${actor}','restore pending',true)`);
    const waiting=session(`doc-waiter-${n}`,actor,isolation);
    if(isolation!=='READ COMMITTED') {waiting.send(`SELECT count(*) FROM public.documents;\n\\echo SNAPSHOT_${n}`);await waiting.waitFor(`SNAPSHOT_${n}`);}
    const writer=session(`doc-writer-${n}`,writerRole==='service_role'?null:actor,'READ COMMITTED',writerRole);
    writer.send(`${restore?`UPDATE public.documents SET archived=false WHERE user_id='${actor}' AND archived=true`:insert(actor,'fifth writer')};\n\\echo WRITTEN_${n}`);
    await writer.waitFor(`WRITTEN_${n}`);
    waiting.send(`${insert(actor,'waiting fifth')}; COMMIT;`);waiting.end();await waitUntilBlocked(waiting.name);
    writer.send(rollback?'ROLLBACK;':'COMMIT;');writer.end();
    const [writerResult,waitingResult]=await Promise.all([writer.complete,waiting.complete]);
    check(`${isolation}: ${writerRole} ${restore?'restore':'insert'} ${rollback?'rollback frees fifth slot':'serializes competing fifth allocation'}`,()=>{
      assert.equal(writerResult.status,0,writerResult.stderr);
      if(rollback) assert.equal(waitingResult.status,0,waitingResult.stderr);
      else expectSqlState(waitingResult,isolation==='READ COMMITTED'?'42501':'40001');
      assert.equal(count(actor),5);
    });
  }
  const heldActor=createActor(47),independentActor=createActor(48);
  const held=session('doc-independent-holder',heldActor);
  held.send(`${insert(heldActor,'held')};\n\\echo INDEPENDENT_HELD`);await held.waitFor('INDEPENDENT_HELD');
  const independent=asActor(independentActor,`SET lock_timeout='300ms'; ${insert(independentActor,'independent')}`,false);
  held.send('ROLLBACK;');held.end();await held.complete;
  check('independent actors do not share the quota row lock',()=>{assert.equal(independent.status,0,independent.stderr);assert.equal(count(independentActor),1);});
  const spoof=session('doc-spoof-holder',null,'READ COMMITTED','postgres');
  spoof.send(`UPDATE survey_private.document_quota_guards SET revision=revision+1 WHERE user_id='${baseline}';\n\\echo SPOOF_HELD`);await spoof.waitFor('SPOOF_HELD');
  const wrongLocked=asActor(other,`SET lock_timeout='300ms'; ${insert(baseline,'spoofed')}`,false);
  spoof.send('ROLLBACK;');spoof.end();await spoof.complete;
  check('wrong-owner INSERT fails before waiting on victim guard',()=>{expectSqlState(wrongLocked,'42501');});

  const cascadeActor=createActor(49);asActor(cascadeActor,insert(cascadeActor,'cascade'));
  check('auth-user deletion cascades documents, memberships and private guard without quota errors',()=>{
    sql(`DELETE FROM auth.users WHERE id='${cascadeActor}'`);assert.equal(count(cascadeActor),0);
    assert.equal(sql(`SELECT count(*) FROM survey_private.document_quota_guards WHERE user_id='${cascadeActor}'`).stdout,'0');
    assert.equal(sql(`SELECT count(*) FROM public.document_collaborators WHERE user_id='${cascadeActor}'`).stdout,'0');
  });
  console.log(`Document quota PostgreSQL checks passed: ${assertions}`);
} finally {
  for (const child of children) child.kill('SIGTERM');
  if (started) {
    if (run('pg_ctl', ['-D', data, 'status'], false).status === 0) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    assert.equal(run('pg_ctl', ['-D', data, 'status'], false).status, 3, 'owned local server stopped before cleanup');
  }
  assert.ok(temp.startsWith('/tmp/survey-document-quota-') && data === join(temp, 'data'));
  rmSync(temp, { recursive: true, force: true });
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
