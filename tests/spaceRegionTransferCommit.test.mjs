import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSpaceRegionTransfer } from '../src/utils/spaceRegionTransfer.js';
import { buildAnnotationHistoryAction } from '../src/utils/annotationLocalHistory.js';
import { scopeLegacyRestoreToOwnSlices } from '../src/utils/historyStacks.js';

// Execute the actual viewer callback, keeping PDF/network setup out of this
// atomic acceptance test. The planner and transfer Undo restore are real.
const source=readFileSync(new URL('../src/PDFViewer.jsx',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('  const handleSpaceTransferRegion = useCallback'),source.indexOf('\n  const getPageRegions = useCallback'));
function harness({accepted=true,hasLinkedMark=true}={}) {
  const initial={spaces:[{id:'a',assignedPages:[{pageId:1,regions:[{regionId:'r',pageId:1,coordinates:[10,10,80,10,80,80]}]}]},{id:'b',assignedPages:[]}],annotationsByPage:{1:{objects:[{id:'prior-edit',left:5,top:5},...(hasLinkedMark?[{id:'linked',regionId:'r',left:30,top:30}]:[])]},2:{objects:[]}},surveyMarkers:{}};
  const before=structuredClone(initial),priorStep=structuredClone(initial);priorStep.annotationsByPage[1].objects[0].left=0;
  const model=structuredClone(initial),history=[{reason:'prior-real-edit',state:priorStep}],events=[];
  const scope={
    requireSpaceManagement:()=>true,pendingEntitySelection:null,pendingSurveyMarkerName:null,activeSpaceId:null,
    spacesRef:{current:model.spaces},annotationsByPageRef:{current:model.annotationsByPage},surveyMarkersRef:{current:model.surveyMarkers},pageSizesRef:{current:{1:{width:600,height:800},2:{width:600,height:800}}},
    planSpaceRegionTransfer,buildAnnotationHistoryAction,getMarkLockedBy:()=>null,notifyLockedMarkBlocked:()=>events.push('locked'),showToast:message=>events.push(`toast:${message}`),
    getHistorySnapshot:()=>structuredClone({spaces:scope.spacesRef.current,annotationsByPage:scope.annotationsByPageRef.current,surveyMarkers:scope.surveyMarkersRef.current}),
    addHistoryCheckpoint:(reason,context,snapshot)=>{events.push('checkpoint');history.push({reason,context,state:snapshot||scope.getHistorySnapshot()});},
    commitTextMarkupDocumentTransaction:(transaction,options)=>{
      events.push('commit');assert.equal(options.skipHistory,true);assert.equal(options.applyWithoutOwnedStep,true);
      if(!accepted)return false;
      model.annotationsByPage=transaction.nextByPage;scope.annotationsByPageRef.current=transaction.nextByPage;return true;
    },
    clearAnnotationSelectionForContextChange:()=>events.push('selection'),
    setSpaces:spaces=>{events.push('spaces');model.spaces=spaces;scope.spacesRef.current=spaces;},
    setSurveyMarkers:markers=>{events.push('markers');model.surveyMarkers=markers;scope.surveyMarkersRef.current=markers;},
    setNewSurveyMarkersByPage:()=>events.push('marker-paint'),setActiveSpaceId:()=>events.push('active-space'),
    surveyMarkerRenderEntry:()=>null,normalizeSurveyMarkerColor:value=>value,useCallback:callback=>callback,
  };
  const transfer=new Function(...Object.keys(scope),`${declaration}\nreturn handleSpaceTransferRegion;`)(...Object.values(scope));
  return{before,model,history,events,transfer:()=>transfer({sourceSpaceId:'a',sourcePageId:1,targetSpaceId:'b',targetPageId:2}),undo:()=>{const entry=history.pop();return entry.reason==='space:transfer-region'?scopeLegacyRestoreToOwnSlices(entry,model,entry.state):entry.state;}};
}

test('a refused annotation transaction changes nothing and does not consume the prior real Undo step',()=>{
  const h=harness({accepted:false});assert.equal(h.transfer(),false);
  assert.deepEqual(h.events,['commit']);assert.deepEqual(h.model,h.before);assert.equal(h.history.length,1);
  const undone=h.undo();assert.equal(h.history.length,0);assert.equal(undone.annotationsByPage[1].objects[0].left,0);
});

test('a region with no linked annotations records one Undo without an annotation transaction',()=>{
  const h=harness({hasLinkedMark:false});assert.equal(h.transfer(),true);
  assert.deepEqual(h.events,['checkpoint','selection','spaces','markers','marker-paint']);assert.equal(h.history.length,2);
  assert.equal(h.model.spaces[0].assignedPages.length,0);assert.equal(h.model.spaces[1].assignedPages[0].pageId,2);
  const undone=h.undo();assert.deepEqual(undone.spaces,h.before.spaces);assert.deepEqual(undone.annotationsByPage,h.before.annotationsByPage);assert.equal(h.history.length,1);
});

test('accepted annotation transfer records its pre-commit snapshot after acceptance and before applying spaces',()=>{
  const h=harness();assert.equal(h.transfer(),true);assert.deepEqual(h.events,['commit','checkpoint','selection','spaces','markers','marker-paint']);
  assert.equal(h.history.length,2);assert.deepEqual(h.history.at(-1).state,h.before);
  assert.deepEqual(h.model.annotationsByPage[1].objects.map(mark=>mark.id),['prior-edit']);assert.equal(h.model.annotationsByPage[2].objects[0].id,'linked');
  const undone=h.undo();assert.deepEqual(undone.spaces,h.before.spaces);assert.deepEqual(undone.annotationsByPage,h.before.annotationsByPage);assert.equal(h.history.length,1);
});
