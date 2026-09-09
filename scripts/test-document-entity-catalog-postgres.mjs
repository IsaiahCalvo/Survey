// Disposable local PostgreSQL only. This script accepts no remote connection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migration = fileURLToPath(new URL('../supabase/migrations/20260909105000_document_entity_catalog.sql', import.meta.url));
const id = n => `10500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4);
const hash = character => character.repeat(64);
const entity = (entityId = 'e-one', name = 'General Contractor', color = '#AABBCC') => ({
  id: entityId, name, color, opacity: 0.123456789,
  borderColor: '#123', borderOpacity: 0.765432198, matchFill: false,
});
let count = 0;

await withDisposablePostgres(async ({ sql, scalar, asRole, errorState, session, blocked, applyMigration, quote }) => {
  sql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${owner}'),('${editor}'),('${viewer}'),('${other}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.documents(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
      template_id uuid, archived boolean NOT NULL DEFAULT false,
      user_archived_at timestamptz, locked_at timestamptz);
    CREATE TABLE public.templates(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
      config jsonb NOT NULL, updated_at timestamptz NOT NULL,
      user_archived_at timestamptz);
    CREATE TABLE public.document_collaborators(
      document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id), role text NOT NULL,
      status text NOT NULL, PRIMARY KEY(document_id,user_id));
    CREATE TABLE public.document_annotations(
      id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      entity_id text, entity_name text, color text);
    CREATE SCHEMA survey_private;
    CREATE TABLE survey_private.account_write_guards(user_id uuid PRIMARY KEY,closing boolean NOT NULL DEFAULT false);
    CREATE FUNCTION public.user_can_access_document(doc_id uuid,required_role text DEFAULT 'viewer')
    RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
    DECLARE owner_id uuid; member_role text;
    BEGIN
      SELECT d.user_id INTO owner_id FROM public.documents d
        WHERE d.id=doc_id AND d.archived=false AND d.user_archived_at IS NULL;
      IF owner_id IS NULL THEN RETURN false;END IF;
      IF owner_id=auth.uid() THEN RETURN true;END IF;
      SELECT c.role INTO member_role FROM public.document_collaborators c
        WHERE c.document_id=doc_id AND c.user_id=auth.uid() AND c.status='active';
      RETURN CASE required_role WHEN 'viewer' THEN member_role IN('viewer','editor','owner')
        WHEN 'editor' THEN member_role IN('editor','owner') WHEN 'owner' THEN member_role='owner' ELSE false END;
    END $$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$SELECT coalesce((SELECT d.locked_at IS NOT NULL FROM public.documents d WHERE d.id=doc_id),true)$$;
    CREATE FUNCTION survey_private.assert_account_open(p_user_id uuid) RETURNS void
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
    DECLARE is_closing boolean;
    BEGIN
      IF p_user_id IS NULL THEN RAISE EXCEPTION 'Account owner is required' USING ERRCODE='23502';END IF;
      INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(p_user_id,false) ON CONFLICT(user_id) DO NOTHING;
      SELECT closing INTO is_closing FROM survey_private.account_write_guards WHERE user_id=p_user_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Account guard is unavailable' USING ERRCODE='40001';END IF;
      IF is_closing THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514';END IF;
    END$$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT ON public.documents,public.templates,public.document_collaborators TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.user_can_access_document(uuid,text),
      public.kal49_document_is_locked(uuid) TO authenticated;
  `);
  applyMigration(migration);

  const createDocument = (n, actor = owner, templateId = null) => {
    const documentId = id(100 + n);
    sql(`INSERT INTO public.documents(id,user_id,template_id) VALUES('${documentId}','${actor}',${quote(templateId)})`);
    return documentId;
  };
  const createTemplate = (n, entities, actor = owner, updatedAt = `2026-09-09T12:${String(n).padStart(2, '0')}:00Z`) => {
    const templateId = id(200 + n);
    sql(`INSERT INTO public.templates(id,user_id,config,updated_at) VALUES('${templateId}','${actor}',${quote(JSON.stringify({ entities }))}::jsonb,${quote(updatedAt)})`);
    return templateId;
  };
  const preview = (actor, documentId, templateId) => JSON.parse(asRole(actor,
    `SELECT public.preview_document_entity_catalog_adoption('${documentId}','${templateId}')`).stdout);
  const adoptSql = (documentId, templateId, source, operationId, requestHash = hash('b')) =>
    `SELECT public.adopt_document_entity_catalog('${documentId}','${templateId}',${quote(source.templateUpdatedAt)}::timestamptz,${quote(source.entitiesSha256)},'${operationId}',${quote(requestHash)})`;
  const adopt = (actor, documentId, templateId, source, operationId, requestHash) =>
    JSON.parse(asRole(actor, adoptSql(documentId, templateId, source, operationId, requestHash)).stdout);
  const read = (actor, documentId) => JSON.parse(asRole(actor,
    `SELECT public.read_document_entity_catalog('${documentId}')`).stdout);
  const check = async (name, work) => { await work(); count++; console.log(`PASS ${name}`); };

  await check('preview and adoption preserve the exact rich normalized Entity receipt', () => {
    const documentId = createDocument(1), templateId = createTemplate(1, [entity()]);
    const p = preview(owner, documentId, templateId);
    assert.deepEqual(Object.keys(p).sort(), ['documentId','entities','source','status','version']);
    assert.equal(p.status, 'preview');
    assert.deepEqual(p.entities, [{ id:'e-one', name:'General Contractor', color:'#aabbcc',
      opacity:0.123456789, borderColor:'#112233', borderOpacity:0.765432198, matchFill:false }]);
    const accepted = adopt(owner, documentId, templateId, p.source, id(301), hash('a'));
    assert.deepEqual(Object.keys(accepted).sort(), ['catalogRevision','documentId','entities','seed','source','status','version']);
    assert.equal(accepted.status, 'accepted'); assert.equal(accepted.catalogRevision, 1);
    assert.deepEqual(accepted.entities, p.entities);
    assert.deepEqual(accepted.seed, { operationId:id(301), requestSha256:hash('a') });
    assert.equal(read(owner, documentId).source.entitiesSha256, p.source.entitiesSha256);
    assert.equal(scalar(`SELECT template_id FROM public.documents WHERE id='${documentId}'`), templateId);
    console.log(`ENTITY_CATALOG_CONTRACT ${JSON.stringify(accepted)}`);
  });

  await check('legacy style omissions and role names get deterministic current defaults', () => {
    const documentId = createDocument(2), templateId = createTemplate(2,
      [{ id:'legacy', role:'Subcontractor', color:'rgb(1, 2, 255)' }, { id:'missing-color', name:'Owner' }]);
    const p = preview(owner, documentId, templateId);
    assert.deepEqual(p.entities, [
      {id:'legacy',name:'Subcontractor',color:'#0102ff',opacity:0.35,borderColor:null,borderOpacity:null,matchFill:false},
      {id:'missing-color',name:'Owner',color:'#8c8c8a',opacity:0.35,borderColor:null,borderOpacity:null,matchFill:false},
    ]);
  });

  await check('unadopted old documents never infer a catalog from mutable template_id', () => {
    const templateId = createTemplate(3, [entity('old','Old')]);
    const documentId = createDocument(3, owner, templateId);
    assert.deepEqual(read(owner, documentId), {status:'unadopted',version:1,documentId});
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_entity_catalogs WHERE document_id='${documentId}'`), '0');
  });

  await check('members read accepted truth, while editors and foreign users cannot adopt', () => {
    const documentId = createDocument(4), templateId = createTemplate(4, [entity()]);
    sql(`INSERT INTO public.document_collaborators VALUES('${documentId}','${viewer}','viewer','active'),('${documentId}','${editor}','editor','active')`);
    const p = preview(owner, documentId, templateId);
    for (const actor of [editor, viewer, other])
      errorState(asRole(actor, adoptSql(documentId, templateId, p.source, id(actor === editor ? 304 : actor === viewer ? 305 : 306)), 'authenticated', false), '42501');
    adopt(owner, documentId, templateId, p.source, id(307));
    assert.equal(read(viewer, documentId).status, 'accepted');
    assert.equal(read(editor, documentId).status, 'accepted');
    errorState(asRole(other, `SELECT public.read_document_entity_catalog('${documentId}')`, 'authenticated', false), '42501');
    sql(`UPDATE public.document_collaborators SET status='revoked' WHERE document_id='${documentId}' AND user_id='${viewer}'`);
    errorState(asRole(viewer, `SELECT public.read_document_entity_catalog('${documentId}')`, 'authenticated', false), '42501');
  });

  await check('stale timestamp or reviewed digest cannot seed changed template content', () => {
    const documentId = createDocument(5), templateId = createTemplate(5, [entity()]);
    const p = preview(owner, documentId, templateId);
    sql(`UPDATE public.templates SET config='${JSON.stringify({entities:[entity('changed','Changed')]})}'::jsonb,
      updated_at='2026-09-10T00:00:00Z' WHERE id='${templateId}'`);
    errorState(asRole(owner, adoptSql(documentId, templateId, p.source, id(308)), 'authenticated', false), '40001');
    const fresh = preview(owner, documentId, templateId);
    errorState(asRole(owner, adoptSql(documentId, templateId,
      {...fresh.source, entitiesSha256:p.source.entitiesSha256}, id(309)), 'authenticated', false), '40001');
  });

  await check('duplicate IDs, normalized names, malformed fields, and oversize lists fail closed', () => {
    const cases = [
      [entity('same','A'),entity('same','B')],
      [entity('one','A\t B'),entity('two','a b')],
      [{id:'bad',name:'Bad',color:'#fff',opacity:2}],
      [{id:'bad',name:'Bad',color:'#fff',unknown:true}],
      Array.from({length:257},(_,index)=>entity(`e-${index}`,`Entity ${index}`)),
    ];
    cases.forEach((entities,index) => {
      const documentId=createDocument(20+index),templateId=createTemplate(20+index,entities);
      const state = index === 0 || index === 1 ? '23505' : index === 4 ? '54000' : '22023';
      errorState(asRole(owner,`SELECT public.preview_document_entity_catalog_adoption('${documentId}','${templateId}')`,'authenticated',false),state);
    });
  });

  await check('the server-owned name key has stable cross-runtime Unicode and ASCII rules', () => {
    const key = value => scalar(`SELECT survey_private.document_entity_name_key(${quote(value)})`);
    assert.equal(key('  A\t\nB  '), 'a b');
    assert.equal(key('I İ Σ σ'), 'i İ Σ σ');
    assert.equal(key(`A\u00a0B`), `a\u00a0b`);
    assert.equal(key('Cafe\u0301'), key('Café'));
    assert.notEqual(key('Σ'), key('σ'));
  });

  await check('same exact seed replays one receipt and every different reseed conflicts', () => {
    const documentId=createDocument(6),templateId=createTemplate(6,[entity()]),p=preview(owner,documentId,templateId);
    const first=adopt(owner,documentId,templateId,p.source,id(310),hash('c'));
    assert.deepEqual(adopt(owner,documentId,templateId,p.source,id(310),hash('c')),first);
    errorState(asRole(owner,adoptSql(documentId,templateId,p.source,id(310),hash('d')),'authenticated',false),'23505');
    errorState(asRole(owner,adoptSql(documentId,templateId,p.source,id(311),hash('c')),'authenticated',false),'23505');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_entity_catalogs WHERE document_id='${documentId}'`),'1');
  });

  await check('template edits and deletion never mutate an accepted document list', () => {
    const documentId=createDocument(7),templateId=createTemplate(7,[entity('fixed','Fixed','#010203')]),p=preview(owner,documentId,templateId);
    const accepted=adopt(owner,documentId,templateId,p.source,id(312));
    sql(`UPDATE public.templates SET config='{"entities":[]}',updated_at='2026-09-11' WHERE id='${templateId}';DELETE FROM public.templates WHERE id='${templateId}'`);
    assert.deepEqual(read(owner,documentId),accepted);
  });

  await check('existing Survey Marker assignment snapshots are unchanged by adoption', () => {
    const documentId=createDocument(8),templateId=createTemplate(8,[entity('current','Current','#111111')]),marker=id(400);
    sql(`INSERT INTO public.document_annotations VALUES('${marker}','${documentId}','old-id','Old Name','#abcdef')`);
    const before=scalar(`SELECT row_to_json(a) FROM public.document_annotations a WHERE id='${marker}'`);
    const p=preview(owner,documentId,templateId);adopt(owner,documentId,templateId,p.source,id(313));
    assert.equal(scalar(`SELECT row_to_json(a) FROM public.document_annotations a WHERE id='${marker}'`),before);
  });

  await check('locked and closing accounts cannot preview, adopt, or read catalogs', () => {
    const locked=createDocument(9),templateId=createTemplate(9,[entity()]);
    sql(`UPDATE public.documents SET locked_at=now() WHERE id='${locked}'`);
    errorState(asRole(owner,`SELECT public.preview_document_entity_catalog_adoption('${locked}','${templateId}')`,'authenticated',false),'42501');
    const documentId=createDocument(10),p=preview(owner,documentId,templateId);
    sql(`INSERT INTO survey_private.account_write_guards VALUES('${owner}',true) ON CONFLICT(user_id) DO UPDATE SET closing=true`);
    errorState(asRole(owner,`SELECT public.preview_document_entity_catalog_adoption('${documentId}','${templateId}')`,'authenticated',false),'42501');
    errorState(asRole(owner,adoptSql(documentId,templateId,p.source,id(314)),'authenticated',false),'23514');
    errorState(asRole(owner,`SELECT public.read_document_entity_catalog('${documentId}')`,'authenticated',false),'42501');
    sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${owner}'`);
  });

  await check('document deletion cascades catalogs without binding template lifetime', () => {
    const documentId=createDocument(11),templateId=createTemplate(11,[entity()]),p=preview(owner,documentId,templateId);
    adopt(owner,documentId,templateId,p.source,id(315));
    sql(`DELETE FROM public.documents WHERE id='${documentId}'`);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_entity_catalogs WHERE document_id='${documentId}'`),'0');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_entity_definitions WHERE document_id='${documentId}'`),'0');
    assert.equal(scalar(`SELECT count(*) FROM public.templates WHERE id='${templateId}'`),'1');
  });

  await check('private storage and mutation stay unavailable to app and service roles', () => {
    for (const role of ['authenticated','service_role']) {
      errorState(asRole(owner,'SELECT * FROM survey_private.document_entity_catalogs',role,false),'42501');
      errorState(asRole(owner,'TRUNCATE survey_private.document_entity_definitions',role,false),'42501');
    }
    errorState(asRole(owner,`SELECT public.adopt_document_entity_catalog(NULL,NULL,NULL,NULL,NULL,NULL)`,'authenticated',false),'22023');
    errorState(asRole(null,`SELECT public.read_document_entity_catalog('${id(999)}')`,'service_role',false),'42501');
    assert.equal(scalar(`SELECT count(*) FROM information_schema.role_routine_grants WHERE routine_schema='public'
      AND routine_name IN('preview_document_entity_catalog_adoption','adopt_document_entity_catalog','read_document_entity_catalog')
      AND grantee='authenticated'`),'3');
  });

  await check('concurrent different adoptions serialize and only one immutable seed wins', async () => {
    const documentId=createDocument(12),firstTemplate=createTemplate(12,[entity('one','One')]),secondTemplate=createTemplate(13,[entity('two','Two')]);
    const firstPreview=preview(owner,documentId,firstTemplate),secondPreview=preview(owner,documentId,secondTemplate);
    const first=session('entity-seed-first',{role:'authenticated',actorId:owner});
    first.send(`${adoptSql(documentId,firstTemplate,firstPreview.source,id(316),hash('e'))};SELECT 'first-seed-held';`);
    await first.wait('first-seed-held');
    const second=session('entity-seed-second',{role:'authenticated',actorId:owner});
    second.send(`${adoptSql(documentId,secondTemplate,secondPreview.source,id(317),hash('f'))};`);
    await blocked('entity-seed-second');
    assert.equal((await first.finish(true)).status,0);
    const loser=await second.finish(true);assert.notEqual(loser.status,0);assert.match(loser.stderr,/23505:/);
    assert.equal(read(owner,documentId).source.templateId,firstTemplate);
  });

  await check('adoption holds the tracked account-open lock until its transaction settles', async () => {
    const documentId=createDocument(14),templateId=createTemplate(14,[entity()]),p=preview(owner,documentId,templateId);
    const seed=session('entity-seed-account-lock',{role:'authenticated',actorId:owner});
    seed.send(`${adoptSql(documentId,templateId,p.source,id(318),hash('9'))};SELECT 'account-lock-held';`);
    await seed.wait('account-lock-held');
    const closing=session('entity-seed-account-closing',{role:'postgres'});
    closing.send(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${owner}';`);
    await blocked('entity-seed-account-closing');
    assert.equal((await seed.finish(true)).status,0);
    assert.equal((await closing.finish(true)).status,0);
    assert.equal(scalar(`SELECT closing FROM survey_private.account_write_guards WHERE user_id='${owner}'`),'t');
    sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${owner}'`);
  });

}, { name: 'document-entity-catalog' });

// withDisposablePostgres returns only after its owned server is stopped and its
// exact temporary directory is removed.
console.log(`document entity catalog: ${count}/${count} passed; cleanup complete`);
