// Disposable local PostgreSQL only. This first gate applies the complete
// checked-generation stack followed by the first-adoption migration.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import * as Y from 'yjs';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
import {syncByPageToDoc,syncSurveyMarkersToDoc} from '../src/services/annotationDocStore.js';
import {mapSurveyMarkerRowToLocalAnnotation} from '../src/services/documentSurveyMarkerMapper.js';
import {materializeAnnotationGenerationStateForOpen} from '../src/services/annotationGenerationState.js';
import {createDocumentGenerationReader,readCheckedGenerationBootstrap} from '../src/services/documentGenerationReader.js';
import {createDocumentReplacementExecutor} from '../src/services/documentReplacementExecutor.js';
import {createDocumentReplacementRequestHandler} from '../src/services/documentReplacementRequest.js';
import {validateDocumentFirstGenerationAdoptionReceipt} from '../src/services/documentFirstGenerationAdoption.js';
import {prepareDocumentFirstGenerationAdoption} from '../src/services/documentFirstGenerationAdoptionTransform.js';

assert.equal(process.argv.length,2,'This local fixture accepts no arguments');
const migrationPath=name=>fileURLToPath(new URL(`../supabase/migrations/${name}`,import.meta.url));
const source=name=>readFileSync(migrationPath(name),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5);
const objectVersion=id(9),hash=value=>createHash('sha256').update(value).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pdfDocument=await PDFDocument.create();pdfDocument.addPage([612,792]);const originalPdf=await pdfDocument.save();

await withDisposablePostgres(async pg=>{
 const {sql,scalar,asRole,errorState,session,blocked,applyMigration,quote}=pg;
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
 sql('CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions');
 applyMigration(migrationPath('20260909105000_document_entity_catalog.sql'));
 applyMigration(migrationPath('20260909107000_annotation_content_model_v2.sql'));
 for(const name of ['20260909108000_annotation_checkpoint_conditional.sql','20260909109000_annotation_model2_capacity.sql',
  '20260909110000_annotation_generation_aggregate_admission.sql','20260909112000_annotation_generation_aggregate_service_broker.sql',
  '20260909113000_annotation_generation_aggregate_current_receipts.sql','20260909114000_annotation_generation_aggregate_write_fence.sql'])applyMigration(migrationPath(name));
 applyMigration(migrationPath('20260909115000_annotation_generation_aggregate_publication.sql'));
 applyMigration(migrationPath('20260915100000_checked_legacy_sidecar_retirement.sql'));
 sql('ALTER TABLE storage.objects ADD COLUMN owner_id text');
 applyMigration(migrationPath('20260909106000_document_survey_definition.sql'));
 applyMigration(migrationPath('20260915101000_document_first_generation_adoption.sql'));
 assert.equal(scalar("SELECT to_regprocedure('survey_private.create_document_first_generation_adoption_review_v1(uuid,uuid,uuid,uuid,uuid,uuid[],jsonb,text)') IS NOT NULL"),'t');
 assert.equal(scalar("SELECT to_regprocedure('public.publish_document_first_generation_adoption_service_v1(uuid,uuid,text)') IS NOT NULL"),'t');
 assert.equal(scalar("SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='survey_private' AND table_name LIKE 'document_first_generation_adoption%' AND grantee IN('anon','authenticated','service_role')"),'0');
 const serviceOnly=[
  'public.begin_document_generation_source_v2(uuid,uuid,uuid,uuid,smallint)',
  'public.get_document_generation_source_v2(uuid,uuid,smallint)',
  'public.claim_document_generation_source_bytes_v2(uuid,uuid,uuid,smallint)',
  'public.record_document_generation_source_bytes_v2(uuid,uuid,uuid,jsonb,smallint)',
  'public.read_document_generation_transform_source_v2(uuid,uuid,smallint)',
  'public.prepare_document_first_generation_adoption_service_v1(uuid,uuid,jsonb,jsonb)',
 ];
 for(const signature of serviceOnly){
  assert.equal(scalar(`SELECT has_function_privilege('service_role',${quote(signature)},'EXECUTE')`),'t');
  assert.equal(scalar(`SELECT has_function_privilege('authenticated',${quote(signature)},'EXECUTE')`),'f');
 }
 for(const signature of [
  'public.begin_document_generation_source_archive_v2(uuid,uuid,uuid,smallint)',
  'public.begin_document_generation_upload_v3(uuid,uuid,text,text,bigint,smallint)',
 ]){
  assert.equal(scalar(`SELECT has_function_privilege('authenticated',${quote(signature)},'EXECUTE')`),'t');
  assert.equal(scalar(`SELECT has_function_privilege('service_role',${quote(signature)},'EXECUTE')`),'f');
 }
 assert.equal(scalar("SELECT has_function_privilege('service_role','survey_private.prepare_document_generation_replacement_v3(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb)','EXECUTE')"),'f');
 console.log('PASS first-adoption migration applies with private tables and service-only RPCs');
 const adoption=id(800),sourceId=id(801),candidate=id(802),archiveA=id(803),archiveB=id(804);
 sql(`INSERT INTO survey_private.document_generation_sources(source_id,actor_user_id,document_id,generation_id,state,source_sql_sha256,wal_head,body_id,expires_at,content_model_version)
  VALUES('${sourceId}','${owner}','${preDocument}',NULL,'expired',repeat('b',64),0,NULL,clock_timestamp(),1);
  INSERT INTO survey_private.document_first_generation_adoption_reviews(adoption_operation_id,actor_user_id,owner_user_id,document_id,
   source_id,candidate_operation_id,offered_archive_operation_ids,used_archive_operation_ids,review_sha256,source_sql_sha256,wal_head,
   objects,source_provenance,canonical_annotations,entity_catalog,survey_definition,sidecar_entity_policy,expires_at)
  VALUES('${adoption}','${owner}','${owner}','${preDocument}','${sourceId}','${candidate}',ARRAY['${archiveA}','${archiveB}']::uuid[],ARRAY['${archiveA}']::uuid[],
   repeat('c',64),repeat('b',64),0,'[{"kind":"pdf","byte_length":"4","content_sha256":"${'d'.repeat(64)}"}]',
   '[{"kind":"pdf","bucket_id":"documents","path":"source.pdf","id":"${id(805)}","version":"${id(806)}","byte_length":"4","content_sha256":"${'d'.repeat(64)}","owner_id":"${editor}"}]',
   '{"version":1,"policy":"legacy-sql-v1","through_seq":"0","baseline_sha256":"${'e'.repeat(64)}","contributors":[]}',
   '{"status":"absent","revision":null,"content_sha256":null}',
   '{"status":"absent","revision":null,"content_sha256":null}','absent',clock_timestamp()+interval '5 minutes')`);
 const review=JSON.parse(scalar(`SELECT survey_private.document_first_generation_adoption_receipt('${adoption}')`));
 validateDocumentFirstGenerationAdoptionReceipt(review,{actorUserId:owner,documentId:preDocument,
  adoptionOperationId:adoption,sourceId,candidateOperationId:candidate,archiveOperationIds:[archiveA,archiveB]});
 assert.deepEqual(review.entity_catalog,{status:'absent',revision:null,content_sha256:null});
 assert.deepEqual(review.survey_definition,{status:'absent',revision:null,content_sha256:null});
 console.log(`REVIEW_RECEIPT ${JSON.stringify(review)}`);
 console.log('PASS SQL blank-definition review validates through the strict client parser');

 let serial=900;const fresh=()=>id(serial++),run=value=>JSON.parse(value.stdout),call=(name,args)=>
  `SELECT public.${name}(${args.map(quote).join(',')})`;
 const service=(name,args)=>run(asRole(null,call(name,args),'service_role'));
 const trusted=(actorId,name,args)=>run(sql(`SET request.jwt.claim.sub=${quote(actorId)};${call(name,args)}`));
 const permanent=owner,uploader=editor,converter=other,adoptDoc=fresh(),adoptProject=fresh();
 const originalPath=`${permanent}/${adoptDoc}.pdf`;
 const sidecarPath=`${adoptProject}/${adoptDoc}_data.json`;
 const sidecarBytes=new TextEncoder().encode(JSON.stringify({
  version:1,
  entities:[],
  annotations:{privateAnnotation:'must-not-adopt'},
  currentPage:77,
  zoomLevel:9,
  templateId:'private-template',
  excelFileId:'private-workbook',
  excelRowIndex:42,
 }));
 sql(`INSERT INTO projects(id,user_id,name) VALUES('${adoptProject}','${converter}','Adoption project');
  INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count) VALUES('${adoptDoc}','${permanent}','${adoptProject}',
   'Legacy adoption',${quote(originalPath)},${originalPdf.length},1);
  INSERT INTO storage.objects(bucket_id,name,owner_id,version,metadata) VALUES
   ('documents',${quote(originalPath)},'${uploader}','${objectVersion}',jsonb_build_object('size',${originalPdf.length})),
   ('documents',${quote(sidecarPath)},'${uploader}','${objectVersion}',jsonb_build_object('size',${sidecarBytes.length}))`);
 const legacyDoc=new Y.Doc();syncByPageToDoc(legacyDoc,{1:{objects:[]}});
 const snapshot=Buffer.from(Y.encodeStateAsUpdate(legacyDoc));legacyDoc.destroy();
 assert.equal(asRole(permanent,`SELECT public.store_annotation_snapshot('${adoptDoc}',0,decode('${snapshot.toString('hex')}','hex'),1,'adoption',1,NULL,NULL,0)`).stdout,'t');
 const adoptionOp=fresh(),adoptSource=fresh(),adoptCandidate=fresh(),adoptArchives=[fresh(),fresh()];
 trusted(converter,'begin_document_generation_source_v2',[converter,adoptDoc,adoptSource,null,1]);
 const claim=fresh(),claimed=service('claim_document_generation_source_bytes_v2',[converter,adoptSource,claim,1]);
 const sourceProof=service('record_document_generation_source_bytes_v2',[converter,adoptSource,claim,
  JSON.stringify(claimed.objects.map(value=>({...value,content_sha256:hash(value.kind==='pdf'?originalPdf:sidecarBytes)}))),1]);
 const envelope=trusted(converter,'read_document_generation_transform_source_v2',[converter,adoptSource,1]);
 const prepared=await prepareDocumentFirstGenerationAdoption({actorUserId:converter,documentId:adoptDoc,
  adoptionOperationId:adoptionOp,sourceId:adoptSource,candidateOperationId:adoptCandidate,
  archiveOperationIds:adoptArchives,envelope,objects:sourceProof.objects.map(value=>({
   id:value.id,
   version:value.version,
   bytes:value.kind==='pdf'?originalPdf:sidecarBytes,
  }))});
 const reviewResult=run(asRole(null,`SELECT public.create_document_first_generation_adoption_review_service_v1('${converter}','${adoptDoc}',
  '${adoptionOp}','${adoptSource}','${adoptCandidate}',ARRAY['${adoptArchives[0]}','${adoptArchives[1]}']::uuid[],
  ${quote(JSON.stringify(prepared.canonicalAnnotations))}::jsonb,${quote(prepared.sidecarEntityPolicy)})`,'service_role'));
 assert.equal(reviewResult.state,'review');assert.equal(reviewResult.owner_user_id,permanent);assert.equal(reviewResult.actor_user_id,converter);
 errorState(asRole(null,`SELECT public.prepare_document_first_generation_adoption_service_v1('${converter}','${adoptionOp}',
  ${quote(JSON.stringify(prepared.plan.operation))}::jsonb,${quote(JSON.stringify(prepared.plan))}::jsonb)`,'service_role',false),'42501');
 const deniedIds=[fresh(),fresh(),fresh(),fresh(),fresh()];
 errorState(asRole(null,`SELECT public.create_document_first_generation_adoption_review_service_v1('${editor}','${adoptDoc}',
  '${deniedIds[0]}','${deniedIds[1]}','${deniedIds[2]}',ARRAY['${deniedIds[3]}','${deniedIds[4]}']::uuid[],
  ${quote(JSON.stringify(prepared.canonicalAnnotations))}::jsonb,'absent')`,'service_role',false),'42501');
 const confirmed=service('confirm_document_first_generation_adoption_service_v1',[converter,adoptionOp,reviewResult.review_sha256]);
 assert.equal(confirmed.state,'confirmed');
 errorState(asRole(null,`SELECT public.prepare_document_first_generation_adoption_service_v1('${uploader}','${adoptionOp}',
  ${quote(JSON.stringify(prepared.plan.operation))}::jsonb,${quote(JSON.stringify(prepared.plan))}::jsonb)`,'service_role',false),'42501');
 // Confirmation holds both the document and inherited-project authority
 // locks. A concurrent project-owner revoke must wait; after it commits,
 // publish must re-check authority rather than trusting the old review.
 const authorityHold=session('first-adoption-authority-hold',{role:'service_role'});
 authorityHold.send(`SELECT public.confirm_document_first_generation_adoption_service_v1('${converter}','${adoptionOp}',${quote(reviewResult.review_sha256)});SELECT 'FIRST_ADOPTION_AUTHORITY_HELD';`);
 await authorityHold.wait('FIRST_ADOPTION_AUTHORITY_HELD');
 const revoke=session('first-adoption-owner-revoke',{role:'postgres'});
 revoke.send(`UPDATE projects SET user_id='${viewer}' WHERE id='${adoptProject}';SELECT 'FIRST_ADOPTION_OWNER_REVOKED';`);
 await blocked('first-adoption-owner-revoke');
 assert.equal((await authorityHold.finish()).status,0);
 await revoke.wait('FIRST_ADOPTION_OWNER_REVOKED');assert.equal((await revoke.finish()).status,0);
 errorState(asRole(null,`SELECT public.publish_document_first_generation_adoption_service_v1('${converter}','${adoptionOp}',${quote(reviewResult.review_sha256)})`,'service_role',false),'42501');
 sql(`UPDATE projects SET user_id='${converter}' WHERE id='${adoptProject}'`);
 const verifyUpload=(upload,bytes)=>{
  sql(`INSERT INTO storage.objects(bucket_id,name,owner_id,version,metadata) VALUES('documents',${quote(upload.path)},'${converter}','${objectVersion}',jsonb_build_object('size',${bytes.length}))`);
  const verification=fresh(),claimedUpload=service('claim_document_generation_upload_verification',[converter,upload.operation_id,verification]);
  return service('record_document_generation_upload_verification',[converter,upload.operation_id,claimedUpload.object.id,
   claimedUpload.object.version,hash(bytes),String(bytes.length),verification]);
 };
 for(let index=0;index<sourceProof.objects.length;index+=1){
  const sourceObject=sourceProof.objects[index];
  const bytes=sourceObject.kind==='pdf'?originalPdf:sidecarBytes;
  const archiveUpload=trusted(converter,'begin_document_generation_source_archive_v2',[
   adoptSource,adoptArchives[index],sourceObject.id,1,
  ]);
  verifyUpload(archiveUpload,bytes);
 }
 const candidateUpload=trusted(converter,'begin_document_generation_upload_v3',[adoptSource,adoptCandidate,'candidate-pdf',
  prepared.candidate.contentSha256,prepared.candidate.byteLength,1]);verifyUpload(candidateUpload,prepared.candidate.bytes);
 const preparedJournal=service('prepare_document_first_generation_adoption_service_v1',[converter,adoptionOp,
  JSON.stringify(prepared.plan.operation),JSON.stringify(prepared.plan)]);
 assert.equal(preparedJournal.state,'prepared');
 const published=service('publish_document_first_generation_adoption_service_v1',[converter,adoptionOp,reviewResult.review_sha256]);
 validateDocumentFirstGenerationAdoptionReceipt(published,{actorUserId:converter,documentId:adoptDoc,adoptionOperationId:adoptionOp});
 assert.equal(published.state,'published');assert.equal(published.content_model_version,2);
 assert.deepEqual(published.legacy_sidecar_migration,{version:2,state:'archived',origin:{mode:'legacy',adoption_operation_id:adoptionOp}});
 assert.deepEqual(service('publish_document_first_generation_adoption_service_v1',[converter,adoptionOp,reviewResult.review_sha256]),published);
 const successorSource=fresh();
 const successor=trusted(converter,'begin_document_generation_source_v2',[converter,adoptDoc,successorSource,published.generation_id,2]);
 assert.deepEqual(successor.sidecar_objects,[]);
 const successorClaim=fresh(),successorBytes=service('claim_document_generation_source_bytes_v2',[converter,successorSource,successorClaim,2]);
 assert.deepEqual(successorBytes.objects.map(value=>value.kind),['pdf']);
 service('record_document_generation_source_bytes_v2',[converter,successorSource,successorClaim,
  JSON.stringify(successorBytes.objects.map(value=>({...value,content_sha256:hash(originalPdf)}))),2]);
 const successorEnvelope=service('read_document_generation_transform_source_v2',[converter,successorSource,2]);
 const successorExecutor=createDocumentReplacementExecutor({timeoutMs:30000});
 let successorPrepared;
 try {
  successorPrepared=await successorExecutor.prepare({actorUserId:converter,documentId:adoptDoc,sourceId:successorSource,
   operationId:fresh(),targetContentModelVersion:2,aggregateAdmissionVersion:1,legacySidecarArchiveVersion:1,
   envelope:successorEnvelope,operation:{type:'rotate',page:1,delta:0},objects:successorBytes.objects.map(value=>({
    id:value.id,version:value.version,bytes:originalPdf,
   }))});
 } finally { await successorExecutor.close(); }
 const successorArchive=fresh(),successorCandidate=successorPrepared.plan.operationId;
 const successorArchiveUpload=trusted(converter,'begin_document_generation_source_archive_v2',[
  successorSource,successorArchive,successorBytes.objects[0].id,2,
 ]);verifyUpload(successorArchiveUpload,originalPdf);
 const successorCandidateUpload=trusted(converter,'begin_document_generation_upload_v3',[successorSource,successorCandidate,'candidate-pdf',
  successorPrepared.candidate.contentSha256,successorPrepared.candidate.byteLength,2]);verifyUpload(successorCandidateUpload,successorPrepared.candidate.bytes);
 const successorJournal=run(sql(`SET request.jwt.claim.sub=${quote(converter)};SELECT survey_private.prepare_document_generation_replacement_v4(
  '${converter}','${successorSource}','${successorCandidate}',ARRAY['${successorArchive}']::uuid[],'${published.generation_id}',${successor.wal_head}::bigint,
  ${quote(JSON.stringify(successorPrepared.plan.operation))}::jsonb,${quote(JSON.stringify(successorPrepared.plan))}::jsonb)`));
 assert.equal(successorJournal.state,'prepared');
 const successorPublished=run(sql(`SET request.jwt.claim.sub=${quote(converter)};SELECT survey_private.publish_document_generation_v4(
  '${converter}','${successorSource}','${successorCandidate}',ARRAY['${successorArchive}']::uuid[],${quote(JSON.stringify(successorPrepared.plan))}::jsonb)`));
 assert.equal(successorPublished.previous_generation_id,published.generation_id);
 assert.deepEqual(successorPublished.legacy_sidecar_migration,{version:2,state:'archived',origin:{mode:'legacy',adoption_operation_id:adoptionOp}});
 assert.equal(scalar(`SELECT adoption_operation_id='${adoptionOp}' FROM survey_private.document_generation_legacy_adoption_origins
  WHERE document_id='${adoptDoc}' AND generation_id='${successorPublished.generation_id}'`),'t');
 console.log('PASS actual v4 successor publish carries the v2 marker and suppresses the retired fixed sidecar');
 for(const denied of [converter,uploader])errorState(asRole(denied,`SELECT public.read_document_first_generation_source_archive_v1('${adoptDoc}','${published.generation_id}')`,'authenticated',false),'42501');
 // Normal SQL writers cannot delete a retired fixed path. Model an
 // out-of-band storage lifecycle deletion with trigger execution disabled,
 // then prove recovery relies only on the immutable archive, not the path.
 errorState(sql(`DELETE FROM storage.objects WHERE bucket_id='documents' AND name IN(${quote(originalPath)},${quote(sidecarPath)})`,false),'23514');
 sql(`SET session_replication_role=replica;DELETE FROM storage.objects WHERE bucket_id='documents' AND name IN(${quote(originalPath)},${quote(sidecarPath)});SET session_replication_role=origin`);
 const recovered=run(asRole(permanent,`SELECT public.read_document_first_generation_source_archive_v1('${adoptDoc}','${published.generation_id}')`));
 assert.deepEqual(recovered.objects.map(value=>value.kind),['pdf','sidecar']);
 assert.equal(recovered.objects[0].content_sha256,hash(originalPdf));
 assert.equal(recovered.objects[1].content_sha256,hash(sidecarBytes));
 for(const value of recovered.objects)assert.equal(value.source_object.owner_id,uploader);
 assert.equal(JSON.stringify(published).includes('private-template'),false);
 assert.equal(JSON.stringify(published).includes('private-workbook'),false);
 console.log('PASS project owner adopts PDF+sidecar, exact publish replays, and only permanent owner recovers retained uploader-provenance archives');
},{name:'first-adoption'});
