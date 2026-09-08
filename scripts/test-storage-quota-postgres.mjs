// Installed PostgreSQL, disposable local data, Unix sockets only. No cloud API.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migration = join(root, 'supabase/migrations/20260908161000_storage_quota_guard.sql');
const baselineSource = readFileSync(join(root, 'supabase/migrations/20260818010000_kal390_storage_quota_trigger.sql'), 'utf8');
const baselineFunction = baselineSource.match(/CREATE OR REPLACE FUNCTION public\.enforce_documents_storage_quota\(\)[\s\S]*?\n\$\$;/)?.[0];
if (!baselineFunction || !existsSync(migration)) throw new Error('Required tracked quota SQL is missing');
if (process.getuid?.() === 0) throw new Error('Run the disposable fixture as a non-root user');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
Object.assign(env, { LANG: 'C', LC_ALL: 'C' });
for (const command of ['initdb', 'pg_ctl', 'psql']) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Installed ${command} is required; nothing was installed or contacted`);
}
const temp = mkdtempSync('/tmp/survey-storage-quota-');
const data = join(temp, 'data');
const socket = temp;
const port = '6543';
const psqlArgs = ['-X', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'];
const children = new Set();
let started = false, assertions = 0;
function run(command, args, required = true) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  if (required && (result.error || result.status !== 0)) throw new Error(result.error?.message || result.stderr || result.stdout);
  return { status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}
const sql = (statement, required = true) => run('psql', [...psqlArgs, '-c', statement], required);
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const path = (n, key) => `${uuid(n)}/${uuid(1000 + n)}/${key.padEnd(64, 'a')}.pdf`;
const insert = (n, key, size, upsert = false) => `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('documents','${path(n, key)}','{"size":${size}}')${upsert ? ' ON CONFLICT(bucket_id,name) DO UPDATE SET metadata=EXCLUDED.metadata' : ''};`;
const total = n => Number(sql(`SELECT coalesce(sum((metadata->>'size')::bigint),0) FROM storage.objects WHERE bucket_id='documents' AND name LIKE '${uuid(n)}/%'`).stdout);
const guardRevision = n => sql(`SELECT coalesce((SELECT revision FROM survey_private.storage_quota_guards WHERE owner_id='${uuid(n)}'),0)`).stdout;
const expectState = (r, state) => { assert.notEqual(r.status, 0, r.stdout); assert.match(r.stderr, new RegExp(`\\b${state}:`)); };
async function check(label, action) { await action(); assertions++; console.log(`PASS ${label}`); }
function session(name, isolation = 'READ COMMITTED') {
  const child = spawn('psql', psqlArgs, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '', stderr = '', exited = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') stderr += error.message; });
  const complete = new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', status => { exited = true; children.delete(child); resolvePromise({ status, stdout, stderr }); });
  });
  const send = statement => { if (!exited && !child.stdin.destroyed) child.stdin.write(`${statement}\n`); };
  async function waitFor(marker) {
    const deadline = Date.now() + 10_000;
    while (!stdout.includes(marker)) {
      if (exited || Date.now() > deadline) throw new Error(`${name} did not reach ${marker}: ${stderr}`);
      await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
    }
  }
  send(`SET application_name='${name}'; SET statement_timeout='15s'; BEGIN ISOLATION LEVEL ${isolation};`);
  return { name, send, waitFor, complete, end: () => child.stdin.end() };
}
async function finish(session, commit = true) {
  session.send(commit ? 'COMMIT;' : 'ROLLBACK;'); session.end(); return session.complete;
}
async function waitUntilBlocked(name) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock'`).stdout === '1') return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  }
  throw new Error(`${name} did not block`);
}
async function concurrentGrowth(n, isolation, expectedError, rollback = false) {
  const first = session(`storage-first-${n}`);
  const second = session(`storage-second-${n}`, isolation);
  second.send("SELECT count(*) FROM storage.objects; SELECT 'SNAPSHOT';"); await second.waitFor('SNAPSHOT');
  first.send(`${insert(n, 'a', 60)} SELECT 'WRITTEN';`); await first.waitFor('WRITTEN');
  second.send(insert(n, 'b', 60)); await waitUntilBlocked(second.name);
  assert.equal((await finish(first, !rollback)).status, 0);
  const result = await finish(second);
  if (expectedError) expectState(result, expectedError); else assert.equal(result.status, 0, result.stderr);
  assert.equal(total(n), rollback || expectedError ? 60 : 120);
}
async function deleteRecreate(n, guarded) {
  sql(insert(n, 'a', 60));
  const deleting = session(`storage-delete-${n}`), recreating = session(`storage-recreate-${n}`);
  deleting.send(`DELETE FROM storage.objects WHERE name='${path(n, 'a')}'; SELECT 'DELETED';`); await deleting.waitFor('DELETED');
  recreating.send(`${insert(n, 'a', 50)} SELECT 'RECREATED';`); await waitUntilBlocked(recreating.name);
  assert.equal((await finish(deleting)).status, 0); await recreating.waitFor('RECREATED');
  if (guarded) {
    const other = session(`storage-other-${n}`); other.send(insert(n, 'b', 90)); await waitUntilBlocked(other.name);
    assert.equal((await finish(recreating)).status, 0); expectState(await finish(other), '42501'); assert.equal(total(n), 50);
  } else {
    sql(insert(n, 'b', 90)); assert.equal((await finish(recreating)).status, 0); assert.equal(total(n), 140);
  }
}
const snapshot = () => sql(`SELECT jsonb_build_object(
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY policyname),'[]') FROM pg_policies p WHERE schemaname='storage'),
  'otherTriggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY tgname) FROM pg_trigger t WHERE tgrelid='storage.objects'::regclass AND NOT tgisinternal AND tgname<>'enforce_documents_storage_quota'),
  'limit',pg_get_functiondef('public.get_storage_limit(uuid)'::regprocedure),
  'quotaACL',(SELECT proacl::text FROM pg_proc WHERE oid='public.enforce_documents_storage_quota()'::regprocedure))`).stdout;

try {
  run('initdb', ['-D', data, '-A', 'trust', '-U', 'fixture_admin', '--no-locale', '-E', 'UTF8']);
  started = true;
  run('pg_ctl', ['-D', data, '-l', join(temp, 'postgres.log'), '-o', `-c listen_addresses='' -k ${socket} -p ${port}`, '-w', 'start']);
  run('psql', [...psqlArgs, '-U', 'fixture_admin', '-c', 'CREATE ROLE postgres LOGIN SUPERUSER; ALTER DATABASE postgres OWNER TO postgres;']);
  console.log(sql('SELECT version()').stdout);
  sql(`
    CREATE ROLE storage_owner NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE anon NOLOGIN;
    GRANT authenticated,service_role,anon TO postgres;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE _parts text[];
      BEGIN SELECT string_to_array(name,'/') INTO _parts;
        RETURN _parts[1:array_length(_parts,1)-1]; END $$;
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb,updated_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
    CREATE TABLE public.test_storage_limits(owner_id uuid PRIMARY KEY,bytes bigint NOT NULL);
    CREATE FUNCTION public.get_storage_limit(uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce((SELECT bytes FROM public.test_storage_limits WHERE owner_id=$1),100) $$;
    ${baselineFunction}
    CREATE TRIGGER enforce_documents_storage_quota BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_storage_quota();
    CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
    CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();
    -- No-op stand-in for the platform's unrelated statement DELETE protection.
    CREATE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY owner_access ON storage.objects TO authenticated USING (split_part(name,'/',1)=auth.uid()::text) WITH CHECK (split_part(name,'/',1)=auth.uid()::text);
    GRANT USAGE ON SCHEMA storage,auth TO authenticated,service_role,anon;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
  `);
  await check('baseline RC different-object growth rejects the second write', () => concurrentGrowth(1, 'READ COMMITTED', '42501'));
  await check('baseline REPEATABLE READ reproduces 120 bytes against 100-byte cap', () => concurrentGrowth(2, 'REPEATABLE READ', null));
  await check('baseline RC delete/recreate reproduces 140 bytes against 100-byte cap', () => deleteRecreate(3, false));
  // Retained malformed/legacy metadata proves the new contract fails closed
  // without denying same-prefix legacy non-growing saves.
  const legacyOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const legacyName = `${legacyOwner.toUpperCase()}/legacy.pdf`;
  sql(`INSERT INTO public.test_storage_limits VALUES('${legacyOwner}',1000);
    INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('documents','${legacyOwner}/canonical.pdf','{"size":90}'),('documents','${legacyName}','{"size":50}');
    UPDATE public.test_storage_limits SET bytes=100 WHERE owner_id='${legacyOwner}';
    ${insert(28, 'negative-old', -1)}`);

  // Hosted privilege analogue: postgres does not own storage.objects and is
  // not a superuser, but has the TRIGGER grant and RLS bypass needed to meter.
  sql(`ALTER TABLE storage.objects OWNER TO storage_owner;
    GRANT SELECT,INSERT,UPDATE,DELETE,TRIGGER ON storage.objects TO postgres;
    ALTER ROLE postgres NOSUPERUSER BYPASSRLS;`);
  const unchanged = snapshot();
  for (let pass = 0; pass < 2; pass++) run('psql', [...psqlArgs, '-f', migration]);
  await check('migration reapplies with TRIGGER privilege, without table ownership or superuser', () => {
    assert.equal(sql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user").stdout, 'f');
    assert.equal(sql("SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='storage.objects'::regclass").stdout, 'storage_owner');
    assert.equal(sql("SELECT tgtype FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname='enforce_documents_storage_quota'").stdout, '21');
    assert.equal(snapshot(), unchanged);
  });
  for (const [n, isolation, error] of [[10, 'READ COMMITTED', '42501'], [11, 'REPEATABLE READ', '40001'], [12, 'SERIALIZABLE', '40001']]) {
    await check(`${isolation} growing writes remain within quota`, () => concurrentGrowth(n, isolation, error));
  }
  await check('waiting writer proceeds after the first allocation rolls back', () => concurrentGrowth(13, 'READ COMMITTED', null, true));
  await check('AFTER insert closes the RC delete/recreate race', () => deleteRecreate(14, true));
  await check('same-size/shrinking upserts stay lock-free over quota, growth fails', () => {
    sql(`INSERT INTO public.test_storage_limits VALUES('${uuid(15)}',1000); ${insert(15, 'a', 120)} UPDATE public.test_storage_limits SET bytes=100 WHERE owner_id='${uuid(15)}';`);
    const revision = guardRevision(15);
    sql(insert(15, 'a', 120, true)); sql(insert(15, 'a', 110, true));
    assert.equal(total(15), 110); assert.equal(guardRevision(15), revision);
    expectState(sql(insert(15, 'a', 111, true), false), '42501'); assert.equal(total(15), 110);
    assert.equal(guardRevision(15), revision, 'failed growth must roll back its guard write');
  });
  await check('upsert meters the actual UPDATE once, not a hypothetical INSERT', () => {
    sql(insert(16, 'a', 60)); const before = Number(guardRevision(16));
    sql(insert(16, 'a', 90, true)); assert.equal(total(16), 90); assert.equal(Number(guardRevision(16)), before + 1);
    expectState(sql(insert(16, 'a', 101, true), false), '42501'); assert.equal(total(16), 90);
  });
  await check('zero bytes and missing-size probes do not lock; final actual bytes are metered', () => {
    sql(insert(15, 'zero', 0)); const revision = guardRevision(15);
    sql(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('documents','${path(15, 'probe')}','{"contentLength":1000000}')`);
    assert.equal(guardRevision(15), revision);
    expectState(sql(`UPDATE storage.objects SET metadata='{"size":1}' WHERE name='${path(15, 'probe')}'`, false), '42501');
    assert.equal(sql(`SELECT metadata ? 'size' FROM storage.objects WHERE name='${path(15, 'probe')}'`).stdout, 'f');
    sql(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('documents','${path(29, 'probe')}','{"contentLength":50}')`);
    assert.equal(guardRevision(29), '0');
    sql(`UPDATE storage.objects SET metadata='{"size":50}' WHERE name='${path(29, 'probe')}'`);
    assert.equal(total(29), 50); assert.equal(guardRevision(29), '1');
  });
  await check('negative actual bytes and negative-to-zero repairs fail without changing objects', () => {
    expectState(sql(insert(30, 'new-negative', -1), false), '42501'); assert.equal(total(30), 0);
    expectState(sql(`UPDATE storage.objects SET metadata='{"size":-1}' WHERE name='${path(29, 'probe')}'`, false), '42501'); assert.equal(total(29), 50);
    expectState(sql(`UPDATE storage.objects SET metadata='{"size":0}' WHERE name='${path(28, 'negative-old')}'`, false), '42501'); assert.equal(total(28), -1);
    expectState(sql(`UPDATE storage.objects SET metadata='{"size":"invalid"}' WHERE name='${path(29, 'probe')}'`, false), '22P02'); assert.equal(total(29), 50);
  });
  await check('new uppercase, braced, and hyphenless UUID owner aliases fail closed at every positive size', () => {
    const canonical = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    for (const prefix of [canonical.toUpperCase(), `{${canonical}}`, canonical.replaceAll('-', '')]) {
      for (const size of [1, 101]) expectState(sql(`SET ROLE service_role; INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('documents','${prefix}/${size}.pdf','{"size":${size}}')`, false), '42501');
    }
    assert.equal(sql(`SELECT count(*) FROM storage.objects WHERE name ILIKE '%bbbb%'`).stdout, '0');
  });
  await check('legacy same-prefix same/shrink saves survive, but alias renames cannot hide allocations', () => {
    sql(`UPDATE storage.objects SET metadata='{"size":50}' WHERE name='${legacyName}'`);
    sql(`UPDATE storage.objects SET metadata='{"size":45}' WHERE name='${legacyName}'`);
    assert.equal(sql(`SELECT metadata->>'size' FROM storage.objects WHERE name='${legacyName}'`).stdout, '45');
    expectState(sql(`UPDATE storage.objects SET metadata='{"size":46}' WHERE name='${legacyName}'`, false), '42501');
    expectState(sql(`UPDATE storage.objects SET name='${legacyOwner}/moved.pdf' WHERE name='${legacyName}'`, false), '42501');
    expectState(sql(`UPDATE storage.objects SET name='${legacyOwner.toUpperCase()}/moved-canonical.pdf' WHERE name='${legacyOwner}/canonical.pdf'`, false), '42501');
    assert.equal(sql(`SELECT count(*) FROM survey_private.storage_quota_guards WHERE owner_id='${legacyOwner}'`).stdout, '0');
  });
  await check('storage service and postgres with null JWT cannot bypass actual-byte quota', () => {
    sql(`SET ROLE service_role; SELECT set_config('request.jwt.claim.sub','',false); ${insert(17, 'a', 90)}`);
    expectState(sql(`SET ROLE service_role; ${insert(17, 'b', 11)}`, false), '42501');
    expectState(sql(insert(17, 'c', 11), false), '42501'); assert.equal(total(17), 90);
  });
  await check('authenticated storage write uses path ownership and the same byte guard', () => {
    sql(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uuid(18)}',false); ${insert(18, 'a', 90)}`);
    expectState(sql(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uuid(18)}',false); ${insert(18, 'b', 11)}`, false), '42501');
    expectState(sql(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uuid(19)}',false); ${insert(18, 'c', 1)}`, false), '42501');
  });
  await check('guard is private and accepts legacy UUID paths without an auth-user FK', () => {
    sql(insert(20, 'a', 1)); assert.equal(total(20), 1);
    assert.equal(sql("SELECT count(*) FROM pg_constraint WHERE conrelid='survey_private.storage_quota_guards'::regclass AND contype='f'").stdout, '0');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expectState(sql(`SET ROLE ${role}; SELECT * FROM survey_private.storage_quota_guards`, false), '42501');
      expectState(sql(`SET ROLE ${role}; INSERT INTO survey_private.storage_quota_guards VALUES('${uuid(99)}',1)`, false), '42501');
    }
  });
  await check('non-owner and root-level service objects keep their existing unmetered-path behavior', () => {
    sql(`SET ROLE service_role; INSERT INTO storage.objects(bucket_id,name,metadata)
      VALUES('documents','legacy-system/file.pdf','{"size":1000}'),
            ('documents','${uuid(34)}','{"size":1000}')`);
    assert.equal(sql(`SELECT count(*) FROM storage.objects WHERE name IN ('legacy-system/file.pdf','${uuid(34)}')`).stdout, '2');
    assert.equal(guardRevision(34), '0', 'a UUID filename without an owner folder is not a user allocation');
  });
  await check('same-owner rename is neutral; cross-owner and cross-bucket imports allocate full bytes', () => {
    const before = guardRevision(15);
    sql(`UPDATE storage.objects SET name='${path(15, 'renamed')}' WHERE name='${path(15, 'a')}'`);
    assert.equal(guardRevision(15), before); assert.equal(total(15), 110);
    expectState(sql(`UPDATE storage.objects SET name='${path(21, 'import')}' WHERE name='${path(15, 'renamed')}'`, false), '42501');
    sql(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('other','${path(22, 'import')}','{"size":101}')`);
    expectState(sql(`UPDATE storage.objects SET bucket_id='documents' WHERE name='${path(22, 'import')}'`, false), '42501');
    assert.equal(total(21), 0); assert.equal(total(22), 0);
    sql(insert(31, 'source', 40)); sql(insert(32, 'existing', 70));
    expectState(sql(`UPDATE storage.objects SET name='${path(32, 'moved')}' WHERE name='${path(31, 'source')}'`, false), '42501');
    sql(`UPDATE storage.objects SET name='${path(33, 'moved')}' WHERE name='${path(31, 'source')}'`);
    assert.equal(total(31), 0); assert.equal(total(33), 40);
  });
  await check('bulk insert over quota rolls back all objects and the guard', () => {
    expectState(sql(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('documents','${path(23, 'a')}','{"size":60}'),('documents','${path(23, 'b')}','{"size":60}')`, false), '42501');
    assert.equal(total(23), 0); assert.equal(guardRevision(23), '0');
  });
  await check('different owners do not wait on each other', async () => {
    const held = session('storage-unrelated-held'); held.send(`${insert(24, 'a', 60)} SELECT 'HELD';`); await held.waitFor('HELD');
    sql(`SET lock_timeout='500ms'; ${insert(25, 'a', 90)}`);
    assert.equal((await finish(held)).status, 0); assert.equal(total(25), 90);
  });
  await check('migration refuses an unexpected trigger event set without changing it', () => {
    sql('CREATE OR REPLACE TRIGGER enforce_documents_storage_quota AFTER INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_storage_quota()');
    const rejected = run('psql', [...psqlArgs, '-f', migration], false);
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /Unexpected storage quota trigger/);
    assert.equal(sql("SELECT tgtype FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname='enforce_documents_storage_quota'").stdout, '5');
  });
  console.log(`Storage quota PostgreSQL checks passed: ${assertions}`);
} finally {
  for (const child of children) { child.stdin.destroy(); child.kill('SIGTERM'); }
  if (started) {
    if (run('pg_ctl', ['-D', data, 'status'], false).status === 0) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    assert.equal(run('pg_ctl', ['-D', data, 'status'], false).status, 3);
  }
  assert.ok(temp.startsWith('/tmp/survey-storage-quota-') && data === join(temp, 'data'));
  rmSync(temp, { recursive: true, force: true });
  console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed.');
}
