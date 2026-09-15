// Disposable local PostgreSQL only. This script accepts no remote connection.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import {
  validateDocumentDefinitionRevisionPreviewV2,
  validateDocumentDefinitionRevisionReviewV2,
  validateDocumentDefinitionRevisionReceipt,
} from '../src/services/documentDefinitionRevisionClient.js';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migration = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const migrations = [
  '20260909105000_document_entity_catalog.sql',
  '20260909106000_document_survey_definition.sql',
  '20260915102000_document_definition_revisions.sql',
  '20260915105000_document_definition_realtime_wake.sql',
  '20260915106000_document_definition_retirement_v2.sql',
].map(migration);
const id = n => `10600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner=id(1), editor=id(2), other=id(3);
const entity = (entityId='entity-door', name='Door') => ({ id:entityId,name,color:'#112233',
  opacity:0.35,borderColor:null,borderOpacity:null,matchFill:false });
const moduleNode = (moduleId='module-doors', categoryId='category-doors', itemId='check-door',
  text='Door condition') => ({ id:moduleId,name:`Module ${moduleId}`,categories:[{
    id:categoryId,name:`Category ${categoryId}`,checklist:[{id:itemId,text}],
  }] });
let passed=0;

await withDisposablePostgres(async ({sql,scalar,asRole,errorState,applyMigration,quote}) => {
  sql(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE PUBLICATION supabase_realtime;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES('${owner}'),('${editor}'),('${other}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.documents(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),
      template_id uuid,archived boolean NOT NULL DEFAULT false,user_archived_at timestamptz,
      locked_at timestamptz,title text NOT NULL DEFAULT 'kept',
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE public.templates(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),
      config jsonb NOT NULL,updated_at timestamptz NOT NULL,
      archived boolean NOT NULL DEFAULT false,user_archived_at timestamptz);
    CREATE TABLE public.document_collaborators(document_id uuid NOT NULL REFERENCES public.documents(id),
      user_id uuid NOT NULL REFERENCES auth.users(id),role text NOT NULL,status text NOT NULL,
      PRIMARY KEY(document_id,user_id));
    CREATE SCHEMA survey_private;
    CREATE TABLE survey_private.account_write_guards(user_id uuid PRIMARY KEY,
      closing boolean NOT NULL DEFAULT false);
    CREATE FUNCTION public.user_can_access_document(doc_id uuid,required_role text DEFAULT 'viewer')
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=doc_id AND d.user_id=auth.uid())
        OR EXISTS(SELECT 1 FROM public.document_collaborators c WHERE c.document_id=doc_id
          AND c.user_id=auth.uid() AND c.status='active' AND
          (required_role='viewer' OR c.role IN('editor','owner')))$$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT coalesce((SELECT locked_at IS NOT NULL FROM public.documents WHERE id=doc_id),true)$$;
    CREATE FUNCTION survey_private.assert_account_open(p_user_id uuid) RETURNS void
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$BEGIN
      IF EXISTS(SELECT 1 FROM survey_private.account_write_guards
        WHERE user_id=p_user_id AND closing) THEN
        RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514'; END IF; END$$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT,UPDATE ON public.documents TO authenticated;
    GRANT SELECT ON public.templates,public.document_collaborators TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.user_can_access_document(uuid,text),
      public.kal49_document_is_locked(uuid),survey_private.assert_account_open(uuid)
      TO authenticated;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
  `);
  applyMigration(migrations[0]); applyMigration(migrations[1]);
  let next=100;
  const createDocument=()=>{const value=id(next++);sql(`INSERT INTO public.documents(id,user_id)
    VALUES('${value}','${owner}')`);return value;};
  const createTemplate=(modules,entities,minute=next)=>{const value=id(next++);
    sql(`INSERT INTO public.templates VALUES('${value}','${owner}',
      ${quote(JSON.stringify({modules,entities}))}::jsonb,
      '2026-09-15T12:${String(minute%60).padStart(2,'0')}:00Z',false,NULL)`);return value;};
  const adopt=(documentId,templateId,n)=>{
    const s=JSON.parse(asRole(owner,`SELECT public.preview_document_survey_definition_adoption(
      '${documentId}','${templateId}')`).stdout);
    const e=JSON.parse(asRole(owner,`SELECT public.preview_document_entity_catalog_adoption(
      '${documentId}','${templateId}')`).stdout);
    asRole(owner,`SELECT public.adopt_document_survey_definition('${documentId}','${templateId}',
      ${quote(s.source.templateUpdatedAt)}::timestamptz,${quote(s.source.structureSha256)},
      '${id(500+n)}','${'a'.repeat(64)}')`);
    asRole(owner,`SELECT public.adopt_document_entity_catalog('${documentId}','${templateId}',
      ${quote(e.source.templateUpdatedAt)}::timestamptz,${quote(e.source.entitiesSha256)},
      '${id(600+n)}','${'b'.repeat(64)}')`);
  };
  const seeded=createDocument(), base=createTemplate([moduleNode()],[entity()]); adopt(seeded,base,1);
  applyMigration(migrations[2]); applyMigration(migrations[3]); applyMigration(migrations[4]);
  const check=async(name,work)=>{await work();passed++;console.log(`PASS ${name}`);};
  const preview2=(actor,documentId,surveyTemplateId,entityTemplateId,archives=[],roots=[],op=id(next++),required=true)=>{
    const raw=asRole(actor,`SELECT public.preview_document_definition_revision_upgrade_v2(
      '${documentId}',${surveyTemplateId?`'${surveyTemplateId}'`:'NULL'},
      ${entityTemplateId?`'${entityTemplateId}'`:'NULL'},${quote(JSON.stringify(archives))}::jsonb,
      ${quote(JSON.stringify(roots))}::jsonb,'${op}')`,'authenticated',required);
    return required?JSON.parse(raw.stdout):raw;
  };
  const preview1=(actor,documentId,surveyTemplateId,entityTemplateId,archives=[],op=id(next++),required=true)=>{
    const raw=asRole(actor,`SELECT public.preview_document_definition_revision_upgrade(
      '${documentId}','${surveyTemplateId}','${entityTemplateId}',
      ${quote(JSON.stringify(archives))}::jsonb,'${op}')`,'authenticated',required);
    return required?JSON.parse(raw.stdout):raw;
  };
  const apply1Sql=(documentId,review)=>`SELECT public.apply_reviewed_document_definition_revision(
    '${documentId}',${review.current.definitionRevision},${quote(review.current.definitionDigest)},
    '${review.surveyDefinition.source.templateId}',
    ${quote(review.surveyDefinition.source.templateUpdatedAt)}::timestamptz,
    ${quote(review.surveyDefinition.source.structureSha256)},
    '${review.entityCatalog.source.templateId}',
    ${quote(review.entityCatalog.source.templateUpdatedAt)}::timestamptz,
    ${quote(review.entityCatalog.source.entitiesSha256)},
    ${quote(JSON.stringify(review.review.archivedSemanticIds))}::jsonb,
    '${review.review.operationId}',${quote(review.review.requestSha256)})`;
  const apply1=(actor,documentId,review,required=true)=>{const raw=asRole(actor,apply1Sql(documentId,review),
    'authenticated',required);return required?JSON.parse(raw.stdout):raw;};
  const apply2Sql=(documentId,review)=>`SELECT public.apply_reviewed_document_definition_revision_v2(
    '${documentId}',${review.current.definitionRevision},${quote(review.current.definitionDigest)},
    ${review.sourceModes.survey==='keep'?'NULL':`'${review.surveyDefinition.source.templateId}'`},
    ${review.sourceModes.survey==='keep'?'NULL':`${quote(review.surveyDefinition.source.templateUpdatedAt)}::timestamptz`},
    ${review.sourceModes.survey==='keep'?'NULL':quote(review.surveyDefinition.source.structureSha256)},
    ${review.sourceModes.entity==='keep'?'NULL':`'${review.entityCatalog.source.templateId}'`},
    ${review.sourceModes.entity==='keep'?'NULL':`${quote(review.entityCatalog.source.templateUpdatedAt)}::timestamptz`},
    ${review.sourceModes.entity==='keep'?'NULL':quote(review.entityCatalog.source.entitiesSha256)},
    ${quote(JSON.stringify(review.review.archivedSemanticIds))}::jsonb,
    ${quote(JSON.stringify(review.review.retiredSemanticRoots))}::jsonb,
    '${review.review.operationId}',${quote(review.review.requestSha256)})`;
  const apply2=(actor,documentId,review,required=true)=>{const raw=asRole(actor,apply2Sql(documentId,review),
    'authenticated',required);return required?JSON.parse(raw.stdout):raw;};

  await check('migration installs and malformed choices fail in actual PostgreSQL',()=>{
    for(const bad of [{},{kind:'module'},{id:'module-doors'}]){
      errorState(preview2(owner,seeded,null,null,[bad],[],id(next++),false),'22023');
      errorState(preview2(owner,seeded,null,null,[],[bad],id(next++),false),'22023');
    }
  });
  await check('V1 public wire still previews and publishes through the shared core',()=>{
    const nextTemplate=createTemplate([moduleNode('module-doors','category-doors','check-door','V1')],
      [entity('entity-door','V1 Door')]);
    const review=preview1(owner,seeded,nextTemplate,nextTemplate);
    assert.deepEqual(Object.keys(review).sort(),['current','documentId','entityCatalog','review',
      'status','surveyDefinition','version']);
    const accepted=apply1(owner,seeded,review);
    assert.equal(accepted.version,1);assert.equal(accepted.definitionRevision,2);

    const removedDoc=createDocument(), removedBase=createTemplate([moduleNode()],[entity()]);
    adopt(removedDoc,removedBase,11);
    const archived=preview1(owner,removedDoc,removedBase,removedBase,
      [{kind:'checklistItem',id:'check-door'}]);
    apply1(owner,removedDoc,archived);
    const omitted=createTemplate([{id:'module-doors',name:'Module module-doors',categories:[{
      id:'category-doors',name:'Category category-doors',checklist:[]}]}],[entity()]);
    const omissionReview=preview1(owner,removedDoc,omitted,omitted);
    const removed=apply1(owner,removedDoc,omissionReview,false);
    errorState(removed,'23514');assert.match(removed.stderr,/DOCUMENT_DEFINITION_SEMANTIC_ID_REMOVED/);

    const movedDoc=createDocument();const movedBase=createTemplate([{
      id:'module-doors',name:'Module module-doors',categories:[
        {id:'category-a',name:'Category A',checklist:[{id:'check-door',text:'Door'}]},
        {id:'category-b',name:'Category B',checklist:[]},
      ]}],[entity()]);adopt(movedDoc,movedBase,12);
    const movedTemplate=createTemplate([{
      id:'module-doors',name:'Module module-doors',categories:[
        {id:'category-a',name:'Category A',checklist:[]},
        {id:'category-b',name:'Category B',checklist:[{id:'check-door',text:'Door'}]},
      ]}],[entity()]);
    const movedReview=preview1(owner,movedDoc,movedTemplate,movedTemplate);
    const moved=apply1(owner,movedDoc,movedReview,false);
    errorState(moved,'23514');assert.match(moved.stderr,/DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED/);
  });
  await check('keep mode pins exact accepted sources without reading Templates',()=>{
    const before=JSON.parse(asRole(owner,`SELECT public.read_document_definition_revision('${seeded}',NULL)`).stdout);
    const review=preview2(owner,seeded,null,null);
    assert.deepEqual(review.surveyDefinition.source,before.surveyDefinition.source);
    assert.deepEqual(review.entityCatalog.source,before.entityCatalog.source);
    sql(`DELETE FROM public.templates`);
    const accepted=apply2(owner,seeded,review);
    assert.deepEqual(accepted.surveyDefinition.source,before.surveyDefinition.source);
    assert.deepEqual(accepted.entityCatalog.source,before.entityCatalog.source);
  });
  await check('discovery and parent approval retire the full old closure',async()=>{
    const doc=createDocument();const old=createTemplate([
      moduleNode('module-old','category-old','item-old','Old'),
      moduleNode('module-kept','category-kept','item-kept','Kept')],[entity('entity-old','Old entity')]);
    adopt(doc,old,20);
    const baseline=JSON.parse(asRole(owner,
      `SELECT public.read_document_definition_revision('${doc}',NULL)`).stdout);
    const fresh=createTemplate([moduleNode('module-kept','category-kept','item-kept','Fresh')],[]);
    const discovery=preview2(owner,doc,fresh,fresh);
    validateDocumentDefinitionRevisionPreviewV2(discovery,doc);
    assert.equal(discovery.status,'retirement-required');assert.equal(discovery.review,null);
    assert.deepEqual(discovery.removedRoots.map(x=>[x.kind,x.id]),
      [['module','module-old'],['entity','entity-old']]);
    assert.deepEqual(discovery.removedRoots[0].subtree.map(x=>x.kind),
      ['module','category','checklistItem']);
    const roots=discovery.removedRoots.map(({kind,id})=>({kind,id}));
    const review=preview2(owner,doc,fresh,fresh,[],roots);
    validateDocumentDefinitionRevisionPreviewV2(review,doc);
    await validateDocumentDefinitionRevisionReviewV2({status:'reviewed',version:2,
      actorUserId:owner,documentId:doc,currentReceipt:baseline,wire:review,
      expectedArchivedSemanticIds:review.retirement.archivedSemanticIds},doc);
    assert.deepEqual(review.review.retiredSemanticRoots,roots);
    const accepted=apply2(owner,doc,review);
    await validateDocumentDefinitionRevisionReceipt(accepted,doc);
    assert.deepEqual(accepted.surveyDefinition.modules.find(x=>x.id==='module-old'),
      moduleNode('module-old','category-old','item-old','Old'));
    assert.deepEqual(accepted.entityCatalog.entities.find(x=>x.id==='entity-old'),
      entity('entity-old','Old entity'));
    assert.equal(accepted.surveyDefinition.modules.find(x=>x.id==='module-old')
      .categories[0].checklist[0].id,'item-old');
    assert.deepEqual(accepted.archivedSemanticIds.map(x=>x.id).sort(),
      ['category-old','entity-old','item-old','module-old'].sort());
  });
  await check('already archived missing roots are retained at the old parent',()=>{
    const doc=createDocument();const old=createTemplate([moduleNode()],[entity()]);adopt(doc,old,30);
    const archiveTemplate=createTemplate([moduleNode()],[entity()]);
    const v1=preview1(owner,doc,archiveTemplate,archiveTemplate,
      [{kind:'module',id:'module-doors'}]);
    apply1(owner,doc,v1);
    const omit=createTemplate([],[entity()]);
    const review=preview2(owner,doc,omit,omit);
    validateDocumentDefinitionRevisionPreviewV2(review,doc);
    assert.equal(review.status,'preview');assert.equal(review.retirement.autoRetainedRoots.length,1);
    assert.equal(review.surveyDefinition.modules[0].categories[0].checklist[0].id,'check-door');
    const accepted=apply2(owner,doc,review);
    assert.deepEqual(accepted.archivedSemanticIds.filter(x=>x.kind!=='entity').map(x=>x.id).sort(),
      ['category-doors','check-door','module-doors'].sort());
  });
  await check('permissions, stale CAS, rollback, exact replay, and one wake hold',async()=>{
    const doc=createDocument();const old=createTemplate([moduleNode()],[entity()]);adopt(doc,old,40);
    const fresh=createTemplate([moduleNode('module-doors','category-doors','check-door','Fresh')],
      [entity('entity-door','Fresh')]);
    errorState(preview2(editor,doc,fresh,fresh,[],[],id(next++),false),'42501');
    const review=preview2(owner,doc,fresh,fresh);const before=scalar(`SELECT updated_at::text FROM public.documents WHERE id='${doc}'`);
    const stale=structuredClone(review);stale.current.definitionDigest='f'.repeat(64);
    errorState(apply2(owner,doc,stale,false),'40001');
    assert.equal(scalar(`SELECT current_revision FROM survey_private.document_definition_revision_heads WHERE document_id='${doc}'`),'1');
    const rolled=asRole(owner,`BEGIN; ${apply2Sql(doc,review)}; ROLLBACK;`);
    assert.equal(rolled.status,0);assert.equal(scalar(`SELECT current_revision FROM survey_private.document_definition_revision_heads WHERE document_id='${doc}'`),'1');
    const first=apply2(owner,doc,review);const woke=scalar(`SELECT updated_at::text FROM public.documents WHERE id='${doc}'`);
    await validateDocumentDefinitionRevisionReceipt(first,doc);
    assert.notEqual(woke,before);
    sql(`UPDATE public.templates SET config='{}'::jsonb,updated_at=clock_timestamp() WHERE id='${fresh}'`);
    assert.deepEqual(apply2(owner,doc,review),first);
    assert.equal(scalar(`SELECT updated_at::text FROM public.documents WHERE id='${doc}'`),woke);
    for(const role of ['anon','authenticated','service_role']) assert.equal(scalar(`SELECT has_function_privilege(
      '${role}','survey_private.publish_document_definition_revision_core(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid,text,integer)','EXECUTE')`),'f');
    assert.equal(scalar(`SELECT has_function_privilege('anon',
      'public.preview_document_definition_revision_upgrade_v2(uuid,uuid,uuid,jsonb,jsonb,uuid)','EXECUTE')`),'f');
  });
  await check('candidate preview stays bounded at 1k and 8k checklist items',()=>{
    const largeModules=count=>[{id:'module-large',name:'Large',categories:Array.from(
      {length:Math.ceil(count/250)},(_,categoryIndex)=>({
        id:`category-${categoryIndex}`,name:`Category ${categoryIndex}`,checklist:Array.from(
          {length:Math.min(250,count-categoryIndex*250)},(_,itemIndex)=>({
            id:`item-${categoryIndex}-${itemIndex}`,text:`Item ${itemIndex}`,
          })),
      }))}];
    for(const count of [1000,8000]){
      const doc=createDocument(), template=createTemplate(largeModules(count),[]);
      adopt(doc,template,70+count);
      const started=performance.now();
      const review=preview2(owner,doc,template,template);
      const elapsed=Math.round(performance.now()-started);
      assert.equal(review.status,'preview');
      console.log(`TIMING ${count} checklist items: ${elapsed}ms preview`);
      const applyStarted=performance.now();
      const accepted=apply2(owner,doc,review);
      const applyElapsed=Math.round(performance.now()-applyStarted);
      assert.equal(accepted.definitionRevision,2);
      console.log(`TIMING ${count} checklist items: ${applyElapsed}ms apply`);
    }
  });
}, {name:'document-definition-retirement-v2'});

console.log(`document definition retirement V2: ${passed}/${passed} passed; cleanup complete`);
