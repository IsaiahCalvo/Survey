import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalDocumentState, createLocalDocumentStateReader, restoreLocalDocumentState, isManagedLocalDocument } from '../src/services/localDocumentState.js';
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
test('cold open reads all canonical loader formats without changing any legacy or unrelated data', () => {
  const storage = memoryStorage();
  const state = buildLocalDocumentState({ pdfId: localId, annotationsByPage: {1:{objects:[{id:'one'}]}},
    items: { item: { name:'item' } }, annotations:{one:{page:1}}, surveyMarkers:{marker:{pageNumber:1}},
    pageNames:{1:'First'}, bookmarks:[{id:'bookmark',pageIds:[1]}], spaces:[], activeSpaceId:'space',
    pageTransformations:{1:{rotation:90}}, regionOverlayDisabled:new Map([['region-1',true]]) });
  for (const key of Object.keys(state.entries)) storage.setItem(key, 'unattributed newer edit');
  const before = [...storage.values];
  const reader = createLocalDocumentStateReader({...file(),_localDocumentState:state});
  for (const [key,value] of Object.entries(state.entries)) assert.equal(reader.getItem(key),value);
  assert.deepEqual([...storage.values], before);
  assert.equal(reader.getItem('unrelated'), null);
  assert.equal(JSON.parse(reader.getItem(`regionOverlayStates_${localId}`))['region-1'],true);
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
test('canonical readers never access storage, including the old restore entry point', () => {
  const storage=memoryStorage(); const state=buildLocalDocumentState({pdfId:localId});
  const first=Object.keys(state.entries)[0];storage.setItem(first,'previous');
  const initial=[...storage.values];
  storage.getItem=storage.setItem=storage.removeItem=()=>assert.fail('canonical hydration must not access shared storage');
  const opened={...file(),_localDocumentState:state};
  const reader = restoreLocalDocumentState(opened,storage);
  assert.equal(reader.getItem(first), state.entries[first]);
  assert.deepEqual([...storage.values],initial);
  assert.equal(opened._localDocumentState,state);
});
test('atomic page snapshot uses remapped page state, not old cache contents', () => {
  const next=transformPageState({annotationsByPage:{2:{objects:[{id:'one'}]}},
    annotations:{one:{pageNumber:2}},surveyMarkers:{},pageNames:{2:'Second'},
    bookmarks:[],spaces:[],pageTransformations:{},regionOverlayDisabled:new Map()}, {type:'delete',page:1});
  const state=buildLocalDocumentState({...next,pdfId:localId});
  const reader=createLocalDocumentStateReader({...file(),_localDocumentState:state});
  assert.equal(JSON.parse(reader.getItem(`annotationsByPage_${localId}`))[1].objects[0].id,'one');
  assert.deepEqual(JSON.parse(reader.getItem(`pdfSidebar_${localId}`)).pageNames,{1:'Second'});
});

test('reader captures immutable exact-file entries and never reads another document or later mutation', () => {
  const state=buildLocalDocumentState({pdfId:localId,annotationsByPage:{1:{objects:[{id:'saved'}]}}});
  const opened={...file(),_localDocumentState:state};
  const reader=createLocalDocumentStateReader(opened);
  state.entries[`annotationsByPage_${localId}`]='{}';
  opened._localDocumentState=buildLocalDocumentState({pdfId:localId});
  assert.equal(Object.isFrozen(reader),true);
  assert.match(reader.getItem(`annotationsByPage_${localId}`),/saved/);
  assert.equal(reader.getItem('annotationsByPage_other'),null);
});

test('new managed files have empty canonical readers rather than adopting any old shared keys', () => {
  const reader=createLocalDocumentStateReader(file());
  assert.equal(reader.getItem(`annotationsByPage_${localId}`),null);
  assert.equal(reader.getItem(`pdfSidebar_${localId}`),null);
});

test('wrong JSON entry shapes fail before the file can hydrate', () => {
  for (const [prefix, value] of [['annotationsByPage_', 'null'], ['pdfSidebar_', '[]'], ['callouts_', '{}']]) {
    const state=buildLocalDocumentState({pdfId:localId});
    state.entries[prefix+localId]=value;
    assert.throws(()=>createLocalDocumentStateReader({...file(),_localDocumentState:state}),/invalid entry/);
  }
});
