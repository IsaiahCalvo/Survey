import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length,2,'This disposable local fixture accepts no arguments');
const path = name => fileURLToPath(new URL(`../supabase/migrations/${name}`,import.meta.url));
const fn = (file,name) => {
  const source=readFileSync(path(file),'utf8'), start=source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), end=source.indexOf('$$;',start);
  assert.ok(start>=0&&end>start); return source.slice(start,end+3);
};
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),template=id(3);
await withDisposablePostgres(async pg=>{
  const {sql,scalar,asRole,errorState,session,applyMigration}=pg;
  let checks=0;
  const check=async(name,work)=>{await work();checks++;console.log(`PASS ${name}`);};
  // Full tracked survey DDL/policies/triggers/FKs. Only unrelated core tables
  // are minimal fixtures. No Microsoft/provider/auth-schema operations occur.
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA survey_private; CREATE PUBLICATION supabase_realtime;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TABLE templates(id uuid PRIMARY KEY); CREATE TABLE projects(id uuid PRIMARY KEY,user_id uuid);
    CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid,project_id uuid REFERENCES projects(id),user_archived_at timestamptz,locked_at timestamptz,locked_by uuid,locked_label text);
    CREATE TABLE document_collaborators(document_id uuid REFERENCES documents(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    CREATE TABLE project_collaborators(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,user_id uuid,role text,status text);
    INSERT INTO auth.users VALUES('${owner}'),('${other}'); INSERT INTO templates VALUES('${template}');`);
  applyMigration(path('20241230000001_create_survey_realtime_tables.sql'));
  sql(`ALTER TABLE survey_items RENAME COLUMN highlight_id TO annotation_id;
    ALTER TABLE survey_items RENAME COLUMN ball_in_court_entity_id TO entity_id;
    ALTER TABLE survey_items RENAME COLUMN ball_in_court_name TO entity_name;`);
  sql(fn('20260802000000_kal426_user_archive_foundation.sql','user_can_access_document'));
  sql(fn('20260522000000_kal49_document_lock_state.sql','kal49_document_is_locked'));
  applyMigration(path('20260606120000_rebuild_yjs_source_of_truth.sql'));
  sql('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;');
  applyMigration(path('20260727131230_annotation_wal_concurrency.sql'));
  applyMigration(path('20260909040000_annotation_write_authorization.sql'));
  applyMigration(path('20260909060000_document_survey_revision.sql'));
  const doc=n=>{const d=id(n);sql(`INSERT INTO documents(id,user_id) VALUES('${d}','${owner}')`);return d;};
  const survey=(n,d,active=true)=>{const s=id(n);asRole(owner,`INSERT INTO survey_sessions(id,template_id,user_id,document_id,is_active) VALUES('${s}','${template}','${owner}',${d?`'${d}'`:'NULL'},${active})`);return s;};
  const rev=d=>Number(scalar(`SELECT coalesce((SELECT revision FROM survey_private.document_survey_revisions WHERE document_id='${d}'),0)`));
  const item=(s,key='a')=>`INSERT INTO survey_items(session_id,annotation_id,module_id,category_id,page_number) VALUES('${s}','${key}','m','c',1);`;
  const append=d=>`SELECT * FROM append_annotation_update('${d}','writer',1,decode('01','hex'));`;

  await check('inactive sessions, all metadata and 1000-row item batches count once per event',()=>{
    const d=doc(100),s=survey(101,d,false);assert.equal(rev(d),1);
    asRole(owner,`INSERT INTO survey_items(session_id,annotation_id,module_id,category_id) SELECT '${s}',n::text,'m','c' FROM generate_series(1,1000)n`);assert.equal(rev(d),2);
    asRole(owner,`UPDATE survey_items SET page_number=2 WHERE session_id='${s}';`);assert.equal(rev(d),3);
    asRole(owner,`UPDATE survey_sessions SET excel_file_path='changed' WHERE id='${s}'`);assert.equal(rev(d),4);
    asRole(owner,`UPDATE survey_items SET page_number=2 WHERE false; DELETE FROM survey_items WHERE false;`);assert.equal(rev(d),4);
    asRole(owner,`DELETE FROM survey_items WHERE session_id='${s}'`);assert.equal(rev(d),5);
  });
  await check('session rebind accounts for all items and metadata; detach and attach include old/new',()=>{
    const a=doc(102),b=doc(103),s=survey(104,a);asRole(owner,item(s));assert.equal(rev(a),2);
    asRole(owner,`UPDATE survey_sessions SET document_id='${b}' WHERE id='${s}'`);assert.equal(rev(a),3);assert.equal(rev(b),1);
    asRole(owner,`UPDATE survey_sessions SET document_id=NULL WHERE id='${s}'`);assert.equal(rev(b),2);
    asRole(owner,`UPDATE survey_items SET notes='detached' WHERE session_id='${s}'`);assert.equal(rev(b),2);
    asRole(owner,`UPDATE survey_sessions SET document_id='${a}',is_active=false WHERE id='${s}'`);assert.equal(rev(a),4);
    assert.equal(scalar(`SELECT notes FROM survey_items WHERE session_id='${s}'`),'detached');
  });
  await check('item cross-session moves count both documents; same-document sessions increment once',()=>{
    const a=doc(105),b=doc(106),s=survey(107,a),t=survey(108,b),u=survey(109,b);
    asRole(owner,item(s));asRole(owner,`UPDATE survey_items SET session_id='${t}' WHERE session_id='${s}'`);assert.equal(rev(a),3);assert.equal(rev(b),3);
    asRole(owner,`UPDATE survey_items SET session_id='${u}' WHERE session_id='${t}'`);assert.equal(rev(b),4);
  });
  await check('rollbacks and mixed upserts preserve exact committed event counts',()=>{
    const d=doc(110),s=survey(111,d);asRole(owner,item(s));
    asRole(owner,`BEGIN; UPDATE survey_sessions SET is_active=false WHERE id='${s}'; ${item(s,'rollback')} ROLLBACK;`);assert.equal(rev(d),2);
    errorState(asRole(owner,`BEGIN; ${item(s,'failed')} SELECT 1/0; COMMIT;`,'authenticated',false),'22012');assert.equal(rev(d),2);
    asRole(owner,item(s).replace(';',' ON CONFLICT(session_id,annotation_id) DO NOTHING;'));assert.equal(rev(d),2);
    asRole(owner,`INSERT INTO survey_items(session_id,annotation_id,module_id,category_id) VALUES('${s}','a','m','c'),('${s}','b','m','c') ON CONFLICT(session_id,annotation_id) DO UPDATE SET notes='updated'`);assert.equal(rev(d),4);
  });
  await check('real session ownership RLS stays intact; service writes count; private/truncate gates hold',()=>{
    const d=doc(112),s=survey(113,d);errorState(asRole(other,item(s),'authenticated',false),'42501');assert.equal(rev(d),1);
    asRole(null,item(s),'service_role');assert.equal(rev(d),2);
    for(const role of ['authenticated','service_role']){
      errorState(asRole(owner,'UPDATE survey_private.document_survey_revisions SET revision=0',role,false),'42501');
      for(const table of ['survey_items','survey_sessions'])errorState(asRole(owner,`TRUNCATE ${table} CASCADE`,role,false),'42501');
    }
    errorState(sql('TRUNCATE survey_items CASCADE',false),'42501');
    for(const statement of [item(s,'rr'),`UPDATE survey_sessions SET is_active=false WHERE id='${s}';`])errorState(asRole(owner,`BEGIN ISOLATION LEVEL REPEATABLE READ; ${statement} COMMIT;`,'authenticated',false),'25001');
    assert.equal(rev(d),2);
  });
  await check('session DELETE cascade preserves old document token with missing parent; document DELETE detaches',()=>{
    const a=doc(114),s=survey(115,a);asRole(owner,item(s));asRole(owner,`DELETE FROM survey_sessions WHERE id='${s}'`);
    assert.equal(rev(a),3);assert.equal(scalar(`SELECT count(*) FROM survey_items WHERE session_id='${s}'`),'0');
    const b=doc(116),t=survey(117,b);asRole(owner,item(t));sql(`DELETE FROM documents WHERE id='${b}'`);
    assert.equal(rev(b),3);assert.equal(scalar(`SELECT document_id IS NULL FROM survey_sessions WHERE id='${t}'`),'t');assert.equal(scalar(`SELECT count(*) FROM survey_items WHERE session_id='${t}'`),'1');
  });
  await check('item first blocks session rebind, then rebind succeeds and accounts on both docs',async()=>{
    const a=doc(118),b=doc(119),s=survey(120,a);const writer=session('item_first',{role:'authenticated',actorId:owner});
    writer.send(`${item(s)} SELECT 'held';`);await writer.wait('held');
    const mover=session('rebind_waiting',{role:'authenticated',actorId:owner});mover.send(`UPDATE survey_sessions SET document_id='${b}' WHERE id='${s}'; SELECT 'moved';`);await pg.blocked('rebind_waiting');
    assert.equal((await writer.finish()).status,0);await mover.wait('moved');assert.equal((await mover.finish()).status,0);assert.equal(rev(a),3);assert.equal(rev(b),1);
  });
  await check('session rebind first makes item write fail NOWAIT; fresh retry belongs to new doc',async()=>{
    const a=doc(121),b=doc(122),s=survey(123,a);const mover=session('rebind_first');mover.send(`UPDATE survey_sessions SET document_id='${b}' WHERE id='${s}';SELECT 'held';`);await mover.wait('held');
    errorState(asRole(owner,item(s),'authenticated',false),'55P03');assert.equal((await mover.finish()).status,0);asRole(owner,item(s));assert.equal(rev(a),2);assert.equal(rev(b),2);
  });
  await check('WAL first rejects both survey lanes; survey first makes WAL wait until commit',async()=>{
    const a=doc(124),s=survey(125,a);const wal=session('wal_first',{role:'authenticated',actorId:owner});wal.send(`${append(a)} SELECT 'held';`);await wal.wait('held');
    errorState(asRole(owner,item(s),'authenticated',false),'40001');errorState(asRole(owner,`UPDATE survey_sessions SET is_active=false WHERE id='${s}'`,'authenticated',false),'40001');assert.equal((await wal.finish()).status,0);
    const b=doc(126),t=survey(127,b);const writer=session('survey_first',{role:'authenticated',actorId:owner});writer.send(`${item(t)} SELECT 'held';`);await writer.wait('held');
    const waiting=session('wal_wait',{role:'authenticated',actorId:owner});waiting.send(`${append(b)} SELECT 'accepted';`);await pg.blocked('wal_wait');assert.equal((await writer.finish()).status,0);await waiting.wait('accepted');assert.equal((await waiting.finish()).status,0);assert.equal(rev(b),2);
  });
  await check('old and new sessions are both locked during item move; unrelated doc progresses',async()=>{
    const a=doc(128),b=doc(129),c=doc(130),s=survey(131,a),t=survey(132,b),u=survey(133,c);asRole(owner,item(s));
    for(const [index,held] of [s,t].entries()){
      const lock=session(`parent_session_${index}`);lock.send(`SELECT id FROM survey_sessions WHERE id='${held}' FOR UPDATE;SELECT 'held';`);await lock.wait('held');
      errorState(asRole(owner,`UPDATE survey_items SET session_id='${t}' WHERE session_id='${s}'`,'authenticated',false),'55P03');asRole(owner,item(u,`unrelated-${index}`));assert.equal((await lock.finish()).status,0);
    }
    assert.equal(rev(a),2);assert.equal(rev(b),1);assert.equal(rev(c),3);
  });
  await check('bulk session events and deletion keep per-document increments bounded',()=>{
    const a=doc(140),b=doc(141);
    asRole(owner,`INSERT INTO survey_sessions(template_id,user_id,document_id,is_active) SELECT '${template}','${owner}','${a}',false FROM generate_series(1,1000)`);assert.equal(rev(a),1);
    asRole(owner,`UPDATE survey_sessions SET document_id='${b}' WHERE document_id='${a}'`);assert.equal(rev(a),2);assert.equal(rev(b),1);
    asRole(owner,`DELETE FROM survey_sessions WHERE document_id='${b}'`);assert.equal(rev(b),2);
    for(const role of ['anon','authenticated','service_role']){
      assert.equal(scalar(`SELECT has_function_privilege('${role}','survey_private.lock_document_survey_revision()','EXECUTE')`),'f');
      assert.equal(scalar(`SELECT has_table_privilege('${role}','survey_private.document_survey_revisions','UPDATE')`),'f');
    }
  });
  await check('actual KAL48 restore rewrites survey-only snapshot and increments without annotation rows',()=>{
    sql(`CREATE TABLE document_annotations(id uuid,document_id uuid,created_at timestamptz);
      CREATE TABLE document_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid,revision_number integer,label text,origin text,created_by uuid,snapshot_json jsonb);`);
    for(const name of ['_kal48_can_access','kal48_create_revision','kal48_restore_revision'])sql(fn('20260522170000_kal48_inline_auth_checks.sql',name));
    const d=doc(134),s=survey(135,d),receipt=id(136),mark=id(137);asRole(owner,item(s));
    sql(`INSERT INTO document_revisions(id,document_id,revision_number,snapshot_json) VALUES('${receipt}','${d}',1,jsonb_build_object('annotations','[]'::jsonb,'survey_items',jsonb_build_array(jsonb_build_object('id','${mark}','session_id','${s}','annotation_id','restored','module_id','m','category_id','c','name','Restored','page_number',7))));`);
    asRole(owner,`BEGIN; SELECT kal48_restore_revision('${receipt}');ROLLBACK;`);assert.equal(rev(d),2);
    asRole(owner,`SELECT kal48_restore_revision('${receipt}')`);assert.equal(rev(d),4);assert.equal(scalar(`SELECT page_number FROM survey_items WHERE session_id='${s}'`),'7');assert.equal(scalar('SELECT count(*) FROM document_annotations'),'0');
  });
  console.log(JSON.stringify({checks,result:'passed',postgres:pg.version,scope:'tracked SQL survey tables/policies only; no provider or whole-document proof'}));
});
