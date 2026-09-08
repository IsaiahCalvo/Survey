import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'This disposable local fixture accepts no arguments');
const path = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(path(name), 'utf8');
const fn = (file, name) => {
  const text = source(file), start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start); assert.ok(start >= 0 && end > start);
  return text.slice(start, end + 3);
};
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), viewer = id(2), editor = id(3);
const revisionMigration = '20260909050000_legacy_annotation_revision.sql';

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration } = pg;
  let checks = 0;
  const check = async (name, work) => { await work(); console.log(`PASS ${name}`); checks++; };
  // Actual table definitions, role helpers, legacy policies, timestamp trigger
  // and WAL migrations. Ancillary projects/documents/auth are minimal fixtures;
  // this does not pretend to exercise the entire Supabase schema or provider.
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA survey_private;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid);
    CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),project_id uuid REFERENCES projects(id),
      user_archived_at timestamptz,locked_at timestamptz,locked_by uuid,locked_label text,updated_at timestamptz DEFAULT now());
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    INSERT INTO auth.users VALUES('${owner}'),('${viewer}'),('${editor}');`);
  sql(fn('20260802000000_kal426_user_archive_foundation.sql', 'user_can_access_document'));
  const annotationDdl = source('20241230000002_create_document_annotations.sql').match(/CREATE TABLE IF NOT EXISTS document_annotations \([\s\S]*?\n\);/)?.[0];
  assert.ok(annotationDdl); sql(annotationDdl);
  sql(`ALTER TABLE document_annotations RENAME COLUMN highlight_id TO annotation_id;
    ALTER TABLE document_annotations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_read ON document_annotations FOR SELECT USING(public.user_can_access_document(document_id,'viewer'));`);
  applyMigration(path('20260522000000_kal49_document_lock_state.sql'));
  applyMigration(path('20260428000000_phase27_crdt_foundation_schema.sql'));
  const phase28 = source('20260504000000_phase28_transport_auth_validator.sql');
  // Exact policy/validator section, not its obsolete access-helper definition.
  sql(phase28.slice(phase28.indexOf('DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all'), phase28.lastIndexOf('COMMIT;')));
  applyMigration(path('20260603130000_db_sync_annotations_changed_at.sql'));
  applyMigration(path('20260606120000_rebuild_yjs_source_of_truth.sql'));
  sql('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;');
  applyMigration(path('20260727131230_annotation_wal_concurrency.sql'));
  applyMigration(path('20260909040000_annotation_write_authorization.sql'));
  applyMigration(path(revisionMigration));
  const seed = n => { const doc = id(n); sql(`INSERT INTO documents(id,user_id) VALUES('${doc}','${owner}'); INSERT INTO document_collaborators VALUES('${doc}','${viewer}','viewer','active'),('${doc}','${editor}','editor','active');`); return doc; };
  const rev = doc => scalar(`SELECT coalesce((SELECT revision FROM survey_private.document_legacy_revisions WHERE document_id='${doc}'),0)`);
  const insert = (doc, key = 'a') => `INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds) VALUES('${doc}','${owner}','${key}',1,'{}');`;
  const cache = doc => `INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${doc}',decode('01','hex'),decode('','hex'),0) ON CONFLICT(document_id) DO UPDATE SET state=excluded.state;`;
  const append = doc => `SELECT * FROM append_annotation_update('${doc}','wal',1,decode('01','hex'));`;

  await check('bulk statement increments once; no-op/empty/rollback semantics', () => {
    const doc = seed(100);
    asRole(owner, `INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds) SELECT '${doc}','${owner}',n::text,1,'{}' FROM generate_series(1,1000)n;`);
    assert.equal(rev(doc),'1');
    asRole(owner, `UPDATE document_annotations SET page_number=page_number WHERE document_id='${doc}';`); assert.equal(rev(doc),'2');
    asRole(owner, `UPDATE document_annotations SET page_number=2 WHERE false; DELETE FROM document_annotations WHERE false;`); assert.equal(rev(doc),'2');
    asRole(owner, `BEGIN; ${insert(doc,'rollback')} ROLLBACK;`); assert.equal(rev(doc),'2');
    errorState(asRole(owner, `BEGIN; ${insert(doc,'failed')} SELECT 1/0; COMMIT;`,'authenticated',false),'22012'); assert.equal(rev(doc),'2');
  });
  await check('mixed upsert counts affected events not attempted duplicate insert', () => {
    const doc = seed(101); asRole(owner,insert(doc)); assert.equal(rev(doc),'1');
    asRole(owner, `${insert(doc).replace(';',' ON CONFLICT(document_id,annotation_id) DO NOTHING;')}`); assert.equal(rev(doc),'1');
    asRole(owner, `INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds) VALUES('${doc}','${owner}','a',2,'{}'),('${doc}','${owner}','b',2,'{}') ON CONFLICT(document_id,annotation_id) DO UPDATE SET page_number=excluded.page_number;`); assert.equal(rev(doc),'3');
  });
  await check('cross-document move advances both tokens, service writes and cache ABA count', () => {
    const a = seed(102), b = seed(103); asRole(null,insert(a),'service_role');
    asRole(null,`UPDATE document_annotations SET document_id='${b}' WHERE document_id='${a}';`,'service_role');
    assert.equal(rev(a),'2'); assert.equal(rev(b),'1');
    asRole(owner,cache(b)); asRole(owner,`DELETE FROM doc_yjs_state WHERE document_id='${b}';`); asRole(owner,cache(b)); assert.equal(rev(b),'4');
    asRole(owner,`INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${b}','old',1,decode('01','hex'));`); assert.equal(rev(b),'5');
    asRole(null,`UPDATE doc_yjs_updates SET update=decode('02','hex') WHERE document_id='${b}'; DELETE FROM doc_yjs_updates WHERE document_id='${b}';`,'service_role'); assert.equal(rev(b),'7');
  });
  await check('real policy boundaries retained; private counter and truncate unavailable', () => {
    const doc = seed(104);
    errorState(asRole(viewer,insert(doc),'authenticated',false),'42501'); assert.equal(rev(doc),'0');
    asRole(editor,insert(doc).replace(owner,editor)); assert.equal(rev(doc),'1');
    asRole(owner,`SELECT kal49_lock_document('${doc}',NULL);`);
    errorState(asRole(owner,insert(doc,'locked'),'authenticated',false),'42501');
    // Existing cache policy permits locked-document writes. Do not silently
    // introduce a new policy while adding a revision token.
    asRole(owner,cache(doc)); assert.equal(rev(doc),'2');
    for (const role of ['authenticated','service_role']) {
      errorState(asRole(owner,'UPDATE survey_private.document_legacy_revisions SET revision=0;',role,false),'42501');
      for (const table of ['document_annotations','doc_yjs_state','doc_yjs_updates']) errorState(asRole(owner,`TRUNCATE ${table} CASCADE;`,role,false),'42501');
    }
    errorState(sql('TRUNCATE doc_yjs_state;',false),'42501');
  });
  await check('all three mutable lanes reject repeatable read', () => {
    const doc = seed(105);
    for (const statement of [insert(doc),cache(doc),`INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${doc}','rr',1,decode('01','hex'));`]) {
      errorState(asRole(owner,`BEGIN ISOLATION LEVEL REPEATABLE READ; ${statement} COMMIT;`,'authenticated',false),'25001');
      assert.equal(rev(doc),'0');
    }
  });
  await check('actual document cascade deletes all lanes without losing permanent token', () => {
    const doc = seed(106); asRole(owner,insert(doc)); asRole(owner,cache(doc));
    asRole(owner,`INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${doc}','cascade',1,decode('01','hex'));`);
    sql(`DELETE FROM documents WHERE id='${doc}';`); assert.equal(rev(doc),'6');
    for(const table of ['document_annotations','doc_yjs_state','doc_yjs_updates']) assert.equal(scalar(`SELECT count(*) FROM ${table} WHERE document_id='${doc}'`),'0');
  });
  await check('WAL first rejects legacy mutation promptly; legacy first makes WAL wait then succeed', async () => {
    const a = seed(107), b = seed(108);
    const wal = session('wal_first',{role:'authenticated',actorId:owner}); wal.send(`${append(a)} SELECT 'held';`); await wal.wait('held');
    errorState(asRole(owner,insert(a),'authenticated',false),'40001'); assert.equal(rev(a),'0'); assert.equal((await wal.finish()).status,0);
    const legacy = session('legacy_first',{role:'authenticated',actorId:owner}); legacy.send(`${insert(b)} SELECT 'held';`); await legacy.wait('held');
    const waiting = session('wal_waiting',{role:'authenticated',actorId:owner}); waiting.send(`${append(b)} SELECT 'accepted';`); await pg.blocked('wal_waiting');
    assert.equal(rev(b),'0'); assert.equal((await legacy.finish()).status,0); await waiting.wait('accepted'); assert.equal((await waiting.finish()).status,0); assert.equal(rev(b),'1');
  });
  await check('document tuple/advisory inversion fails NOWAIT; unrelated document progresses', async () => {
    const a = seed(109), b = seed(110);
    const parent = session('parent_held'); parent.send(`SELECT id FROM documents WHERE id='${a}' FOR UPDATE; SELECT 'held';`); await parent.wait('held');
    errorState(asRole(owner,insert(a),'authenticated',false),'55P03'); asRole(owner,insert(b)); assert.equal(rev(b),'1'); assert.equal((await parent.finish()).status,0);
  });
  await check('child tuple/advisory inversion aborts old row updater rather than deadlocks', async () => {
    const doc = seed(111); asRole(owner,insert(doc));
    const row = session('child_held'); row.send(`SELECT id FROM document_annotations WHERE document_id='${doc}' FOR UPDATE; SELECT 'held';`); await row.wait('held');
    const lock = session('advisory_held'); lock.send(`SELECT pg_advisory_xact_lock(hashtextextended('${doc}',0)); SELECT 'held';`); await lock.wait('held');
    row.send(`UPDATE document_annotations SET page_number=2 WHERE document_id='${doc}';`);
    errorState(await row.finish(),'40001'); assert.equal((await lock.finish()).status,0); assert.equal(rev(doc),'1');
  });
  await check('cache identity move advances old/new heads; old WAL uniqueness failure does not advance', () => {
    const a = seed(113), b = seed(114); asRole(owner,cache(a));
    asRole(owner,`UPDATE doc_yjs_state SET document_id='${b}' WHERE document_id='${a}';`);
    assert.equal(rev(a),'2'); assert.equal(rev(b),'1');
    const oldInsert = `INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${b}','same',1,decode('01','hex'));`;
    asRole(owner,oldInsert); errorState(asRole(owner,oldInsert,'authenticated',false),'23505'); assert.equal(rev(b),'2');
  });
  await check('opposite cross-parent moves fail promptly and roll back both rows/counters', async () => {
    const a = seed(115), b = seed(116); asRole(owner,insert(a,'left')); asRole(owner,insert(b,'right'));
    const first = session('move_first'), second = session('move_second');
    first.send(`UPDATE document_annotations SET page_number=2 WHERE document_id='${a}'; SELECT 'held';`);
    second.send(`UPDATE document_annotations SET page_number=2 WHERE document_id='${b}'; SELECT 'held';`);
    await first.wait('held'); await second.wait('held');
    first.send(`UPDATE document_annotations SET document_id='${b}' WHERE document_id='${a}';`);
    errorState(await first.finish(),'40001');
    second.send(`UPDATE document_annotations SET document_id='${a}' WHERE document_id='${b}';`);
    assert.equal((await second.finish(false)).status,0); assert.equal(rev(a),'1'); assert.equal(rev(b),'1');
  });
  await check('all legacy lanes conflict with a held WAL lock and succeed after its rollback', async () => {
    const doc = seed(117);
    const lock = session('all_lanes_wal',{actorId:owner,role:'authenticated'});
    lock.send(`${append(doc)} SELECT 'held';`); await lock.wait('held');
    const oldInsert = `INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${doc}','old',1,decode('01','hex'));`;
    for(const statement of [cache(doc),oldInsert]) errorState(asRole(owner,statement,'authenticated',false),'40001');
    assert.equal((await lock.finish(false)).status,0); assert.equal(rev(doc),'0');
    asRole(owner,cache(doc)); asRole(owner,oldInsert); assert.equal(rev(doc),'2');
  });
  await check('actual tracked revision restore deletion advances token and rolls back on error', () => {
    // Exact restore/create/access function bodies. Only empty target arrays are
    // used: ancillary survey/revision fixture columns are not the full schema.
    sql(`CREATE TABLE survey_sessions(id uuid PRIMARY KEY,document_id uuid); CREATE TABLE survey_items(id uuid,session_id uuid,created_at timestamptz);
      CREATE TABLE document_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid,revision_number integer,label text,origin text,created_by uuid,snapshot_json jsonb);`);
    const file = '20260522170000_kal48_inline_auth_checks.sql';
    for(const name of ['_kal48_can_access','kal48_create_revision','kal48_restore_revision']) sql(fn(file,name));
    const doc = seed(112), receipt = id(500); asRole(owner,insert(doc));
    sql(`INSERT INTO document_revisions(id,document_id,revision_number,snapshot_json) VALUES('${receipt}','${doc}',1,'{"annotations":[],"survey_items":[]}');`);
    asRole(owner,`BEGIN; SELECT kal48_restore_revision('${receipt}'); ROLLBACK;`); assert.equal(rev(doc),'1');
    asRole(owner,`SELECT kal48_restore_revision('${receipt}');`); assert.equal(rev(doc),'2');
  });
  console.log(JSON.stringify({checks,postgres:pg.version,result:'passed',scope:'local SQL annotation/cache counter only; no provider or full-state proof'}));
});
