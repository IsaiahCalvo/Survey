// Installed, disposable PostgreSQL only. No hosted provider, account or secret.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import * as Y from 'yjs';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
import {syncByPageToDoc,syncSurveyMarkersToDoc} from '../src/services/annotationDocStore.js';
import {mapSurveyMarkerRowToLocalAnnotation} from '../src/services/documentSurveyMarkerMapper.js';
import {createDocumentReplacementExecutor} from '../src/services/documentReplacementExecutor.js';

assert.equal(process.argv.length,2,'This local fixture accepts no arguments');
const migrationPath=name=>fileURLToPath(new URL(`../supabase/migrations/${name}`,import.meta.url));
const source=name=>readFileSync(migrationPath(name),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5);
const objectVersion=id(9),hash=value=>createHash('sha256').update(value).digest('hex');
const pdfDocument=await PDFDocument.create();for(let i=0;i<3;i++)pdfDocument.addPage([612,792]);const originalPdf=await pdfDocument.save();

await withDisposablePostgres(async pg=>{
 const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
 const prior=readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url),'utf8');
 const a=prior.indexOf('  const prior='),b=prior.indexOf('  const doc=');assert.ok(a>=0&&b>a);
 new Function('sql','applyMigration','migrationPath','readFileSync','source','fn','owner','editor','viewer','other','project','assert',
  prior.slice(a,b).replaceAll("'import.meta.url'","'__KEEP_IMPORT_META__'")
   .replaceAll('import.meta.url',JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url).href))
   .replaceAll('__KEEP_IMPORT_META__','import.meta.url'))
  (sql,applyMigration,migrationPath,readFileSync,source,fn,owner,editor,viewer,other,project,assert);
 for(const name of ['20260909092000_document_generation_source_receipts.sql','20260909093000_document_generation_source_bytes.sql',
  '20260909094000_document_generation_source_bound_uploads.sql','20260909095000_document_generation_source_archives.sql',
  '20260909096000_document_generation_transform_source.sql','20260909097000_document_generation_retention.sql'])applyMigration(migrationPath(name));
 applyMigration(migrationPath('20260425121704_extend_document_annotations_for_all_types.sql'));
 const timestamp=source('20241230000002_create_document_annotations.sql');
 sql(timestamp.slice(timestamp.indexOf('CREATE OR REPLACE FUNCTION update_document_tables_updated_at()'),timestamp.indexOf('CREATE TRIGGER trigger_update_document_collaborators_updated_at')));
 sql(source('20260518000000_rename_ball_in_court_to_entity.sql').split('\n').filter(line=>line.startsWith('ALTER TABLE document_annotations RENAME COLUMN')).join('\n'));
 applyMigration(migrationPath('20260518000001_survey_marker_widen_type_check.sql'));
 applyMigration(migrationPath('20260603130000_db_sync_annotations_changed_at.sql'));
 applyMigration(migrationPath('20260909098000_document_generation_publication.sql'));
 applyMigration(migrationPath('20260909099000_document_generation_open.sql'));
 const roleDefinition=fn('20260802000000_kal426_user_archive_foundation.sql','get_my_document_role');sql(roleDefinition);
 applyMigration(migrationPath('20260909100000_document_generation_collaboration.sql'));
 applyMigration(migrationPath('20260909103000_document_generation_replacement_requests.sql'));
 const identityMigration=source('20260606120000_rebuild_yjs_source_of_truth.sql');
 const identityStart=identityMigration.indexOf('ALTER TABLE public.documents\n  ADD COLUMN IF NOT EXISTS content_sha256');
 const identityEnd=identityMigration.indexOf(';',identityMigration.indexOf('WHERE content_sha256 IS NOT NULL',identityStart))+1;
 assert.ok(identityStart>=0&&identityEnd>identityStart);sql(identityMigration.slice(identityStart,identityEnd));
 sql(`INSERT INTO templates(id,user_id) VALUES('${id(500)}','${owner}')`);
 const preDocument=id(8),preGeneration=id(98);
 sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${preDocument}','${owner}','${project}','pre-migration','${owner}/pre.pdf',4);
  INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
   VALUES('${preDocument}','${preGeneration}',0,decode('0102','hex'),1)`);
 applyMigration(migrationPath('20260909107000_annotation_content_model_v2.sql'));
 const doc=n=>{const d=id(n);sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${d}','${owner}','${project}','fixture','${owner}/${n}.pdf',4)`);return d;};
 const gen=(d,n,model)=>{const g=id(n);sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
  VALUES('${d}','${g}',0,decode('0102','hex'),1,${model});INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq) VALUES('${d}','${g}',0)`);return g;};
 const run=(actor,q)=>JSON.parse(asRole(actor,q).stdout);
 let count=0;const check=async(name,work)=>{await work();count++;console.log(`PASS ${name}`);};
 await check('migration is replay-safe and model-1 is the backfill default',()=>{
  assert.equal(scalar(`SELECT content_model_version FROM survey_private.annotation_generations WHERE document_id='${preDocument}' AND generation_id='${preGeneration}'`),'1');
  applyMigration(migrationPath('20260909107000_annotation_content_model_v2.sql'));
  const d=doc(10),g=id(100);sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
   VALUES('${d}','${g}',0,decode('0102','hex'),1);INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq) VALUES('${d}','${g}',0)`);
  assert.equal(scalar(`SELECT content_model_version FROM survey_private.annotation_generations WHERE document_id='${d}' AND generation_id='${g}'`),'1');
 });
 await check('mode discovery returns one checked model and old discovery rejects model 2',()=>{
  const d=doc(11),g=gen(d,101,2),mode=run(viewer,`SELECT public.read_document_open_mode_v2('${d}')`);
  assert.deepEqual(Object.keys(mode).sort(),['actor_user_id','content_model_version','document_id','generation_id','mode','version']);
  assert.equal(mode.content_model_version,2);assert.equal(mode.generation_id,g);assert.equal(mode.version,2);
  errorState(asRole(viewer,`SELECT public.read_document_open_mode('${d}')`,'authenticated',false),'SG003');
  errorState(asRole(viewer,`SELECT public.read_document_generation_open('${d}','${g}',false)`,'authenticated',false),'SG003');
  errorState(asRole(viewer,`SELECT public.read_document_generation_open_v3('${d}','${g}',1::smallint,false)`,'authenticated',false),'SG003');
  errorState(asRole(viewer,`SELECT public.read_document_generation_open_v3('${d}','${g}',2::smallint,false)`,'authenticated',false),'23514');
 });
 await check('v3 transport also carries explicit model 1 without changing old model-1 access',()=>{
  const d=doc(17),g=gen(d,107,1);
  assert.equal(run(owner,`SELECT public.append_annotation_update_v3('${d}','${g}',1::smallint,'new-on-old',1,decode('0a','hex'))`).content_model_version,1);
  assert.equal(run(viewer,`SELECT public.read_annotation_updates_v3('${d}','${g}',1::smallint,0,NULL,1000)`).rows.length,1);
  assert.equal(run(viewer,`SELECT public.read_annotation_updates_v2('${d}','${g}',0,NULL,1000)`).rows.length,1);
 });
 await check('v3 model-2 transport works while every old model-1 transport path fails',()=>{
  const d=doc(12),g=gen(d,102,2);
  for(const q of [`SELECT public.read_annotation_snapshot_v2('${d}','${g}')`,
   `SELECT public.read_annotation_updates_v2('${d}','${g}',0,NULL,1000)`,
   `SELECT public.read_annotation_writer_sequence_v2('${d}','${g}','old')`,
   `SELECT public.append_annotation_update_v2('${d}','${g}','old',1,decode('01','hex'))`,
   `SELECT public.store_annotation_snapshot_v2('${d}','${g}',0,decode('01','hex'),1,'old',1,0,NULL,0)`])
   errorState(asRole(owner,q,'authenticated',false),'SG003');
  const append=run(owner,`SELECT public.append_annotation_update_v3('${d}','${g}',2::smallint,'new',1,decode('03','hex'))`);
  assert.equal(append.version,3);assert.equal(append.content_model_version,2);assert.equal(append.seq,'1');
  const page=run(viewer,`SELECT public.read_annotation_updates_v3('${d}','${g}',2::smallint,0,NULL,1000)`);
  assert.equal(page.rows.length,1);assert.equal(page.content_model_version,2);
  const snap=run(owner,`SELECT public.store_annotation_snapshot_v3('${d}','${g}',2::smallint,1,decode('010203','hex'),1,'new',1,0,NULL,0)`);
  assert.equal(snap.stored,true);assert.equal(run(viewer,`SELECT public.read_annotation_snapshot_v3('${d}','${g}',2::smallint)`).snapshot.at_seq,'1');
 });
 await check('explicit wrong model and unauthorized actor fail without data',()=>{
  const d=doc(13),g=gen(d,103,2);
  errorState(asRole(owner,`SELECT public.read_annotation_snapshot_v3('${d}','${g}',1::smallint)`,'authenticated',false),'SG003');
  errorState(asRole(other,`SELECT public.read_annotation_snapshot_v3('${d}','${g}',2::smallint)`,'authenticated',false),'42501');
  errorState(asRole(viewer,`SELECT public.append_annotation_update_v3('${d}','${g}',2::smallint,'viewer',1,decode('01','hex'))`,'authenticated',false),'42501');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_updates WHERE document_id='${d}'`),'0');
 });
 await check('v3 retired exact receipt survives head replacement and role revoke',()=>{
  const d=doc(14),g=gen(d,104,2),q=`SELECT public.append_annotation_update_v3('${d}','${g}',2::smallint,'receipt',1,decode('aa','hex'))`;
  const receipt=run(editor,q);const next=id(204);sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
   VALUES('${d}','${next}',1,decode('0102','hex'),1,2);UPDATE survey_private.annotation_generation_heads SET generation_id='${next}',last_seq=1 WHERE document_id='${d}';
   INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
  const replay=run(editor,q);assert.equal(replay.seq,receipt.seq);assert.equal(replay.data_sha256,receipt.data_sha256);assert.equal(replay.is_current,false);
  errorState(asRole(editor,`SELECT public.append_annotation_update_v2('${d}','${g}','receipt',1,decode('aa','hex'))`,'authenticated',false),'SG003');
  errorState(asRole(editor,`SELECT public.append_annotation_update_v3('${d}','${g}',2::smallint,'receipt',2,decode('bb','hex'))`,'authenticated',false),'42501');
 });
 await check('generation model is immutable and account closing fences discovery',()=>{
  const d=doc(15),g=gen(d,105,2);
  errorState(sql(`UPDATE survey_private.annotation_generations SET content_model_version=1 WHERE document_id='${d}' AND generation_id='${g}'`,false),'42501');
  assert.equal(scalar(`SELECT content_model_version FROM survey_private.annotation_generations WHERE document_id='${d}' AND generation_id='${g}'`),'2');
  const sourceId=id(305);sql(`INSERT INTO survey_private.document_generation_sources(source_id,actor_user_id,document_id,generation_id,state,source_sql_sha256,wal_head,body_id,expires_at,content_model_version)
   VALUES('${sourceId}','${owner}','${d}','${g}','expired',repeat('a',64),0,NULL,clock_timestamp(),2)`);
  errorState(sql(`UPDATE survey_private.document_generation_sources SET content_model_version=1 WHERE source_id='${sourceId}'`,false),'42501');
  const sourceReceipt=JSON.parse(scalar(`SELECT survey_private.document_generation_source_descriptor_v2('${sourceId}',2::smallint)`));
  assert.equal(sourceReceipt.state,'expired');assert.equal(sourceReceipt.content_model_version,2);
  run(owner,`SELECT public.read_document_open_mode_v2('${d}')`);
  errorState(sql(`BEGIN;UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${owner}';${pg.actorContext(owner)}SELECT public.read_document_open_mode_v2('${d}');COMMIT`,false),'23514');
 });
 await check('mode discovery fails fast on a held document publication lock',async()=>{
  const d=doc(16),g=gen(d,106,2),held=session('model_mode_lock');
  held.send(`SELECT pg_advisory_xact_lock(hashtextextended('${d}',0));SELECT 'model-lock-held';`);await held.wait('model-lock-held');
  errorState(asRole(viewer,`SELECT public.read_document_open_mode_v2('${d}')`,'authenticated',false),'40001');
  assert.equal((await held.finish(false)).status,0);assert.equal(run(viewer,`SELECT public.read_document_open_mode_v2('${d}')`).generation_id,g);
 });
 await check('real source, archive and worker plan publish model 2 and open its checked generation',async()=>{
  let serial=600;const fresh=()=>id(serial++),bytea=value=>`decode('${Buffer.from(value).toString('hex')}','hex')`;
  const call=(name,args)=>`SELECT public.${name}(${args.map(quote).join(',')})`;
  const service=(name,args)=>JSON.parse(asRole(null,call(name,args),'service_role').stdout);
  const privateCall=(actor,name,args)=>JSON.parse(sql(`SET request.jwt.claim.sub=${quote(actor)};SELECT public.${name}(${args.map(quote).join(',')})`).stdout);
  const rows=(table,where)=>JSON.parse(scalar(`SET TimeZone='UTC';SET bytea_output='hex';SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.${table==='doc_yjs_state'?'document_id':'id'}),'[]') FROM public.${table} r WHERE ${where}`));
  const seed=()=>{
   const d=fresh(),path=`${owner}/${d}.pdf`,sid=fresh();
   sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count) VALUES('${d}','${owner}','${project}','Model 2 publication',${quote(path)},${originalPdf.length},3);
    INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(path)},'${objectVersion}',jsonb_build_object('size',${originalPdf.length}));
    INSERT INTO survey_sessions(id,template_id,user_id,document_id,is_active) VALUES('${sid}','${id(500)}','${other}','${d}',false)`);
   const shape={type:'rect',pageNumber:2,left:10,top:20,width:30,height:40,data:{id:'mark',pageNumber:2},meta:{authorId:owner}};
   sql(`INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,annotation_data) VALUES('${d}','${owner}','mark','square',2,'{"x":10,"y":20,"width":30,"height":40}',${quote(JSON.stringify({fabricObject:shape,pageNumber:2}))});
    INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,name,version,last_modified_by,annotation_data)
     VALUES('${d}','${owner}','survey','survey-marker',2,'{"x":10,"y":20,"width":30,"height":40}','Shared marker',3,'${owner}','{"scope":"survey","pageNumber":2}')`);
   const markerRow=rows('document_annotations',`document_id='${d}'`).find(row=>row.annotation_id==='survey');
   const marker=mapSurveyMarkerRowToLocalAnnotation(markerRow);for(const key of Object.keys(marker))if(marker[key]===undefined)delete marker[key];
   const modern=new Y.Doc();syncByPageToDoc(modern,{2:{objects:[shape]}});syncSurveyMarkersToDoc(modern,{survey:marker});
   assert.equal(asRole(owner,`SELECT public.store_annotation_snapshot('${d}',0,${bytea(Y.encodeStateAsUpdate(modern))},1,'model2-publisher',1,NULL,NULL,0)`).stdout,'t');modern.destroy();
   const legacy=new Y.Doc(),record=new Y.Map();record.set('id','mark');record.set('type','rect');record.set('pageNumber',2);
   record.set('fabric',new Y.Map(Object.entries(shape)));record.set('meta',new Y.Map([['authorId',owner]]));legacy.getMap('annotations').set('mark',record);
   sql(`INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${d}',${bytea(Y.encodeStateAsUpdate(legacy))},${bytea(Y.encodeStateVector(legacy))},0)`);legacy.destroy();
   return {d,path,sid,pdf:originalPdf,generation:null};
  };
  const stage=async(x,{actor=owner,target=2}={})=>{
   const sourceId=fresh(),sourceModel=x.generation?target:1;
   const beginName=target===2?'begin_document_generation_source_v2':'begin_document_generation_source';
   const beginArgs=target===2?[actor,x.d,sourceId,x.generation,sourceModel]:[actor,x.d,sourceId,x.generation];
   target===2?privateCall(actor,beginName,beginArgs):service(beginName,beginArgs);
   const claimId=fresh();let proof;
   if(target===2){proof=privateCall(actor,'claim_document_generation_source_bytes_v2',[actor,sourceId,claimId,sourceModel]);
    privateCall(actor,'record_document_generation_source_bytes_v2',[actor,sourceId,claimId,JSON.stringify(proof.objects.map(o=>({...o,content_sha256:hash(x.pdf)}))),sourceModel]);}
   else{proof=service('claim_document_generation_source_bytes',[actor,sourceId,claimId]);
    service('record_document_generation_source_bytes',[actor,sourceId,claimId,JSON.stringify(proof.objects.map(o=>({...o,content_sha256:hash(x.pdf)})))]);}
   const envelope=target===2?privateCall(actor,'read_document_generation_transform_source_v2',[actor,sourceId,sourceModel])
    :service('read_document_generation_transform_source',[actor,sourceId]);
   const executor=createDocumentReplacementExecutor({timeoutMs:120000});let prepared;
   try{prepared=await executor.prepare({actorUserId:actor,documentId:x.d,sourceId,operationId:fresh(),operation:{type:'move',from:2,to:1},envelope,
     ...(target===2?{targetContentModelVersion:2}:{}),objects:proof.objects.map(o=>({id:o.id,version:o.version,bytes:x.pdf}))});}
   finally{await executor.close();}
   const verify=upload=>{asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(upload.path)},'${objectVersion}',jsonb_build_object('size',${upload.byte_length}))`,'service_role');
    const verifyClaim=fresh(),p=service('claim_document_generation_upload_verification',[actor,upload.operation_id,verifyClaim]);
    service('record_document_generation_upload_verification',[actor,upload.operation_id,p.object.id,p.object.version,upload.content_sha256,upload.byte_length,verifyClaim]);return upload;};
   const candidate=verify(target===2?privateCall(actor,'begin_document_generation_upload_v3',[sourceId,prepared.plan.operationId,'candidate-pdf',prepared.candidate.contentSha256,prepared.candidate.byteLength,sourceModel])
    :JSON.parse(asRole(actor,call('begin_document_generation_upload_v2',[sourceId,prepared.plan.operationId,'candidate-pdf',prepared.candidate.contentSha256,prepared.candidate.byteLength])).stdout));
   const archives=proof.objects.map(o=>verify(target===2?privateCall(actor,'begin_document_generation_source_archive_v2',[sourceId,fresh(),o.id,sourceModel])
    :JSON.parse(asRole(actor,call('begin_document_generation_source_archive',[sourceId,fresh(),o.id])).stdout)));
   return {...x,actor,sourceId,proof,envelope,plan:prepared.plan,candidate,archives,nextPdf:prepared.candidate.bytes};
  };
  const publishSql=(x,target=2)=>`SELECT survey_private.${target===2?'publish_document_generation_v2':'publish_document_generation'}('${x.actor}','${x.sourceId}','${x.candidate.operation_id}',ARRAY[${x.archives.map(a=>quote(a.operation_id)).join(',')}]::uuid[],${quote(JSON.stringify(x.plan))}::jsonb)`;
  const prepareSql=x=>`SELECT survey_private.prepare_document_generation_replacement_v2('${x.actor}','${x.sourceId}','${x.candidate.operation_id}',ARRAY[${x.archives.map(a=>quote(a.operation_id)).join(',')}]::uuid[],${quote(x.plan.source.generationId)},${quote(x.plan.source.walHead)}::bigint,${quote(JSON.stringify(x.plan.operation))}::jsonb,${quote(JSON.stringify(x.plan))}::jsonb)`;

  const base=seed();sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${base.d}','${editor}','editor','active'),('${base.d}','${viewer}','viewer','active')`);
  const prepared=await stage(base,{actor:editor,target:2});const preparedReceipt=JSON.parse(scalar(prepareSql(prepared)));assert.equal(preparedReceipt.state,'prepared');
  sql(`UPDATE document_collaborators SET role='viewer' WHERE document_id='${base.d}' AND user_id='${editor}'`);
  errorState(sql(publishSql(prepared),false),'42501');
  sql(`UPDATE document_collaborators SET role='editor' WHERE document_id='${base.d}' AND user_id='${editor}'`);
  const receipt=JSON.parse(scalar(publishSql(prepared)));assert.equal(receipt.version,2);assert.equal(receipt.content_model_version,2);
  assert.deepEqual(JSON.parse(scalar(publishSql(prepared))),receipt);
  const opened=run(viewer,`SELECT public.read_document_generation_open_v3('${base.d}','${prepared.candidate.generation_id}',2::smallint,true)`);
  assert.equal(opened.version,3);assert.equal(opened.content_model_version,2);assert.equal(opened.annotations.content_model_version,2);
  assert.equal(opened.generation_id,prepared.candidate.generation_id);assert.equal(opened.pdf.path,prepared.candidate.path);
  const successor=await stage({...prepared,pdf:prepared.nextPdf,generation:prepared.candidate.generation_id},{actor:editor,target:2});
  assert.equal(successor.envelope.content_model_version,2);assert.equal(successor.envelope.source_bytes.content_model_version,2);
  assert.equal(JSON.parse(scalar(prepareSql(successor))).state,'prepared');const successorReceipt=JSON.parse(scalar(publishSql(successor)));
  const successorOpen=run(viewer,`SELECT public.read_document_generation_open_v3('${base.d}','${successor.candidate.generation_id}',2::smallint,false)`);
  assert.equal(successorReceipt.content_model_version,2);assert.equal(successorOpen.generation_id,successor.candidate.generation_id);
  assert.deepEqual(JSON.parse(scalar(publishSql(prepared))),receipt);assert.equal(run(viewer,`SELECT public.read_document_open_mode_v2('${base.d}')`).generation_id,successor.candidate.generation_id);
  sql(`UPDATE document_collaborators SET role='viewer' WHERE document_id='${base.d}' AND user_id='${editor}'`);
  errorState(sql(publishSql(successor),false),'42501');

  const legacy=await stage(seed(),{target:1}),legacyReceipt=JSON.parse(scalar(publishSql(legacy,1)));
  assert.equal(legacyReceipt.version,1);assert.equal(JSON.parse(asRole(owner,`SELECT public.read_document_generation_open('${legacy.d}','${legacy.candidate.generation_id}',true)`).stdout).version,1);
 });
 for(const role of ['anon','authenticated','service_role'])
  errorState(asRole(owner,'SELECT * FROM survey_private.annotation_generations',role,false),'42501');
 assert.equal(scalar("SELECT has_function_privilege('anon','public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea)','EXECUTE')"),'f');
 assert.equal(scalar("SELECT has_function_privilege('authenticated','public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea)','EXECUTE')"),'t');
 assert.equal(scalar("SELECT has_function_privilege('service_role','public.begin_document_generation_source_v2(uuid,uuid,uuid,uuid,smallint)','EXECUTE')"),'f');
 assert.equal(scalar("SELECT has_function_privilege('service_role','survey_private.publish_document_generation_v2(uuid,uuid,uuid,uuid[],jsonb)','EXECUTE')"),'f');
 assert.equal(scalar("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('begin_document_generation_source_v2','get_document_generation_source_v2','claim_document_generation_source_bytes_v2','record_document_generation_source_bytes_v2','read_document_generation_transform_source_v2','begin_document_generation_source_archive_v2','begin_document_generation_upload_v3') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))"),'0');
 assert.equal(scalar("SELECT count(*) FROM pg_constraint WHERE conname IN('annotation_generations_content_model_version_check','annotation_generation_signals_content_model_version_check','document_generation_sources_content_model_version_check') AND convalidated AND regexp_replace(pg_get_constraintdef(oid),'\\s','','g')='CHECK((content_model_version=ANY(ARRAY[1,2])))'"),'3');
 assert.equal(scalar("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='survey_private' AND (p.proname LIKE '%\\_v2' ESCAPE '\\' OR p.proname LIKE '%\\_v3' ESCAPE '\\') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))"),'0');
 await check('migration fails closed on widened checks and changed defaults',()=>{
  sql(`ALTER TABLE survey_private.annotation_generations DROP CONSTRAINT annotation_generations_content_model_version_check;
   ALTER TABLE survey_private.annotation_generations ADD CONSTRAINT annotation_generations_content_model_version_check CHECK(content_model_version IN(1,2,3))`);
  errorState(sql(source('20260909107000_annotation_content_model_v2.sql'),false),'55000');
  sql(`ALTER TABLE survey_private.annotation_generations DROP CONSTRAINT annotation_generations_content_model_version_check;
   ALTER TABLE survey_private.annotation_generations ADD CONSTRAINT annotation_generations_content_model_version_check CHECK(content_model_version IN(1,2));
   ALTER TABLE survey_private.annotation_generations ALTER COLUMN content_model_version SET DEFAULT 2`);
  errorState(sql(source('20260909107000_annotation_content_model_v2.sql'),false),'55000');
 });
 console.log(`Annotation content model v2 PostgreSQL checks passed: ${count}`);
},{name:'annotation-content-model-v2'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
