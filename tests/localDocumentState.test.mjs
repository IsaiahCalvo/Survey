import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalDocumentState, restoreLocalDocumentState, isManagedLocalDocument } from '../src/services/localDocumentState.js';
import { transformPageState } from '../src/utils/pageAnnotationReindex.js';

const localId = 'local:12345678-1234-1234-1234-123456789abc';
const file = () => ({ localId, _surveyPdfId: localId, storageMode: 'local' });
function memoryStorage() {
  const values = new Map([['unrelated', 'keep']]);
  return { values, getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
}
test('only explicit managed local identities enter the state path', () => {
  assert.equal(isManagedLocalDocument(file()), true);
  for (const changed of [{id:'cloud'}, {_surveyPdfId:'other'}, {localId:'local:bad'}, {storageMode:'cloud'}]) {
    assert.equal(isManagedLocalDocument({...file(), ...changed}), false);
  }
});
test('cold open restores all current loader formats and no unrelated data', () => {
  const storage = memoryStorage();
  const state = buildLocalDocumentState({ pdfId: localId, annotationsByPage: {1:{objects:[{id:'one'}]}},
    items: { item: { name:'item' } }, annotations:{one:{page:1}}, surveyMarkers:{marker:{pageNumber:1}},
    pageNames:{1:'First'}, bookmarks:[{id:'bookmark',pageIds:[1]}], spaces:[], activeSpaceId:'space',
    pageTransformations:{1:{rotation:90}}, regionOverlayDisabled:new Map([['region-1',true]]) });
  restoreLocalDocumentState({...file(),_localDocumentState:state},storage);
  for (const [key,value] of Object.entries(state.entries)) assert.equal(storage.getItem(key),value);
  assert.equal(storage.getItem('unrelated'),'keep');
  assert.equal(JSON.parse(storage.getItem(`regionOverlayStates_${localId}`))['region-1'],true);
});
test('invalid state is rejected before any cache writes', () => {
  for (const mutate of [s=>s.pdfId='other', s=>s.version=2,
    s=>s.entries.unrelated='"overwrite"', s=>s.entries[`pdfData_${localId}`]='broken']) {
    const state = buildLocalDocumentState({pdfId:localId}); mutate(state);
    const storage=memoryStorage(); const initial=[...storage.values];
    assert.throws(()=>restoreLocalDocumentState({...file(),_localDocumentState:state},storage));
    assert.deepEqual([...storage.values],initial);
  }
});
test('partial cache failure keeps canonical state and restores prior keys', () => {
  const storage=memoryStorage(); const state=buildLocalDocumentState({pdfId:localId});
  const first=Object.keys(state.entries)[0];storage.setItem(first,'previous');
  const initial=[...storage.values];const put=storage.setItem;let writes=0;
  storage.setItem=(k,v)=>{if(++writes===3)throw new Error('quota');put(k,v);};
  const opened={...file(),_localDocumentState:state};
  assert.throws(()=>restoreLocalDocumentState(opened,storage),/saved copy was kept/);
  assert.deepEqual([...storage.values],initial);
  assert.equal(opened._localDocumentState,state);
});
test('atomic page snapshot uses remapped page state, not old cache contents', () => {
  const next=transformPageState({annotationsByPage:{2:{objects:[{id:'one'}]}},
    annotations:{one:{pageNumber:2}},surveyMarkers:{},pageNames:{2:'Second'},
    bookmarks:[],spaces:[],pageTransformations:{},regionOverlayDisabled:new Map()}, {type:'delete',page:1});
  const state=buildLocalDocumentState({...next,pdfId:localId});
  const storage=memoryStorage();restoreLocalDocumentState({...file(),_localDocumentState:state},storage);
  assert.equal(JSON.parse(storage.getItem(`annotationsByPage_${localId}`))[1].objects[0].id,'one');
  assert.deepEqual(JSON.parse(storage.getItem(`pdfSidebar_${localId}`)).pageNames,{1:'Second'});
});
