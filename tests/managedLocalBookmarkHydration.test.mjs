import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { parse } from '@babel/parser';
import { IDBFactory } from 'fake-indexeddb';
import { prepareManagedLocalBookmarks } from '../src/utils/managedLocalBookmarkHydration.js';
import { buildLocalDocumentState, createLocalDocumentStateReader, isManagedLocalDocument } from '../src/services/localDocumentState.js';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';
import { useManagedLocalSaveTracking } from '../src/hooks/useManagedLocalSaveTracking.js';
import { useManagedLocalDraftTracking } from '../src/hooks/useManagedLocalDraftTracking.js';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) { const hit = find(child, predicate); if (hit) return hit; } }
    else if (value && typeof value === 'object') { const hit = find(value, predicate); if (hit) return hit; }
  }
  return null;
};
const autoImport = find(tree, node => node.type === 'CallExpression' && node.callee.name === 'useEffect'
  && node.arguments[1]?.elements?.some(item => item.name === 'pdfBookmarks'));
assert.ok(autoImport);
const autoSource = source.slice(autoImport.arguments[0].body.start + 1, autoImport.arguments[0].body.end - 1);
function rendererArrival(file, bookmarks, importBookmarks) {
  new Function('pdfFile', 'pdfId', 'pdfBookmarks', 'hasImportedPdfBookmarks', 'isManagedLocalDocument', 'importPdfBookmarksIntoSidebar', 'setHasImportedPdfBookmarks', autoSource)(
    file, file.localId || 'cloud', bookmarks, true, isManagedLocalDocument, importBookmarks, () => {});
}
const initialStart = source.slice(source.indexOf('if (isManagedLocalDocument(pdfFile) && !pdfFile._localDocumentState) {'), source.indexOf('// Load project data from Supabase if available'));
const initialFinish = source.slice(source.indexOf('const managedOutline = await managedOutlineLoad;'), source.indexOf("perfLoad.mark(docName, 'PDF ready for rendering')"));
function initialLoad(file, extract, publish) {
  return new Function('pdfFile', 'extractPdfOutlineBookmarks', 'isManagedLocalDocument', 'prepareManagedLocalBookmarks', 'publish', `
    const pdf = {}; let managedOutlineLoad = null; let isCancelled = false;
    const isCurrentLoad = () => !isCancelled;
    const setPdfBookmarks = value => publish('available', value);
    const setBookmarks = value => publish('bookmarks', value);
    const setHasImportedPdfBookmarks = value => publish('imported', value);
    ${initialStart}
    return { cancel: () => { isCancelled = true; }, finish: async () => { ${initialFinish} } };
  `)(file, extract, isManagedLocalDocument, prepareManagedLocalBookmarks, publish);
}
const id = 'local:00000000-0000-4000-8000-000000000003';
const fileFor = () => Object.assign(new File(['%PDF-1.7\n%%EOF'], 'bookmarks.pdf', { type: 'application/pdf' }),
  { localId: id, _surveyPdfId: id, storageMode: 'local', localRevision: 1 });
const outline = [{ id: 'pdf:parent', name: 'Section', type: 'folder', parentId: null, children: [], pageIds: [], source: 'pdf', sourceId: 'pdfjs:Section#0' },
  { id: 'pdf:child', name: 'Blank Page', type: 'bookmark', parentId: 'pdf:parent', children: [], pageIds: [1], dest: { pageNumber: 1 }, source: 'pdf', sourceId: 'pdfjs:Section>Blank Page#0' }];
const snapshot = fields => buildLocalDocumentState({ pdfId: id, ...fields });

test('fresh outline normalization preserves its tree and source but resolves navigation before first baseline', () => {
  let sequence = 0; const untouched = structuredClone(outline);
  const loaded = prepareManagedLocalBookmarks(outline, () => `generated-${++sequence}`);
  assert.deepEqual(outline, untouched);
  assert.equal(loaded[1].parentId, loaded[0].id);
  assert.equal(loaded[1].sourceId, outline[1].sourceId);
  assert.equal(loaded[1].outlineCorrected, true);
  assert.equal(loaded[1].disableSourceNavigation, true);
  assert.deepEqual(loaded[1].dest, { pageNumber: 1, PageNumber: 1, pageIndex: 0, PageIndex: 0 });
});

test('actual load starts outline in parallel and publishes only after completion; stale loads publish nothing', async () => {
  for (const cancel of [false, true]) {
    let release, calls = 0; const events = [];
    const load = initialLoad(fileFor(), () => { calls++; return new Promise(resolve => { release = resolve; }); }, (...event) => events.push(event));
    assert.equal(calls, 1); assert.deepEqual(events, []);
    const done = load.finish();
    if (cancel) load.cancel();
    release(outline); await done;
    if (cancel) assert.deepEqual(events, []);
    else { assert.deepEqual(events.map(([kind]) => kind), ['available', 'bookmarks', 'imported']); assert.equal(events[1][1][1].name, 'Blank Page'); }
  }
});

test('saved canonical renamed and deleted bookmarks survive actual load and late automatic renderer import', async () => {
  for (const bookmarks of [[{ id: 'user-bookmark', name: 'My changed name', pageIds: [1] }], []]) {
    const file = { ...fileFor(), _localDocumentState: snapshot({ bookmarks }) };
    let extracts = 0; const events = [];
    await initialLoad(file, async () => { extracts++; return outline; }, (...event) => events.push(event)).finish();
    rendererArrival(file, outline, value => events.push(value));
    assert.equal(extracts, 0); assert.deepEqual(events, []);
    assert.deepEqual(JSON.parse(createLocalDocumentStateReader(file).getItem(`pdfSidebar_${id}`)).bookmarks, bookmarks);
  }
  let imports = 0;
  rendererArrival({ id: 'cloud-document' }, outline, () => imports++);
  assert.equal(imports, 1, 'cloud automatic import remains intact');
});

test('managed renderer still supplies available bookmarks for the actual explicit Reimport action', () => {
  const available = find(tree, node => node.type === 'VariableDeclarator' && node.id?.name === 'handlePDFBookmarksAvailable').init.arguments[0];
  const reimport = find(tree, node => node.type === 'VariableDeclarator' && node.id?.name === 'handleReimportPdfBookmarks').init.arguments[0];
  let list, imported;
  new Function('setPdfBookmarks', 'setDebugData', 'emitPdfDebugEvent', `return (${source.slice(available.start, available.end)});`)(
    value => { list = value; }, () => {}, () => {})(outline);
  assert.deepEqual(list, outline);
  new Function('pdfBookmarks', 'importPdfBookmarksIntoSidebar', 'setHasImportedPdfBookmarks', 'showToast', `return (${source.slice(reimport.start, reimport.end)});`)(
    list, value => { imported = value; }, () => {}, () => {})();
  assert.deepEqual(imported, outline);
});

test('mounted initial outline is clean with no recovery write; late renderer result cannot clear real edits', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const restore = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); restore.reverse().forEach(fn => fn()); });
  const file = fileFor(); let api, view, update; const captures = []; let writers = 0;
  const createWriter = () => { writers++; return { capture: async state => { captures.push(state); return {}; }, seal: async () => {} }; };
  function Harness() {
    [view, update] = useState({ hydrated: false, bookmarks: [] });
    const state = snapshot(view);
    api = useManagedLocalSaveTracking({ file, pdfId: id, snapshot: state, hydrated: view.hydrated });
    useManagedLocalDraftTracking({ file, snapshot: state, ready: api.ready, dirty: api.dirty, createWriter });
    return null;
  }
  await act(async () => root.render(React.createElement(Harness)));
  await act(async () => update({ hydrated: true, bookmarks: prepareManagedLocalBookmarks(outline) }));
  assert.equal(api.ready, true); assert.equal(api.dirty, false);
  await act(async () => t.mock.timers.tick(150));
  assert.equal(writers, 0); assert.deepEqual(captures, []);
  const loaded = view.bookmarks;
  await act(async () => update({ ...view, bookmarks: loaded.map(bookmark => ({ ...bookmark, name: 'User renamed' })), annotationsByPage: { 1: { objects: [{ id: 'user-edit', type: 'rect' }] } } }));
  assert.equal(api.dirty, true);
  await act(async () => rendererArrival(file, outline, bookmarks => update({ ...view, bookmarks })));
  assert.equal(api.dirty, true); assert.equal(view.bookmarks[1].name, 'User renamed');
  await act(async () => t.mock.timers.tick(150));
  assert.equal(writers, 1); assert.equal(captures.length, 1);
  assert.ok(JSON.stringify(captures[0]).includes('user-edit'));
  await act(async () => update({ hydrated: true, bookmarks: loaded }));
  assert.equal(api.dirty, false, 'undo to source-import baseline still works');
});

test('canonical IDB save and cold open retain user bookmark rename and deletion', async t => {
  const store = createLocalDocumentStore({ indexedDB: new IDBFactory() }); t.after(() => store.close());
  const imported = await store.importLocalDocument(fileFor());
  for (const bookmarks of [[{ id: 'saved', name: 'User saved title', pageIds: [1] }], []]) {
    const file = await store.openLocalDocument(imported.localId);
    const state = buildLocalDocumentState({ pdfId: file.localId, bookmarks });
    await store.saveLocalDocumentState(file.localId, state, { expectedRevision: file.localRevision });
    const reopened = await store.openLocalDocument(imported.localId); const events = [];
    await initialLoad(reopened, async () => { throw Error('canonical must not re-extract'); }, (...event) => events.push(event)).finish();
    rendererArrival(reopened, outline, value => events.push(value));
    assert.deepEqual(events, []);
    assert.deepEqual(JSON.parse(createLocalDocumentStateReader(reopened).getItem(`pdfSidebar_${reopened.localId}`)).bookmarks, bookmarks);
  }
});
