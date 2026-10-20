import test from 'node:test';
import assert from 'node:assert/strict';
import { planSurveyCategoryTransferRestore, surveyCategoryTransferCheckpoint, surveyCategoryTransferStepId } from '../src/utils/surveyCategoryTransferHistory.js';
const before = { id:'t', name:'Survey', modules:[{id:'a',categories:[{id:'c',name:'Walls'}]},{id:'b',categories:[]}], entities:[] };
const after = { ...before, modules:[{id:'a',categories:[]},{id:'b',categories:[{id:'c',name:'Walls'}]}] };
const transfer = { before:{template:before,moduleId:'a',categoryId:'c'},after:{template:after,moduleId:'b',categoryId:null},markerIds:['mark'],itemScopes:[{id:'item',keys:['aData','bData'],before:{aData:{entityId:'e'}},after:{aData:{entityId:'e'},bData:{entityId:'e'}}}] };
const marker = { moduleId:'b', categoryId:'c', bounds:{x:1,y:2}, checklistResponses:{q:'Y'}, notes:{text:'Keep'}, media:['photo'] };
const items = {item:{id:'item',aData:{entityId:'e'},bData:{entityId:'e'},extra:'Keep'}};
test('Undo and Redo transfer definitions, marker and item scope together and retain answers/media',()=>{
  const undo=planSurveyCategoryTransferRestore({transfer,direction:'undo',markers:{mark:marker,other:{moduleId:'b'}},items,latestTemplate:after});
  assert.equal(undo.ok,true);assert.strictEqual(undo.template,before);assert.equal(undo.markers.mark.moduleId,'a');assert.deepEqual(undo.markers.mark.checklistResponses,{q:'Y'});assert.deepEqual(undo.markers.mark.media,['photo']);assert.equal(undo.items.item.bData,undefined);assert.equal(undo.items.item.extra,'Keep');assert.equal(undo.writeGlobalTemplate,true);
  const redo=planSurveyCategoryTransferRestore({transfer,direction:'redo',markers:undo.markers,items:undo.items,latestTemplate:before});assert.equal(redo.ok,true);assert.strictEqual(redo.template,after);assert.deepEqual(redo.markers.mark,marker);assert.deepEqual(redo.items,items);
});
test('a newer global version is preserved while the document can retain the older snapshot',()=>{const result=planSurveyCategoryTransferRestore({transfer,direction:'undo',markers:{mark:marker},items,latestTemplate:{...after,name:'Someone edited'}});assert.equal(result.ok,true);assert.equal(result.writeGlobalTemplate,false);assert.strictEqual(result.template,before);});
test('remote scope edits conflict atomically; missing remotely deleted marks are not resurrected',()=>{assert.equal(planSurveyCategoryTransferRestore({transfer,direction:'undo',markers:{mark:{...marker,moduleId:'other'}},items,latestTemplate:after}).ok,false);const result=planSurveyCategoryTransferRestore({transfer,direction:'undo',markers:{},items,latestTemplate:after});assert.equal(result.ok,true);assert.deepEqual(result.markers,{});});
test('the transfer has its own checkpoint on the shared timeline',()=>{const entry=surveyCategoryTransferCheckpoint('x',18);assert.equal(surveyCategoryTransferStepId(entry.meta),'x');assert.equal(entry.meta.checkpointId,18);assert.equal(surveyCategoryTransferStepId({reason:'highlight:create'}),null);});
test('new module data follows the marker back instead of losing later entity/answer edits',()=>{
  const scoped={...transfer,itemScopes:[{id:'item',sourceKey:'aData',destinationKey:'bData',keys:['aData','bData'],before:{aData:{entityId:'old'}},after:{aData:{entityId:'old'},bData:{entityId:'old'}}}]};
  const current={item:{id:'item',aData:{entityId:'old',extra:'Keep'},bData:{entityId:'latest',answer:'Y'}}};
  const result=planSurveyCategoryTransferRestore({transfer:scoped,direction:'undo',markers:{mark:marker},items:current,latestTemplate:after});
  assert.equal(result.ok,true);assert.equal(result.items.item.aData.entityId,'latest');assert.equal(result.items.item.aData.answer,'Y');assert.equal(result.items.item.aData.extra,'Keep');assert.equal(result.items.item.bData,undefined);
  const redo=planSurveyCategoryTransferRestore({transfer:scoped,direction:'redo',markers:result.markers,items:result.items,latestTemplate:before});assert.equal(redo.ok,true);assert.equal(redo.items.item.bData.answer,'Y');
});
