import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const RUN = process.env.SURVEY_POSTGRES_INTEGRATION === '1';
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const lookupSql = migration('20260907213935_storage_lookup_and_function_hardening.sql');
const policySql = migration('20260907213936_rls_uid_initplans.sql');
const serviceSql = migration('20260907214518_service_only_maintenance_functions.sql');

test('database optimization preserves RLS access and write checks in real Postgres', {
  skip: !RUN && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local Postgres',
  timeout: 60_000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'survey-db-optimization-'));
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options }).trim();
  const sql = (query) => run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: query });
  let started = false;
  const owner = '10000000-0000-4000-8000-000000000001';
  const other = '20000000-0000-4000-8000-000000000002';
  const asUser = (id, query) => sql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub" = '${id}'; ${query}; ROLLBACK;`);
  try {
    run('initdb', ['-D', dir, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', ['-D', dir, '-l', join(dir, 'server.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start']);
    started = true;
    sql(`
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION public.archive_retention_interval() RETURNS interval LANGUAGE sql IMMUTABLE
        AS $$ SELECT interval '30 days' $$;
      CREATE TABLE documents(id int PRIMARY KEY, user_id uuid, file_path text, locked boolean DEFAULT false);
      INSERT INTO documents VALUES (1, '${owner}', 'owner.pdf', false), (2, '${other}', 'other.pdf', false), (3, '${owner}', 'locked.pdf', true);
      ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO authenticated;
      CREATE POLICY owner_read ON documents FOR SELECT USING (auth.uid() = user_id);
      CREATE POLICY owner_insert ON documents FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT locked);
      CREATE POLICY owner_update ON documents FOR UPDATE USING (auth.uid() = user_id AND NOT locked) WITH CHECK (auth.uid() = user_id AND NOT locked);
      CREATE POLICY owner_delete ON documents FOR DELETE USING (auth.uid() = user_id AND NOT locked);
      -- Existing initplans must stay unchanged on both first and repeated runs.
      CREATE TABLE storage.already_optimized(user_id uuid);
      ALTER TABLE storage.already_optimized ENABLE ROW LEVEL SECURITY;
      CREATE POLICY preoptimized ON storage.already_optimized USING ((select auth.uid()) = user_id);
    `);
    const catalog = () => sql("SELECT json_agg(row(schemaname,tablename,policyname,roles,cmd,permissive,qual,with_check) ORDER BY schemaname,tablename,policyname) FROM pg_policies");
    const access = () => ({
      ownerRead: asUser(owner, 'SELECT array_agg(id ORDER BY id) FROM documents'),
      otherRead: asUser(other, 'SELECT array_agg(id ORDER BY id) FROM documents'),
      guestRead: asUser('', 'SELECT count(*) FROM documents'),
      update: asUser(owner, "UPDATE documents SET file_path='changed.pdf' RETURNING id"),
      remove: asUser(owner, 'DELETE FROM documents RETURNING id'),
    });
    const baseline = access();
    const beforePolicies = JSON.parse(catalog());
    sql(lookupSql);
    sql(policySql);
    assert.deepEqual(access(), baseline);
    assert.equal(baseline.ownerRead, '{1,3}');
    assert.equal(baseline.otherRead, '{2}');
    assert.equal(baseline.guestRead, '0');
    assert.equal(baseline.update, '1');
    assert.equal(baseline.remove, '1');
    assert.throws(() => asUser(owner, `INSERT INTO documents VALUES (4, '${other}', 'bad.pdf', false)`), /row-level security/);
    assert.throws(() => asUser(owner, `UPDATE documents SET user_id='${other}' WHERE id=1`), /row-level security/);
    assert.equal(asUser(owner, `INSERT INTO documents VALUES (4, '${owner}', 'good.pdf', false) RETURNING id`), '4');
    const afterPolicies = JSON.parse(catalog());
    for (let i = 0; i < beforePolicies.length; i++) {
      for (const key of ['f1','f2','f3','f4','f5','f6']) assert.deepEqual(afterPolicies[i][key], beforePolicies[i][key]);
    }
    assert.deepEqual(afterPolicies.find(p => p.f3 === 'preoptimized'), beforePolicies.find(p => p.f3 === 'preoptimized'));
    const plan = asUser(owner, 'EXPLAIN (FORMAT JSON) SELECT id FROM documents');
    assert.match(plan, /InitPlan/);
    assert.deepEqual(JSON.parse(sql("SELECT to_json(proconfig) FROM pg_proc WHERE proname='archive_retention_interval'")), ['search_path=""']);
    assert.equal(sql("SELECT archive_retention_interval() = interval '30 days'"), 't');
    assert.equal(sql("SELECT count(*) FROM pg_indexes WHERE indexname='idx_documents_file_path'"), '1');
    const after = catalog();
    sql(lookupSql);
    sql(policySql);
    assert.equal(catalog(), after, 'migrations must be idempotent');
    sql(`
      CREATE TABLE internal_metrics (user_id uuid, metric text);
      CREATE FUNCTION record_usage_metric(uuid, varchar, bigint, jsonb DEFAULT '{}') RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
        INSERT INTO public.internal_metrics VALUES ($1,$2); RETURN $1; END $$;
      CREATE FUNCTION sweep_annotation_trash_events(integer DEFAULT 30) RETURNS integer
      LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 0 $$;
      GRANT EXECUTE ON FUNCTION record_usage_metric(uuid,varchar,bigint,jsonb) TO authenticated;
      GRANT EXECUTE ON FUNCTION sweep_annotation_trash_events(integer) TO authenticated;
      CREATE FUNCTION record_document_metric() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = '' AS $$ BEGIN
        PERFORM public.record_usage_metric(NEW.user_id, 'upload', 1, '{}'); RETURN NEW; END $$;
      CREATE TRIGGER record_metric AFTER INSERT ON documents FOR EACH ROW EXECUTE FUNCTION record_document_metric();
    `);
    sql(serviceSql);
    assert.throws(() => asUser(owner, 'SELECT sweep_annotation_trash_events(-1)'), /permission denied for function/);
    assert.throws(() => asUser(owner, `SELECT record_usage_metric('${other}','forged',1,'{}')`), /permission denied for function/);
    assert.equal(sql("SELECT has_function_privilege('service_role','sweep_annotation_trash_events(integer)','EXECUTE')"), 't');
    assert.equal(sql("SELECT has_function_privilege('anon','record_usage_metric(uuid,varchar,bigint,jsonb)','EXECUTE')"), 'f');
    assert.equal(asUser(owner, `INSERT INTO documents VALUES (4,'${owner}','trigger.pdf',false); RESET ROLE; SELECT count(*) FROM internal_metrics`), '1', 'definer trigger still records metrics');
    sql(serviceSql);
    sql("CREATE POLICY literal_probe ON storage.already_optimized USING (user_id::text = 'auth.uid()')");
    assert.throws(() => sql(policySql), /Unexpected auth.uid\(\) literal/);
  } finally {
    if (started) run('pg_ctl', ['-D', dir, '-m', 'immediate', '-w', 'stop']);
    // Only this test's exact mkdtemp directory; never a shared database.
    rmSync(dir, { recursive: true, force: true });
  }
});
