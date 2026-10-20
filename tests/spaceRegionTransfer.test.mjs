import test from 'node:test';
import assert from 'node:assert/strict';
import { planSpaceRegionTransfer } from '../src/utils/spaceRegionTransfer.js';
import { calloutToAnnotationObject, deriveCalloutsFromByPage } from '../src/utils/calloutAnnotationBridge.js';
import { scopeLegacyRestoreToOwnSlices } from '../src/utils/historyStacks.js';
const source = () => ({ spaces:[{id:'a',assignedPages:[{pageId:1,regions:[{regionId:'r',pageId:1,shapeType:'polygon',coordinates:[100,100,200,100,200,200]}]}]},{id:'b',assignedPages:[{pageId:3,regions:[{regionId:'other',coordinates:[1,1,10,1,10,10]}]}]}], annotationsByPage:{1:{objects:[{id:'mark',left:100,top:100,regionId:'r'},{id:'plain',left:20,top:30}]},3:{objects:[{id:'collaborator'}]}},surveyMarkers:{sm:{pageNumber:1,regionId:'r',bounds:{x:140,y:140,width:20,height:20}}}});
const plan=(model,extra={})=>planSpaceRegionTransfer({...model,sourceSpaceId:'a',sourcePageId:1,targetSpaceId:'b',targetPageId:3,...extra});
test('move keeps region and mark identity, target marks, and source ordinary marks',()=>{ const m=source(), p=plan(m); assert.equal(p.spaces[0].assignedPages.length,0); assert.deepEqual(p.spaces[1].assignedPages[0].regions.map(r=>r.regionId),['other','r']); assert.equal(p.annotationsByPage[1].objects[0].id,'plain'); assert.deepEqual(p.annotationsByPage[3].objects.map(m=>m.id),['collaborator','mark']); assert.equal(p.surveyMarkers.sm.pageNumber,3); assert.equal(p.surveyMarkers.sm.spaceId,'b'); assert.equal(m.spaces[0].assignedPages.length,1); });
test('copy keeps marks on their source and mints outline identity',()=>{ const m=source(),p=plan(m,{copy:true,createId:()=> 'copy'}); assert.equal(p.spaces[0].assignedPages.length,1); assert.equal(p.spaces[1].assignedPages[0].regions[1].regionId,'copy'); assert.equal(p.annotationsByPage,m.annotationsByPage); assert.equal(p.surveyMarkers,m.surveyMarkers); });
test('smaller host translates outlines and marks together without changing their size',()=>{const p=plan(source(),{targetSize:{width:150,height:150}});assert.deepEqual(p.spaces[1].assignedPages[0].regions[1].coordinates,[50,50,150,50,150,150]);assert.equal(p.annotationsByPage[3].objects[1].left,50);assert.equal(p.surveyMarkers.sm.bounds.x,90);});
test('an outline that cannot fit is rejected before any data changes',()=>{ const m=source(),before=structuredClone(m);assert.throws(()=>plan(m,{targetSize:{width:50,height:50}}),/larger/);assert.deepEqual(m,before); });
test('move between spaces on the same page does not drop ordinary marks',()=>{const p=plan(source(),{targetPageId:1});assert.deepEqual(p.annotationsByPage[1].objects.map(m=>m.id),['plain','mark']);assert.equal(p.annotationsByPage[1].objects[1].spaceId,'b');});
test('region transfer undo and redo affect its own spaces/marks, keep newer collaborator edits',()=>{const m=source(),p=plan(m);const current={...p,annotationsByPage:{...p.annotationsByPage,3:{objects:[...p.annotationsByPage[3].objects,{id:'newer'}]}}};const meta={reason:'space:transfer-region',context:{spaceIds:['a','b'],transferIds:p.movedIds,transferState:p.transferState}};const undone=scopeLegacyRestoreToOwnSlices(meta,current,m);assert.deepEqual(undone.annotationsByPage[1].objects.map(m=>m.id),['mark','plain']);assert.deepEqual(undone.annotationsByPage[3].objects.map(m=>m.id),['collaborator','newer']);assert.equal(undone.surveyMarkers.sm.pageNumber,1);const redone=scopeLegacyRestoreToOwnSlices(meta,undone,current,{direction:'redo'});assert.deepEqual(redone.annotationsByPage[3].objects.map(m=>m.id),['collaborator','mark','newer']);assert.equal(redone.spaces[0].assignedPages.length,0);});

test('callouts keep physical geometry and author metadata on a different-size page',()=>{
  const m=source(); const callout={id:'callout',pageNumber:1,regionId:'r',meta:{authorId:'author'},text:'Room note',arrowTip:{x:.2,y:.2},knee:{x:.25,y:.25},textBoxPosition:{x:.3,y:.3},textBoxWidth:.1,textBoxHeight:.05,style:{fontFamily:'Helvetica',fontSize:14}};
  m.annotationsByPage[1].objects.push(calloutToAnnotationObject(callout,{width:600,height:800}));
  const p=plan(m,{sourceSize:{width:600,height:800},targetSize:{width:400,height:600}});
  const result=deriveCalloutsFromByPage(p.annotationsByPage)[0];
  assert.equal(result.pageNumber,3); assert.equal(result.meta.authorId,'author'); assert.equal(result.text,'Room note');
  assert.equal(result.arrowTip.x*400,120);assert.equal(result.arrowTip.y*600,160);assert.equal(result.textBoxWidth*400,60);
});

const transferMeta = (p) => ({ reason:'space:transfer-region',context:{transferIds:p.movedIds,transferState:p.transferState} });
test('transfer Undo and Redo preserve newer space rename, new pages, and unrelated region changes',()=>{
  const m=source(),p=plan(m);
  const later={...p,spaces:p.spaces.map(space=>space.id==='b'?{...space,name:'Later rename',assignedPages:[...space.assignedPages.map(page=>({...page,label:'Later page label',regions:page.regions.map(region=>region.regionId==='other'?{...region,coordinates:[2,2,20,2,20,20]}:region)})),{pageId:4,regions:[{regionId:'later',coordinates:[1,1,30,1,30,30]}]}]}:space)};
  const undone=scopeLegacyRestoreToOwnSlices(transferMeta(p),later,m);
  assert.equal(undone.spaces[1].name,'Later rename'); assert.equal(undone.spaces[1].assignedPages[0].label,'Later page label');
  assert.deepEqual(undone.spaces[1].assignedPages[0].regions.map(r=>r.regionId),['other']);
  assert.deepEqual(undone.spaces[1].assignedPages[0].regions[0].coordinates,[2,2,20,2,20,20]);
  assert.equal(undone.spaces[1].assignedPages[1].pageId,4);
  const redone=scopeLegacyRestoreToOwnSlices(transferMeta(p),undone,later,{direction:'redo'});
  assert.equal(redone.spaces[1].name,'Later rename');assert.equal(redone.spaces[1].assignedPages[1].pageId,4);
  assert.deepEqual(redone.spaces[1].assignedPages[0].regions.map(r=>r.regionId),['other','r']);
});
test('a later edit of a moved region blocks its transfer Undo instead of duplicating it',()=>{
  const m=source(),p=plan(m);const later={...p,spaces:p.spaces.map(s=>s.id==='b'?{...s,assignedPages:s.assignedPages.map(page=>({...page,regions:page.regions.map(r=>r.regionId==='r'?{...r,showCanvasAnnotations:false}:r)}))}:s)};
  const undone=scopeLegacyRestoreToOwnSlices(transferMeta(p),later,m);
  assert.equal(undone.spaces[0].assignedPages.length,0);assert.equal(undone.spaces[1].assignedPages[0].regions[1].showCanvasAnnotations,false);
  assert.equal(undone.surveyMarkers.sm.pageNumber,3);
});
test('a later edit of a moved mark keeps that mark and its region together',()=>{
  const m=source(),p=plan(m);const later={...p,annotationsByPage:{...p.annotationsByPage,3:{objects:p.annotationsByPage[3].objects.map(mark=>mark.id==='mark'?{...mark,stroke:'#ff0000'}:mark)}}};
  const undone=scopeLegacyRestoreToOwnSlices(transferMeta(p),later,m);
  assert.equal(undone.spaces[0].assignedPages.length,0);assert.equal(undone.annotationsByPage[3].objects[1].stroke,'#ff0000');assert.equal(undone.surveyMarkers.sm.pageNumber,3);
});
test('same-page different-space transfer Undo keeps newer source and destination regions',()=>{
  const m=source(),p=plan(m,{targetPageId:1});
  const later={...p,spaces:p.spaces.map(space=>({...space,name:`New ${space.id}`,assignedPages:[...space.assignedPages,{pageId:5,regions:[{regionId:`new-${space.id}`}]}]}))};
  const undone=scopeLegacyRestoreToOwnSlices(transferMeta(p),later,m);
  assert.equal(undone.spaces[0].name,'New a');assert.equal(undone.spaces[1].name,'New b');
  assert.ok(undone.spaces.every(s=>s.assignedPages.some(page=>page.pageId===5)));
  assert.equal(undone.annotationsByPage[1].objects.find(mark=>mark.id==='mark').spaceId,undefined);
  const redone=scopeLegacyRestoreToOwnSlices(transferMeta(p),undone,later,{direction:'redo'});
  assert.equal(redone.annotationsByPage[1].objects.find(mark=>mark.id==='mark').spaceId,'b');assert.ok(redone.spaces.every(s=>s.assignedPages.some(page=>page.pageId===5)));
});
test('copy Undo removes only its own outline; later destination pages stay',()=>{
  const m=source(),p=plan(m,{copy:true,createId:()=> 'copy'});
  const later={...p,spaces:p.spaces.map(s=>s.id==='b'?{...s,assignedPages:[...s.assignedPages,{pageId:5,regions:[{regionId:'new'}]}]}:s)};
  const undone=scopeLegacyRestoreToOwnSlices(transferMeta(p),later,m);
  assert.deepEqual(undone.spaces[1].assignedPages[0].regions.map(r=>r.regionId),['other']);assert.equal(undone.spaces[1].assignedPages[1].pageId,5);
  const redone=scopeLegacyRestoreToOwnSlices(transferMeta(p),undone,later,{direction:'redo'});
  assert.deepEqual(redone.spaces[1].assignedPages[0].regions.map(r=>r.regionId),['other','copy']);
});
test('text markup and links move their absolute quads and clear source text anchors on another page',()=>{
  const m=source();const quads=[{x1:120,y1:120,x2:140,y2:120,x3:120,y3:135,x4:140,y4:135}];
  for(const kind of ['highlight','link'])m.annotationsByPage[1].objects.push({id:kind,left:120,top:120,regionId:'r',data:{type:'text-markup',markupType:kind,pageNumber:1,textRange:{start:5,end:9},textRangeModel:{runs:[{start:5,end:9}]},quads,linkUrl:'https://example.com'}});
  const p=plan(m,{targetSize:{width:150,height:150}});
  for(const kind of ['highlight','link']){const mark=p.annotationsByPage[3].objects.find(mark=>mark.id===kind);assert.equal(mark.left,70);assert.deepEqual(mark.data.quads,[{x1:70,y1:70,x2:90,y2:70,x3:70,y3:85,x4:90,y4:85}]);assert.equal(mark.data.textRange,undefined);assert.equal(mark.data.textRangeModel,undefined);assert.equal(mark.data.linkUrl,'https://example.com');}
  assert.equal(m.annotationsByPage[1].objects[2].data.quads[0].x1,120);
});
test('same-page text markup keeps its PDF range anchors',()=>{
  const m=source();m.annotationsByPage[1].objects.push({id:'text',regionId:'r',data:{type:'text-markup',textRange:{start:5,end:9},quads:[{x1:120,y1:120}]}});
  const p=plan(m,{targetPageId:1});assert.deepEqual(p.annotationsByPage[1].objects.find(mark=>mark.id==='text').data.textRange,{start:5,end:9});
});
test('deleted destination space never resurrects its transferred regions or marks',()=>{
  const m=source(),p=plan(m);const later={...p,spaces:p.spaces.filter(s=>s.id!=='b')};
  const undone=scopeLegacyRestoreToOwnSlices(transferMeta(p),later,m);assert.equal(undone.spaces.length,1);assert.equal(undone.spaces[0].assignedPages.length,0);
});
test('whole-page transfer Undo keeps newer assignments and skips later linked marker edits',()=>{
  const m={spaces:[{id:'a',assignedPages:[{pageId:1,wholePageIncluded:true,regions:[]}]},{id:'b',assignedPages:[]}],annotationsByPage:{},surveyMarkers:{sm:{pageNumber:1,spaceId:'a',bounds:{x:10,y:10,width:20,height:20}}}};
  const p=plan(m);const later={...p,spaces:p.spaces.map(s=>s.id==='b'?{...s,assignedPages:[...s.assignedPages,{pageId:4,regions:[{regionId:'newer'}]}]}:s)};
  const undone=scopeLegacyRestoreToOwnSlices(transferMeta(p),later,m);assert.equal(undone.spaces[0].assignedPages[0].wholePageIncluded,true);assert.deepEqual(undone.spaces[1].assignedPages.map(p=>p.pageId),[4]);assert.equal(undone.surveyMarkers.sm.pageNumber,1);
  const edited={...later,surveyMarkers:{sm:{...p.surveyMarkers.sm,name:'Later name'}}};const skipped=scopeLegacyRestoreToOwnSlices(transferMeta(p),edited,m);assert.equal(skipped.spaces[0].assignedPages.length,0);assert.equal(skipped.surveyMarkers.sm.pageNumber,3);assert.equal(skipped.surveyMarkers.sm.name,'Later name');
});
