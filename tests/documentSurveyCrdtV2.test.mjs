import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import * as Y from 'yjs';
import {
  initializeSurveyCrdtV2,
  materializeSurveyCrdtV2,
  updateSurveyMarkersV2,
  updateSurveySpacesV2,
} from '../src/services/documentSurveyCrdtV2.js';
import {setMetaValue,syncSurveyMarkersToDoc} from '../src/services/annotationDocStore.js';

const ids=(prefix=1)=>{let n=prefix;return()=>`00000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;};
const marker=(id,extra={})=>({annotationId:id,pageNumber:1,bounds:{x:1,y:2,width:3,height:4},
 moduleId:'module',categoryId:'category',...extra});
const space=(extra={})=>({id:'space',name:'Base',assignedPages:[{pageId:1,regions:[{regionId:'region',name:'Base region'}]}],...extra});
const branch=(snapshot,clientID)=>{const doc=new Y.Doc();doc.clientID=clientID;Y.applyUpdate(doc,snapshot);return doc;};
const change=(doc,work)=>{const updates=[];doc.on('update',u=>updates.push(u));work();assert.ok(updates.length);return Y.mergeUpdates(updates);};
const replay=(snapshot,tails)=>{const doc=new Y.Doc();Y.applyUpdate(doc,snapshot);for(const tail of tails)Y.applyUpdate(doc,tail);return doc;};
const orders=(a,b)=>[[a,b],[b,a],[a,b,a,b]];
const view=doc=>materializeSurveyCrdtV2(doc);

test('independent checklist answers survive both orders, duplicate delivery and cold reopen',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{checklistResponses:{existing:{selection:'Y'}}})},createId:ids(1)});
 const snapshot=Y.encodeStateAsUpdate(base),a=branch(snapshot,20),b=branch(snapshot,30);
 const ua=change(a,()=>updateSurveyMarkersV2(a,current=>({...current,mark:{...current.mark,
  checklistResponses:{...current.mark.checklistResponses,aOnly:{selection:'Y'}}}})));
 const ub=change(b,()=>updateSurveyMarkersV2(b,current=>({...current,mark:{...current.mark,
  checklistResponses:{...current.mark.checklistResponses,bOnly:{selection:'N'}}}})));
 for(const tails of orders(ua,ub)){
  const merged=replay(snapshot,tails),expected={existing:{selection:'Y'},aOnly:{selection:'Y'},bOnly:{selection:'N'}};
  assert.deepEqual(view(merged).surveyMarkers.mark.checklistResponses,expected);
  assert.deepEqual(view(replay(Y.encodeStateAsUpdate(merged),[])).surveyMarkers.mark.checklistResponses,expected);
 }
});

test('entity and placement are atomic groups while an independent checklist edit merges',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{entityId:'old',entityName:'Old',entityColor:'#000',checklistResponses:{}})},createId:ids(10)});
 const snapshot=Y.encodeStateAsUpdate(base),a=branch(snapshot,20),b=branch(snapshot,30);
 const ua=change(a,()=>updateSurveyMarkersV2(a,current=>({...current,mark:{...current.mark,
  entityId:'new',entityName:'New',entityColor:'#fff',pageNumber:4,bounds:{x:40,y:50,width:60,height:70}}})));
 const ub=change(b,()=>updateSurveyMarkersV2(b,current=>({...current,mark:{...current.mark,
  checklistResponses:{answer:{selection:'Y'}}}})));
 for(const tails of orders(ua,ub)){const result=view(replay(snapshot,tails)).surveyMarkers.mark;
  assert.deepEqual([result.entityId,result.entityName,result.entityColor],['new','New','#fff']);
  assert.deepEqual([result.pageNumber,result.bounds],[4,{x:40,y:50,width:60,height:70}]);
  assert.deepEqual(result.checklistResponses,{answer:{selection:'Y'}});
 }
});

test('space rename and independent region edit both survive',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{spaces:[space()],createId:ids(20)});
 const snapshot=Y.encodeStateAsUpdate(base),a=branch(snapshot,20),b=branch(snapshot,30);
 const ua=change(a,()=>updateSurveySpacesV2(a,current=>current.map(s=>({...s,name:'Renamed'}))));
 const ub=change(b,()=>updateSurveySpacesV2(b,current=>current.map(s=>({...s,assignedPages:s.assignedPages.map(p=>({...p,
  regions:p.regions.map(r=>({...r,name:'Changed region'}))}))}))));
 for(const tails of orders(ua,ub)){const result=view(replay(snapshot,tails)).spaces[0];
  assert.equal(result.name,'Renamed');assert.equal(result.assignedPages[0].regions[0].name,'Changed region');
 }
});

test('marker deletion and page removal win over an older concurrent child edit',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{note:'old'})},spaces:[space()],createId:ids(30)});
 const snapshot=Y.encodeStateAsUpdate(base);
 const a=branch(snapshot,20),b=branch(snapshot,30);
 const markerDelete=change(a,()=>updateSurveyMarkersV2(a,{}));
 const markerEdit=change(b,()=>updateSurveyMarkersV2(b,current=>({...current,mark:{...current.mark,note:'late'}})));
 for(const tails of orders(markerDelete,markerEdit))assert.equal(view(replay(snapshot,tails)).surveyMarkers.mark,undefined);
 const c=branch(snapshot,40),d=branch(snapshot,50);
 const pageDelete=change(c,()=>updateSurveySpacesV2(c,current=>current.map(s=>({...s,assignedPages:[]}))));
 const regionEdit=change(d,()=>updateSurveySpacesV2(d,current=>current.map(s=>({...s,assignedPages:s.assignedPages.map(p=>({...p,
  regions:p.regions.map(r=>({...r,name:'late'}))}))}))));
 for(const tails of orders(pageDelete,regionEdit))assert.deepEqual(view(replay(snapshot,tails)).spaces[0].assignedPages,[]);
});

test('same-id concurrent creation converges to one complete incarnation without torn groups',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{createId:ids(40)});const snapshot=Y.encodeStateAsUpdate(base);
 const a=branch(snapshot,20),b=branch(snapshot,30);
 const ua=change(a,()=>updateSurveyMarkersV2(a,{mark:marker('mark',{entityId:'a',entityName:'Actor A',note:'A'})},{createId:ids(100)}));
 const ub=change(b,()=>updateSurveyMarkersV2(b,{mark:marker('mark',{entityId:'b',entityName:'Actor B',note:'B'})},{createId:ids(200)}));
 const results=orders(ua,ub).map(tails=>view(replay(snapshot,tails)).surveyMarkers.mark);
 assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
 assert.ok((results[0].entityId==='a'&&results[0].entityName==='Actor A'&&results[0].note==='A')
  ||(results[0].entityId==='b'&&results[0].entityName==='Actor B'&&results[0].note==='B'));
});

test('unchanged projections emit no Yjs update and returned values are clone-isolated',()=>{
 const input=marker('mark',{checklistResponses:{answer:{selection:'Y'}}});const base=new Y.Doc();
 initializeSurveyCrdtV2(base,{surveyMarkers:{mark:input},spaces:[space()],createId:ids(50)});
 let updates=0;base.on('update',()=>updates++);
 assert.equal(updateSurveyMarkersV2(base,current=>current).changed,false);
 assert.equal(updateSurveySpacesV2(base,current=>current).changed,false);assert.equal(updates,0);
 input.bounds.x=999;const output=view(base);assert.equal(output.surveyMarkers.mark.bounds.x,1);
 assert.throws(()=>{output.surveyMarkers.mark.bounds.x=888;},TypeError);
 assert.equal(view(base).surveyMarkers.mark.bounds.x,1);
});

test('clear then recreate the same ids does not revive old note, answer, page or region data',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{note:'old',checklistResponses:{old:{selection:'Y'}}})},spaces:[space()],createId:ids(60)});
 updateSurveyMarkersV2(base,{}, {createId:ids(70)});updateSurveySpacesV2(base,[],{createId:ids(80)});
 updateSurveyMarkersV2(base,{mark:marker('mark')},{createId:ids(90)});
 updateSurveySpacesV2(base,[{id:'space',name:'New',assignedPages:[]}],{createId:ids(100)});
 const result=view(base);assert.equal(result.surveyMarkers.mark.note,undefined);
 assert.equal(result.surveyMarkers.mark.checklistResponses,undefined);
 assert.deepEqual(result.spaces,[{id:'space',name:'New',assignedPages:[]}]);
});

test('safe JSON keys round-trip as data without changing object prototypes',()=>{
 const extension={};Object.defineProperty(extension,'__proto__',{value:{safe:true},enumerable:true,writable:true,configurable:true});
 const value=marker('mark',{extension});const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:value},createId:ids(110)});
 const result=view(base).surveyMarkers.mark.extension;
 assert.equal(Object.getPrototypeOf(result),Object.prototype);assert.equal(Object.prototype.hasOwnProperty.call(result,'__proto__'),true);
 assert.deepEqual(result.__proto__,{safe:true});assert.equal({}.safe,undefined);
});

test('late invalid input and a failing id factory leave zero accepted updates',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{kept:marker('kept')},spaces:[space()],createId:ids(120)});
 const before=Y.encodeStateAsUpdate(base);let updates=0;base.on('update',()=>updates++);
 assert.throws(()=>updateSurveyMarkersV2(base,{first:marker('first'),bad:{annotationId:'bad'}},{createId:ids(130)}),{code:'SURVEY_CRDT_V2_INVALID'});
 assert.equal(updates,0);assert.deepEqual(Y.encodeStateAsUpdate(base),before);
 let calls=0;const failSecond=()=>{calls++;return calls===1?'00000000-0000-4000-8000-000000000140':'bad-id';};
 assert.throws(()=>updateSurveySpacesV2(base,[{id:'new-a',assignedPages:[]},{id:'new-b',assignedPages:[]}],{createId:failSecond}),{code:'SURVEY_CRDT_V2_INVALID'});
 assert.equal(updates,0);assert.deepEqual(Y.encodeStateAsUpdate(base),before);
});

test('one field edit stays bounded in a large survey and materialization scales within a broad budget',()=>{
 const markers={};for(let i=0;i<2000;i++)markers[`m${i}`]=marker(`m${i}`,{checklistResponses:{a:{selection:'Y'},b:{selection:'N'}}});
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:markers,createId:ids(1000)});
 const updates=[];base.on('update',u=>updates.push(u));
 updateSurveyMarkersV2(base,current=>({...current,m1000:{...current.m1000,
  checklistResponses:{...current.m1000.checklistResponses,c:{selection:'Y'}}}}));
 assert.ok(Y.mergeUpdates(updates).byteLength<50000,`one answer update was ${Y.mergeUpdates(updates).byteLength} bytes`);
 const start=performance.now();assert.equal(Object.keys(view(base).surveyMarkers).length,2000);
 assert.ok(performance.now()-start<1500,'2000-marker materialization exceeded the broad linear-work budget');
});

test('same checklist key resolves to one deterministic whole answer in every delivery order',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{checklistResponses:{same:{selection:'Y',note:'base'}}})},createId:ids(4000)});
 const snapshot=Y.encodeStateAsUpdate(base),a=branch(snapshot,20),b=branch(snapshot,30);
 const ua=change(a,()=>updateSurveyMarkersV2(a,current=>({...current,mark:{...current.mark,
  checklistResponses:{same:{selection:'N',note:'A'}}}})));
 const ub=change(b,()=>updateSurveyMarkersV2(b,current=>({...current,mark:{...current.mark,
  checklistResponses:{same:{selection:'NA',note:'B'}}}})));
 const results=orders(ua,ub).map(tails=>view(replay(snapshot,tails)).surveyMarkers.mark.checklistResponses.same);
 assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
 assert.ok((results[0].selection==='N'&&results[0].note==='A')||(results[0].selection==='NA'&&results[0].note==='B'));
});

test('concurrent entity and placement writes choose complete groups without hybrid fields',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{entityId:'base',entityName:'Base',entityColor:'#000'})},createId:ids(4100)});
 const snapshot=Y.encodeStateAsUpdate(base),a=branch(snapshot,20),b=branch(snapshot,30);
 const ua=change(a,()=>updateSurveyMarkersV2(a,current=>({...current,mark:{...current.mark,entityId:'a',entityName:'A',entityColor:'#aaa',
  pageNumber:2,bounds:{x:2,y:2,width:2,height:2}}})));
 const ub=change(b,()=>updateSurveyMarkersV2(b,current=>({...current,mark:{...current.mark,entityId:'b',entityName:'B',entityColor:'#bbb',
  pageNumber:3,bounds:{x:3,y:3,width:3,height:3}}})));
 for(const tails of orders(ua,ub)){const result=view(replay(snapshot,tails)).surveyMarkers.mark;
  assert.ok((result.entityId==='a'&&result.entityName==='A'&&result.entityColor==='#aaa')
   ||(result.entityId==='b'&&result.entityName==='B'&&result.entityColor==='#bbb'));
  assert.ok((result.pageNumber===2&&result.bounds.x===2&&result.bounds.width===2)
   ||(result.pageNumber===3&&result.bounds.x===3&&result.bounds.width===3));
 }
});

test('an updater runs exactly once and observes the latest applied remote state',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{note:'base'})},createId:ids(4200)});
 const snapshot=Y.encodeStateAsUpdate(base),remote=branch(snapshot,20),local=branch(snapshot,30);
 const tail=change(remote,()=>updateSurveyMarkersV2(remote,current=>({...current,mark:{...current.mark,note:'remote'}})));
 Y.applyUpdate(local,tail);let calls=0;
 updateSurveyMarkersV2(local,current=>{calls++;assert.equal(current.mark.note,'remote');return {...current,
  mark:{...current.mark,checklistResponses:{seen:{selection:'Y'}}}};});
 assert.equal(calls,1);assert.equal(view(local).surveyMarkers.mark.note,'remote');
});

test('clearing complete marker groups keeps the marker and removes all old group fields',()=>{
 const base=new Y.Doc();initializeSurveyCrdtV2(base,{surveyMarkers:{mark:marker('mark',{entityId:'entity',entityName:'Entity',entityColor:'#abc',
  note:'old',notes:'older',changedBy:'actor',excelSync:{revision:1}})},createId:ids(4300)});
 updateSurveyMarkersV2(base,current=>({mark:{annotationId:'mark',pageNumber:current.mark.pageNumber,bounds:current.mark.bounds,
  moduleId:current.mark.moduleId,categoryId:current.mark.categoryId}}));
 const result=view(base).surveyMarkers.mark;assert.equal(result.annotationId,'mark');
 for(const key of ['entityId','entityName','entityColor','note','notes','changedBy','excelSync'])assert.equal(result[key],undefined,key);
});

test('invalid initialization emits zero accepted updates and leaves no model root',()=>{
 const doc=new Y.Doc();let updates=0;doc.on('update',()=>updates++);
 assert.throws(()=>initializeSurveyCrdtV2(doc,{surveyMarkers:{good:marker('good'),late:{annotationId:'late'}},createId:ids(4400)}),
  {code:'SURVEY_CRDT_V2_INVALID'});
 assert.equal(updates,0);assert.equal(doc.getMap('surveyV2Meta').size,0);
 assert.equal(doc.getMap('surveyMarkerLifecycle').size,0);assert.equal(doc.getMap('surveySpaceLifecycle').size,0);
});

test('field-level payloads are under one tenth of legacy whole-value updates for large real shapes',t=>{
 const checklistResponses={};for(let i=0;i<1000;i++)checklistResponses[`answer-${i}`]={selection:i%2?'Y':'N',note:`note-${i}`};
 const largeMarker=marker('mark',{checklistResponses});
 const legacyMarker=new Y.Doc();syncSurveyMarkersToDoc(legacyMarker,{mark:largeMarker});
 const legacyMarkerBytes=change(legacyMarker,()=>syncSurveyMarkersToDoc(legacyMarker,{mark:{...largeMarker,
  checklistResponses:{...checklistResponses,'answer-500':{selection:'NA',note:'changed'}}}})).byteLength;
 const modernMarker=new Y.Doc();initializeSurveyCrdtV2(modernMarker,{surveyMarkers:{mark:largeMarker},createId:ids(5000)});
 const modernMarkerBytes=change(modernMarker,()=>updateSurveyMarkersV2(modernMarker,current=>({...current,mark:{...current.mark,
  checklistResponses:{...current.mark.checklistResponses,'answer-500':{selection:'NA',note:'changed'}}}}))).byteLength;

 const largeSpaces=Array.from({length:250},(_,i)=>({id:`space-${i}`,name:`Space ${i}`,
  assignedPages:[{pageId:i+1,regions:[{regionId:`region-${i}`,name:`Region ${i}`,bounds:{x:i,y:i,width:10,height:10}}]}]}));
 const legacySpaces=new Y.Doc();setMetaValue(legacySpaces,'spaces',largeSpaces);
 const changedSpaces=largeSpaces.map((value,i)=>i===125?{...value,name:'Changed'}:value);
 const legacySpaceBytes=change(legacySpaces,()=>setMetaValue(legacySpaces,'spaces',changedSpaces)).byteLength;
 const modernSpaces=new Y.Doc();initializeSurveyCrdtV2(modernSpaces,{spaces:largeSpaces,createId:ids(7000)});
 const modernSpaceBytes=change(modernSpaces,()=>updateSurveySpacesV2(modernSpaces,current=>current.map((value,i)=>i===125?{...value,name:'Changed'}:value))).byteLength;
 assert.ok(modernMarkerBytes<legacyMarkerBytes/10,`${modernMarkerBytes} is not under one tenth of ${legacyMarkerBytes}`);
 assert.ok(modernSpaceBytes<legacySpaceBytes/10,`${modernSpaceBytes} is not under one tenth of ${legacySpaceBytes}`);
 t.diagnostic(`payload-only Yjs update bytes; not stored, wire, compressed, quota or billing bytes: ${JSON.stringify({legacyMarkerBytes,modernMarkerBytes,legacySpaceBytes,modernSpaceBytes})}`);
});
