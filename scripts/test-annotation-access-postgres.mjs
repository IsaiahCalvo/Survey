import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--baseline-only'),
  'Usage: node scripts/test-annotation-access-postgres.mjs [--baseline-only]');

const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const trackedFunction = (file, name) => {
  const text = readFileSync(migrationPath(file), 'utf8');
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start, `exact tracked function ${name} must exist`);
  return text.slice(start, end + 3);
};
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), outsider = id(4), project = id(10);
const accessSource = '20260802000000_kal426_user_archive_foundation.sql';
const lockSource = '20260522000000_kal49_document_lock_state.sql';
const walSource = '20260606120000_rebuild_yjs_source_of_truth.sql';
const concurrencySource = '20260727131230_annotation_wal_concurrency.sql';
const guardSource = '20260909040000_annotation_write_authorization.sql';
const append = (doc, client = 'writer', seq = 1) => `SELECT * FROM public.append_annotation_update('${doc}','${client}',${seq},decode('01','hex'));`;
const raw = doc => `INSERT INTO public.annotation_updates(document_id,client_id,client_seq,data) VALUES('${doc}','raw',1,decode('01','hex'));`;
const snapshot = doc => `SELECT public.store_annotation_snapshot('${doc}',0,decode('01','hex'),1,'snapshot',1,NULL,NULL,0);`;
const directSnapshot = doc => `INSERT INTO public.annotation_snapshots(document_id,at_seq,snapshot,writer_id,writer_epoch) VALUES('${doc}',0,decode('01','hex'),'direct',1);`;

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration } = pg;
  let checks = 0;
  const check = async (label, run) => { await run(); checks++; console.log(`PASS ${label}`); };
  // Deliberately minimal relational fixture, not the entire application schema.
  // Authorization and WAL behavior below use verbatim tracked functions, full
  // WAL DDL/RLS and the complete concurrency migration, never an access GUC.
  // Document UPDATE and membership owner-admin policies are synthetic fixture
  // controls, not a claim of full application administrator-policy coverage.
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
    CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),user_archived_at timestamptz);
    CREATE TABLE public.documents(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),
      project_id uuid REFERENCES public.projects(id),archived boolean DEFAULT false,user_archived_at timestamptz,
      locked_at timestamptz,locked_by uuid,locked_label text);
    CREATE TABLE public.document_collaborators(document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id),role text,status text,PRIMARY KEY(document_id,user_id));
    CREATE TABLE public.project_collaborators(project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id),role text,status text,PRIMARY KEY(project_id,user_id));
    INSERT INTO auth.users VALUES('${owner}'),('${editor}'),('${viewer}'),('${outsider}');
    INSERT INTO public.projects VALUES('${project}','${owner}',NULL);`);
  sql(trackedFunction(accessSource, 'user_can_access_document'));
  sql(trackedFunction(lockSource, 'kal49_document_is_locked'));
  sql(`ALTER FUNCTION public.kal49_document_is_locked(uuid) SET search_path='';
    REVOKE ALL ON FUNCTION public.user_can_access_document(uuid,text),public.kal49_document_is_locked(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.user_can_access_document(uuid,text),public.kal49_document_is_locked(uuid) TO anon,authenticated,service_role;
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY documents_read ON public.documents FOR SELECT USING(public.user_can_access_document(id,'viewer'));
    CREATE POLICY documents_update ON public.documents FOR UPDATE USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    ALTER TABLE public.document_collaborators ENABLE ROW LEVEL SECURITY;
    CREATE POLICY document_members_read ON public.document_collaborators FOR SELECT USING(public.user_can_access_document(document_id,'viewer'));
    CREATE POLICY document_members_update ON public.document_collaborators FOR UPDATE
      USING(EXISTS(SELECT 1 FROM public.documents d WHERE d.id=document_id AND d.user_id=auth.uid()));
    GRANT SELECT,UPDATE ON public.documents,public.document_collaborators TO authenticated;
    GRANT SELECT ON public.projects,public.project_collaborators TO authenticated;`);
  applyMigration(migrationPath(walSource));
  applyMigration(migrationPath('20260701140000_lock_gate_annotation_updates.sql'));
  sql('GRANT ALL ON public.annotation_updates,public.annotation_snapshots TO anon,authenticated,service_role;');
  applyMigration(migrationPath(concurrencySource));
  const seed = (n, role = 'editor') => {
    const doc = id(n);
    sql(`INSERT INTO public.documents(id,user_id,project_id) VALUES('${doc}','${owner}','${project}');
      INSERT INTO public.document_collaborators(document_id,user_id,role,status) VALUES('${doc}','${editor}','${role}','active'),('${doc}','${viewer}','viewer','active');`);
    return doc;
  };
  const revoke = doc => asRole(owner, `UPDATE public.document_collaborators SET role='viewer' WHERE document_id='${doc}' AND user_id='${editor}';`);

  await check('real role helper enforces explicit document role before inherited project editor', () => {
    const doc = seed(100, 'viewer');
    sql(`INSERT INTO public.project_collaborators VALUES('${project}','${editor}','editor','active');`);
    assert.equal(asRole(editor, `SELECT public.user_can_access_document('${doc}','editor')`).stdout, 'f');
    errorState(asRole(editor, append(doc), 'authenticated', false), '42501');
    sql(`DELETE FROM public.document_collaborators WHERE document_id='${doc}' AND user_id='${editor}';`);
    assert.equal(asRole(editor, `SELECT public.user_can_access_document('${doc}','editor')`).stdout, 't');
    asRole(editor, append(doc));
    sql('DELETE FROM public.project_collaborators;');
  });
  await check('viewer outsider null actor and locked document fail real write authorization', () => {
    const doc = seed(101);
    for (const actor of [viewer, outsider, null]) errorState(asRole(actor, append(doc), 'authenticated', false), '42501');
    asRole(owner, `SELECT public.kal49_lock_document('${doc}',NULL);`);
    errorState(asRole(editor, append(doc), 'authenticated', false), '42501');
  });
  for (const [index, [name, statement, table]] of [
    ['append RPC', append, 'annotation_updates'], ['raw WAL insert', raw, 'annotation_updates'],
    ['snapshot RPC', snapshot, 'annotation_snapshots'], ['direct snapshot insert', directSnapshot, 'annotation_snapshots'],
  ].entries()) {
    await check(`BASELINE ${name} accepts then commits after a concurrent role downgrade commits`, async () => {
      const doc = seed(110 + index);
      const writer = session(`baseline_${index}`, { actorId: editor, role: 'authenticated' });
      writer.send(`${statement(doc)} SELECT 'write_accepted';`); await writer.wait('write_accepted');
      revoke(doc);
      assert.equal(asRole(editor, `SELECT public.user_can_access_document('${doc}','editor')`).stdout, 'f');
      assert.equal(scalar(`SELECT count(*) FROM public.${table} WHERE document_id='${doc}'`), '0', 'write still uncommitted');
      const done = await writer.finish(); assert.equal(done.status, 0, done.stderr);
      assert.equal(scalar(`SELECT count(*) FROM public.${table} WHERE document_id='${doc}'`), '1');
    });
  }
  await check('BASELINE repeatable-read old permission snapshot appends after document locking commits', async () => {
    const doc = seed(120);
    const writer = session('baseline_rr', { actorId: editor, role: 'authenticated', isolation: 'REPEATABLE READ' });
    writer.send(`SELECT locked_at IS NULL FROM public.documents WHERE id='${doc}'; SELECT 'snapshot_ready';`);
    await writer.wait('snapshot_ready');
    asRole(owner, `SELECT public.kal49_lock_document('${doc}',NULL);`);
    writer.send(append(doc));
    const done = await writer.finish(); assert.equal(done.status, 0, done.stderr);
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${doc}'`), '1');
  });
  await check('an open writer transaction does not block another document', async () => {
    const first = seed(121), second = seed(122);
    const writer = session('independent', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(first)} SELECT 'holding';`); await writer.wait('holding');
    asRole(editor, `SET statement_timeout='1000ms'; ${append(second)}`);
    assert.equal((await writer.finish(false)).status, 0);
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${first}'`), '0');
  });
  console.log(`Annotation access baseline PostgreSQL checks passed: ${checks}`);
  if (args[0] === '--baseline-only') return;
  sql('CREATE SCHEMA survey_private; REVOKE ALL ON SCHEMA survey_private FROM PUBLIC;');
  const policiesBefore = scalar(`SELECT json_agg(row_to_json(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'`);
  const helperBefore = scalar(`SELECT pg_get_functiondef('public.user_can_access_document(uuid,text)'::regprocedure)`);
  const rpcDefinitions = () => scalar(`SELECT string_agg(pg_get_functiondef(oid), E'\n' ORDER BY proname) FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN('append_annotation_update','store_annotation_snapshot')`);
  const rpcBefore = rpcDefinitions();
  applyMigration(migrationPath(guardSource)); applyMigration(migrationPath(guardSource));
  await check('migration replay preserves role helper, existing policies and immutable RPC receipt definitions', () => {
    assert.equal(scalar(`SELECT json_agg(row_to_json(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'`), policiesBefore);
    assert.equal(scalar(`SELECT pg_get_functiondef('public.user_can_access_document(uuid,text)'::regprocedure)`), helperBefore);
    assert.equal(rpcDefinitions(), rpcBefore);
  });
  const routes = [
    ['append RPC', append], ['raw WAL insert', raw], ['snapshot RPC', snapshot], ['direct snapshot insert', directSnapshot],
  ];
  for (const [index, [name, statement]] of routes.entries()) {
    await check(`${name}: write first refuses revoke until commit; subsequent fresh writes are denied`, async () => {
      const doc = seed(200 + index);
      const writer = session(`guard_write_${index}`, { actorId: editor, role: 'authenticated' });
      writer.send(`${statement(doc)} SELECT 'accepted';`); await writer.wait('accepted');
      errorState(asRole(owner, `UPDATE public.document_collaborators SET role='viewer' WHERE document_id='${doc}' AND user_id='${editor}'`, 'authenticated', false), '55P03');
      assert.equal((await writer.finish()).status, 0);
      revoke(doc);
      errorState(asRole(editor, append(doc, 'fresh'), 'authenticated', false), '42501');
    });
    await check(`${name}: revoke first refuses waiting writer then denies after revoke commits`, async () => {
      const doc = seed(210 + index);
      const revoker = session(`guard_revoke_${index}`, { actorId: owner, role: 'authenticated' });
      revoker.send(`UPDATE public.document_collaborators SET role='viewer' WHERE document_id='${doc}' AND user_id='${editor}'; SELECT 'revoking';`);
      await revoker.wait('revoking');
      errorState(asRole(editor, statement(doc), 'authenticated', false), '55P03');
      assert.equal((await revoker.finish()).status, 0);
      errorState(asRole(editor, statement(doc), 'authenticated', false), '42501');
    });
  }
  await check('direct snapshot UPDATE holds authority and rejects changed document identity', async () => {
    const doc = seed(220); asRole(editor, snapshot(doc));
    const writer = session('direct_snapshot_update', { actorId: editor, role: 'authenticated' });
    writer.send(`UPDATE public.annotation_snapshots SET snapshot=decode('02','hex'),writer_epoch=2,base_at_seq=0,base_writer_id='snapshot',base_writer_epoch=1 WHERE document_id='${doc}'; SELECT 'updated';`);
    await writer.wait('updated');
    errorState(asRole(owner, `UPDATE public.document_collaborators SET status='revoked' WHERE document_id='${doc}' AND user_id='${editor}'`, 'authenticated', false), '55P03');
    assert.equal((await writer.finish()).status, 0);
    assert.equal(scalar(`SELECT writer_epoch FROM public.annotation_snapshots WHERE document_id='${doc}'`), '2');
    const other = seed(237);
    errorState(asRole(editor, `UPDATE public.annotation_snapshots SET document_id='${other}' WHERE document_id='${doc}'`, 'authenticated', false), '40001');
  });
  await check('exact accepted WAL replay still works after revocation without creating a row', () => {
    const doc = seed(221); assert.equal(asRole(editor, append(doc)).stdout, '1'); revoke(doc);
    assert.equal(asRole(editor, append(doc)).stdout, '1');
    errorState(asRole(outsider, append(doc), 'authenticated', false), '42501');
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${doc}'`), '1');
  });
  await check('absent direct role insertion cannot shadow inherited editor while a write is open', async () => {
    const doc = seed(222);
    sql(`DELETE FROM public.document_collaborators WHERE document_id='${doc}' AND user_id='${editor}';
      INSERT INTO public.project_collaborators VALUES('${project}','${editor}','editor','active');`);
    const writer = session('inherited_writer', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(doc)} SELECT 'accepted';`); await writer.wait('accepted');
    errorState(sql(`INSERT INTO public.document_collaborators VALUES('${doc}','${editor}','viewer','active')`, false), '55P03');
    errorState(sql(`UPDATE public.project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}'`, false), '55P03');
    assert.equal((await writer.finish()).status, 0);
    sql(`INSERT INTO public.document_collaborators VALUES('${doc}','${editor}','viewer','active');`);
    errorState(asRole(editor, append(doc, 'fresh'), 'authenticated', false), '42501');
    sql('DELETE FROM public.project_collaborators;');
  });
  await check('inactive direct viewer activation is fenced against inherited editor writes', async () => {
    const doc = seed(223, 'viewer');
    sql(`UPDATE public.document_collaborators SET status='inactive' WHERE document_id='${doc}' AND user_id='${editor}';
      INSERT INTO public.project_collaborators VALUES('${project}','${editor}','editor','active');`);
    const writer = session('activation_writer', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(doc)} SELECT 'accepted';`); await writer.wait('accepted');
    errorState(sql(`UPDATE public.document_collaborators SET status='active' WHERE document_id='${doc}' AND user_id='${editor}'`, false), '55P03');
    assert.equal((await writer.finish()).status, 0);
    sql(`UPDATE public.document_collaborators SET status='active' WHERE document_id='${doc}' AND user_id='${editor}';`);
    errorState(asRole(editor, append(doc, 'fresh'), 'authenticated', false), '42501');
    sql('DELETE FROM public.project_collaborators;');
  });
  await check('direct finalization cannot commit during an authorized append', async () => {
    const doc = seed(224);
    const writer = session('direct_finalization', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(doc)} SELECT 'accepted';`); await writer.wait('accepted');
    errorState(asRole(owner, `SET lock_timeout='150ms'; UPDATE public.documents SET locked_at=now() WHERE id='${doc}'`, 'authenticated', false), '55P03');
    assert.equal((await writer.finish()).status, 0);
    asRole(owner, `UPDATE public.documents SET locked_at=now() WHERE id='${doc}'`);
    errorState(asRole(editor, append(doc, 'fresh'), 'authenticated', false), '42501');
  });
  await check('official finalization waits for accepted append commit then denies subsequent writes', async () => {
    const doc = seed(225);
    const writer = session('official_write', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(doc)} SELECT 'accepted';`); await writer.wait('accepted');
    const locker = session('official_lock', { actorId: owner, role: 'authenticated' });
    locker.send(`SELECT public.kal49_lock_document('${doc}',NULL);`);
    await pg.blocked('official_lock');
    assert.equal((await writer.finish()).status, 0);
    assert.equal((await locker.finish()).status, 0);
    errorState(asRole(editor, append(doc, 'fresh'), 'authenticated', false), '42501');
  });
  for (const [index, isolation] of ['REPEATABLE READ', 'SERIALIZABLE'].entries()) {
    await check(`${isolation} stale unlocked snapshot cannot perform a new write`, async () => {
      const doc = seed(230 + index);
      const writer = session(`isolation_${index}`, { actorId: editor, role: 'authenticated', isolation });
      writer.send(`SELECT locked_at FROM public.documents WHERE id='${doc}'; SELECT 'snapshot';`); await writer.wait('snapshot');
      asRole(owner, `SELECT public.kal49_lock_document('${doc}',NULL);`);
      writer.send(append(doc)); const done = await writer.finish(); errorState(done, '25001');
      assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${doc}'`), '0');
    });
  }
  await check('repeatable-read absence snapshot cannot miss a new direct viewer override', async () => {
    const doc = seed(232);
    sql(`DELETE FROM public.document_collaborators WHERE document_id='${doc}' AND user_id='${editor}';
      INSERT INTO public.project_collaborators VALUES('${project}','${editor}','editor','active');`);
    const writer = session('rr_absence', { actorId: editor, role: 'authenticated', isolation: 'REPEATABLE READ' });
    writer.send(`SELECT public.user_can_access_document('${doc}','editor'); SELECT 'snapshot';`); await writer.wait('snapshot');
    sql(`INSERT INTO public.document_collaborators VALUES('${doc}','${editor}','viewer','active');`);
    writer.send(append(doc)); errorState(await writer.finish(), '25001');
    sql('DELETE FROM public.project_collaborators;');
  });
  await check('same-project different-document healthy writers proceed together and rollback is local', async () => {
    const first = seed(233), second = seed(234);
    const writer = session('parallel_docs', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(first)} SELECT 'holding';`); await writer.wait('holding');
    asRole(editor, `SET statement_timeout='1000ms'; ${append(second)}`);
    assert.equal((await writer.finish(false)).status, 0);
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${first}'`), '0');
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${second}'`), '1');
  });
  await check('owner user-archived document behavior and role ladder remain unchanged', () => {
    const doc = seed(235); sql(`UPDATE public.documents SET user_archived_at=now(),archived=true WHERE id='${doc}'`);
    asRole(owner, append(doc));
    errorState(asRole(editor, append(doc, 'editor'), 'authenticated', false), '42501');
    errorState(asRole(null, append(doc, 'service'), 'service_role', false), '42501');
  });
  await check('two inherited-only writers share the same project lock and commit independently', async () => {
    const first = seed(249), second = seed(250);
    sql(`DELETE FROM public.document_collaborators WHERE document_id IN('${first}','${second}') AND user_id='${editor}';
      INSERT INTO public.project_collaborators VALUES('${project}','${editor}','editor','active');`);
    const writer = session('inherited_parallel', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(first)} SELECT 'holding';`); await writer.wait('holding');
    asRole(editor, `SET statement_timeout='1000ms'; ${append(second)}`);
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${second}'`), '1');
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${first}'`), '0');
    assert.equal((await writer.finish()).status, 0);
    sql('DELETE FROM public.project_collaborators;');
  });
  await check('one project membership update does not block inherited writes in a distinct project', async () => {
    const otherProject = id(251), doc = seed(252);
    sql(`INSERT INTO public.projects VALUES('${otherProject}','${owner}',NULL);
      UPDATE public.documents SET project_id='${otherProject}' WHERE id='${doc}';
      DELETE FROM public.document_collaborators WHERE document_id='${doc}' AND user_id='${editor}';
      INSERT INTO public.project_collaborators VALUES('${project}','${editor}','editor','active'),('${otherProject}','${editor}','editor','active');
      GRANT SELECT,UPDATE ON public.project_collaborators TO service_role;`);
    const updater = session('distinct_project_membership', { role: 'service_role' });
    updater.send(`UPDATE public.project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}'; SELECT 'holding';`);
    await updater.wait('holding');
    asRole(editor, `SET statement_timeout='1000ms'; ${append(doc)}`);
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${doc}'`), '1');
    assert.equal((await updater.finish(false)).status, 0);
    sql('DELETE FROM public.project_collaborators;');
  });
  await check('membership deletion and FK cascades retain existing cleanup behavior', () => {
    const doc = seed(236);
    sql(`DELETE FROM public.document_collaborators WHERE document_id='${doc}' AND user_id='${editor}';`);
    errorState(asRole(editor, append(doc), 'authenticated', false), '42501');
    sql(`DELETE FROM public.documents WHERE id='${doc}'`);
    assert.equal(scalar(`SELECT count(*) FROM public.document_collaborators WHERE document_id='${doc}'`), '0');
  });
  await check('private triggers cannot be invoked by application roles', () => {
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal(scalar(`SELECT has_function_privilege('${role}','survey_private.guard_annotation_write_authority()','EXECUTE')`), 'f');
      assert.equal(scalar(`SELECT has_function_privilege('${role}','survey_private.guard_annotation_membership_change()','EXECUTE')`), 'f');
    }
  });
  await check('owner and direct editor do not wait on unrelated project metadata; inherited editor does', async () => {
    const doc = seed(240);
    const updater = session('project_metadata', { role: 'service_role' });
    // Service is a fixture role with BYPASSRLS, not an authorization claim.
    sql('GRANT UPDATE,SELECT ON public.projects TO service_role;');
    updater.send(`UPDATE public.projects SET user_archived_at=now() WHERE id='${project}'; SELECT 'updating';`);
    await updater.wait('updating');
    asRole(owner, `SET statement_timeout='1000ms'; ${append(doc, 'owner')}`);
    asRole(editor, `SET statement_timeout='1000ms'; ${append(doc, 'direct')}`);
    // Establish a separate inherited editor before the project lock is released.
    // Creating that membership now would itself correctly contend the parent.
    assert.equal((await updater.finish(false)).status, 0);
    const inherited = seed(241);
    sql(`DELETE FROM public.document_collaborators WHERE document_id='${inherited}' AND user_id='${editor}';
      INSERT INTO public.project_collaborators VALUES('${project}','${editor}','editor','active');`);
    const held = session('project_inherited', { role: 'service_role' });
    held.send(`UPDATE public.projects SET user_archived_at=now() WHERE id='${project}'; SELECT 'held';`); await held.wait('held');
    errorState(asRole(editor, append(inherited), 'authenticated', false), '55P03');
    assert.equal((await held.finish(false)).status, 0);
    asRole(editor, append(inherited));
    sql('DELETE FROM public.project_collaborators;');
  });
  await check('user-id-only membership changes and deletes require the same authority fence', async () => {
    const doc = seed(242);
    const writer = session('membership_identity', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(doc)} SELECT 'accepted';`); await writer.wait('accepted');
    errorState(sql(`UPDATE public.document_collaborators SET user_id='${outsider}' WHERE document_id='${doc}' AND user_id='${editor}'`, false), '55P03');
    errorState(sql(`DELETE FROM public.document_collaborators WHERE document_id='${doc}' AND user_id='${editor}'`, false), '55P03');
    assert.equal((await writer.finish()).status, 0);
    sql(`UPDATE public.document_collaborators SET user_id='${outsider}' WHERE document_id='${doc}' AND user_id='${editor}'`);
    errorState(asRole(editor, append(doc, 'fresh'), 'authenticated', false), '42501');
  });
  await check('opposite membership moves lock both parents and fail promptly rather than deadlock', async () => {
    const first = seed(243), second = seed(244);
    sql(`DELETE FROM public.document_collaborators WHERE (document_id='${second}' AND user_id='${editor}') OR (document_id='${first}' AND user_id='${viewer}');
      GRANT ALL ON public.document_collaborators TO service_role;`);
    const mover = session('membership_move', { role: 'service_role' });
    mover.send(`UPDATE public.document_collaborators SET document_id='${second}' WHERE document_id='${first}' AND user_id='${editor}'; SELECT 'moved';`); await mover.wait('moved');
    errorState(sql(`UPDATE public.document_collaborators SET document_id='${first}' WHERE document_id='${second}' AND user_id='${viewer}'`, false), '55P03');
    errorState(asRole(owner, append(first), 'authenticated', false), '55P03');
    errorState(asRole(owner, append(second), 'authenticated', false), '55P03');
    assert.equal((await mover.finish(false)).status, 0);
    assert.equal(scalar(`SELECT document_id FROM public.document_collaborators WHERE user_id='${editor}' AND document_id IN('${first}','${second}')`), first);
  });
  await check('exact direct snapshot upsert remains a no-op while changed content still consumes a new epoch', () => {
    const doc = seed(245); asRole(editor, directSnapshot(doc));
    const before = scalar(`SELECT row_to_json(s) FROM public.annotation_snapshots s WHERE document_id='${doc}'`);
    asRole(editor, `INSERT INTO public.annotation_snapshots(document_id,at_seq,snapshot,writer_id,writer_epoch)
      VALUES('${doc}',0,decode('01','hex'),'direct',1) ON CONFLICT(document_id) DO UPDATE SET snapshot=excluded.snapshot,writer_id=excluded.writer_id,writer_epoch=excluded.writer_epoch`);
    assert.equal(scalar(`SELECT row_to_json(s) FROM public.annotation_snapshots s WHERE document_id='${doc}'`), before);
    errorState(asRole(editor, `UPDATE public.annotation_snapshots SET snapshot=decode('02','hex') WHERE document_id='${doc}'`, 'authenticated', false), '40001');
  });
  await check('READ COMMITTED new-write rule leaves exact accepted receipt replay available in repeatable-read', async () => {
    const doc = seed(246); asRole(editor, append(doc)); revoke(doc);
    const retry = session('receipt_rr', { actorId: editor, role: 'authenticated', isolation: 'REPEATABLE READ' });
    retry.send(append(doc)); const done = await retry.finish(); assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /1/);
    assert.equal(scalar(`SELECT count(*) FROM public.annotation_updates WHERE document_id='${doc}'`), '1');
  });
  await check('a project deletion cascades its membership rows without blocking on its own removed parent', () => {
    const otherProject = id(247);
    sql(`INSERT INTO public.projects VALUES('${otherProject}','${owner}',NULL);
      INSERT INTO public.project_collaborators VALUES('${otherProject}','${editor}','editor','active');
      DELETE FROM public.projects WHERE id='${otherProject}';`);
    assert.equal(scalar(`SELECT count(*) FROM public.project_collaborators WHERE project_id='${otherProject}'`), '0');
  });
  await check('membership display-only updates do not contend an active writer parent lock', async () => {
    const doc = seed(248);
    sql('ALTER TABLE public.document_collaborators ADD COLUMN display_label text;');
    const writer = session('membership_display', { actorId: editor, role: 'authenticated' });
    writer.send(`${append(doc)} SELECT 'accepted';`); await writer.wait('accepted');
    sql(`SET statement_timeout='1000ms'; UPDATE public.document_collaborators SET display_label='Display only' WHERE document_id='${doc}' AND user_id='${editor}'`);
    assert.equal((await writer.finish()).status, 0);
  });
  console.log(`Annotation access PostgreSQL checks passed: ${checks}`);
}, { name: 'annotation-access' });
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
