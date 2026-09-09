// Actual SQL capture -> pure transform. No provider, account, or publication.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as Y from 'yjs';
import {PDFDocument} from 'pdf-lib';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
import {syncByPageToDoc,docToByPage,syncSurveyMarkersToDoc} from '../src/services/annotationDocStore.js';
import {transformDocumentGenerationSource} from '../src/services/documentGenerationTransform.js';
import {mapSurveyMarkerRowToLocalAnnotation} from '../src/services/documentSurveyMarkerMapper.js';
import {mutatePdfPagesWithIdentity} from '../src/utils/pdfPageMutation.js';
assert.equal(process.argv.length,2,'No connection arguments accepted');
const migrationPath=n=>fileURLToPath(new URL(`../supabase/migrations/${n}`,import.meta.url));
const source=n=>readFileSync(migrationPath(n),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5),version=id(9);
const pdfDoc=await PDFDocument.create();for(let i=0;i<3;i++)pdfDoc.addPage([612,792]);
const pdf=await pdfDoc.save(),loadedPdf=await PDFDocument.load(pdf);
const pageCount=loadedPdf.getPageCount(),pageSizes=loadedPdf.getPages().map(p=>p.getSize());
const shape={type:'rect',pageNumber:2,left:10,top:20,width:30,height:40,
 data:{id:'mark',pageNumber:2,notes:'kept'},meta:{authorId:owner}};
const modern=new Y.Doc();syncByPageToDoc(modern,{2:{objects:[shape]}});
modern.getMap('annoMeta').set('spaces',[{id:'space',assignedPages:[{pageId:2,regions:[{regionId:'region',pageId:2,points:[1,2]}]}]}]);
const modernBytes=Y.encodeStateAsUpdate(modern),modernVector=Y.encodeStateVector(modern);
modern.getMap('annoMeta').set('preservedTail','accepted modern tail');
const modernTail=Y.encodeStateAsUpdate(modern,modernVector);modern.destroy();
const legacy=new Y.Doc(),record=new Y.Map(),fabric=new Y.Map(),meta=new Y.Map();
for(const [k,v] of Object.entries(shape))fabric.set(k,structuredClone(v));
meta.set('authorId',owner);meta.set('createdAt',123);
record.set('id','mark');record.set('type','rect');record.set('pageNumber',2);record.set('fabric',fabric);record.set('meta',meta);
legacy.getMap('annotations').set('mark',record);
const legacyBytes=Y.encodeStateAsUpdate(legacy),legacyVector=Y.encodeStateVector(legacy);
legacy.getMap('meta').set('preservedLabel','legacy tail');
const legacyTail=Y.encodeStateAsUpdate(legacy,legacyVector);legacy.destroy();
await withDisposablePostgres(async pg=>{
 const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
 const prior=readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url),'utf8');
 const a=prior.indexOf('  const prior='),b=prior.indexOf('  const doc=');assert.ok(a>=0&&b>a);
 new Function('sql','applyMigration','migrationPath','readFileSync','source','fn','owner','editor','viewer','other','project','assert',
  prior.slice(a,b).replaceAll("'import.meta.url'","'__KEEP_IMPORT_META__'")
   .replaceAll('import.meta.url',JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url).href))
   .replaceAll('__KEEP_IMPORT_META__','import.meta.url'))
  (sql,applyMigration,migrationPath,readFileSync,source,fn,owner,editor,viewer,other,project,assert);
 for(const file of ['20260909092000_document_generation_source_receipts.sql','20260909093000_document_generation_source_bytes.sql',
  '20260909094000_document_generation_source_bound_uploads.sql','20260909095000_document_generation_source_archives.sql',
  '20260909096000_document_generation_transform_source.sql',
  '20260425121704_extend_document_annotations_for_all_types.sql'])applyMigration(migrationPath(file));
 // The shared SQL bootstrap intentionally imports only the original annotation
 // table, unlike the complete survey migration. Restore its real timestamp
 // function/trigger here; do not substitute a test-written timestamp function.
 const timestampSource=source('20241230000002_create_document_annotations.sql');
 const timestampStart=timestampSource.indexOf('CREATE OR REPLACE FUNCTION update_document_tables_updated_at()');
 const timestampEnd=timestampSource.indexOf('CREATE TRIGGER trigger_update_document_collaborators_updated_at',timestampStart);
 assert.ok(timestampStart>=0&&timestampEnd>timestampStart);sql(timestampSource.slice(timestampStart,timestampEnd));
 const entityRename=source('20260518000000_rename_ball_in_court_to_entity.sql').split('\n').filter(line=>line.startsWith('ALTER TABLE document_annotations RENAME COLUMN')).join('\n');
 assert.equal(entityRename.split('\n').length,2);sql(entityRename);
 applyMigration(migrationPath('20260518000001_survey_marker_widen_type_check.sql'));
 assert.equal(scalar("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trigger_update_document_annotations_updated_at','trigger_update_survey_sessions_updated_at','trigger_update_survey_items_updated_at')"),'3');
 const bytea=x=>`decode('${Buffer.from(x).toString('hex')}','hex')`;
 const call=(name,args)=>`SELECT public.${name}(${args.map(quote).join(',')})`;
 const service=(name,args)=>JSON.parse(asRole(null,call(name,args),'service_role').stdout);
 const readSql=(s,actor=owner)=>call('read_document_generation_transform_source',[actor,s]);
 const read=s=>service('read_document_generation_transform_source',[owner,s]);
 let serial=100,count=0,readChecks=0;const fresh=()=>id(serial++);
 sql(`INSERT INTO templates(id,user_id) VALUES('${id(10)}','${owner}')`);
 async function capture({gzip=false,generated=false,verified=true}={}){
  const d=fresh(),s=fresh(),path=`${owner}/${d}.pdf`,jsonPath=`${project}/${d}_data.json`;
  const sidecar={version:1,pdfId:d,annotationsByPage:{2:{objects:[structuredClone(shape)]}},annotations:{},callouts:[],
   spaces:[],entities:[{id:'entity',name:'GC'}],currentPage:2,zoomLevel:1.25};
  const sidecarBytes=Buffer.from(JSON.stringify(sidecar));
  const sessions=[fresh(),fresh()];
  sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count) VALUES('${d}','${owner}','${project}','Transform','${path}',${pdf.length},3);
   INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${path}','${version}',jsonb_build_object('size',${pdf.length})),('documents','${jsonPath}','${version}',jsonb_build_object('size',${sidecarBytes.length}))`);
  // Synthetic existing generation fixture only: reserve its immutable object
  // before foreign sessions exist, respecting old 080's private-source gate.
  const hash=createHash('sha256').update(pdf).digest('hex');
  const upload=generated?JSON.parse(asRole(owner,call('begin_document_generation_upload',[d,fresh(),hash,String(pdf.length)])).stdout):null;
  sql(`INSERT INTO excel_workbook_registrations(document_id,template_id,workbook_id,token_hash,token_expiry,registered_by)
   VALUES('${d}','template','private-workbook','SYNTHETIC PRIVATE HISTORY',now()+interval '1 day','${other}')`);
  sql(`INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,annotation_data)
    VALUES('${d}','${owner}','mark','square',2,'{}',${quote(JSON.stringify({fabricObject:shape,pageNumber:2,schemaVersion:1}))});
   INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${d}',${bytea(legacyBytes)},${bytea(legacyVector)},4);
   INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${d}','legacy-fixture',5,${bytea(legacyTail)});
   INSERT INTO survey_sessions(id,template_id,user_id,document_id,is_active,excel_file_id) VALUES
    ('${sessions[0]}','${id(10)}','${owner}','${d}',false,'own-workbook'),('${sessions[1]}','${id(10)}','${other}','${d}',false,'foreign-private-workbook');
   INSERT INTO survey_items(session_id,annotation_id,module_id,category_id,page_number,notes,excel_row_index) VALUES
    ('${sessions[0]}','mark','module','category',2,'own note',7),('${sessions[1]}','mark','module','category',2,'foreign private note',8)`);
  let generation=null;
  if(generated){
   const u=upload,op=u.operation_id,claim=fresh();
   sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}',jsonb_build_object('size',${pdf.length}))`);
   const c=service('claim_document_generation_upload_verification',[owner,op,claim]);
   service('record_document_generation_upload_verification',[owner,op,c.object.id,c.object.version,hash,String(pdf.length),claim]);
   generation=u.generation_id;
   sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
    VALUES('${d}','${generation}',0,${bytea(gzipSync(modernBytes))},2);
    INSERT INTO survey_private.annotation_generation_heads VALUES('${d}','${generation}',0)`);
  }else{
   assert.equal(asRole(owner,`SELECT public.store_annotation_snapshot('${d}',0,${bytea(gzip?gzipSync(modernBytes):modernBytes)},${gzip?2:1},'fixture',1,NULL,NULL,0)`).stdout.trim(),'t');
  }
  asRole(owner,generation
   ?`SELECT public.append_annotation_update_v2('${d}','${generation}','modern-fixture',1,${bytea(modernTail)})`
   :`SELECT public.append_annotation_update('${d}','modern-fixture',1,${bytea(modernTail)})`);
  const receipt=service('begin_document_generation_source',[owner,d,s,generation]);
  if(!verified)return {receipt,d,s,path,jsonPath};
  const proofClaim=fresh(),proof=service('claim_document_generation_source_bytes',[owner,s,proofClaim]);
  assert.equal(proof.objects.length,2);
  const proofs=proof.objects.map(o=>({...o,content_sha256:createHash('sha256').update(o.kind==='pdf'?pdf:sidecarBytes).digest('hex')}));
  const proofReceipt=service('record_document_generation_source_bytes',[owner,s,proofClaim,JSON.stringify(proofs)]);
  assert.equal(proofReceipt.state,'verified');
  // The transform input must come from the actual least-privilege service RPC,
  // not raw superuser table reads or a hand-built approximation of SQL JSON.
  const envelope=read(s),payload=envelope.payload;
  assert.deepEqual(Object.keys(envelope).sort(),['version','source_id','actor_user_id','document_id','generation_id','source_sql_sha256','body_sha256','wal_head','expires_at','source_bytes','payload'].sort());
  assert.equal(envelope.version,1);assert.equal(envelope.source_id,s);assert.equal(envelope.actor_user_id,owner);
  assert.equal(envelope.document_id,d);assert.equal(envelope.generation_id,generation);
  assert.equal(envelope.source_sql_sha256,receipt.source_sql_sha256);assert.equal(envelope.wal_head,receipt.wal_head);
  assert.equal(Date.parse(envelope.expires_at),Date.parse(receipt.expires_at));assert.match(envelope.body_sha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(envelope.source_bytes,proofReceipt);assert.deepEqual(read(s),envelope);
  assert.equal(envelope.body_sha256,scalar(`SELECT encode(sha256(convert_to(payload::text,'UTF8')),'hex') FROM survey_private.document_generation_source_bodies WHERE document_id='${d}'`));
  assert.equal(payload.semantic.document_id,d);assert.equal(payload.semantic.generation_id,generation);
  assert.equal(payload.semantic.sources.survey_items[0].annotation_id,'mark');
  assert.equal(payload.semantic.sources.survey_items[0].highlight_id,undefined);
  assert.equal(payload.semantic.sources.survey_sessions.length,2);
  assert.equal(payload.connector_history.registrations[0].token_hash,'SYNTHETIC PRIVATE HISTORY');
  assert.equal(payload.connector_history.registrations[0].registered_by,other);
  assert.equal(payload.semantic.sources.doc_yjs_updates[0].seq,'5');
  assert.equal(payload.semantic.sidecar_objects[0].byte_length,String(sidecarBytes.length));
  assert.equal(payload.semantic.source_object.byte_length,String(pdf.length));
  return {receipt,envelope,d,s,path,jsonPath,sourcePayload:payload,sidecars:[{path:jsonPath,content:JSON.parse(sidecarBytes)}],operationId:fresh(),pageCount,pageSizes};
 }
 const cases=[[{type:'move',from:2,to:1},[1]],[{type:'delete',page:2},[]],[{type:'insert',afterPage:1},[3]],
  [{type:'rotate',page:2,delta:90},[2]],[{type:'duplicate',page:2},[2,3]],[{type:'copy',source:2,afterPage:3},[2,4]]];
 const errors=[];
 for(const mode of [{gzip:false},{gzip:true},{generated:true}]){
  const fixture=await capture(mode);
  for(const [operation,pages] of cases){
   const input={...fixture,operation},before=structuredClone(input),label=`${mode.generated?'generation-gzip':mode.gzip?'legacy-gzip':'legacy-raw'} ${operation.type}`;
   try{
    const result=await transformDocumentGenerationSource(input);
    assert.deepEqual(input,before);assert.deepEqual(result.archive.sourcePayload,before.sourcePayload);assert.deepEqual(result.archive.sidecars,before.sidecars);
    assert.deepEqual(Object.keys(result.projection.modern.annotationsByPage).map(Number),pages);
    assert.deepEqual(result.projection.documentAnnotations.map(r=>r.page_number),pages);
    assert.deepEqual(Object.values(result.projection.legacyYjs.annotations).map(r=>r.pageNumber),pages);
    assert.equal(result.projection.legacyYjs.meta.preservedLabel,'legacy tail');
    assert.deepEqual(result.projection.surveySessions,before.sourcePayload.semantic.sources.survey_sessions);
    assert.deepEqual(result.projection.surveyItems.map(r=>r.page_number).sort(),[...pages,...pages].sort());
    assert.deepEqual(result.projection.modern.surveyMarkers,{},'foreign private surveys never enter shared marker maps');
    assert.equal(result.projection.modern.annoMeta.preservedTail,'accepted modern tail');
    assert.equal(result.source.walHead,before.sourcePayload.semantic.wal_head);
    assert.equal(before.sourcePayload.wal_history[mode.generated?'generation':'legacy'].length,1);
    assert.deepEqual(Object.keys(result.projection.sidecars[0].content.annotationsByPage).map(Number),pages);
    const decoded=new Y.Doc();Y.applyUpdate(decoded,result.baselineUpdate);assert.deepEqual(docToByPage(decoded),result.projection.modern.annotationsByPage);decoded.destroy();
    if(pages.length===2){
     const copied=result.identityMap.annotations.mark;assert.ok(copied&&copied!=='mark');
     assert.equal(result.projection.documentAnnotations[1].annotation_id,copied);
     const copies=result.projection.surveyItems.filter(r=>r.page_number===pages[1]);
     assert.equal(copies.length,2);assert.equal(new Set(copies.map(r=>r.id)).size,2);
     for(const row of copies){assert.equal(row.annotation_id,copied);assert.equal(row.excel_row_index,null);}
     assert.deepEqual(result.projection.surveyItems.filter(r=>r.page_number===2).map(r=>r.excel_row_index),[7,8]);
     const different=await transformDocumentGenerationSource({...input,operationId:fresh()});assert.notEqual(different.identityMap.annotations.mark,copied);
    }
    const replay=await transformDocumentGenerationSource(input);assert.deepEqual(replay.identityMap,result.identityMap);assert.deepEqual(replay.baselineUpdate,result.baselineUpdate);
    assert.equal(result.projection.document.page_count,operation.type==='delete'?2:['copy','duplicate','insert'].includes(operation.type)?4:3);
    count++;console.log(`PASS ${label}`);
   }catch(error){const failure=`${label}: ${error.code||error.name} ${error.reason||error.message}`;errors.push(failure);console.log(`FAIL ${failure}`);}
  }
 }
 assert.deepEqual(errors,[],'Actual captured source must transform unchanged');
 const check=async(label,work)=>{await work();readChecks++;console.log(`PASS service read ${label}`);};
 const denied=(s,code='23514',actor=owner)=>errorState(asRole(null,readSql(s,actor),'service_role',false),code);
 await check('ACL denies browser roles and direct service table access',async()=>{
  const x=await capture();
  for(const role of ['anon','authenticated'])errorState(asRole(owner,readSql(x.s),role,false),'42501');
  for(const table of ['document_generation_sources','document_generation_source_bodies','document_generation_source_bytes'])
   errorState(asRole(null,`SELECT * FROM survey_private.${table}`,'service_role',false),'42501');
  denied(x.s,'42501',other);denied(fresh(),'42501');
  assert.deepEqual(read(x.s),x.envelope);
 });
 await check('unverified sources cannot return a private body',async()=>{
  const x=await capture({verified:false});denied(x.s);
 });
 await check('expired sources cannot return an old proof',async()=>{
  const x=await capture();sql(`UPDATE survey_private.document_generation_sources SET expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${x.s}'`);denied(x.s);
 });
 await check('changed PDF or sidecar metadata rejects the frozen source',async()=>{
  for(const kind of ['path','jsonPath']){const x=await capture();sql(`UPDATE storage.objects SET version='${fresh()}' WHERE bucket_id='documents' AND name=${quote(x[kind])}`);denied(x.s);}
 });
 await check('a different current generation rejects legacy captured coordinates',async()=>{
  const x=await capture(),generation=fresh();
  sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
   VALUES('${x.d}','${generation}',${x.envelope.wal_head},${bytea(modernBytes)},1);
   INSERT INTO survey_private.annotation_generation_heads VALUES('${x.d}','${generation}',${x.envelope.wal_head})`);
  denied(x.s,'SG001');
 });
 await check('accepted later WAL does not silently recapture or change the frozen body',async()=>{
  const x=await capture();asRole(owner,`SELECT public.append_annotation_update('${x.d}','later-writer',1,${bytea(modernTail)})`);
  assert.deepEqual(read(x.s),x.envelope);assert.equal(read(x.s).payload.wal_history.legacy.length,1);
  assert.equal(scalar(`SELECT count(*) FROM annotation_updates WHERE document_id='${x.d}'`),'2');
 });
 await check('body content hash and semantic identity corruption fail closed',async()=>{
  const x=await capture();
  for(const mutation of ["payload=payload||'{\"tampered\":true}'::jsonb","body_sha256=repeat('0',64)","payload=jsonb_set(payload,'{semantic,wal_head}','\"999\"')"]){
   const result=sql(`BEGIN;UPDATE survey_private.document_generation_source_bodies SET ${mutation} WHERE document_id='${x.d}';SET ROLE service_role;${readSql(x.s)}`,false);
   errorState(result,'23514');assert.deepEqual(read(x.s),x.envelope,'failed private corruption transaction rolls back');
  }
 });
 await check('held service read protects source body and object until transaction end',async()=>{
  const x=await capture(),held=session('transform_read_locks');held.send(`${readSql(x.s)};SELECT 'held';`);await held.wait('held');
  errorState(asRole(null,call('cancel_document_generation_source',[owner,x.s]),'service_role',false),'55P03');
  for(const query of [
   `UPDATE survey_private.document_generation_source_bodies SET payload=payload WHERE document_id='${x.d}'`,
   `UPDATE survey_private.document_generation_sources SET expires_at=expires_at WHERE source_id='${x.s}'`,
   `UPDATE storage.objects SET version=version WHERE name=${quote(x.path)}`,
  ])errorState(sql(`SET lock_timeout='50ms';${query}`,false),'55P03');
  assert.equal((await held.finish()).status,0);assert.deepEqual(read(x.s),x.envelope);
 });
 await check('reverse source and body contention fail fast with no stale read',async()=>{
  const x=await capture();
  for(const table of ['document_generation_sources','document_generation_source_bodies']){
   const held=session(`transform_${table==='document_generation_sources'?'source':'body'}_writer`,{role:'postgres'});
   held.send(`UPDATE survey_private.${table} SET document_id=document_id WHERE document_id='${x.d}';SELECT 'held';`);await held.wait('held');
   denied(x.s,'55P03');assert.equal((await held.finish(false)).status,0);assert.deepEqual(read(x.s),x.envelope);
  }
 });
 await check('repeatable read never uses a stale authority snapshot',async()=>{
  const x=await capture();errorState(asRole(null,`BEGIN ISOLATION LEVEL REPEATABLE READ;${readSql(x.s)}`,'service_role',false),'25001');
 });
 // Release only this disposable cluster's captured fixture receipts before the
 // next group, preserving actual per-actor source admission limits.
 sql("SELECT survey_private.release_document_generation_source(source_id,'canceled') FROM survey_private.document_generation_sources WHERE state='captured'");
 let roundtripChecks=0;const roundtripErrors=[];
 const rowSet=(table,where)=>JSON.parse(scalar(`SET TimeZone='UTC';SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.${table} r WHERE ${where}`));
 const writeRows=(table,rows)=>{
  if(!rows.length)return;
  const columns=Object.keys(rows[0]);assert.ok(columns.every(k=>/^[a-z_]+$/.test(k)));
  sql(`INSERT INTO public.${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM jsonb_populate_recordset(NULL::public.${table},${quote(JSON.stringify(rows))})
   ON CONFLICT(id) DO UPDATE SET ${columns.filter(k=>k!=='id').map(k=>`${k}=EXCLUDED.${k}`).join(',')}`);
 };
 for(const [operation,withIdAlias] of [[{type:'move',from:2,to:1},false],[{type:'copy',source:2,afterPage:3},false],[{type:'duplicate',page:2},true]]){
  const d=fresh(),path=`${owner}/roundtrip-${d}.pdf`,sessionIds=[fresh(),fresh()];let currentPdf=pdf;
  const captureRows=()=>{
   const s=fresh();service('begin_document_generation_source',[owner,d,s,null]);
   const c=fresh(),proof=service('claim_document_generation_source_bytes',[owner,s,c]);assert.equal(proof.objects.length,1);
   service('record_document_generation_source_bytes',[owner,s,c,JSON.stringify(proof.objects.map(o=>({...o,content_sha256:createHash('sha256').update(currentPdf).digest('hex')})))]);
   const envelope=read(s);service('cancel_document_generation_source',[owner,s]);return envelope.payload;
  };
  try{
   sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count) VALUES('${d}','${owner}','${project}','Marker roundtrip',${quote(path)},${pdf.length},3);
    INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(path)},'${version}',jsonb_build_object('size',${pdf.length}));
    INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,module_id,category_id,name,notes,version,last_modified_by,annotation_data)
     VALUES('${d}','${owner}','survey','survey-marker',2,'{"x":10,"y":20,"width":30,"height":40}','module','category','Original marker','Business note',3,'${owner}','{"scope":"survey","pageNumber":2}');
    INSERT INTO survey_sessions(id,template_id,user_id,document_id,is_active) VALUES
     ('${sessionIds[0]}','${id(10)}','${owner}','${d}',false),('${sessionIds[1]}','${id(10)}','${other}','${d}',false);
    INSERT INTO survey_items(session_id,annotation_id,module_id,category_id,page_number,notes,excel_row_index) VALUES
     ('${sessionIds[0]}','survey','module','category',2,'Own business note',7),('${sessionIds[1]}','survey','module','category',2,'Foreign business note',8)`);
   // A genuine legacy checkpoint and tail carry private metadata through the
   // serializer without introducing a competing rect/callout representation.
   const oldDoc=new Y.Doc();oldDoc.getMap('meta').set('privateContext','kept');
   const oldBytes=Y.encodeStateAsUpdate(oldDoc),oldVector=Y.encodeStateVector(oldDoc);
   oldDoc.getMap('meta').set('tailContext','accepted');const tail=Y.encodeStateAsUpdate(oldDoc,oldVector);oldDoc.destroy();
   sql(`INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${d}',${bytea(oldBytes)},${bytea(oldVector)},7);
    INSERT INTO doc_yjs_updates(document_id,client_id,seq,update) VALUES('${d}','legacy-roundtrip',8,${bytea(tail)})`);
   const original=rowSet('document_annotations',`document_id='${d}'`)[0];
   const marker=mapSurveyMarkerRowToLocalAnnotation(original);for(const key of Object.keys(marker))if(marker[key]===undefined)delete marker[key];
   if(withIdAlias)marker.id=marker.annotationId;
   const markerDoc=new Y.Doc();syncSurveyMarkersToDoc(markerDoc,{survey:marker});const initial=Y.encodeStateAsUpdate(markerDoc);markerDoc.destroy();
   assert.equal(asRole(owner,`SELECT public.store_annotation_snapshot('${d}',0,${bytea(initial)},1,'roundtrip',1,NULL,NULL,0)`).stdout,'t');
   const captured=captureRows(),input={sourcePayload:captured,operation,operationId:fresh(),pageCount:3,pageSizes,sidecars:[]};
   const first=await transformDocumentGenerationSource(input);
   const mutation=await mutatePdfPagesWithIdentity(currentPdf,operation);currentPdf=mutation.bytes;
   const changedPdf=await PDFDocument.load(currentPdf),changedCount=changedPdf.getPageCount(),changedSizes=changedPdf.getPages().map(p=>p.getSize());
   // Actual row updates/inserts invoke the tracked BEFORE UPDATE timestamps;
   // no trigger is disabled and no generation head/publication is fabricated.
   writeRows('document_annotations',first.projection.documentAnnotations);writeRows('survey_items',first.projection.surveyItems);
   assert.equal(first.legacyCheckpoint.documentId,d);assert.equal(first.legacyCheckpoint.throughSeq,'8');assert.equal(first.legacyCheckpoint.encodingVersion,1);
   sql(`UPDATE doc_yjs_state SET state=${bytea(first.legacyCheckpoint.state)},state_vector=${bytea(first.legacyCheckpoint.stateVector)},through_seq=${first.legacyCheckpoint.throughSeq},encoding_version=${first.legacyCheckpoint.encodingVersion} WHERE document_id='${d}'`);
   sql(`UPDATE documents SET page_count=${changedCount},file_size=${currentPdf.length} WHERE id='${d}';
    UPDATE storage.objects SET version='${fresh()}',metadata=jsonb_build_object('size',${currentPdf.length}) WHERE bucket_id='documents' AND name=${quote(path)}`);
   assert.equal(asRole(owner,`SELECT public.store_annotation_snapshot('${d}',0,${bytea(first.baselineUpdate)},1,'roundtrip',2,0,'roundtrip',1)`).stdout,'t');
   const written=rowSet('document_annotations',`document_id='${d}'`),writtenItems=rowSet('survey_items',`session_id IN('${sessionIds.join("','")}')`);
   assert.notEqual(written.find(r=>r.id===original.id).updated_at,original.updated_at,'real annotation UPDATE changes lastSyncedAt source');
   for(const item of captured.semantic.sources.survey_items)assert.notEqual(writtenItems.find(r=>r.id===item.id).updated_at,item.updated_at,'real survey-item UPDATE timestamp changed');
   const secondPayload=captureRows();
   assert.deepEqual(secondPayload.semantic.sources.document_annotations,written);
   assert.equal(secondPayload.semantic.sources.doc_yjs_state.through_seq,'8');
   assert.deepEqual(Buffer.from(secondPayload.semantic.sources.doc_yjs_state.state_base64,'base64'),Buffer.from(first.legacyCheckpoint.state));
   assert.deepEqual(Buffer.from(secondPayload.semantic.sources.doc_yjs_state.state_vector_base64,'base64'),Buffer.from(first.legacyCheckpoint.stateVector));
   assert.equal(secondPayload.semantic.sources.doc_yjs_updates[0].seq,'8','old WAL remains in the archive, not replayed past its checkpoint floor');
   assert.equal(secondPayload.semantic.sources.survey_items.length,operation.type==='move'?2:4);
   const secondInput={sourcePayload:secondPayload,operation:{type:'move',from:1,to:2},operationId:fresh(),pageCount:changedCount,pageSizes:changedSizes,sidecars:[]};
   const second=await transformDocumentGenerationSource(secondInput);
   assert.deepEqual(second.archive.sourcePayload,secondPayload);
   assert.equal(second.legacyCheckpoint.throughSeq,'8');
   assert.deepEqual(second.projection.legacyYjs.meta,{privateContext:'kept',tailContext:'accepted'});
   for(const row of second.projection.documentAnnotations){
    const live=second.projection.modern.surveyMarkers[row.annotation_id];
    assert.equal(live.supabaseId,row.id);assert.equal(live.userId,row.user_id);assert.equal(live.version,row.version);
    assert.equal(live.name,row.name);assert.equal(live.notes,row.notes);assert.equal(live.annotationId,row.annotation_id);
    if(live.id!=null)assert.equal(live.id,row.annotation_id);
   }
   if(operation.type!=='move'){
    const copied=written.find(r=>r.id!==original.id);assert.ok(copied);assert.notEqual(copied.annotation_id,'survey');
    assert.equal(first.projection.modern.surveyMarkers[copied.annotation_id].supabaseId,copied.id);
    for(const item of writtenItems.filter(r=>r.annotation_id===copied.annotation_id))assert.equal(item.excel_row_index,null);
   }
   // Benign SQL receipt timestamps/optional matching aliases are not license
   // to accept divergent row identity, version, authorship, or business state.
   for(const [label,assignment] of [['row id',`id='${fresh()}'`],['version','version=version+1'],['author',`user_id='${other}'`],['business',"notes='Different business note'"]]){
    sql(`UPDATE document_annotations SET ${assignment} WHERE document_id='${d}' AND annotation_id='survey'`);
    const badPayload=captureRows();
    await assert.rejects(transformDocumentGenerationSource({...secondInput,sourcePayload:badPayload}),e=>e.code==='DOCUMENT_GENERATION_TRANSFORM_INVALID',label);
    if(label==='row id')sql(`UPDATE document_annotations SET id='${original.id}' WHERE document_id='${d}' AND annotation_id='survey'`);
    writeRows('document_annotations',written);
   }
   roundtripChecks++;console.log(`PASS SQL marker roundtrip ${operation.type} timestamp and identity fences`);
  }catch(error){const failure=`${operation.type}: ${error.code||error.name} ${error.reason||error.message}`;roundtripErrors.push(failure);console.log(`FAIL SQL marker roundtrip ${failure}`);}
 }
 assert.deepEqual(roundtripErrors,[],'Real timestamp-trigger writeback must remain transformable while semantic conflicts reject');
 console.log(`Document generation transform PostgreSQL checks passed: ${count}`);
 console.log(`Document generation transform service-read PostgreSQL checks passed: ${readChecks}`);
 console.log(`Document generation transform SQL-writeback PostgreSQL checks passed: ${roundtripChecks}`);
},{name:'generation-transform'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
