// SQL-only source capture. No Storage/provider proof, network, accounts or secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'This isolated local fixture accepts no arguments');
const migration = '20260909072000_document_publication_source_capture.sql';
const path = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(path(name), 'utf8');
const fn = (file, name) => {
  const text = source(file), start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), end = text.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start); return text.slice(start, end + 3);
};
const id = n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), stranger = id(4), project = id(5), template = id(6);
const captureSql = doc => `SELECT survey_private.capture_document_publication_sources('${doc}')`;

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration } = pg;
  let checks = 0;
  const check = async (label, run) => { await run(); checks++; console.log(`PASS ${label}`); };
  // Core tables predate tracked DDL. Source tables, access/lock helpers, RLS,
  // timestamp triggers and all revision/destructive fences below are real SQL.
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA survey_private;
    CREATE PUBLICATION supabase_realtime;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TABLE templates(id uuid PRIMARY KEY);
    CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid);
    CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),project_id uuid REFERENCES projects(id),
      name text,file_path text,file_size bigint,page_count integer,annotations jsonb,archived boolean DEFAULT false,
      user_archived_at timestamptz,locked_at timestamptz,locked_by uuid,locked_label text,updated_at timestamptz DEFAULT now(),
      fixture_extra jsonb);
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    INSERT INTO auth.users VALUES('${owner}'),('${editor}'),('${viewer}'),('${stranger}');
    INSERT INTO projects VALUES('${project}','${owner}'); INSERT INTO templates VALUES('${template}');
    INSERT INTO project_collaborators VALUES('${project}','${editor}','editor','active'),('${project}','${viewer}','viewer','active');`);
  sql(fn('20260802000000_kal426_user_archive_foundation.sql', 'user_can_access_document'));
  const annotationDdl = source('20241230000002_create_document_annotations.sql').match(/CREATE TABLE IF NOT EXISTS document_annotations \([\s\S]*?\n\);/)?.[0];
  assert.ok(annotationDdl); sql(annotationDdl);
  sql(`ALTER TABLE document_annotations RENAME COLUMN highlight_id TO annotation_id;
    ALTER TABLE document_annotations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_read ON document_annotations FOR SELECT USING(public.user_can_access_document(document_id,'viewer'));`);
  applyMigration(path('20260522000000_kal49_document_lock_state.sql'));
  applyMigration(path('20260428000000_phase27_crdt_foundation_schema.sql'));
  const phase28 = source('20260504000000_phase28_transport_auth_validator.sql');
  sql(phase28.slice(phase28.indexOf('DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all'), phase28.lastIndexOf('COMMIT;')));
  applyMigration(path('20260603130000_db_sync_annotations_changed_at.sql'));
  applyMigration(path('20260606120000_rebuild_yjs_source_of_truth.sql'));
  applyMigration(path('20241230000001_create_survey_realtime_tables.sql'));
  sql(`ALTER TABLE survey_items RENAME COLUMN highlight_id TO annotation_id;
    ALTER TABLE survey_items RENAME COLUMN ball_in_court_entity_id TO entity_id;
    ALTER TABLE survey_items RENAME COLUMN ball_in_court_name TO entity_name;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;`);
  for (const name of ['20260727131230_annotation_wal_concurrency.sql', '20260909040000_annotation_write_authorization.sql',
    '20260909050000_legacy_annotation_revision.sql', '20260909060000_document_survey_revision.sql']) applyMigration(path(name));
  const seed = n => {
    const doc = id(n);
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count,annotations,fixture_extra)
      VALUES('${doc}','${owner}','${project}','Source metadata','${owner}/original.pdf',9007199254740993,3,'{"sidebar":"original"}','{"nested":[1,null,true]}')`);
    return doc;
  };
  // Invoke as the function owner with a synthetic auth.uid context. Never grant
  // EXECUTE to an app role just to make tests pass: this is not a public RPC.
  const capture = (doc, actor = owner) => JSON.parse(asRole(actor, captureSql(doc), 'postgres').stdout);
  const deniedCapture = (doc, actor = owner, isolation = null) => asRole(actor,
    `${isolation ? `BEGIN ISOLATION LEVEL ${isolation};` : ''}${captureSql(doc)};${isolation ? 'COMMIT;' : ''}`, 'postgres', false);
  const insert = (doc, key = 'mark') => `INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds,notes)
    VALUES('${doc}','${owner}','${key}',2,'{"x":4,"y":5}','Keep full metadata');`;
  const append = (doc, seq = 1) => `SELECT * FROM append_annotation_update('${doc}','fixture-writer',${seq},decode('00ff0102','hex'));`;
  const survey = (doc, n, actor = owner, active = false) => {
    const sid = id(n); asRole(actor, `INSERT INTO survey_sessions(id,template_id,user_id,document_id,is_active,excel_file_path)
      VALUES('${sid}','${template}','${actor}','${doc}',${active},'saved workbook provenance')`); return sid;
  };
  const item = sid => `INSERT INTO survey_items(session_id,annotation_id,module_id,category_id,page_number,notes,checklist_responses)
    VALUES('${sid}','survey-mark','module','category',2,'Keep item text','{"answer":true}');`;
  const fullRows = (table, predicate, projection = 'to_jsonb(t)', order = 'id') => JSON.parse(scalar(
    `SET TimeZone='UTC';SELECT coalesce(jsonb_agg(${projection} ORDER BY ${order}),'[]'::jsonb) FROM ${table} t WHERE ${predicate}`));

  // Historical large/gapped WAL fixture BEFORE the immutable UPDATE fence is
  // installed. Every capture and race below runs with the final guard active.
  // No trigger is disabled and this seed is not claimed as a client write.
  const historical = seed(101), compacted = seed(103);
  asRole(owner, `INSERT INTO annotation_updates(document_id,client_id,client_seq,data)
    VALUES('${historical}','large',9007199254740993,decode('00ff80','hex')),
    ('${historical}','large',9007199254740999,decode('010203','hex'));${append(compacted)}`);
  sql(`UPDATE annotation_updates SET seq=CASE seq WHEN 1 THEN 9007199254740993 ELSE 9007199254740999 END WHERE document_id='${historical}';
    UPDATE annotation_updates SET seq=9007199254740997 WHERE document_id='${compacted}'`);
  applyMigration(path('20260909071000_annotation_destructive_write_fence.sql'));
  applyMigration(path(migration));

  await check('empty capture has stable exact document, zero tokens and explicit SQL-only scope', () => {
    const doc = seed(100), a = capture(doc), b = capture(doc);
    assert.deepEqual(a, b); assert.equal(a.version, 1); assert.equal(a.scope, 'sql-only'); assert.equal(a.actor_user_id, owner);
    assert.equal(a.document.file_size, '9007199254740993');
    const expected = JSON.parse(scalar(`SET TimeZone='UTC';SELECT to_jsonb(d)||jsonb_build_object('file_size',d.file_size::text) FROM documents d WHERE id='${doc}'`));
    assert.deepEqual(a.document, expected);
    assert.equal(a.sources.annotation_snapshot, null); assert.equal(a.sources.doc_yjs_state, null);
    for (const field of ['annotation_updates','document_annotations','doc_yjs_updates','survey_sessions','survey_items']) assert.deepEqual(a.sources[field], []);
    for (const field of ['wal_head','covered_head','legacy_revision','survey_revision']) assert.equal(a.compare[field], '0');
    assert.match(a.compare.sql_sha256, /^[0-9a-f]{64}$/);
    assert.equal(asRole(owner, `SELECT p#>>'{compare,sql_sha256}'=encode(sha256(convert_to((p#-'{compare,sql_sha256}')::text,'UTF8')),'hex')
      FROM (${captureSql(doc)}) result(p)`, 'postgres').stdout, 't', 'hash includes full body except its own digest');
  });
  await check('all full source rows, inactive sessions, bytea and bigint values survive in deterministic order', () => {
    const doc = historical; asRole(owner, insert(doc)); const sid = survey(doc, 102); asRole(owner, item(sid));
    assert.deepEqual(capture(doc).sources.annotation_updates.map(row => row.seq), ['9007199254740993','9007199254740999'], 'historical gaps are ordered, not rejected');
    asRole(owner, `
      INSERT INTO annotation_snapshots(document_id,at_seq,snapshot,writer_id,writer_epoch,base_at_seq,base_writer_epoch)
      VALUES('${doc}',9007199254740999,decode('00ff','hex'),'writer',9007199254740993,NULL,0);
      UPDATE annotation_snapshots SET snapshot=decode('00ff01','hex'),writer_epoch=9007199254740994,
        base_at_seq=at_seq,base_writer_id=writer_id,base_writer_epoch=writer_epoch WHERE document_id='${doc}';
      INSERT INTO annotation_updates(document_id,client_id,client_seq,data) VALUES('${doc}','tail',9007199254740994,decode('010203','hex'));
      INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${doc}',decode('00ff0102','hex'),decode('ff00','hex'),9007199254740993);
      INSERT INTO doc_yjs_updates(id,document_id,client_id,seq,update,origin) VALUES(9007199254740993,'${doc}','legacy',9007199254740995,decode('00ff','hex'),'{"fixture":true}');`);
    const a = capture(doc), p = `document_id='${doc}'`;
    assert.deepEqual(a.sources.document_annotations, fullRows('document_annotations', p));
    assert.deepEqual(a.sources.annotation_updates, fullRows('annotation_updates', `${p} AND seq>9007199254740999`,
      `(to_jsonb(t)-'data')||jsonb_build_object('data_base64',encode(data,'base64'),'seq',seq::text,'client_seq',client_seq::text)`, 'seq'));
    assert.deepEqual(a.sources.annotation_snapshot, fullRows('annotation_snapshots', p,
      `(to_jsonb(t)-'snapshot')||jsonb_build_object('snapshot_base64',encode(snapshot,'base64'),'at_seq',at_seq::text,'writer_epoch',writer_epoch::text,'base_at_seq',base_at_seq::text,'base_writer_epoch',base_writer_epoch::text)`, 'document_id')[0]);
    assert.deepEqual(a.sources.doc_yjs_state, fullRows('doc_yjs_state', p,
      `(to_jsonb(t)-'state'-'state_vector')||jsonb_build_object('state_base64',encode(state,'base64'),'state_vector_base64',encode(state_vector,'base64'),'through_seq',through_seq::text)`, 'document_id')[0]);
    assert.deepEqual(a.sources.doc_yjs_updates, fullRows('doc_yjs_updates', p,
      `(to_jsonb(t)-'update')||jsonb_build_object('update_base64',encode(update,'base64'),'id',id::text,'seq',seq::text)`, 'seq,id'));
    assert.deepEqual(a.sources.survey_sessions, fullRows('survey_sessions', p));
    assert.deepEqual(a.sources.survey_items, fullRows('survey_items', `session_id='${sid}'`, 'to_jsonb(t)', 'session_id,id'));
    assert.equal(a.sources.survey_sessions[0].is_active, false); assert.equal(a.compare.wal_head, '9007199254741000');
    assert.equal(a.compare.covered_head, '9007199254741000'); assert.deepEqual(a, capture(doc));
  });
  await check('timezone changes cannot alter the capture digest and the caller timezone is restored', () => {
    const observed = [];
    for (const zone of ['UTC','America/New_York']) {
      const lines = asRole(owner, `SET TimeZone='${zone}';${captureSql(historical)};SHOW TimeZone`, 'postgres').stdout.split('\n');
      assert.equal(lines.at(-1), zone, 'function-local timezone must not leak to caller');
      observed.push(JSON.parse(lines.slice(0,-1).join('\n')));
    }
    assert.deepEqual(observed[0], observed[1]);
  });
  await check('snapshot head can exceed remaining WAL without pretending there is a missing gap', () => {
    const doc = compacted;
    asRole(owner, `INSERT INTO annotation_snapshots(document_id,at_seq,snapshot,writer_epoch) VALUES('${doc}',9007199254740997,decode('01','hex'),1)`);
    sql(`DELETE FROM annotation_updates WHERE document_id='${doc}'`);
    const result = capture(doc); assert.equal(result.compare.wal_head, '0'); assert.equal(result.compare.covered_head, '9007199254740997');
  });
  await check('every mutable source lane and document metadata changes the digest; rollback does not', () => {
    const doc = seed(104), sid = survey(doc, 105); asRole(owner, insert(doc) + item(sid));
    asRole(owner, `INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${doc}',decode('01','hex'),decode('','hex'),0)`);
    let previous = capture(doc).compare.sql_sha256;
    for (const change of [`UPDATE documents SET fixture_extra='{"new":true}' WHERE id='${doc}'`,
      `UPDATE document_annotations SET notes='new notes' WHERE document_id='${doc}'`,
      `UPDATE doc_yjs_state SET state=decode('02','hex') WHERE document_id='${doc}'`,
      `INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${doc}','legacy',1,decode('03','hex'))`,
      `UPDATE survey_sessions SET is_active=true WHERE id='${sid}'`, `UPDATE survey_items SET notes='new survey' WHERE session_id='${sid}'`, append(doc)]) {
      asRole(owner, change); const next = capture(doc).compare.sql_sha256; assert.notEqual(next, previous); previous = next;
    }
    asRole(owner, `BEGIN; UPDATE survey_items SET notes='rolled back' WHERE session_id='${sid}';ROLLBACK;`);
    assert.equal(capture(doc).compare.sql_sha256, previous);
  });
  await check('private EXECUTE remains denied to all app roles; no caller can use service JWT to bypass', () => {
    const doc = seed(106);
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal(scalar(`SELECT has_function_privilege('${role}','survey_private.capture_document_publication_sources(uuid)','EXECUTE')`), 'f');
      errorState(asRole(owner, captureSql(doc), role, false), '42501');
    }
    errorState(asRole(viewer, `SET request.jwt.claim.role='service_role';${captureSql(doc)}`, 'authenticated', false), '42501');
    assert.equal(capture(doc, editor).actor_user_id, editor);
    for (const actor of [viewer,stranger,null]) errorState(deniedCapture(doc, actor), '42501');
    errorState(deniedCapture(id(99999)), '42501');
    asRole(owner, `SELECT kal49_lock_document('${doc}','fixture')`); errorState(deniedCapture(doc), '42501');
  });
  await check('READ COMMITTED required and foreign-owned attached sessions always reject, including inactive empty sessions', () => {
    const doc = seed(107);
    for (const isolation of ['REPEATABLE READ','SERIALIZABLE']) errorState(deniedCapture(doc, owner, isolation), '25001');
    const sid = survey(doc, 108, stranger, false); errorState(deniedCapture(doc), '42501');
    asRole(stranger, item(sid)); errorState(deniedCapture(doc), '42501');
    asRole(stranger, `UPDATE survey_sessions SET document_id=NULL WHERE id='${sid}'`);
    assert.deepEqual(capture(doc).sources.survey_sessions, []);
  });
  await check('writer first rejects capture promptly; fresh capture after commit includes exact accepted tail', async () => {
    const doc = seed(109), writer = session('capture_writer_first', { role:'authenticated', actorId:owner });
    writer.send(`${append(doc)} SELECT 'WAL_HELD';`); await writer.wait('WAL_HELD');
    errorState(deniedCapture(doc), '40001'); assert.equal((await writer.finish()).status, 0);
    assert.equal(capture(doc).sources.annotation_updates.length, 1);
  });
  await check('capture first holds WAL against append and refuses destructive/survey/legacy changes atomically', async () => {
    const doc = seed(110), sid = survey(doc, 111); asRole(owner, insert(doc) + item(sid) + append(doc));
    const held = session('capture_first', { role:'postgres', actorId:owner });
    held.send(`${captureSql(doc)}; SELECT 'CAPTURE_HELD';`); await held.wait('CAPTURE_HELD');
    for (const statement of [`DELETE FROM annotation_updates WHERE document_id='${doc}'`,
      `DELETE FROM document_annotations WHERE document_id='${doc}'`, `UPDATE survey_items SET notes='blocked' WHERE session_id='${sid}'`]) {
      errorState(asRole(owner, statement, 'postgres', false), '40001');
    }
    const pending = session('capture_append_wait', { role:'authenticated', actorId:owner });
    pending.send(`${append(doc,2)} SELECT 'APPENDED';`); await pg.blocked(pending.name);
    assert.equal((await held.finish()).status, 0); await pending.wait('APPENDED'); assert.equal((await pending.finish()).status, 0);
    assert.equal(capture(doc).sources.annotation_updates.length, 2);
    assert.equal(scalar(`SELECT notes FROM survey_items WHERE session_id='${sid}'`), 'Keep item text');
  });
  await check('document row lock and inherited project lock fail NOWAIT in the reverse order', async () => {
    const doc = seed(112);
    for (const [table,target] of [['documents',doc],['projects',project]]) {
      const lock = session(`capture_${table}_held`); lock.send(`SELECT id FROM ${table} WHERE id='${target}' FOR UPDATE; SELECT 'ROW_HELD';`); await lock.wait('ROW_HELD');
      errorState(deniedCapture(doc, editor), '55P03'); assert.equal((await lock.finish()).status, 0);
    }
  });
  await check('capture fences role revocation; revoke-first causes contention then fresh permission denial', async () => {
    const doc = seed(113), held = session('capture_editor_held', { role:'postgres', actorId:editor });
    held.send(`${captureSql(doc)};SELECT 'CAPTURE_HELD';`); await held.wait('CAPTURE_HELD');
    const revoke = `UPDATE project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}'`;
    errorState(sql(revoke, false), '55P03'); assert.equal((await held.finish()).status, 0);
    const first = session('capture_revoke_first'); first.send(`${revoke};SELECT 'REVOKED';`); await first.wait('REVOKED');
    errorState(deniedCapture(doc, editor), '55P03'); assert.equal((await first.finish()).status, 0);
    errorState(deniedCapture(doc, editor), '42501');
    sql(`UPDATE project_collaborators SET role='editor' WHERE project_id='${project}' AND user_id='${editor}'`);
  });
  await check('over 10000 total source rows fail without a truncated capture', () => {
    const doc = seed(114);
    asRole(owner, `INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds)
      SELECT '${doc}','${owner}',n::text,1,'{}' FROM generate_series(1,10001)n`);
    errorState(deniedCapture(doc), '54000');
    assert.equal(scalar(`SELECT count(*) FROM document_annotations WHERE document_id='${doc}'`), '10001');
  });
  await check('10000 combined rows succeed but adding one other-source row fails the whole capture', () => {
    const doc = seed(117), sid = survey(doc, 118);
    asRole(owner, `INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds)
      SELECT '${doc}','${owner}',n::text,1,'{}' FROM generate_series(1,9999)n`);
    assert.equal(asRole(owner, `SELECT jsonb_array_length(p#>'{sources,document_annotations}')+jsonb_array_length(p#>'{sources,survey_sessions}')
      FROM (${captureSql(doc)}) result(p)`, 'postgres').stdout, '10000');
    asRole(owner, item(sid)); errorState(deniedCapture(doc), '54000');
    assert.equal(scalar(`SELECT count(*) FROM survey_items WHERE session_id='${sid}'`), '1');
  });
  await check('over 16 MiB serialized source body fails without truncation or source mutation', () => {
    const doc = seed(115); asRole(owner, insert(doc));
    asRole(owner, `UPDATE document_annotations SET notes=repeat('x',17*1024*1024) WHERE document_id='${doc}'`);
    errorState(deniedCapture(doc), '54000');
    assert.equal(scalar(`SELECT length(notes) FROM document_annotations WHERE document_id='${doc}'`), String(17*1024*1024));
  });
  console.log(`Document publication source capture PostgreSQL checks passed: ${checks}`);
  console.log(JSON.stringify({ checks, result:'passed', postgres:pg.version,
    scope:'sql-only; tracked sources/access/revision/destructive guards; no Storage/provider or publication proof' }));
}, { name:'document-source-capture', commandTimeoutMs:30000 });
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
