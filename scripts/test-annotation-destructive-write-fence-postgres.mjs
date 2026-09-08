import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'Only a fresh disposable local database is supported');
const path = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(path(name), 'utf8');
const trackedFunction = (file, name) => {
  const text = source(file), start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start, `tracked ${name} exists`);
  return text.slice(start, end + 3);
};
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), outsider = id(4);
const migration = '20260909071000_annotation_destructive_write_fence.sql';
const append = (doc, client = 'writer', sequence = 1) => `SELECT * FROM public.append_annotation_update('${doc}','${client}',${sequence},decode('01','hex'));`;
const snapshot = (doc, at = 1, epoch = 1, base = 'NULL,NULL,0') => `SELECT public.store_annotation_snapshot('${doc}',${at},decode('01','hex'),1,'snapshot',${epoch},${base});`;

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration } = pg;
  let checks = 0;
  const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
  // Real tracked WAL tables, indexes, RLS, RPC and lock guards. Only ancillary
  // auth/documents/projects are a minimal local relational fixture. No provider
  // account or live Supabase service is involved.
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA survey_private;
    REVOKE ALL ON SCHEMA survey_private FROM PUBLIC;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid,user_archived_at timestamptz);
    CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),project_id uuid REFERENCES projects(id),
      user_archived_at timestamptz,locked_at timestamptz,locked_by uuid,locked_label text);
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    INSERT INTO auth.users VALUES('${owner}'),('${editor}'),('${viewer}'),('${outsider}');`);
  sql(trackedFunction('20260802000000_kal426_user_archive_foundation.sql', 'user_can_access_document'));
  sql(trackedFunction('20260522000000_kal49_document_lock_state.sql', 'kal49_document_is_locked'));
  applyMigration(path('20260606120000_rebuild_yjs_source_of_truth.sql'));
  applyMigration(path('20260701140000_lock_gate_annotation_updates.sql'));
  sql('GRANT ALL ON public.annotation_updates,public.annotation_snapshots TO anon,authenticated,service_role; GRANT SELECT ON public.documents,public.projects,public.document_collaborators,public.project_collaborators TO authenticated,service_role;');
  applyMigration(path('20260727131230_annotation_wal_concurrency.sql'));
  applyMigration(path('20260909040000_annotation_write_authorization.sql'));
  const seed = n => {
    const doc = id(n);
    sql(`INSERT INTO documents(id,user_id) VALUES('${doc}','${owner}');
      INSERT INTO document_collaborators VALUES('${doc}','${editor}','editor','active'),('${doc}','${viewer}','viewer','active');`);
    asRole(owner, append(doc)); asRole(owner, snapshot(doc)); return doc;
  };
  const count = (table, doc) => scalar(`SELECT count(*) FROM public.${table} WHERE document_id='${doc}'`);
  const deleteSource = (table, doc) => `DELETE FROM public.${table} WHERE document_id='${doc}'`;

  await check('BASELINE destructive source writes are unfenced while the actual WAL RPC owns the document lock', async () => {
    const doc = seed(100);
    const writer = session('baseline_wal', { role: 'authenticated', actorId: owner });
    writer.send(`${append(doc, 'other')} SELECT 'held';`); await writer.wait('held');
    sql(`UPDATE annotation_updates SET data=decode('02','hex') WHERE document_id='${doc}' AND seq=1;`);
    assert.equal(scalar(`SELECT encode(data,'hex') FROM annotation_updates WHERE document_id='${doc}' AND seq=1`), '02',
      'privileged UPDATE also bypasses the old insert-only source lock');
    asRole(null, `${deleteSource('annotation_snapshots', doc)};`, 'service_role');
    // WAL DELETE is owner-only already; use the actual database owner, not an
    // invented service-role grant, to reproduce internal cleanup's missing lock.
    sql(`${deleteSource('annotation_updates', doc)} AND seq=1;`);
    assert.equal(count('annotation_snapshots', doc), '0');
    assert.equal((await writer.finish()).status, 0);
    assert.equal(count('annotation_updates', doc), '1');
  });
  const policyState = () => scalar(`SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname)::text FROM pg_policies p WHERE schemaname='public'`);
  const rpcState = () => scalar(`SELECT string_agg(pg_get_functiondef(oid), E'\n' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('append_annotation_update','store_annotation_snapshot','kal49_lock_document')`);
  const beforePolicies = policyState(), beforeRpc = rpcState();
  applyMigration(path(migration)); applyMigration(path(migration));
  await check('migration replay preserves actual RPC definitions and policies; private functions and WAL revokes stay closed', () => {
    assert.equal(policyState(), beforePolicies); assert.equal(rpcState(), beforeRpc);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(scalar(`SELECT has_table_privilege('${role}','public.annotation_updates','${privilege}')`), 'f');
      assert.equal(scalar(`SELECT has_table_privilege('${role}','public.annotation_snapshots','TRUNCATE')`), 'f');
      for (const name of ['guard_annotation_source_delete', 'reject_annotation_source_truncate', 'reject_annotation_wal_update']) {
        assert.equal(scalar(`SELECT has_function_privilege('${role}','survey_private.${name}()','EXECUTE')`), 'f');
      }
    }
    assert.equal(scalar(`SELECT has_function_privilege('anon','public.append_annotation_update(uuid,text,bigint,bytea)','EXECUTE')`), 'f');
    assert.equal(scalar(`SELECT has_function_privilege('authenticated','public.append_annotation_update(uuid,text,bigint,bytea)','EXECUTE')`), 't');
  });
  await check('WAL UPDATE is rejected for privileged rows, regranted service role and a private definer', () => {
    const doc = seed(104), other = seed(105);
    const before = scalar(`SELECT to_jsonb(u)::text FROM annotation_updates u WHERE document_id='${doc}'`);
    for (const changes of ["data=decode('02','hex')", 'actor_user_id=NULL', "client_id='forged'", 'client_seq=99',
      'seq=99', `document_id='${other}'`, "created_at=now()+interval '1 day'", 'data=data']) {
      errorState(sql(`UPDATE annotation_updates SET ${changes} WHERE document_id='${doc}';`, false), '42501');
      assert.equal(scalar(`SELECT to_jsonb(u)::text FROM annotation_updates u WHERE document_id='${doc}'`), before);
    }
    sql('GRANT UPDATE ON annotation_updates TO service_role;');
    errorState(asRole(null, `UPDATE annotation_updates SET actor_user_id=NULL WHERE document_id='${doc}';`, 'service_role', false), '42501');
    sql('REVOKE UPDATE ON annotation_updates FROM service_role;');
    sql(`CREATE FUNCTION survey_private.fixture_update_wal(doc uuid) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
      UPDATE public.annotation_updates SET data=decode('02','hex') WHERE document_id=doc $$;
      REVOKE ALL ON FUNCTION survey_private.fixture_update_wal(uuid) FROM PUBLIC,anon,authenticated,service_role;`);
    errorState(sql(`SELECT survey_private.fixture_update_wal('${doc}');`, false), '42501');
    assert.equal(scalar(`SELECT to_jsonb(u)::text FROM annotation_updates u WHERE document_id='${doc}'`), before);
  });
  await check('TRUNCATE is rejected even for the owner, after regrant, and through parent CASCADE', () => {
    const doc = seed(101);
    for (const table of ['annotation_updates', 'annotation_snapshots']) {
      for (const role of ['anon', 'authenticated', 'service_role']) errorState(asRole(owner, `TRUNCATE ${table};`, role, false), '42501');
      errorState(sql(`TRUNCATE ${table};`, false), '42501');
      sql(`GRANT TRUNCATE ON ${table} TO service_role;`);
      errorState(asRole(null, `TRUNCATE ${table};`, 'service_role', false), '42501');
      sql(`REVOKE TRUNCATE ON ${table} FROM service_role;`);
    }
    errorState(sql('TRUNCATE documents CASCADE;', false), '42501');
    assert.equal(count('annotation_updates', doc), '1'); assert.equal(count('annotation_snapshots', doc), '1');
  });
  await check('actual viewer/outsider read and delete boundaries remain unchanged', () => {
    const doc = seed(102);
    for (const actor of [owner, editor, viewer, outsider, null]) {
      errorState(asRole(actor, `${deleteSource('annotation_updates', doc)};`, 'authenticated', false), '42501');
      asRole(actor, `${deleteSource('annotation_snapshots', doc)};`);
      assert.equal(count('annotation_snapshots', doc), '1', 'no authenticated snapshot DELETE policy');
    }
    assert.equal(asRole(outsider, `SELECT count(*) FROM annotation_snapshots WHERE document_id='${doc}'`).stdout, '0');
    asRole(null, `${deleteSource('annotation_snapshots', doc)};`, 'service_role');
    assert.equal(count('annotation_snapshots', doc), '0', 'existing service authority is preserved');
  });
  await check('both mutable DELETE lanes reject old repeatable-read and serializable snapshots', () => {
    const doc = seed(103);
    for (const table of ['annotation_updates', 'annotation_snapshots']) for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
      errorState(sql(`BEGIN ISOLATION LEVEL ${isolation}; ${deleteSource(table, doc)}; COMMIT;`, false), '25001');
      assert.equal(count(table, doc), '1');
    }
  });
  for (const [index, table] of ['annotation_updates', 'annotation_snapshots'].entries()) {
    await check(`${table}: WAL first rejects DELETE promptly and preserves all rows`, async () => {
      const doc = seed(110 + index);
      const writer = session(`wal_first_${index}`, { role: 'authenticated', actorId: owner });
      writer.send(`${append(doc, 'other')} SELECT 'held';`); await writer.wait('held');
      errorState(sql(`${deleteSource(table, doc)};`, false), '40001');
      assert.equal(count(table, doc), '1'); assert.equal((await writer.finish()).status, 0);
    });
    await check(`${table}: DELETE first holds append RPC until commit; independent document progresses`, async () => {
      const doc = seed(120 + index), other = seed(130 + index);
      const deleting = session(`delete_first_${index}`, { role: 'postgres' });
      deleting.send(`${deleteSource(table, doc)}; SELECT 'held';`); await deleting.wait('held');
      const writer = session(`append_wait_${index}`, { role: 'authenticated', actorId: owner });
      writer.send(`${append(doc, 'after_delete')} SELECT 'accepted';`); await pg.blocked(`append_wait_${index}`);
      asRole(owner, append(other, 'independent'));
      assert.equal((await deleting.finish()).status, 0);
      await writer.wait('accepted'); assert.equal((await writer.finish()).status, 0);
    });
  }
  await check('snapshot row/delete to advisory inversion fails without deadlocking the real snapshot RPC', async () => {
    const doc = seed(140);
    const row = session('snapshot_row', { role: 'postgres' });
    row.send(`SELECT document_id FROM annotation_snapshots WHERE document_id='${doc}' FOR UPDATE; SELECT 'held';`); await row.wait('held');
    const writer = session('snapshot_rpc', { role: 'authenticated', actorId: owner });
    writer.send(`${snapshot(doc, 1, 2, "1,'snapshot',1")} SELECT 'stored';`); await pg.blocked('snapshot_rpc');
    row.send(`${deleteSource('annotation_snapshots', doc)};`);
    errorState(await row.finish(), '40001');
    await writer.wait('stored'); assert.equal((await writer.finish()).status, 0);
    assert.equal(scalar(`SELECT writer_epoch FROM annotation_snapshots WHERE document_id='${doc}'`), '2');
  });
  await check('owner-run private pruning and actual append/store receipts still work', () => {
    // No tracked server prune RPC exists. This fixture-only private definer
    // proves existing internal owner deletion authority, not a new public API.
    sql(`CREATE FUNCTION survey_private.fixture_prune(doc uuid,before_seq bigint) RETURNS bigint
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
      WITH removed AS (DELETE FROM public.annotation_updates WHERE document_id=doc AND seq<before_seq RETURNING seq)
      SELECT count(*) FROM removed $$;
      REVOKE ALL ON FUNCTION survey_private.fixture_prune(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;`);
    const doc = seed(141);
    asRole(owner, `${append(doc, 'writer', 2)} ${append(doc, 'writer', 3)} ${snapshot(doc, 3, 2, "1,'snapshot',1")}`);
    assert.equal(scalar(`SELECT survey_private.fixture_prune('${doc}',3)`), '2');
    assert.equal(count('annotation_updates', doc), '1', 'head retained by bounded fixture prune');
    assert.equal(asRole(owner, append(doc, 'writer', 3)).stdout, '3', 'retained exact receipt is unchanged');
    assert.equal(asRole(owner, snapshot(doc, 3, 2, "1,'snapshot',1")).stdout, 't');
    assert.equal(asRole(owner, append(doc, 'writer', 4)).stdout, '4');
  });
  await check('bulk DELETE rollback and actual parent document FK cascades remain atomic', () => {
    const a = seed(150), b = seed(151);
    sql(`BEGIN; DELETE FROM annotation_snapshots WHERE document_id IN('${a}','${b}'); DELETE FROM annotation_updates WHERE document_id IN('${a}','${b}'); ROLLBACK;`);
    for (const doc of [a, b]) for (const table of ['annotation_updates', 'annotation_snapshots']) assert.equal(count(table, doc), '1');
    sql(`DELETE FROM documents WHERE id IN('${a}','${b}');`);
    for (const doc of [a, b]) for (const table of ['annotation_updates', 'annotation_snapshots']) assert.equal(count(table, doc), '0');
  });
  await check('document cascade contention aborts the entire parent deletion', async () => {
    const doc = seed(152);
    const capturing = session('capture_lock', { role: 'postgres' });
    capturing.send(`SELECT pg_advisory_xact_lock(hashtextextended('${doc}',0)); SELECT 'held';`); await capturing.wait('held');
    errorState(sql(`DELETE FROM documents WHERE id='${doc}';`, false), '40001');
    assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${doc}'`), '1');
    for (const table of ['annotation_updates', 'annotation_snapshots']) assert.equal(count(table, doc), '1');
    assert.equal((await capturing.finish()).status, 0);
    sql(`DELETE FROM documents WHERE id='${doc}';`);
  });
  await check('snapshot delete/reinsert can restore identical full state; this fence is not an incarnation counter', () => {
    const doc = seed(153);
    const before = scalar(`SELECT to_jsonb(s)::text FROM annotation_snapshots s WHERE document_id='${doc}'`);
    asRole(null, `${deleteSource('annotation_snapshots', doc)};`, 'service_role');
    asRole(owner, `INSERT INTO annotation_snapshots SELECT * FROM jsonb_populate_record(NULL::annotation_snapshots,${pg.quote(before)}::jsonb);`);
    assert.equal(scalar(`SELECT to_jsonb(s)::text FROM annotation_snapshots s WHERE document_id='${doc}'`), before);
  });
  console.log(JSON.stringify({ checks, postgres: pg.version, result: 'passed',
    scope: 'local destructive source lock; no capture/PDF generation/provider proof; prune is a labelled fixture definer' }));
}, { name: 'annotation-delete-fence' });
