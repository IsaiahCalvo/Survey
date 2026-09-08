import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { IDBFactory } from 'fake-indexeddb';
import { buildLocalDocumentState, createLocalDocumentStateReader, isManagedLocalDocument } from '../src/services/localDocumentState.js';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const localId = 'local:8ad364a5-786f-470f-858d-253c52bff3bd';
const file = { localId, _surveyPdfId: localId, storageMode: 'local' };
const canonical = buildLocalDocumentState({ pdfId: localId,
  annotationsByPage: { 1: { objects: [{ id: 'saved-mark' }] } },
  items: { item: { name: 'saved-item' } }, annotations: { label: { pageNumber: 1 } },
  surveyMarkers: { marker: { pageNumber: 1 } }, callouts: [],
  pageNames: { 1: 'saved-page' }, bookmarks: [{ id: 'saved-bookmark', pageIds: [1] }],
  regionOverlayDisabled: new Map([['saved-region', true]]),
});
const reader = createLocalDocumentStateReader({ ...file, _localDocumentState: canonical });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = find(child, predicate); if (found) return found;
    }
  }
  return null;
}
const evaluate = (node, scope) => new Function(...Object.keys(scope), `return (${source.slice(node.start, node.end)});`)(...Object.values(scope));
const isCall = (node, name) => node.type === 'CallExpression' && node.callee.name === name;
const noLegacy = () => assert.fail('managed files must not read or write shared legacy storage');

test('actual main hydration expressions use canonical entries and never adopt shared raw keys', () => {
  const hydrate = find(tree, node => isCall(node, 'useEffect')
    && node.arguments[1]?.elements?.some(entry => entry.name === 'activePdfChangeIdentity'));
  assert.ok(hydrate);
  const scope = { id: localId, managedLocalStateReader: reader, isCloudBackedDoc: false,
    isSamePdfReload: false, shouldUseLocalAnnotationCache: true, cloudRenderCache: null,
    loadPDFData: noLegacy, loadSurveyMarkers: noLegacy, loadAnnotationsByPage: noLegacy, loadCallouts: noLegacy,
  };
  for (const [name, prefix] of [['data', 'pdfData_'], ['loadedSurveyMarkers', 'surveyMarkers_'],
    ['loadedAnnotationsByPage', 'annotationsByPage_'], ['loadedCallouts', 'callouts_']]) {
    const variable = find(hydrate.arguments[0], node => node.type === 'VariableDeclarator' && node.id.name === name);
    assert.ok(variable, name);
    assert.deepEqual(evaluate(variable.init, scope), JSON.parse(canonical.entries[prefix + localId]));
    const empty = evaluate(variable.init, { ...scope, managedLocalStateReader: createLocalDocumentStateReader(file) });
    assert.deepEqual(empty, name === 'loadedCallouts' ? [] : {});
  }
});

test('actual cloud and unmanaged hydration expressions retain their original read sources', () => {
  const hydrate = find(tree, node => isCall(node, 'useEffect')
    && node.arguments[1]?.elements?.some(entry => entry.name === 'activePdfChangeIdentity'));
  const variable = name => find(hydrate.arguments[0], node => node.type === 'VariableDeclarator' && node.id.name === name).init;
  const legacy = { legacy: true };
  const scope = { id: 'raw-local', managedLocalStateReader: null, isCloudBackedDoc: false,
    isSamePdfReload: false, shouldUseLocalAnnotationCache: true, cloudRenderCache: null,
    loadPDFData: () => legacy, loadSurveyMarkers: () => legacy, loadAnnotationsByPage: () => legacy, loadCallouts: () => legacy,
  };
  for (const name of ['data', 'loadedSurveyMarkers', 'loadedAnnotationsByPage', 'loadedCallouts']) {
    assert.equal(evaluate(variable(name), scope), legacy);
  }
  const cloud = { ...scope, isCloudBackedDoc: true, isSamePdfReload: true,
    previousSurveyMarkersForSamePdf: { cloud: 'marker' }, previousCalloutsForSamePdf: ['cloud-callout'], cloudRenderCache: { cloud: 'annotation' } };
  assert.equal(evaluate(variable('loadedSurveyMarkers'), cloud), cloud.previousSurveyMarkersForSamePdf);
  assert.equal(evaluate(variable('loadedCallouts'), cloud), cloud.previousCalloutsForSamePdf);
  assert.equal(evaluate(variable('loadedAnnotationsByPage'), cloud), cloud.cloudRenderCache);
});

test('actual sidebar load uses canonical page names/bookmarks and keeps the deliberate regular-mode reset', () => {
  const effect = find(tree, node => isCall(node, 'useEffect') && find(node.arguments[0], child => isCall(child, 'migrateSidebarData')));
  const values = {};
  const scope = { pdfId: localId, managedLocalStateReader: reader, localStorage: { getItem: noLegacy },
    migrateSidebarData: data => data,
    setPageNames: value => { values.pageNames = value; }, setBookmarks: value => { values.bookmarks = value; },
    setHasImportedPdfBookmarks() {}, setSpaces() {}, setPageTransformations() {}, setActiveSpaceId: value => { values.activeSpaceId = value; },
  };
  evaluate(effect.arguments[0], scope)();
  assert.deepEqual(values.pageNames, { 1: 'saved-page' });
  assert.deepEqual(values.bookmarks, [{ id: 'saved-bookmark', pageIds: [1] }]);
  assert.equal(values.activeSpaceId, null);
});

test('actual per-edit mirror effects skip managed files but keep unmanaged writes', () => {
  for (const name of ['savePDFData', 'saveSurveyMarkers', 'saveCallouts', 'saveAnnotationsByPage']) {
    const effect = find(tree, node => isCall(node, 'useEffect') && node.arguments[0]?.body?.body?.some?.(statement =>
      statement.type === 'ExpressionStatement' && isCall(statement.expression, name)));
    assert.ok(effect, name);
    let writes = 0;
    const scope = { pdfId: localId, managedLocalStateReader: reader, pdfFile: file, items: {}, annotations: {},
      surveyMarkers: {}, callouts: [], annotationsByPage: {}, getCalloutSyncFingerprint: () => 'current',
      lastSavedCalloutsFingerprintRef: { current: null }, [name]: () => { writes++; },
    };
    evaluate(effect.arguments[0], scope)();
    assert.equal(writes, 0, `${name} must not touch legacy keys for managed files`);
    evaluate(effect.arguments[0], { ...scope, managedLocalStateReader: null, pdfFile: {} })();
    assert.equal(writes, 1, `${name} retains the unmanaged path`);
  }
  const sidebar = find(tree, node => isCall(node, 'useEffect') && node.arguments[1]?.elements?.some(entry => entry.name === 'pageNames')
    && find(node.arguments[0], child => child.type === 'CallExpression' && child.callee.object?.name === 'localStorage' && child.callee.property?.name === 'setItem'));
  assert.ok(sidebar);
  evaluate(sidebar.arguments[0], { pdfId: localId, managedLocalStateReader: reader, localStorage: { setItem: noLegacy } })();
});

test('actual page publication updates the view but never changes managed legacy keys', () => {
  const variable = find(tree, node => node.type === 'VariableDeclarator' && node.id.name === 'commitPageStructureState');
  const ref = () => ({ current: null });
  const scope = { pdfId: localId, pdfFile: file, isManagedLocalDocument,
    pageStructureStateRef: ref(), annotationsByPageRef: ref(), surveyMarkersRef: ref(), spacesRef: ref(),
    saveAnnotationsByPage: noLegacy, saveSurveyMarkers: noLegacy, localStorage: { setItem: noLegacy },
    setAnnotationsByPage() {}, setSurveyMarkers() {}, setAnnotations() {}, setPageNames() {}, setPageTransformations() {},
    setBookmarks() {}, setSpaces() {}, setRegionOverlayDisabled() {}, setUndoHistory() {}, setRedoHistory() {},
    resetPageStructureHistory() {},
    clearAnnotationSelectionForContextChange() {}, setPageNum: run => run(1), numPages: 2, pageNumberAfterOperation: () => 1,
  };
  const next = { annotationsByPage: { 1: { objects: [{ id: 'remapped' }] } }, surveyMarkers: {}, spaces: [],
    annotations: {}, pageNames: {}, pageTransformations: {}, bookmarks: [], regionOverlayDisabled: new Map() };
  evaluate(variable.init.arguments[0], scope)(next, { type: 'delete', page: 1 });
  assert.equal(scope.annotationsByPageRef.current, next.annotationsByPage);
});

test('independent cold readers keep exact checkpoint revisions without altering preexisting raw drafts', async () => {
  const store = createLocalDocumentStore({ indexedDB: new IDBFactory() });
  try {
    const row = await store.importLocalDocument(new File(['%PDF-1.7\nfixture'], 'local.pdf'));
    const make = name => buildLocalDocumentState({ pdfId: row.localId, annotationsByPage: { 1: { objects: [{ id: name }] } } });
    await store.saveLocalDocumentState(row.localId, make('first'), { expectedRevision: 1 });
    const firstFile = await store.openLocalDocument(row.localId);
    const first = createLocalDocumentStateReader(firstFile);
    const raw = new Map(Object.entries(make('unattributed-raw').entries));
    const before = [...raw];
    await store.saveLocalDocumentState(row.localId, make('second'), { expectedRevision: 2 });
    const secondFile = await store.openLocalDocument(row.localId);
    const second = createLocalDocumentStateReader(secondFile);
    assert.equal(firstFile.localRevision, 2); assert.equal(secondFile.localRevision, 3);
    assert.match(first.getItem('annotationsByPage_' + row.localId), /first/);
    assert.match(second.getItem('annotationsByPage_' + row.localId), /second/);
    assert.deepEqual([...raw], before);
  } finally { store.close(); }
});
