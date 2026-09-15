import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { IDBFactory } from 'fake-indexeddb';
import { buildLocalDocumentState, isManagedLocalDocument } from '../src/services/localDocumentState.js';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';
import { deriveCalloutsFromByPage } from '../src/utils/calloutAnnotationBridge.js';
import { filterRestoredPdfAnnotationTombstones } from '../src/utils/textMarkupGroupTransactions.js';
import { persistThenCommitPageMutation } from '../src/utils/pageMutationTransaction.js';

// Execute bounded expressions from the real viewer, including the actual memo
// dependencies. No duplicate implementation of its snapshot or quit signature.
const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      const match = find(child, predicate); if (match) return match;
    }
  }
  return null;
}
const variable = name => {
  const result = find(tree, node => node.type === 'VariableDeclarator' && node.id.name === name);
  assert.ok(result, `${name} exists`); return result;
};
const assignment = (name, rightName = null) => {
  const result = find(tree, node => node.type === 'AssignmentExpression'
    && node.left.object?.name === name && node.left.property?.name === 'current'
    && (!rightName || node.right.name === rightName));
  assert.ok(result, `${name}.current is assigned`); return result;
};
const evaluate = (node, scope) => new Function(...Object.keys(scope), `return (${source.slice(node.start, node.end)});`)(...Object.values(scope));
const localId = 'local:00000000-0000-4000-8000-000000000001';
const deleted = [{ pageNumber: 1, pdfAnnotationId: '44R', pdfAnnotationType: 'Square',
  pdfNativeAnnotationIdentity: { rect: [10, 20, 30, 40], contents: 'native' } }];
const file = { localId, _surveyPdfId: localId, storageMode: 'local' };
const state = () => ({ pdfId: localId, pdfFile: file, annotationsByPage: {}, items: { one: { name: 'Door', quantity: 1 } },
  annotations: {}, deletedPdfAnnotations: [], surveyMarkers: {}, callouts: [], pageNames: {}, bookmarks: [],
  spaces: [{ id: 'space' }], activeSpaceId: 'space', pageTransformations: {}, regionOverlayDisabled: new Map() });

test('page capture can be initialized before combined tombstones and reads the latest ref plus items and active space', () => {
  const fields = state();
  const scope = { ...fields, isManagedLocalDocument, annotationsByPageRef: { current: fields.annotationsByPage },
    surveyMarkersRef: { current: fields.surveyMarkers }, spacesRef: { current: fields.spaces },
    pageStructureStateRef: { current: null }, deletedPdfAnnotationsRef: { current: [] }, useCallback: fn => fn };
  // The state assignment and callback occur before the combined const in the
  // real component. Leave that binding in the TDZ while executing both.
  const init = assignment('pageStructureStateRef');
  const get = variable('getPageStructureState');
  delete scope.deletedPdfAnnotations;
  const expression = new Function(...Object.keys(scope), `
    ${source.slice(init.start, init.end)};
    const get = ${source.slice(get.init.start, get.init.end)};
    const deletedPdfAnnotations = 'late-render-binding';
    return get;
  `)(...Object.values(scope));
  scope.deletedPdfAnnotationsRef.current = deleted;
  const captured = expression();
  assert.equal(captured.deletedPdfAnnotations, deleted);
  assert.equal(captured.items, fields.items);
  assert.equal(captured.activeSpaceId, 'space');
  const newer = [{ ...deleted[0], pageNumber: 2 }];
  scope.deletedPdfAnnotationsRef.current = newer;
  assert.equal(expression().deletedPdfAnnotations, newer, 'capture is not tied to render-time deletion state');
  for (const pdfFile of [{}, { ...file, id: 'cloud-id' }]) {
    const unmanagedCapture = evaluate(get.init, { ...scope, pdfFile })();
    assert.equal(Object.hasOwn(unmanagedCapture, 'deletedPdfAnnotations'), false,
      'existing unmanaged/cloud page capture does not acquire local tombstone semantics');
  }
});

test('actual raw-File reset keeps managed tombstones but preserves unmanaged and cloud reset behavior', () => {
  const effect = find(tree, node => node.type === 'CallExpression' && node.callee.name === 'useEffect'
    && node.arguments[1]?.elements?.length === 1 && node.arguments[1].elements[0]?.name === 'pdfFile'
    && !!find(node.arguments[0], child => child.type === 'CallExpression' && child.callee.name === 'setLocallyDeletedPdfAnnotations'));
  assert.ok(effect);
  for (const [pdfFile, expectedWrites] of [[file, []], [{}, [[]]], [{ ...file, id: 'cloud-id' }, [[]]]]) {
    const writes = [];
    evaluate(effect.arguments[0], { pdfFile, isManagedLocalDocument, setLocallyDeletedPdfAnnotations: value => writes.push(value) })();
    assert.deepEqual(writes, expectedWrites);
  }
});

test('actual saved-managed import branch selects diagnostics only; fresh local files keep full import', async () => {
  const branch = find(tree, node => node.type === 'IfStatement'
    && source.slice(node.test.start, node.test.end).includes('pdfFile._localDocumentState != null'));
  assert.ok(branch, 'saved managed canonical state has its own import boundary');
  for (const [pdfFile, expected] of [
    [{ ...file, _localDocumentState: buildLocalDocumentState({ pdfId: localId }) }, true],
    [{ ...file, _localDocumentState: null }, false], [file, false],
    [{ ...file, id: 'cloud-id', _localDocumentState: {} }, false],
  ]) assert.equal(evaluate(branch.test, { pdfFile, isManagedLocalDocument }), expected);
  const importCalls = [];
  const policies = [];
  const scope = { pdf: {}, arrayBuffer: new ArrayBuffer(0), isCurrentLoad: () => true,
    importAnnotationsFromPdf: async (...args) => { importCalls.push(args); return { nativeLayerPolicyByPage: { 1: { hideNativeLayer: true } } }; },
    setPdfNativeAnnotationLayerPolicyByPage: value => policies.push(value),
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(scope), source.slice(branch.consequent.start, branch.consequent.end))(...Object.values(scope));
  assert.equal(importCalls.length, 1);
  assert.equal(importCalls[0][1].diagnosticsOnly, true);
  assert.equal(importCalls[0][1].rawPdfBytes, scope.arrayBuffer);
  assert.deepEqual(policies, [{ 1: { hideNativeLayer: true } }]);
  // No semantic-state setters are in scope: executing this branch must not
  // repopulate canonical empty objects, spaces, markers, or edited native marks.
});

test('actual combined tombstones filter restored native marks and update the ref after memo evaluation', () => {
  const scope = { useMemo: fn => fn(), filterRestoredPdfAnnotationTombstones,
    durableDeletedPdfAnnotations: deleted, locallyDeletedPdfAnnotations: [{ ...deleted[0], source: 'latest' }],
    annotationsByPage: {}, deletedPdfAnnotationsRef: { current: null } };
  const combined = evaluate(variable('deletedPdfAnnotations').init, scope);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].source, 'latest');
  evaluate(assignment('deletedPdfAnnotationsRef', 'deletedPdfAnnotations'), { ...scope, deletedPdfAnnotations: combined });
  assert.equal(scope.deletedPdfAnnotationsRef.current, combined);
  const restored = evaluate(variable('deletedPdfAnnotations').init, { ...scope,
    annotationsByPage: { 1: { objects: [{ type: 'rect', pdfAnnotationId: '44R' }] } } });
  assert.deepEqual(restored, [], 'undo-restored native annotation must not remain in export deletions');
});

test('actual managed snapshot and memo dependencies include deletion-only changes', () => {
  let previousDeps, previousValue;
  const useMemo = (build, deps) => {
    if (!previousDeps || deps.some((value, index) => !Object.is(value, previousDeps[index]))) previousValue = build();
    previousDeps = deps; return previousValue;
  };
  const scope = { ...state(), useMemo, isManagedLocalDocument, buildLocalDocumentState,
    pendingManagedEntityCatalog: null,
    entityCatalog: { mode: 'legacy', busy: false, catalog: null },
    pendingManagedSurveyDefinition: null,
    surveyDefinition: { mode: 'legacy', busy: false, definition: null } };
  const clean = evaluate(variable('managedLocalSnapshot').init, scope);
  const dirty = evaluate(variable('managedLocalSnapshot').init, { ...scope, deletedPdfAnnotations: deleted });
  assert.notEqual(dirty, clean, 'deletion-only dependency reruns the actual useMemo');
  assert.deepEqual(JSON.parse(dirty.entries[`pdfData_${localId}`]).deletedPdfAnnotations, deleted);
  assert.deepEqual(evaluate(variable('managedLocalSnapshot').init, scope), clean, 'undo restores exact saved entries');
});

test('actual page persistence stores items and deletion data with new bytes before publishing the view', async () => {
  const store = createLocalDocumentStore({ indexedDB: new IDBFactory() });
  try {
    const row = await store.importLocalDocument(new File(['%PDF-1.7\nold'], 'before.pdf'));
    const opened = await store.openLocalDocument(row.localId);
    const replacement = Object.assign(new File(['%PDF-1.7\nnew pages'], 'after.pdf'), opened,
      { localId: row.localId, _surveyPdfId: row.localId });
    const next = { ...state(), deletedPdfAnnotations: deleted };
    let committed = false;
    const persist = evaluate(variable('persistPageMutationFile').init.arguments[0], {
      isManagedLocalDocument, buildLocalDocumentState, deriveCalloutsFromByPage, tabId: 'tab',
      entityCatalog: { mode: 'legacy', busy: false, catalog: null },
      surveyDefinition: { mode: 'legacy', busy: false, definition: null },
      onUpdatePDFFile: async updated => {
        assert.equal(committed, false);
        assert.deepEqual(JSON.parse(updated._localDocumentState.entries[`pdfData_${row.localId}`]).deletedPdfAnnotations, deleted);
        await store.replaceLocalDocument(row.localId, updated, { expectedRevision: opened.localRevision, state: updated._localDocumentState });
      },
    });
    await persistThenCommitPageMutation({ file: replacement, state: next, operation: { type: 'move', from: 2, to: 1 },
      persist, commit: () => { committed = true; } });
    assert.equal(committed, true);
    const cold = await store.openLocalDocument(row.localId);
    assert.equal(await cold.text(), await replacement.text());
    const data = JSON.parse(cold._localDocumentState.entries[`pdfData_${row.localId}`]);
    assert.deepEqual(data.deletedPdfAnnotations, deleted);
    assert.deepEqual(data.items, next.items);
  } finally { store.close(); }
});

test('actual manual-save capture and native quit revision detect a deletion with unchanged annotation objects', () => {
  const fields = state();
  const scope = { ...fields, buildLocalDocumentState, managedLocalStateRef: { current: null },
    annotationsByPageRef: { current: fields.annotationsByPage }, surveyMarkersRef: { current: fields.surveyMarkers },
    spacesRef: { current: fields.spaces }, user: null, entities: [],
    pendingManagedEntityCatalog: null,
    entityCatalog: { mode: 'legacy', busy: false, catalog: null },
    pendingManagedSurveyDefinition: null,
    surveyDefinition: { mode: 'legacy', busy: false, definition: null } };
  evaluate(assignment('managedLocalStateRef'), scope);
  const capture = evaluate(variable('captureManagedLocalSnapshot').init, scope);
  const before = capture(file, fields.annotationsByPage);
  const revision = () => evaluate(variable('getQuitSaveRevision').init, scope)();
  const beforeQuit = revision();
  scope.deletedPdfAnnotations = deleted;
  evaluate(assignment('managedLocalStateRef'), scope);
  const after = capture(file, fields.annotationsByPage);
  assert.notDeepEqual(after.entries, before.entries);
  assert.deepEqual(JSON.parse(after.entries[`pdfData_${localId}`]).deletedPdfAnnotations, deleted);
  assert.notEqual(revision(), beforeQuit, 'a prior quit receipt cannot acknowledge a newer native deletion');
  scope.deletedPdfAnnotations = [];
  assert.equal(revision(), beforeQuit, 'undo restores the quit signature');
});

test('actual native quit rejects a late save acknowledgement when only native deletions changed', async () => {
  const fields = state();
  const dirtyWrites = [];
  let release;
  const pendingWrite = new Promise(resolve => { release = resolve; });
  const scope = { ...fields, annotationsByPageRef: { current: fields.annotationsByPage },
    surveyMarkersRef: { current: fields.surveyMarkers }, spacesRef: { current: fields.spaces },
    user: null, entities: [], effectiveDocumentLocked: false, hasUnsavedAnnotations: true,
    getQuitSaveBlockReason: () => null, isManagedLocalDocument,
    persistManagedLocalSnapshot: () => pendingWrite,
    quitSaveHandlerRef: { current: null },
    managedLocalSaveTracking: { markSaved: () => assert.fail('late receipt cannot clear a newer deletion') },
    savedAnnotationsByPageRef: { current: null },
    setHasUnsavedAnnotations: value => dirtyWrites.push(value),
    onUnsavedAnnotationsChange: value => dirtyWrites.push(value),
    tabId: 'tab',
  };
  const getRevision = () => evaluate(variable('getQuitSaveRevision').init, scope)();
  scope.getQuitSaveRevision = getRevision;
  scope.quitSaveHandlerRef.current = { getRevision };
  const quit = evaluate(variable('saveLocalBeforeQuit').init, scope);
  const receipt = quit();
  scope.deletedPdfAnnotations = deleted;
  release(true);
  assert.deepEqual(await receipt, { saved: false });
  assert.deepEqual(dirtyWrites, [], 'no dirty flag is cleared by the outdated close receipt');
  assert.equal(scope.savedAnnotationsByPageRef.current, null);
});
