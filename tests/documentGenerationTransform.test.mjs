import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { gzipSync } from 'node:zlib';
import { transformDocumentGenerationSource } from '../src/services/documentGenerationTransform.js';
import { syncByPageToDoc, docToByPage } from '../src/services/annotationDocStore.js';
import { PDFDocument } from 'pdf-lib';
import { mutatePdfPagesWithIdentity } from '../src/utils/pdfPageMutation.js';
import { transformPageState } from '../src/utils/pageAnnotationReindex.js';
import { mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
const uuid=n=>`86000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const documentId=uuid(1),actor=uuid(2),operationId=uuid(3);
const b64=bytes=>Buffer.from(bytes).toString('base64');
const shape={type:'rect',pageNumber:2,left:10,top:20,width:30,height:40,
  data:{id:'mark',pageNumber:2,notes:'kept'},meta:{authorId:actor}};
function fixture({generation=null,gzip=false}={}){
  const doc=new Y.Doc();syncByPageToDoc(doc,{2:{objects:[structuredClone(shape)]}});
  doc.getMap('annoMeta').set('spaces',[{id:'space',assignedPages:[{pageId:2,regions:[{regionId:'region',pageId:2,points:[1,2]}]}]}]);
  doc.getMap('annoMeta').set('futureFeature',{label:'kept',empty:false});
  const bytes=Y.encodeStateAsUpdate(doc);doc.destroy();
  const snapshot={document_id:documentId,at_seq:'9007199254740993',writer_epoch:'9007199254740994',
    encoding_version:gzip?2:1,snapshot_base64:b64(gzip?gzipSync(bytes):bytes)};
  const sources={annotation_snapshot:generation?null:snapshot,annotation_updates:[],document_annotations:[],
    doc_yjs_state:null,doc_yjs_updates:[],survey_sessions:[],survey_items:[],
    generation_baseline:generation?{document_id:documentId,generation_id:generation,base_seq:snapshot.at_seq,baseline_encoding_version:1,baseline_snapshot_base64:b64(bytes)}:null,
    generation_snapshot:null,generation_updates:[]};
  const sourcePayload={semantic:{version:1,document_id:documentId,generation_id:generation,
    document:{id:documentId,user_id:actor,page_count:3,current_page:2,zoom_level:1.5,template_id:uuid(9)},
    sources,wal_head:snapshot.at_seq,source_object:{bucket_id:'documents',path:'actor/source.pdf',id:uuid(4),version:uuid(5),byte_length:'100'},
    sidecar_objects:[],connector_consumed:{head:[],ops:[]}},connector_history:{audit:[{private:'kept'}]},wal_history:{legacy:[],generation:[]}};
  return {sourcePayload,sidecars:[],operationId,pageCount:3,pageSizes:[1,2,3].map(()=>({width:612,height:792})),copiedWidgets:[]};
}
test('pure private plan moves full modern state with exact large sequence and an unchanged owned archive',async()=>{
  const input={...fixture({gzip:true}),operation:{type:'move',from:2,to:1}};
  const before=structuredClone(input);const result=await transformDocumentGenerationSource(input);
  assert.equal(result.source.walHead,'9007199254740993');
  assert.equal(result.projection.modern.annotationsByPage[1].objects[0].data.id,'mark');
  assert.equal(result.projection.modern.annoMeta.spaces[0].assignedPages[0].pageId,1);
  assert.deepEqual(result.projection.modern.annoMeta.futureFeature,{label:'kept',empty:false});
  assert.deepEqual(input,before);assert.deepEqual(result.archive.sourcePayload,before.sourcePayload);
  const fresh=new Y.Doc();Y.applyUpdate(fresh,result.baselineUpdate);
  assert.equal(docToByPage(fresh)[1].objects[0].meta.authorId,actor);fresh.destroy();
  result.archive.sourcePayload.connector_history.audit[0].private='changed';
  assert.equal(input.sourcePayload.connector_history.audit[0].private,'kept');
});

for(const [operation,pages] of [[{type:'move',from:2,to:1},[1]],[{type:'insert',afterPage:1},[3]],
  [{type:'delete',page:2},[]],[{type:'rotate',page:2,delta:90},[2]],
  [{type:'duplicate',page:2},[2,3]],[{type:'copy',source:2,afterPage:3},[2,4]]]){
  test(`${operation.type} transforms SQL, nested legacy Yjs, sidecar and private inactive surveys together`,async()=>{
    const input={...fixture(),operation},s=input.sourcePayload.semantic.sources;
    s.document_annotations=[{id:uuid(20),document_id:documentId,user_id:actor,annotation_id:'mark',annotation_type:'rect',
      page_number:2,annotation_data:{fabricObject:structuredClone(shape),pageNumber:2,schemaVersion:1},created_at:'kept',custom:'kept'}];
    const legacy=new Y.Doc(),anno=new Y.Map(),fabric=new Y.Map(),meta=new Y.Map();
    for(const [k,v] of Object.entries(shape))fabric.set(k,structuredClone(v));
    meta.set('authorId',actor);meta.set('createdAt',123);
    anno.set('id','mark');anno.set('type','rect');anno.set('pageNumber',2);anno.set('fabric',fabric);anno.set('meta',meta);
    legacy.getMap('annotations').set('mark',anno);legacy.getMap('__annotationLatestSnapshot').set('mark',{oldPage:2});
    s.doc_yjs_state={document_id:documentId,state_base64:b64(Y.encodeStateAsUpdate(legacy)),through_seq:'4'};legacy.destroy();
    s.survey_sessions=[{id:uuid(30),document_id:documentId,user_id:uuid(31),is_active:false,template_id:uuid(32),excel_file_id:'private-workbook'}];
    s.survey_items=[{id:uuid(33),session_id:uuid(30),highlight_id:'mark',page_number:2,excel_row_index:5,
      notes:'foreign private note',bounds:{x:0.1,y:0.2},checklist_responses:{check:false}}];
    input.sourcePayload.semantic.sidecar_objects=[{bucket_id:'documents',path:'project/data.json',id:uuid(40),version:uuid(41),byte_length:'100'}];
    input.sidecars=[{path:'project/data.json',content:{version:1,pdfId:'legacy-id',updatedAt:'kept',
      annotationsByPage:{2:{objects:[structuredClone(shape)]}},annotations:{},callouts:[],spaces:[],entities:[{id:'entity',name:'GC'}],
      currentPage:2,zoomLevel:1.25,templateId:uuid(32)}}];
    const before=structuredClone(input),result=await transformDocumentGenerationSource(input);
    assert.deepEqual(Object.keys(result.projection.modern.annotationsByPage).map(Number),pages);
    assert.deepEqual(result.projection.documentAnnotations.map(r=>r.page_number),pages);
    assert.deepEqual(Object.values(result.projection.legacyYjs.annotations).map(r=>r.pageNumber),pages);
    assert.deepEqual(result.projection.surveyItems.map(r=>r.page_number),pages);
    assert.deepEqual(result.projection.modern.surveyMarkers,{},'foreign survey never enters shared markers');
    assert.equal(result.projection.surveySessions[0].user_id,uuid(31));
    assert.equal(result.projection.surveySessions[0].is_active,false);
    assert.deepEqual(result.projection.sidecars[0].content.entities,[{id:'entity',name:'GC'}]);
    assert.equal(result.projection.sidecars[0].content.zoomLevel,1.25);
    assert.deepEqual(input,before);assert.deepEqual(result.archive.sourcePayload,before.sourcePayload);
    for(const row of result.projection.documentAnnotations)assert.equal(row.user_id,actor);
    if(pages.length===2){
      const copied=result.projection.modern.annotationsByPage[pages[1]].objects[0].data.id;
      assert.equal(result.projection.documentAnnotations[1].annotation_id,copied);
      assert.equal(result.projection.legacyYjs.annotations[copied].meta.authorId,actor);
      assert.equal(result.projection.surveyItems[1].highlight_id,copied);
      assert.equal(result.projection.surveyItems[1].excel_row_index,null);
      assert.equal(result.projection.surveyItems[1].notes,'foreign private note');
      assert.equal(result.projection.sidecars[0].content.annotationsByPage[pages[1]].objects[0].data.id,copied);
    }
    const replay=await transformDocumentGenerationSource(input);
    assert.deepEqual(replay.baselineUpdate,result.baselineUpdate);assert.deepEqual(replay.identityMap,result.identityMap);
  });
}

test('copy factory context exposes source identity without breaking existing zero-argument factories',()=>{
  const input={annotationsByPage:{1:{objects:[{type:'rect',data:{id:'old'}}]}},
    spaces:[{id:'space',assignedPages:[{pageId:1,regions:[{regionId:'region'}]}]}]};
  const seen=[];transformPageState(input,{type:'duplicate',page:1},{createId:context=>{seen.push(context);return `${context.kind}-copy`;}});
  assert.deepEqual(seen,[{kind:'region',sourceId:'region'},{kind:'annotation',sourceId:'old'}]);
  assert.equal(transformPageState(input,{type:'duplicate',page:1},{createId:()=> 'copy'}).annotationsByPage[2].objects[0].data.id,'copy');
});

test('generated baseline replays exact contiguous tail while legacy global WAL permits gaps',async()=>{
  for(const generated of [false,true]){
    const input=fixture({generation:generated?uuid(50):null}),s=input.sourcePayload.semantic.sources;
    input.operation={type:'insert',afterPage:1};
    const doc=new Y.Doc(),baseline=generated?s.generation_baseline.baseline_snapshot_base64:s.annotation_snapshot.snapshot_base64;
    Y.applyUpdate(doc,Buffer.from(baseline,'base64'));const vector=Y.encodeStateVector(doc);
    doc.getMap('annoMeta').set('remote',{text:'new'});const update=b64(Y.encodeStateAsUpdate(doc,vector));doc.destroy();
    const next=generated?'9007199254740994':'9007199254740998';input.sourcePayload.semantic.wal_head=next;
    s[generated?'generation_updates':'annotation_updates']=[{document_id:documentId,...(generated?{generation_id:uuid(50)}:{}),seq:next,client_seq:'9007199254740995',data_base64:update}];
    assert.equal((await transformDocumentGenerationSource(input)).projection.modern.annoMeta.remote.text,'new');
    if(generated){s.generation_updates[0].seq='9007199254740995';input.sourcePayload.semantic.wal_head='9007199254740995';
      await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='wal-order');}
  }
});

test('a current standalone generation checkpoint replaces baseline state instead of reviving its absent marks',async()=>{
  const input={...fixture({generation:uuid(50)}),operation:{type:'move',from:2,to:1}};
  const doc=new Y.Doc();syncByPageToDoc(doc,{1:{objects:[{type:'rect',data:{id:'only-current'}}]}});
  input.sourcePayload.semantic.sources.generation_snapshot={document_id:documentId,generation_id:uuid(50),
    at_seq:input.sourcePayload.semantic.wal_head,writer_epoch:'9007199254740999',encoding_version:1,snapshot_base64:b64(Y.encodeStateAsUpdate(doc))};doc.destroy();
  const result=await transformDocumentGenerationSource(input);
  assert.deepEqual(result.projection.modern.annotationsByPage[2].objects.map(o=>o.data.id),['only-current']);
  assert.equal(Object.values(result.projection.modern.annotationsByPage).flatMap(p=>p.objects).length,1);
  input.sourcePayload.semantic.sources.generation_snapshot.at_seq='9007199254740994';
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='checkpoint');
});

test('copied SQL and sidecar carriers use the same copied region and never inherit Excel receipts',async()=>{
  const input={...fixture(),operation:{type:'duplicate',page:2}},s=input.sourcePayload.semantic.sources;
  const doc=new Y.Doc();Y.applyUpdate(doc,Buffer.from(s.annotation_snapshot.snapshot_base64,'base64'));
  const o={...structuredClone(shape),excelSync:{assignedToken:'old-token'},exportedAt:'old',excelRowIndex:9};
  o.data.regionId='region';o.data.excelSync={assignedToken:'old-token'};
  syncByPageToDoc(doc,{2:{objects:[o]}});s.annotation_snapshot.snapshot_base64=b64(Y.encodeStateAsUpdate(doc));doc.destroy();
  s.document_annotations=[{id:uuid(60),document_id:documentId,user_id:actor,annotation_id:'mark',annotation_type:'rect',page_number:2,
    excelRowIndex:9,exportedAt:'old',annotation_data:{fabricObject:o,pageNumber:2,excelSync:{assignedToken:'old-token'},
      data:{excelSync:{assignedToken:'nested-old'},legacyCallout:{exportedAt:'nested-old'}}}}];
  const before=structuredClone(input);
  const result=await transformDocumentGenerationSource(input),copy=result.projection.documentAnnotations[1];
  const region=result.projection.modern.annoMeta.spaces[0].assignedPages[1].regions[0].regionId;
  assert.equal(copy.annotation_data.fabricObject.data.regionId,region);
  assert.equal(result.projection.modern.annotationsByPage[3].objects[0].data.regionId,region);
  assert.equal(copy.excelRowIndex,undefined);assert.equal(copy.exportedAt,undefined);assert.equal(copy.annotation_data.excelSync,undefined);
  assert.equal(copy.annotation_data.fabricObject.excelSync,undefined);
  assert.equal(result.projection.documentAnnotations[0].annotation_data.fabricObject.excelSync.assignedToken,'old-token');
  assert.deepEqual(input,before);assert.deepEqual(result.archive.sourcePayload,before.sourcePayload);
  assert.deepEqual(result.projection.documentAnnotations[0].annotation_data.data,before.sourcePayload.semantic.sources.document_annotations[0].annotation_data.data);
  assert.equal(copy.annotation_data.data.excelSync,undefined);assert.equal(copy.annotation_data.data.legacyCallout.exportedAt,undefined);
});

test('outer and nested page_number aliases in actual Yjs, bookmarks and regions follow their physical page',async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},s=input.sourcePayload.semantic.sources;
  const doc=new Y.Doc();const o=structuredClone(shape);o.page_number=2;o.data.page_number=2;
  syncByPageToDoc(doc,{2:{objects:[o]}});
  doc.getMap('annoMeta').set('bookmarks',[{id:'bookmark',pageNumber:2,page_number:2}]);
  doc.getMap('annoMeta').set('spaces',[{id:'space',assignedPages:[{pageId:2,page_number:2,regions:[{regionId:'r',page_number:2}]}]}]);
  s.annotation_snapshot.snapshot_base64=b64(Y.encodeStateAsUpdate(doc));doc.destroy();
  const result=await transformDocumentGenerationSource(input),modern=result.projection.modern;
  assert.equal(modern.annotationsByPage[1].objects[0].page_number,1);
  assert.equal(modern.annotationsByPage[1].objects[0].data.page_number,1);
  assert.equal(modern.annoMeta.bookmarks[0].page_number,1);
  assert.equal(modern.annoMeta.spaces[0].assignedPages[0].page_number,1);
  assert.equal(modern.annoMeta.spaces[0].assignedPages[0].regions[0].page_number,1);
});

test('actual copied PDF widget map preserves field IDs, value and original author in a fresh generation',async()=>{
  const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();pdf.addPage();
  const field=pdf.getForm().createTextField('inspection');field.setText('kept');field.addToPage(pdf.getPage(1));
  const input=fixture(),op={type:'duplicate',page:2};
  const rewritten=await mutatePdfPagesWithIdentity(await pdf.save(),op),map=rewritten.copiedWidgets[0];
  const doc=new Y.Doc(),id=`form-field:2:${map.sourceFieldId}`;
  syncByPageToDoc(doc,{2:{objects:[{type:'form-field',id,pageNumber:2,fieldId:map.sourceFieldId,fieldName:'inspection',
    data:{id,fieldId:map.sourceFieldId,fieldName:'inspection',value:'kept',pageNumber:2},meta:{authorId:actor}}]}});
  input.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64=b64(Y.encodeStateAsUpdate(doc));doc.destroy();
  const result=await transformDocumentGenerationSource({...input,operation:op,copiedWidgets:rewritten.copiedWidgets});
  const copy=result.projection.modern.annotationsByPage[3].objects[0];
  assert.equal(copy.data.fieldId,map.targetFieldId);assert.equal(copy.data.fieldName,map.targetFieldName);
  assert.equal(copy.data.value,'kept');assert.equal(copy.meta.authorId,actor);
});

function setModern(input,doc){input.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64=b64(Y.encodeStateAsUpdate(doc));doc.destroy();}
function legacyOnly(input,doc){const semantic=input.sourcePayload.semantic;semantic.sources.annotation_snapshot=null;semantic.wal_head='0';
  semantic.sources.doc_yjs_state={document_id:documentId,through_seq:'0',state_base64:b64(Y.encodeStateAsUpdate(doc))};doc.destroy();}
function attachSidecar(input,content){input.sourcePayload.semantic.sidecar_objects=[{bucket_id:'documents',path:'data.json'}];input.sidecars=[{path:'data.json',content}];}

test('all reviewed scalar/list page aliases remap in SQL, sidecars and accepted metadata',async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},s=input.sourcePayload.semantic.sources;
  const doc=new Y.Doc();syncByPageToDoc(doc,{2:{objects:[structuredClone(shape)]}});
  doc.getMap('annoMeta').set('currentPage',2);
  doc.getMap('annoMeta').set('bookmarks',[{id:'b',pageNumbers:[2]}]);
  doc.getMap('annoMeta').set('spaces',[{id:'s',assignedPages:[{pageId:2,targetPage:2,regions:[]}]}]);setModern(input,doc);
  s.document_annotations=[{id:uuid(60),document_id:documentId,annotation_id:'mark',annotation_type:'rect',page_number:2,pageNumber:2,
    annotation_data:{fabricObject:structuredClone(shape),pageNumber:2,page_number:2}}];
  attachSidecar(input,{version:1,current_page:2});
  const r=await transformDocumentGenerationSource(input),m=r.projection.modern.annoMeta,row=r.projection.documentAnnotations[0];
  assert.equal(m.currentPage,1);assert.deepEqual(m.bookmarks[0].pageNumbers,[1]);assert.equal(m.spaces[0].assignedPages[0].targetPage,1);
  assert.equal(row.page_number,1);assert.equal(row.pageNumber,1);assert.equal(row.annotation_data.page_number,1);assert.equal(row.annotation_data.pageNumber,1);
  assert.equal(r.projection.sidecars[0].content.current_page,1);
});

test('dedicated copied survey marker preserves business data but remaps nested region and SQL row receipts',async()=>{
  const input={...fixture(),operation:{type:'duplicate',page:2}},s=input.sourcePayload.semantic.sources;
  const row={id:uuid(60),document_id:documentId,user_id:actor,annotation_id:'survey',annotation_type:'survey-marker',page_number:2,
    bounds:{x:1,y:2},name:'Private note',updated_at:'2026-09-08T00:00:00Z',excelRowIndex:8,
    annotation_data:{regionId:'region',scope:'survey-region',pageNumber:2,excelSync:{assignedToken:'old'},exportedAt:'old',
      data:{excelRowIndex:8}}};
  const marker=mapSurveyMarkerRowToLocalAnnotation(row);for(const k of Object.keys(marker))if(marker[k]===undefined)delete marker[k];
  const d=new Y.Doc();d.getMap('surveyMarkers').set('survey',marker);setModern(input,d);s.document_annotations=[row];
  const before=structuredClone(input),r=await transformDocumentGenerationSource(input),copy=r.projection.documentAnnotations[1];
  const copied=r.projection.modern.surveyMarkers[copy.annotation_id];
  assert.equal(copied.supabaseId,copy.id);assert.notEqual(copy.id,row.id);assert.equal(copied.lastSyncedAt,undefined);
  assert.equal(copied.annotationData.regionId,copied.regionId);assert.equal(copy.annotation_data.regionId,copied.regionId);
  assert.equal(copied.annotationData.pageNumber,3);assert.equal(copy.annotation_data.excelSync,undefined);assert.equal(copied.annotationData.excelSync,undefined);
  assert.equal(copied.annotationData.data.excelRowIndex,undefined);assert.equal(copy.name,row.name);
  assert.deepEqual(r.projection.documentAnnotations[0],row);assert.deepEqual(input,before);assert.deepEqual(r.archive.sourcePayload,before.sourcePayload);
});

function markerComparisonFixture(){
  const input={...fixture(),operation:{type:'move',from:2,to:1}};
  const row={id:uuid(60),document_id:documentId,user_id:actor,last_modified_by:actor,annotation_id:'survey',
    annotation_type:'survey-marker',page_number:2,version:3,bounds:{x:1,y:2},name:'Kept',notes:'Original',
    updated_at:'2026-09-08T00:00:00Z',annotation_data:{regionId:'region',scope:'survey-region'}};
  input.sourcePayload.semantic.sources.document_annotations=[row];
  const marker=mapSurveyMarkerRowToLocalAnnotation(row);for(const k of Object.keys(marker))if(marker[k]===undefined)delete marker[k];
  return {input,row,marker:structuredClone(marker)};
}
function installMarker(input,marker){const d=new Y.Doc();d.getMap('surveyMarkers').set('survey',marker);setModern(input,d);}

for(const alias of [false,true])test(`marker comparison accepts only server receipt time drift${alias?' with a matching id alias':''}`,async()=>{
  const {input,row,marker}=markerComparisonFixture();if(alias)marker.id=marker.annotationId;installMarker(input,marker);
  row.updated_at='2026-09-09T01:02:03Z';const before=structuredClone(input),result=await transformDocumentGenerationSource(input);
  assert.equal(result.projection.modern.surveyMarkers.survey.pageNumber,1);
  assert.equal(result.projection.modern.surveyMarkers.survey.lastSyncedAt,'2026-09-08T00:00:00Z');
  assert.equal(result.projection.documentAnnotations[0].updated_at,row.updated_at);
  assert.deepEqual(input,before);assert.deepEqual(result.archive.sourcePayload,before.sourcePayload);
});

test('copied marker baseline can be compared with re-read SQL rows on the next transform',async()=>{
  const {input,marker}=markerComparisonFixture();installMarker(input,marker);input.operation={type:'duplicate',page:2};
  const first=await transformDocumentGenerationSource(input),next=fixture();
  next.pageCount=4;next.pageSizes.push({width:612,height:792});next.operation={type:'move',from:3,to:1};
  next.sourcePayload.semantic.document=first.projection.document;
  next.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64=b64(first.baselineUpdate);
  next.sourcePayload.semantic.sources.document_annotations=first.projection.documentAnnotations.map(r=>({...r,updated_at:'2026-09-09T02:03:04Z'}));
  const second=await transformDocumentGenerationSource(next),copiedId=first.projection.documentAnnotations[1].annotation_id;
  assert.equal(second.projection.modern.surveyMarkers[copiedId].pageNumber,1);
  assert.equal(second.projection.modern.surveyMarkers[copiedId].supabaseId,first.projection.documentAnnotations[1].id);
});

for(const key of ['supabaseId','version','userId','lastModifiedBy','bounds','name','annotationData'])test(`marker comparison still rejects changed ${key}`,async()=>{
  const {input,marker}=markerComparisonFixture();marker.id=marker.annotationId;marker.lastSyncedAt='different-time';
  marker[key]=key==='version'?9:key==='bounds'?{x:999,y:2}:key==='annotationData'?{regionId:'other',scope:'survey-region'}:'different';
  installMarker(input,marker);await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='representation-conflict');
});

for(const alias of [null,'different'])test(`marker comparison rejects invalid optional id ${alias}`,async()=>{
  const {input,marker}=markerComparisonFixture();marker.id=alias;installMarker(input,marker);
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.code==='DOCUMENT_GENERATION_TRANSFORM_INVALID');
});

test('marker id alias requires an explicit matching annotationId, and nested timestamps remain semantic',async()=>{
  for(const missing of [true,false]){
    const {input,marker}=markerComparisonFixture();
    if(missing){marker.id='survey';delete marker.annotationId;}
    else marker.annotationData.lastSyncedAt='nested business value';
    installMarker(input,marker);await assert.rejects(transformDocumentGenerationSource(input),e=>e.code==='DOCUMENT_GENERATION_TRANSFORM_INVALID');
  }
});

test('legacy fallback accepts equivalent SQL and sidecar markers without relaxing their identity checks',async()=>{
  const {input,marker}=markerComparisonFixture();input.sourcePayload.semantic.sources.annotation_snapshot=null;input.sourcePayload.semantic.wal_head='0';
  marker.id=marker.annotationId;marker.lastSyncedAt='later receipt';attachSidecar(input,{version:1,annotations:{survey:marker}});
  assert.equal((await transformDocumentGenerationSource(input)).projection.modern.surveyMarkers.survey.pageNumber,1);
  marker.version=99;await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='representation-conflict');
});

test('moving a form carrier changes its page-derived alias without minting a new SQL row or clearing its receipt',async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},s=input.sourcePayload.semantic.sources;
  const id='form-field:2:15R',form={type:'form-field',id,fieldId:'15R',pageNumber:2,data:{id,type:'form-field',fieldId:'15R',pageNumber:2,value:'kept'}};
  const d=new Y.Doc();syncByPageToDoc(d,{2:{objects:[form]}});setModern(input,d);
  s.document_annotations=[{id:uuid(60),document_id:documentId,annotation_id:id,annotation_type:'form-field',page_number:2,exportedAt:'old',annotation_data:{fabricObject:form}}];
  const row=(await transformDocumentGenerationSource(input)).projection.documentAnnotations[0];
  assert.equal(row.id,uuid(60));assert.equal(row.annotation_id,'form-field:1:15R');assert.equal(row.exportedAt,'old');
});

function linkedFormFixture(operation,{rows=true}={}){
  const input={...fixture(),operation},s=input.sourcePayload.semantic.sources;
  const forms=[1,2].map(p=>{const id=`form-field:${p}:15R`;return{type:'form-field',id,fieldId:'15R',pageNumber:p,
    data:{type:'form-field',id,fieldId:'15R',pageNumber:p,value:`value-${p}`},meta:{authorId:actor}};});
  const d=new Y.Doc();syncByPageToDoc(d,{1:{objects:[forms[0]]},2:{objects:[forms[1],structuredClone(shape)]}});setModern(input,d);
  if(rows)s.document_annotations=forms.map((o,i)=>({id:uuid(70+i),document_id:documentId,user_id:actor,annotation_id:o.id,
    annotation_type:'form-field',page_number:i+1,annotation_data:{fabricObject:o}}));
  s.survey_sessions=[{id:uuid(30),document_id:documentId,user_id:uuid(31),is_active:false,template_id:uuid(32)}];
  s.survey_items=forms.map((o,i)=>({id:uuid(80+i),session_id:uuid(30),annotation_id:o.id,highlight_id:o.id,page_number:i+1,
    notes:`private-${i}`,version:9,excel_row_index:i+10,changed_by:'original'}));
  s.survey_items.push({id:uuid(82),session_id:uuid(30),annotation_id:'mark',page_number:2,notes:'non-form',excel_row_index:12});
  return input;
}

for(const type of ['move','reorder'])for(const rows of [true,false])test(`${type} propagates surviving form identity to private survey links (SQL rows=${rows})`,async()=>{
  const input=linkedFormFixture({type,from:2,to:1},{rows}),before=structuredClone(input),result=await transformDocumentGenerationSource(input);
  for(const [i,p] of [[0,2],[1,1]]){
    const original=before.sourcePayload.semantic.sources.survey_items[i],item=result.projection.surveyItems[i];
    assert.deepEqual(item,{...original,page_number:p,annotation_id:`form-field:${p}:15R`,highlight_id:`form-field:${p}:15R`});
    if(rows)assert.equal(result.projection.documentAnnotations[i].annotation_id,item.annotation_id);
    const form=result.projection.modern.annotationsByPage[p].objects.find(o=>o.type==='form-field');assert.equal(form.data.id,item.annotation_id);
  }
  assert.equal(result.projection.surveyItems[2].annotation_id,'mark');assert.equal(result.projection.surveyItems[2].page_number,1);
  assert.deepEqual(input,before);assert.deepEqual(result.archive.sourcePayload,before.sourcePayload);
});

test('copy keeps shifted survivor links separate from fresh copied form links',async()=>{
  const input=linkedFormFixture({type:'copy',source:2,afterPage:1});
  input.copiedWidgets=[{sourcePage:2,targetPage:2,sourceFieldId:'15R',targetFieldId:'45R',targetFieldName:'copied'}];
  const original=input.sourcePayload.semantic.sources.survey_items[1],result=await transformDocumentGenerationSource(input);
  const survivor=result.projection.surveyItems.find(r=>r.id===original.id),copy=result.projection.surveyItems.find(r=>r.notes===original.notes&&r.id!==original.id);
  assert.equal(survivor.annotation_id,'form-field:3:15R');assert.equal(survivor.highlight_id,'form-field:3:15R');assert.equal(survivor.excel_row_index,original.excel_row_index);
  assert.equal(copy.annotation_id,'form-field:2:45R');assert.equal(copy.highlight_id,'form-field:2:45R');assert.equal(copy.excel_row_index,null);
  assert.equal(result.identityMap.annotations[original.annotation_id],copy.annotation_id);
});

test('sidecar-only legacy form links are resolved after all source representations are read',async()=>{
  const input=linkedFormFixture({type:'move',from:2,to:1},{rows:false}),s=input.sourcePayload.semantic.sources,d=new Y.Doc();
  Y.applyUpdate(d,Buffer.from(s.annotation_snapshot.snapshot_base64,'base64'));const byPage=docToByPage(d);d.destroy();
  s.annotation_snapshot=null;input.sourcePayload.semantic.wal_head='0';attachSidecar(input,{version:1,annotationsByPage:byPage});
  const item=s.survey_items[1];delete item.annotation_id;
  const result=await transformDocumentGenerationSource(input),saved=result.projection.surveyItems.find(r=>r.id===item.id);
  assert.equal(saved.highlight_id,'form-field:1:15R');assert.equal(Object.hasOwn(saved,'annotation_id'),false);
  assert.equal(result.projection.sidecars[0].content.annotationsByPage[1].objects[0].data.id,saved.highlight_id);
});

test('unplaced linked business row keeps its null page while its known surviving form identity moves',async()=>{
  const input=linkedFormFixture({type:'move',from:2,to:1}),row=input.sourcePayload.semantic.sources.survey_items[1];row.page_number=null;
  const original=structuredClone(row),saved=(await transformDocumentGenerationSource(input)).projection.surveyItems.find(r=>r.id===row.id);
  assert.deepEqual(saved,{...original,annotation_id:'form-field:1:15R',highlight_id:'form-field:1:15R'});
});

test('survey page or shared representation disagreement rejects instead of attaching to the wrong survivor',async()=>{
  const wrongPage=linkedFormFixture({type:'move',from:2,to:1});wrongPage.sourcePayload.semantic.sources.survey_items[1].page_number=1;
  const before=structuredClone(wrongPage);await assert.rejects(transformDocumentGenerationSource(wrongPage),e=>e.reason==='survey-identity-page');assert.deepEqual(wrongPage,before);
  const disagree=linkedFormFixture({type:'move',from:2,to:1},{rows:false}),d=new Y.Doc();
  Y.applyUpdate(d,Buffer.from(disagree.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64,'base64'));
  d.getMap('surveyMarkers').set('form-field:2:15R',{annotationId:'form-field:2:15R',pageNumber:2});setModern(disagree,d);
  await assert.rejects(transformDocumentGenerationSource(disagree),e=>e.reason==='survivor-identity-conflict');
});

for(const [operation,p] of [[{type:'insert',afterPage:1},3],[{type:'delete',page:1},1]])test(`${operation.type} propagates a shifted surviving form ID without treating it as a copy`,async()=>{
  const input=linkedFormFixture(operation),row=input.sourcePayload.semantic.sources.survey_items[1];
  const saved=(await transformDocumentGenerationSource(input)).projection.surveyItems.find(r=>r.id===row.id);
  assert.equal(saved.annotation_id,`form-field:${p}:15R`);assert.equal(saved.excel_row_index,row.excel_row_index);
  assert.equal(saved.notes,row.notes);assert.equal(saved.version,row.version);
});

for(const mode of ['legacy-empty','generated-empty-baseline','generated-empty-snapshot'])test(`${mode} remains authoritative and never resurrects stale SQL`,async()=>{
  const input={...fixture({generation:mode==='legacy-empty'?null:uuid(50)}),operation:{type:'move',from:2,to:1}},s=input.sourcePayload.semantic.sources;
  const empty=new Y.Doc(),bytes=b64(Y.encodeStateAsUpdate(empty));empty.destroy();
  if(mode==='legacy-empty')s.annotation_snapshot.snapshot_base64=bytes;
  else if(mode==='generated-empty-baseline')s.generation_baseline.baseline_snapshot_base64=bytes;
  else s.generation_snapshot={document_id:documentId,generation_id:uuid(50),at_seq:input.sourcePayload.semantic.wal_head,encoding_version:1,snapshot_base64:bytes};
  assert.deepEqual((await transformDocumentGenerationSource(input)).projection.modern.annotationsByPage,{});
  s.document_annotations=[{id:uuid(60),document_id:documentId,annotation_id:'mark',annotation_type:'rect',page_number:2,annotation_data:{fabricObject:structuredClone(shape)}}];
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='representation-conflict');
});

test('gzip generation baseline and deterministic copy bytes do not depend on wall time',async()=>{
  const input={...fixture({generation:uuid(50)}),operation:{type:'duplicate',page:2}},base=input.sourcePayload.semantic.sources.generation_baseline;
  base.baseline_snapshot_base64=b64(gzipSync(Buffer.from(base.baseline_snapshot_base64,'base64')));base.baseline_encoding_version=2;
  const old=Date.now;try{Date.now=()=>1000;const first=await transformDocumentGenerationSource(input);Date.now=()=>9000000;
    const second=await transformDocumentGenerationSource(input);assert.deepEqual(first.baselineUpdate,second.baselineUpdate);assert.deepEqual(first.projection,second.projection);
  }finally{Date.now=old;}
});

for(const sourceId of ['constructor','__proto__','toString'])test(`private current-schema survey identity ${sourceId} remains a JSON string on copy`,async()=>{
  const input={...fixture(),operation:{type:'duplicate',page:2}},s=input.sourcePayload.semantic.sources;
  s.survey_sessions=[{id:uuid(30),document_id:documentId,user_id:uuid(31),is_active:false}];
  s.survey_items=[{id:uuid(33),session_id:uuid(30),annotation_id:sourceId,page_number:2,excel_row_index:7}];
  const r=await transformDocumentGenerationSource(input),copy=r.projection.surveyItems[1];
  assert.equal(r.projection.surveyItems[0].annotation_id,sourceId);assert.equal(typeof copy.annotation_id,'string');assert.notEqual(copy.annotation_id,sourceId);
  assert.equal(Object.hasOwn(copy,'highlight_id'),false);assert.equal(copy.annotation_id,r.identityMap.annotations[sourceId]);
  assert.deepEqual(JSON.parse(JSON.stringify(r.projection.surveyItems)),r.projection.surveyItems);
  s.survey_items[0].highlight_id='different';await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='survey-item');
});

test('legacy creator undo restores a collaborator-owned latest field without replaying opaque undo history',async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},d=new Y.Doc();
  d.getMap('__annotationUndoCreateMarkers').set('mark',{creatorId:actor});
  d.getMap('__annotationLatestSnapshot').set('mark',{id:'mark',type:'rect',pageNumber:2,fabric:structuredClone(shape),meta:{authorId:actor,createdAt:123}});
  const owners=new Y.Map();owners.set('left',uuid(99));d.getMap('__annotationFabricFieldOwners').set('mark',owners);
  const fields=new Y.Map();fields.set('left',900);d.getMap('__annotationLatestFabricFields').set('mark',fields);legacyOnly(input,d);
  const before=structuredClone(input),r=await transformDocumentGenerationSource(input);
  assert.equal(r.projection.modern.annotationsByPage[1].objects[0].left,900);
  assert.equal(r.projection.legacyYjs.annotations.mark.meta.authorId,actor);assert.deepEqual(r.archive.sourcePayload,before.sourcePayload);
});

test('legacy deletion tombstones cannot resurrect through creator-undo snapshots or stale secondary rows',async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},d=new Y.Doc();
  d.getMap('__annotationDeletionTombstones').set('mark',{deletedBy:actor});
  d.getMap('__annotationUndoCreateMarkers').set('mark',{creatorId:actor});
  d.getMap('__annotationLatestSnapshot').set('mark',{id:'mark',type:'rect',pageNumber:2,fabric:structuredClone(shape),meta:{authorId:actor}});
  legacyOnly(input,d);assert.deepEqual((await transformDocumentGenerationSource(input)).projection.modern.annotationsByPage,{});
  input.sourcePayload.semantic.sources.document_annotations=[{id:uuid(60),document_id:documentId,annotation_id:'mark',page_number:2,annotation_type:'rect',annotation_data:{fabricObject:structuredClone(shape)}}];
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='legacy-delete-conflict');
});

test('compressed state exceeding the total decoded budget fails without exposing private contents',async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}};
  const bytes=Buffer.alloc(65*1024*1024,65);input.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64=b64(gzipSync(bytes));
  input.sourcePayload.semantic.sources.annotation_snapshot.encoding_version=2;
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.code==='DOCUMENT_GENERATION_TRANSFORM_INVALID');
});

test('a Yjs delta with missing causal state fails instead of publishing a partial baseline',async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},d=new Y.Doc();d.getMap('annoMeta').set('key','first');const vector=Y.encodeStateVector(d);
  d.getMap('annoMeta').set('key','second');input.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64=b64(Y.encodeStateAsUpdate(d,vector));d.destroy();
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.reason==='yjs-dependencies');
});

for(const authoritative of [true,false])test(`SQL reconciliation traverses annotation buckets linearly (${authoritative?'accepted checkpoint':'legacy fallback'})`,async t=>{
  const run=async count=>{
    const input={...fixture(),operation:{type:'move',from:2,to:1}},s=input.sourcePayload.semantic.sources;
    const objects=Array.from({length:count},(_,i)=>({...structuredClone(shape),data:{id:`scale-${i}`,pageNumber:2}}));
    if(authoritative){const d=new Y.Doc();syncByPageToDoc(d,{2:{objects}});setModern(input,d);}
    else {s.annotation_snapshot=null;input.sourcePayload.semantic.wal_head='0';}
    s.document_annotations=objects.map((o,i)=>({id:uuid(1000+i),document_id:documentId,user_id:actor,annotation_id:o.data.id,
      annotation_type:'rect',page_number:2,annotation_data:{fabricObject:o}}));
    const entries=Object.entries;let traversed=0;
    // Count actual module/utility bucket traversals, not wall time. Inputs are
    // built before instrumentation and this test runs without concurrency.
    Object.entries=value=>{const result=entries(value);for(const [,bucket] of result){
      if(Array.isArray(bucket?.objects)&&bucket.objects[0]?.data?.id?.startsWith('scale-'))traversed+=bucket.objects.length;
    }return result;};
    let result;try{result=await transformDocumentGenerationSource(input);}finally{Object.entries=entries;}
    assert.deepEqual(result.projection.modern.annotationsByPage[1].objects.map(o=>o.data.id),objects.map(o=>o.data.id));
    assert.equal(result.projection.documentAnnotations.length,count);
    return traversed;
  };
  const small=await run(100),large=await run(500);
  t.diagnostic(`100 rows: ${small} bucket-object visits; 500 rows: ${large}`);
  assert.ok(large<=small*5.5,`500 rows visited ${large} bucket objects vs ${small} at 100 rows`);
  assert.ok(large<500*50,`500 rows visited ${large} bucket objects`);
});

for(const type of ['raw','callout'])for(const embedded of [null,uuid(99)])test(`${type} fallback keeps ${embedded?'embedded':'SQL row'} author in the next baseline`,async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},s=input.sourcePayload.semantic.sources;
  s.annotation_snapshot=null;input.sourcePayload.semantic.wal_head='0';
  const value={type:type==='raw'?'rect':'callout',id:'owned-mark',pageNumber:2,...(embedded?{meta:{authorId:embedded}}:{})};
  s.document_annotations=[{id:uuid(60),document_id:documentId,user_id:actor,annotation_id:'owned-mark',annotation_type:type==='raw'?'rect':'callout',
    page_number:2,annotation_data:type==='raw'?value:{callout:value}}];
  const before=structuredClone(input),result=await transformDocumentGenerationSource(input),d=new Y.Doc();
  try{Y.applyUpdate(d,result.baselineUpdate);const saved=docToByPage(d)[1].objects[0];
    assert.equal(type==='raw'?saved.meta.authorId:saved.data.authorId,embedded||actor);
    if(type==='callout')assert.equal(saved.data.legacyCallout.meta.authorId,embedded||actor);
  }
  finally{d.destroy();}
  assert.deepEqual(input,before);assert.deepEqual(result.archive.sourcePayload,before.sourcePayload);
});

for(const location of ['meta','document','SQL','sidecar','bookmark','space'])test(`recognized unsupported own-key page binding in ${location} is never silently kept`,async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}},s=input.sourcePayload.semantic.sources;
  if(location==='document')input.sourcePayload.semantic.document.targetPage=2;
  if(location==='SQL')s.document_annotations=[{id:uuid(60),document_id:documentId,annotation_id:'mark',annotation_type:'rect',page_number:2,targetPage:2,annotation_data:{fabricObject:shape}}];
  if(location==='sidecar')attachSidecar(input,{version:1,targetPage:2});
  if(['meta','bookmark','space'].includes(location)){const d=new Y.Doc();
    if(location==='meta')d.getMap('annoMeta').set('sourcePage',2);
    if(location==='bookmark')d.getMap('annoMeta').set('bookmarks',[{id:'b',sourcePage:2}]);
    if(location==='space')d.getMap('annoMeta').set('spaces',[{id:'s',assignedPages:[{pageId:2,sourcePage:2,regions:[]}]}]);setModern(input,d);}
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.code==='DOCUMENT_GENERATION_TRANSFORM_INVALID');
});

for(const [label,mutate] of [
  ['missing page',i=>{i.pageCount=1;}],['wrong document',i=>{i.sourcePayload.semantic.document.id=uuid(99);}],
  ['missing sidecar',i=>{i.sourcePayload.semantic.sidecar_objects=[{bucket_id:'documents',path:'missing'}];}],
  ['bad key',i=>{const d=new Y.Doc();d.getMap('annotations').set('bad',{p:0,o:shape});i.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64=b64(Y.encodeStateAsUpdate(d));d.destroy();}],
  ['unknown page metadata',i=>{const d=new Y.Doc();d.getMap('annoMeta').set('future',{pageNumber:2});i.sourcePayload.semantic.sources.annotation_snapshot.snapshot_base64=b64(Y.encodeStateAsUpdate(d));d.destroy();}],
  ['unavailable tail',i=>{i.sourcePayload.semantic.wal_head='9007199254740994';}],
  ['private disagreement',i=>{i.sourcePayload.semantic.sources.document_annotations=[{id:uuid(60),document_id:documentId,annotation_id:'mark',page_number:2,
    annotation_type:'rect',annotation_data:{fabricObject:{...shape,left:999,notes:'PRIVATE SECRET'}}}];}],
])test(`rejects ${label} with no private data in errors and no mutation`,async()=>{
  const input={...fixture(),operation:{type:'move',from:2,to:1}};mutate(input);const before=structuredClone(input);
  await assert.rejects(transformDocumentGenerationSource(input),e=>e.code==='DOCUMENT_GENERATION_TRANSFORM_INVALID'&&!e.message.includes('PRIVATE SECRET'));
  assert.deepEqual(input,before);
});
