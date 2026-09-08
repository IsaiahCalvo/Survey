// Installed, disposable local PostgreSQL only. No existing database or network.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const migration = join(root, 'supabase/migrations/20260908171000_archive_helpers_service_only.sql');
if (process.argv.length !== 2) throw new Error('This local fixture takes no arguments.');
if (process.getuid?.() === 0) throw new Error('Run this disposable PostgreSQL harness as a non-root user.');
if (!existsSync(migration)) throw new Error('The archive permissions migration is missing.');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
for (const command of ['initdb', 'pg_ctl', 'psql']) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Installed ${command} is required; nothing was installed and no database was contacted.`);
}
const temp = mkdtempSync('/tmp/survey-archive-helper-permissions-');
const data = join(temp, 'data');
const socket = temp;
const port = '6543'; // Private Unix socket only; no TCP listener.
const psqlArgs = ['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'];
let started = false;
let assertions = 0;
const run = (command, args, required = true) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  if (required && (result.error || result.status !== 0)) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return { status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
};
const sql = (statement, required = true) => run('psql', [...psqlArgs, '-c', statement], required);
const apply = (required = true) => run('psql', [...psqlArgs, '-f', migration], required);
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = uuid(1), actorB = uuid(2), keepB = uuid(206);
const signatures = ['public.handle_downgrade_to_free(uuid)', 'public.archive_excess_projects(uuid,integer)',
  'public.archive_excess_projects(uuid,uuid)', 'public.archive_excess_documents(uuid,integer)'];
const regprocedures = signatures.map(name => `'${name}'::regprocedure`).join(',');
const call = (index, actor) => [
  `SELECT public.handle_downgrade_to_free('${actor}'::uuid)`,
  `SELECT * FROM public.archive_excess_projects('${actor}'::uuid,2::integer)`,
  `SELECT public.archive_excess_projects('${actor}'::uuid,'${actor === actorB ? keepB : uuid(106)}'::uuid)`,
  `SELECT * FROM public.archive_excess_documents('${actor}'::uuid,3::integer)`,
][index];
const asRole = (role, actor, statement, required = true) => sql(`SET ROLE ${role};
  SELECT set_config('request.jwt.claim.sub','${actor}',false);
  SELECT set_config('request.jwt.claim.role','${role}',false); ${statement}`, required);
const check = (label, action) => { action(); assertions++; console.log(`PASS ${label}`); };
const reset = () => sql(`UPDATE public.projects SET archived=false; UPDATE public.documents SET archived=false;
  UPDATE public.project_status SET is_active=true,archived_at=null,archived_reason=null;`);
const scalar = statement => sql(statement).stdout;
const functionSnapshot = () => scalar(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
  'body',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'search_path',p.proconfig,'definer',p.prosecdef) ORDER BY p.oid)
  FROM pg_proc p WHERE p.oid IN (${regprocedures})`);
const aclSnapshot = () => scalar(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'acl',p.proacl) ORDER BY p.oid)
  FROM pg_proc p WHERE p.oid IN (${regprocedures})`);
const policySnapshot = () => scalar(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb) FROM pg_policies p`);
const tables = ['auth.users', 'public.projects', 'public.documents', 'public.project_status', 'public.project_collaborators', 'public.document_collaborators', 'storage.objects'];
const dataSnapshot = () => tables.map(table => scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`));
const unchangedFields = () => tables.map(table => {
  const omit = table === 'public.projects' || table === 'public.documents' ? "-'archived'"
    : table === 'public.project_status' ? "-'is_active'-'archived_at'-'archived_reason'" : '';
  return scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t)${omit} ORDER BY (to_jsonb(t)${omit})::text),'[]'::jsonb) FROM ${table} t`);
});
function sourceFunction(file, name) {
  const source = readFileSync(join(root, 'supabase/migrations', file), 'utf8');
  const expression = new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$ LANGUAGE plpgsql SECURITY DEFINER;`, 'i');
  const match = source.match(expression);
  assert.ok(match, `tracked ${name} definition is present in ${file}`);
  return match[0];
}
function expectDenied(result) {
  assert.notEqual(result.status, 0, 'client RPC must be denied');
  assert.match(result.stderr, /\b42501:/);
  assert.match(result.stderr, /permission denied for function/);
}
function assertArchiveResult(index) {
  const number = query => Number(scalar(query));
  if (index === 0 || index === 1) assert.equal(number(`SELECT count(*) FROM projects WHERE user_id='${actorB}' AND archived=false`), index === 0 ? 1 : 2);
  else assert.equal(number(`SELECT count(*) FROM projects WHERE archived`), 0);
  if (index === 0 || index === 3) assert.equal(number(`SELECT count(*) FROM documents WHERE user_id='${actorB}' AND archived=false`), index === 0 ? 5 : 3);
  else assert.equal(number(`SELECT count(*) FROM documents WHERE archived`), 0);
  assert.equal(number(`SELECT count(*) FROM projects WHERE user_id='${actorA}' AND archived`), 0);
  assert.equal(number(`SELECT count(*) FROM documents WHERE user_id='${actorA}' AND archived`), 0);
  if (index === 2) {
    assert.equal(number(`SELECT count(*) FROM project_status s JOIN projects p ON p.id=s.project_id WHERE p.user_id='${actorB}' AND NOT s.is_active`), 5);
    assert.equal(scalar(`SELECT is_active AND archived_at IS NULL AND archived_reason IS NULL FROM project_status WHERE project_id='${keepB}'`), 't');
    assert.equal(number(`SELECT count(*) FROM project_status s JOIN projects p ON p.id=s.project_id WHERE p.user_id='${actorB}' AND NOT s.is_active AND s.archived_reason='downgrade' AND s.archived_at IS NOT NULL`), 5);
  } else assert.equal(number('SELECT count(*) FROM project_status WHERE NOT is_active'), 0);
  assert.equal(number(`SELECT count(*) FROM project_status s JOIN projects p ON p.id=s.project_id WHERE p.user_id='${actorA}' AND NOT s.is_active`), 0);
  if (index === 0 || index === 1) assert.equal(scalar(`SELECT bool_and(archived) FROM projects WHERE id IN ('${uuid(201)}','${uuid(202)}','${uuid(203)}','${uuid(204)}')`), 't');
  if (index === 0 || index === 3) assert.equal(scalar(`SELECT bool_and(archived) FROM documents WHERE id IN ('${uuid(2001)}','${uuid(2002)}','${uuid(2003)}')`), 't');
}

try {
  run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8']);
  started = true;
  run('pg_ctl', ['-D', data, '-l', join(temp, 'postgres.log'), '-o', `-c listen_addresses='' -k ${socket} -p ${port}`, '-w', 'start']);
  console.log(scalar('SELECT version()'));
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE authenticated_member NOLOGIN IN ROLE authenticated; CREATE ROLE unrelated NOLOGIN;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role,authenticated_member,unrelated;
    CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),name text NOT NULL,updated_at timestamptz NOT NULL,archived boolean NOT NULL DEFAULT false,metadata jsonb);
    CREATE TABLE public.documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),project_id uuid REFERENCES public.projects(id),name text NOT NULL,updated_at timestamptz NOT NULL,archived boolean NOT NULL DEFAULT false,annotations jsonb,file_path text);
    CREATE TABLE public.project_status(project_id uuid PRIMARY KEY REFERENCES public.projects(id),is_active boolean,archived_at timestamptz,archived_reason varchar(100),last_active_swap timestamptz,metadata jsonb);
    CREATE TABLE public.project_collaborators(project_id uuid REFERENCES public.projects(id),user_id uuid REFERENCES auth.users(id),role text);
    CREATE TABLE public.document_collaborators(document_id uuid REFERENCES public.documents(id),user_id uuid REFERENCES auth.users(id),role text);
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb,PRIMARY KEY(bucket_id,name));
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY; ALTER TABLE documents ENABLE ROW LEVEL SECURITY; ALTER TABLE project_status ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_project_owner ON projects TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    CREATE POLICY fixture_document_owner ON documents TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    CREATE POLICY fixture_status_owner ON project_status TO authenticated USING(project_id IN (SELECT id FROM projects WHERE user_id=auth.uid()));
    GRANT SELECT ON projects,documents,project_status TO authenticated;
    INSERT INTO auth.users VALUES('${actorA}'),('${actorB}');
    INSERT INTO projects SELECT ('10000000-0000-4000-8000-'||lpad((a*100+g)::text,12,'0'))::uuid,
      ('10000000-0000-4000-8000-'||lpad(a::text,12,'0'))::uuid,'project-'||a||'-'||g,'2025-01-01'::timestamptz+g*interval '1 day',false,jsonb_build_object('keep','project-'||a||'-'||g)
      FROM generate_series(1,2) a CROSS JOIN generate_series(1,6) g;
    INSERT INTO documents SELECT ('10000000-0000-4000-8000-'||lpad((a*1000+g)::text,12,'0'))::uuid,
      ('10000000-0000-4000-8000-'||lpad(a::text,12,'0'))::uuid,('10000000-0000-4000-8000-'||lpad((a*100+1)::text,12,'0'))::uuid,
      'document-'||a||'-'||g,'2025-01-01'::timestamptz+g*interval '1 day',false,jsonb_build_object('keep','mark-'||a||'-'||g),'fixture/'||a||'/'||g||'.pdf'
      FROM generate_series(1,2) a CROSS JOIN generate_series(1,8) g;
    INSERT INTO project_status SELECT id,true,null,null,'2024-01-01',jsonb_build_object('keep',name) FROM projects;
    INSERT INTO project_collaborators VALUES('${uuid(201)}','${actorA}','viewer');
    INSERT INTO document_collaborators VALUES('${uuid(2001)}','${actorA}','editor');
    INSERT INTO storage.objects SELECT 'documents',file_path,jsonb_build_object('size',1234,'keep',name) FROM documents;
    ALTER TABLE projects ADD COLUMN user_archived_at timestamptz;
    ALTER TABLE documents ADD COLUMN user_archived_at timestamptz;
    UPDATE projects SET user_archived_at='2025-02-01' WHERE id IN ('${uuid(101)}','${uuid(201)}','${uuid(206)}');
    UPDATE documents SET user_archived_at='2025-02-02' WHERE id IN ('${uuid(1001)}','${uuid(2001)}','${uuid(2008)}');`);
  sql(sourceFunction('20241223000003_create_project_status.sql', 'archive_excess_projects'));
  for (const name of ['archive_excess_projects', 'archive_excess_documents', 'handle_downgrade_to_free']) {
    sql(sourceFunction('20241226000002_add_archived_columns.sql', name));
  }
  // Match the deployed helper config while retaining the tracked function bodies.
  // PUBLIC (the creation default) and anon are synthetic extra-grant cases;
  // the observed live baseline grants only postgres, authenticated and service_role.
  for (const signature of signatures) sql(`ALTER FUNCTION ${signature} SET search_path = public;
    GRANT EXECUTE ON FUNCTION ${signature} TO anon,authenticated,service_role`);
  const originalFields = unchangedFields();
  for (let index = 0; index < signatures.length; index++) check(`baseline authenticated actor can invoke ${signatures[index]} on another actor`, () => {
    reset(); asRole('authenticated', actorA, call(index, actorB)); assertArchiveResult(index);
    assert.deepEqual(unchangedFields(), originalFields, 'only documented archive fields change; rows, objects and unrelated state remain');
  });
  reset();
  check('preflight rejects a changed definer mode before any helper ACL changes', () => {
    sql(`ALTER FUNCTION ${signatures[3]} SECURITY INVOKER`); const before = aclSnapshot();
    const result = apply(false); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unexpected archive helper owner or execution mode/);
    assert.equal(aclSnapshot(), before); sql(`ALTER FUNCTION ${signatures[3]} SECURITY DEFINER`);
  });
  check('preflight rejects a changed owner before any helper ACL changes', () => {
    sql(`ALTER FUNCTION ${signatures[3]} OWNER TO service_role`); const before = aclSnapshot();
    const result = apply(false); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unexpected archive helper owner or execution mode/);
    assert.equal(aclSnapshot(), before); sql(`ALTER FUNCTION ${signatures[3]} OWNER TO postgres`);
  });
  const functionsBefore = functionSnapshot(), policiesBefore = policySnapshot(), rowsBefore = dataSnapshot();
  for (let pass = 0; pass < 2; pass++) check(`migration pass ${pass + 1} changes only target ACLs`, () => {
    apply(); assert.equal(functionSnapshot(), functionsBefore); assert.equal(policySnapshot(), policiesBefore); assert.deepEqual(dataSnapshot(), rowsBefore);
    for (const signature of signatures) {
      for (const role of ['anon','authenticated','authenticated_member','unrelated']) assert.equal(scalar(`SELECT has_function_privilege('${role}','${signature}','EXECUTE')`), 'f');
      for (const role of ['service_role','postgres']) assert.equal(scalar(`SELECT has_function_privilege('${role}','${signature}','EXECUTE')`), 't');
    }
    assert.equal(scalar(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid IN (${regprocedures}) AND a.grantee=0 AND a.privilege_type='EXECUTE'`), '0');
  });
  for (const role of ['authenticated', 'authenticated_member', 'anon', 'unrelated']) {
    for (const target of [actorA, actorB]) for (let index = 0; index < signatures.length; index++) {
      check(`${role} cannot call ${signatures[index]} for ${target === actorA ? 'own' : 'other'} account`, () => {
        expectDenied(asRole(role, actorA, call(index, target), false)); assert.deepEqual(dataSnapshot(), rowsBefore);
      });
    }
  }
  for (const role of ['service_role', 'postgres']) for (let index = 0; index < signatures.length; index++) {
    check(`${role} retains actual ${signatures[index]} archive behavior`, () => {
      reset(); const result = asRole(role, actorA, call(index, actorB)); assertArchiveResult(index);
      if (index === 0) {
        const value = JSON.parse(result.stdout.split('\n').at(-1));
        assert.equal(value.user_id, actorB); assert.equal(value.projects_archived_count, 5); assert.equal(value.documents_archived_count, 3);
      }
      assert.deepEqual(unchangedFields(), originalFields, 'objects, collaborators, metadata and all row identities survive');
      assert.equal(functionSnapshot(), functionsBefore); assert.equal(policySnapshot(), policiesBefore);
    });
  }
  console.log(`Archive helper permissions PostgreSQL checks passed: ${assertions}`);
} finally {
  if (started) {
    if (run('pg_ctl', ['-D', data, 'status'], false).status === 0) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    assert.equal(run('pg_ctl', ['-D', data, 'status'], false).status, 3, 'owned local server stopped before cleanup');
  }
  assert.ok(temp.startsWith('/tmp/survey-archive-helper-permissions-') && data === join(temp, 'data'));
  rmSync(temp, { recursive: true, force: true });
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
