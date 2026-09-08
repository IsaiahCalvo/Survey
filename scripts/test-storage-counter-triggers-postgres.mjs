// Disposable local PostgreSQL only. No Supabase URL, service key, or saved DB.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const migration = join(root, 'supabase/migrations/20260908170000_remove_duplicate_storage_counter_trigger.sql');
if (process.getuid?.() === 0) throw new Error('Run this disposable PostgreSQL harness as a non-root user.');
if (!existsSync(migration)) throw new Error(`Required local migration is missing: ${migration}`);
// libpq must not inherit a remote connection, service file, options, or password.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
for (const command of ['initdb', 'pg_ctl', 'psql']) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Installed ${command} is required; nothing was installed and no database was contacted.`);
}
const temp = mkdtempSync('/tmp/survey-storage-counter-');
const data = join(temp, 'data');
const socket = temp;
const port = '6543'; // Each cluster has its own socket directory; no TCP listener.
const psqlArgs = ['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'];
let started = false;
let assertions = 0;

function run(command, args, required = true) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  if (required && (result.error || result.status !== 0)) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return { status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}
const sql = (statement, required = true) => run('psql', [...psqlArgs, '-c', statement], required);
const actorContext = (actor, role = 'authenticated') => `SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${actor || ''}',false); SELECT set_config('request.jwt.claim.role','${role}',false);`;
const asActor = (actor, statement, required = true, role = 'authenticated') => sql(`${actorContext(actor, role)} ${statement}`, required);
const uuid = n => `20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

function check(label, action) { action(); assertions++; console.log(`PASS ${label}`); }
function expectSqlState(result, state) {
  assert.notEqual(result.status,0,`expected SQLSTATE ${state}, got success`);
  assert.match(result.stderr,new RegExp(`\\b${state}:`));
}
const owner=uuid(1),viewer=uuid(2),coOwner=uuid(3),stranger=uuid(4);
const insert = (id,bytes=10,actor=owner) => `INSERT INTO public.documents(id,user_id,name,file_size) VALUES('${uuid(id)}','${actor}','document-${id}',${bytes})`;
const counter = actor => Number(sql(`SELECT storage_used_bytes FROM public.user_subscriptions WHERE user_id='${actor}'`).stdout);
const writeCount = () => Number(sql('SELECT count(*) FROM public.test_subscription_writes').stdout);
const callbackCount = () => Number(sql(`SELECT coalesce((SELECT calls FROM pg_stat_user_functions WHERE funcid='public.update_user_storage()'::regprocedure),0)`).stdout);
const last = result => result.stdout.split('\n').at(-1);
const triggerSnapshot = () => sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY t.tgrelid,t.tgname),'[]'::jsonb)
  FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname <> 'trigger_update_storage_on_document_change'`).stdout;
const policySnapshot = () => sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb) FROM pg_policies p`).stdout;
const functionSnapshot = () => sql(`SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',p.proowner::regrole::text) ORDER BY p.oid)
  FROM pg_proc p WHERE p.oid IN('public.update_user_storage()'::regprocedure,'public.get_actual_storage_usage(uuid)'::regprocedure,'public.enforce_documents_storage_quota()'::regprocedure)`).stdout;
const subscriptionSnapshot = () => sql(`SELECT jsonb_agg(to_jsonb(s) ORDER BY user_id) FROM public.user_subscriptions s`).stdout;
const viewSnapshot = () => sql(`SELECT pg_get_viewdef('public.test_legacy_counter_view'::regclass,true)`).stdout;
const combinedTrigger = `CREATE TRIGGER trigger_update_storage_on_document_change AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage()`;
const applyMigration = (required=true) => run('psql',[...psqlArgs,'-f',migration],required);
try {
  run('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);
  started=true;
  run('pg_ctl',['-D',data,'-l',join(temp,'postgres.log'),'-o',`-c listen_addresses='' -c track_functions=all -k ${socket} -p ${port}`,'-w','start']);
  console.log(sql('SELECT version()').stdout);
  sql(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
    CREATE TABLE public.user_subscriptions(user_id uuid PRIMARY KEY REFERENCES auth.users(id),storage_used_bytes bigint);
    CREATE TABLE public.documents(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),name text,file_size bigint,annotations jsonb DEFAULT '{}');
    CREATE TABLE public.document_collaborators(document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id),role text,status text,PRIMARY KEY(document_id,user_id));
    CREATE TABLE public.test_subscription_writes(user_id uuid,old_bytes bigint,new_bytes bigint);
    CREATE FUNCTION public.test_count_subscription_writes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    BEGIN INSERT INTO public.test_subscription_writes VALUES(NEW.user_id,OLD.storage_used_bytes,NEW.storage_used_bytes); RETURN NEW; END $$;
    CREATE TRIGGER test_count_subscription_writes AFTER UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION public.test_count_subscription_writes();
    ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.user_subscriptions TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.documents TO authenticated,service_role;
    CREATE FUNCTION public.user_can_access_document(doc_id uuid,required_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.document_collaborators c WHERE c.document_id=doc_id AND c.user_id=auth.uid() AND c.status='active' AND (required_role='viewer' OR c.role='owner')) $$;
    CREATE POLICY own_subscription ON public.user_subscriptions FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
    CREATE POLICY document_select ON public.documents FOR SELECT USING(user_id=(SELECT auth.uid()) OR public.user_can_access_document(id,'viewer'));
    CREATE POLICY document_insert ON public.documents FOR INSERT WITH CHECK(user_id=(SELECT auth.uid()));
    CREATE POLICY document_update ON public.documents FOR UPDATE USING(user_id=(SELECT auth.uid()) OR public.user_can_access_document(id,'owner'));
    CREATE POLICY document_delete ON public.documents FOR DELETE USING(user_id=(SELECT auth.uid()) OR public.user_can_access_document(id,'owner'));
    CREATE VIEW public.test_legacy_counter_view AS SELECT user_id,storage_used_bytes FROM public.user_subscriptions;
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,PRIMARY KEY(bucket_id,name));
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    CREATE FUNCTION public.get_storage_limit(actor uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT 104857600::bigint $$;
    CREATE FUNCTION public.get_actual_storage_usage(p_user_id uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT coalesce(sum((o.metadata->>'size')::bigint),0) FROM storage.objects o
      WHERE o.bucket_id='documents' AND o.name LIKE coalesce(auth.uid(),p_user_id)::text || '/%' $$;
    INSERT INTO auth.users VALUES('${owner}'),('${viewer}'),('${coOwner}'),('${stranger}');
    INSERT INTO public.user_subscriptions VALUES('${owner}',1000),('${viewer}',12345),('${coOwner}',0),('${stranger}',NULL);
  `);
  const tracked=readFileSync(join(root,'supabase/migrations/20241226000001_add_storage_tracking_triggers.sql'),'utf8');
  const functionStart=tracked.indexOf('CREATE OR REPLACE FUNCTION update_user_storage()');
  const functionEnd=tracked.indexOf('$$ LANGUAGE plpgsql SECURITY DEFINER;',functionStart);
  assert.ok(functionStart>=0 && functionEnd>functionStart);
  const counterFunction=tracked.slice(functionStart,functionEnd+'$$ LANGUAGE plpgsql SECURITY DEFINER;'.length);
  sql(counterFunction);
  // Live catalog (2026-09-08) retains the tracked unqualified body and uses
  // search_path=public, not the earlier intermediate migration's empty path.
  sql(`ALTER FUNCTION public.update_user_storage() OWNER TO postgres;
    ALTER FUNCTION public.update_user_storage() SET search_path=public;
    REVOKE ALL ON FUNCTION public.update_user_storage() FROM PUBLIC,anon;
    GRANT EXECUTE ON FUNCTION public.update_user_storage() TO authenticated,service_role;
    ${combinedTrigger};
    CREATE TRIGGER update_storage_on_insert AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage();
    CREATE TRIGGER update_storage_on_delete AFTER DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage();`);
  const storageSource=readFileSync(join(root,'supabase/migrations/20260818010000_kal390_storage_quota_trigger.sql'),'utf8');
  const storageStart=storageSource.indexOf('CREATE OR REPLACE FUNCTION public.enforce_documents_storage_quota()');
  const storageEnd=storageSource.indexOf('EXECUTE FUNCTION public.enforce_documents_storage_quota();',storageStart);
  assert.ok(storageStart>=0 && storageEnd>storageStart);
  sql(storageSource.slice(storageStart,storageEnd+'EXECUTE FUNCTION public.enforce_documents_storage_quota();'.length));

  check('live tracked function hash and public search path match the guarded candidate',()=>{
    assert.equal(sql(`SELECT md5(prosrc)||':'||proconfig[1] FROM pg_proc WHERE oid='public.update_user_storage()'::regprocedure`).stdout,'62d343bc3f1ba4d97e3b675cc9145838:search_path=public');
  });
  check('baseline INSERT doubles legacy increment and writes subscription row twice',()=>{
    const writes=writeCount(),calls=callbackCount();asActor(owner,insert(100,10));
    assert.equal(counter(owner),1020);assert.equal(writeCount()-writes,2);assert.equal(callbackCount()-calls,2);
  });
  check('baseline metadata UPDATE invokes combined callback without changing legacy counter',()=>{
    const writes=writeCount(),calls=callbackCount();asActor(owner,`UPDATE public.documents SET name='renamed' WHERE id='${uuid(100)}'`);
    assert.equal(counter(owner),1020);assert.equal(writeCount(),writes);assert.equal(callbackCount()-calls,1);
  });
  check('baseline DELETE doubles legacy decrement and subscription row writes',()=>{
    const writes=writeCount(),calls=callbackCount();asActor(owner,`DELETE FROM public.documents WHERE id='${uuid(100)}'`);
    assert.equal(counter(owner),1000);assert.equal(writeCount()-writes,2);assert.equal(callbackCount()-calls,2);
  });
  const triggersBefore=triggerSnapshot(),policiesBefore=policySnapshot(),functionsBefore=functionSnapshot(),subscriptionsBefore=subscriptionSnapshot(),viewBefore=viewSnapshot();
  for(let pass=0;pass<2;pass++) applyMigration();
  check('migration twice removes only combined trigger; function ACL/config, views, policies, storage guard and legacy values stay unchanged',()=>{
    assert.equal(sql(`SELECT count(*) FROM pg_trigger WHERE tgrelid='public.documents'::regclass AND tgname='trigger_update_storage_on_document_change'`).stdout,'0');
    assert.equal(triggerSnapshot(),triggersBefore);assert.equal(policySnapshot(),policiesBefore);assert.equal(functionSnapshot(),functionsBefore);
    assert.equal(subscriptionSnapshot(),subscriptionsBefore);assert.equal(viewSnapshot(),viewBefore);
  });
  check('INSERT and DELETE each update the legacy counter once after migration',()=>{
    let writes=writeCount(),calls=callbackCount();asActor(owner,insert(101,25));
    assert.equal(counter(owner),1025);assert.equal(writeCount()-writes,1);assert.equal(callbackCount()-calls,1);
    writes=writeCount();calls=callbackCount();asActor(owner,`DELETE FROM public.documents WHERE id='${uuid(101)}'`);
    assert.equal(counter(owner),1000);assert.equal(writeCount()-writes,1);assert.equal(callbackCount()-calls,1);
  });
  check('metadata/annotation saves run no legacy callback and still preserve document values',()=>{
    asActor(owner,insert(102,20));const writes=writeCount(),calls=callbackCount();
    asActor(owner,`UPDATE public.documents SET name='saved',annotations='{"note":"retained"}' WHERE id='${uuid(102)}'`);
    assert.equal(sql(`SELECT name||':'||(annotations->>'note') FROM public.documents WHERE id='${uuid(102)}'`).stdout,'saved:retained');
    assert.equal(writeCount(),writes);assert.equal(callbackCount(),calls);assert.equal(counter(owner),1020);
  });
  check('explicit rollback and failed multi-row insert roll back documents and legacy writes atomically',()=>{
    const before=subscriptionSnapshot(),writes=writeCount();
    asActor(owner,`BEGIN; ${insert(103,50)}; DELETE FROM public.documents WHERE id='${uuid(102)}'; ROLLBACK`);
    assert.equal(subscriptionSnapshot(),before);assert.equal(writeCount(),writes);
    expectSqlState(asActor(owner,`INSERT INTO public.documents(id,user_id,name,file_size) VALUES('${uuid(104)}','${owner}','first',50),('${uuid(102)}','${owner}','duplicate',60)`,false),'23505');
    assert.equal(subscriptionSnapshot(),before);assert.equal(writeCount(),writes);
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE id IN('${uuid(103)}','${uuid(104)}')`).stdout,'0');
  });
  check('RLS keeps owner writes and shared co-owner saves while viewer and stranger cannot mutate',()=>{
    sql(`INSERT INTO public.document_collaborators VALUES('${uuid(102)}','${viewer}','viewer','active'),('${uuid(102)}','${coOwner}','owner','active')`);
    assert.equal(last(asActor(viewer,`SELECT count(*) FROM public.documents WHERE id='${uuid(102)}'`)),'1');
    assert.equal(last(asActor(stranger,`SELECT count(*) FROM public.documents WHERE id='${uuid(102)}'`)),'0');
    const before=subscriptionSnapshot(),writes=writeCount(),calls=callbackCount();
    for(const actor of [viewer,stranger]) asActor(actor,`UPDATE public.documents SET name='forbidden' WHERE id='${uuid(102)}'; DELETE FROM public.documents WHERE id='${uuid(102)}'`);
    assert.equal(sql(`SELECT name FROM public.documents WHERE id='${uuid(102)}'`).stdout,'saved');
    asActor(coOwner,`UPDATE public.documents SET name='co-owner save' WHERE id='${uuid(102)}'`);
    assert.equal(subscriptionSnapshot(),before);assert.equal(writeCount(),writes);assert.equal(callbackCount(),calls);
    expectSqlState(asActor(stranger,insert(105,99,owner),false),'42501');
    asActor(coOwner,`DELETE FROM public.documents WHERE id='${uuid(102)}'`);
    assert.equal(counter(owner),1000);assert.equal(counter(coOwner),0);assert.equal(writeCount()-writes,1);
  });
  check('null and zero file sizes preserve legacy COALESCE behavior; DELETE still clamps at zero',()=>{
    asActor(stranger,insert(106,'NULL',stranger));assert.equal(counter(stranger),0);
    asActor(stranger,insert(107,0,stranger));assert.equal(counter(stranger),0);
    asActor(coOwner,insert(108,10,coOwner));sql(`UPDATE public.user_subscriptions SET storage_used_bytes=3 WHERE user_id='${coOwner}'`);
    asActor(coOwner,`DELETE FROM public.documents WHERE id='${uuid(108)}'`);assert.equal(counter(coOwner),0);
  });
  check('actual storage usage and object byte guard remain independent of document counters',()=>{
    sql(`INSERT INTO storage.objects VALUES('documents','${owner}/fixture.pdf','{"size":123}')`);
    assert.equal(last(asActor(owner,`SELECT public.get_actual_storage_usage('${owner}')`)),'123');
    expectSqlState(sql(`UPDATE storage.objects SET metadata='{"size":104857601}' WHERE name='${owner}/fixture.pdf'`,false),'42501');
    assert.equal(counter(owner),1000);
  });

  // Drift cases alter this disposable fixture only, and restore it after each
  // rejected migration. The combined trigger must never disappear on failure.
  const dropCombined='DROP TRIGGER IF EXISTS trigger_update_storage_on_document_change ON public.documents';
  const insertTrigger='CREATE TRIGGER update_storage_on_insert AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage()';
  const deleteTrigger='CREATE TRIGGER update_storage_on_delete AFTER DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage()';
  sql('CREATE FUNCTION public.test_wrong_counter() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
  const drifts=[
    ['missing dedicated INSERT','DROP TRIGGER update_storage_on_insert ON public.documents',insertTrigger],
    ['missing dedicated DELETE','DROP TRIGGER update_storage_on_delete ON public.documents',deleteTrigger],
    ['disabled dedicated trigger','ALTER TABLE public.documents DISABLE TRIGGER update_storage_on_insert','ALTER TABLE public.documents ENABLE TRIGGER update_storage_on_insert'],
    ['wrong dedicated event','DROP TRIGGER update_storage_on_insert ON public.documents; CREATE TRIGGER update_storage_on_insert AFTER UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage()',`DROP TRIGGER update_storage_on_insert ON public.documents; ${insertTrigger}`],
    ['dedicated WHEN clause','DROP TRIGGER update_storage_on_insert ON public.documents; CREATE TRIGGER update_storage_on_insert AFTER INSERT ON public.documents FOR EACH ROW WHEN(NEW.file_size>0) EXECUTE FUNCTION public.update_user_storage()',`DROP TRIGGER update_storage_on_insert ON public.documents; ${insertTrigger}`],
    ['dedicated arguments',"DROP TRIGGER update_storage_on_insert ON public.documents; CREATE TRIGGER update_storage_on_insert AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage('unexpected')",`DROP TRIGGER update_storage_on_insert ON public.documents; ${insertTrigger}`],
    ['wrong dedicated function','DROP TRIGGER update_storage_on_insert ON public.documents; CREATE TRIGGER update_storage_on_insert AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.test_wrong_counter()',`DROP TRIGGER update_storage_on_insert ON public.documents; ${insertTrigger}`],
    ['dedicated statement trigger','DROP TRIGGER update_storage_on_insert ON public.documents; CREATE TRIGGER update_storage_on_insert AFTER INSERT ON public.documents FOR EACH STATEMENT EXECUTE FUNCTION public.update_user_storage()',`DROP TRIGGER update_storage_on_insert ON public.documents; ${insertTrigger}`],
    ['wrong combined event',`${dropCombined}; CREATE TRIGGER trigger_update_storage_on_document_change AFTER INSERT OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage()`,`${dropCombined}; ${combinedTrigger}`],
    ['disabled combined trigger','ALTER TABLE public.documents DISABLE TRIGGER trigger_update_storage_on_document_change','ALTER TABLE public.documents ENABLE TRIGGER trigger_update_storage_on_document_change'],
    ['combined WHEN clause',`${dropCombined}; CREATE TRIGGER trigger_update_storage_on_document_change AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW WHEN(true) EXECUTE FUNCTION public.update_user_storage()`,`${dropCombined}; ${combinedTrigger}`],
    ['combined arguments',`${dropCombined}; CREATE TRIGGER trigger_update_storage_on_document_change AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_user_storage('unexpected')`,`${dropCombined}; ${combinedTrigger}`],
    ['wrong combined function',`${dropCombined}; CREATE TRIGGER trigger_update_storage_on_document_change AFTER INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.test_wrong_counter()`,`${dropCombined}; ${combinedTrigger}`],
    ['function body drift',counterFunction.replace('BEGIN','BEGIN\n    -- Unknown new behavior must require review.'),`${counterFunction} ALTER FUNCTION public.update_user_storage() SET search_path=public`],
  ];
  for(const [label,change,restore] of drifts) {
    sql(combinedTrigger);sql(change);const before=subscriptionSnapshot();
    check(`preflight fails closed for ${label}`,()=>{
      const result=applyMigration(false);expectSqlState(result,'P0001');
      assert.equal(sql(`SELECT count(*) FROM pg_trigger WHERE tgrelid='public.documents'::regclass AND tgname='trigger_update_storage_on_document_change'`).stdout,'1');
      assert.equal(subscriptionSnapshot(),before);
    });
    sql(restore);sql(dropCombined);
  }
  check('reapply also validates kept triggers when combined trigger is already absent',()=>{
    sql('ALTER TABLE public.documents DISABLE TRIGGER update_storage_on_delete');
    expectSqlState(applyMigration(false),'P0001');
    sql('ALTER TABLE public.documents ENABLE TRIGGER update_storage_on_delete');applyMigration();
  });
  console.log(`Storage counter PostgreSQL checks passed: ${assertions}`);
} finally {
  if(started) {
    if(run('pg_ctl',['-D',data,'status'],false).status===0) run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
    assert.equal(run('pg_ctl',['-D',data,'status'],false).status,3,'owned local server stopped before cleanup');
  }
  assert.ok(temp.startsWith('/tmp/survey-storage-counter-') && data===join(temp,'data'));
  rmSync(temp,{recursive:true,force:true});
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
