import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as Y from 'yjs';
import { persistThenCommitPageMutation } from '../src/utils/pageMutationTransaction.js';
import { transformPageState, pageNumberAfterOperation } from '../src/utils/pageAnnotationReindex.js';
import { createUndoManager, userUndo } from '../src/lib/collab/crdtUndoManager.js';
import { syncByPageToDoc, docToByPage } from '../src/services/annotationDocStore.js';

// Agreed narrow seam for the giant viewer: execute its actual named callbacks,
// not a copied reset implementation. React setters are the test boundary.
const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
function callback(name, environment) {
  const marker = `  const ${name} = useCallback(`;
  const declaration = viewerSource.indexOf(marker);
  assert.notEqual(declaration, -1, `${name} must exist`);
  assert.equal(viewerSource.indexOf(marker, declaration + 1), -1, `${name} must be unique`);
  const start = declaration + marker.length;
  const end = viewerSource.indexOf('\n  }, [', start);
  assert.notEqual(end, -1, `${name} must have a bounded callback body`);
  const expression = viewerSource.slice(start, end + 4);
  return new Function(...Object.keys(environment), `return (${expression});`)(...Object.values(environment));
}

const historyRefs = [
  'undoHistoryRef', 'redoHistoryRef', 'undoHistoryMetaRef', 'redoHistoryMetaRef',
  'localAnnotationUndoRef', 'localAnnotationRedoRef',
];
function fixture(t, { withYjs = true } = {}) {
  const legacy = new Y.Doc();
  const flat = new Y.Doc();
  const ctx = { userId: 'page-history-owner', deviceId: 'offline-test', sessionId: 'test', clientID: legacy.clientID };
  const { undoManager, origin, dispose } = createUndoManager({ ydoc: legacy, ...ctx });
  t.after(() => { dispose(); legacy.destroy(); flat.destroy(); });
  const annotation = new Y.Map([['pageNumber', 1], ['type', 'rect'], ['label', 'kept']]);
  legacy.transact(() => legacy.getMap('annotations').set('kept-shape', annotation), origin);
  undoManager.stopCapturing();
  legacy.transact(() => annotation.set('label', 'old redo'), origin);
  undoManager.undo();
  assert.equal(undoManager.undoStack.length, 1);
  assert.equal(undoManager.redoStack.length, 1);

  const ui = { undo: ['old'], redo: ['old'], version: 7, preview: new Set([2]), toast: 'old page undo', dismissals: 0, page: 2 };
  const environment = {
    ...Object.fromEntries(historyRefs.map(name => [name, { current: [{ name, page: 2 }] }])),
    suppressBatchCheckpointsRef: { current: 3 },
    objectModifiedInteractionCheckpointRef: { current: new Map([[2, 'old interaction']]) },
    previewBaselineByPageRef: { current: new Map([[2, 'old preview']]) },
    lastCheckpointHashRef: { current: 'old-page-hash' },
    dismissUndoToast: () => { ui.toast = null; ui.dismissals += 1; },
    setErasePreviewPages: value => { ui.preview = value; },
    setUndoHistory: value => { ui.undo = value; },
    setRedoHistory: value => { ui.redo = value; },
    setLocalAnnotationHistoryVersion: update => { ui.version = update(ui.version); },
    yjsUndoManager: withYjs ? undoManager : null,
  };
  const reset = callback('resetPageStructureHistory', environment);
  const state = {
    annotationsByPage: { 2: { objects: [{ id: 'flat-shape', type: 'rect', left: 3, top: 4, width: 5, height: 6 }] } },
    surveyMarkers: {}, annotations: {}, pageNames: { 2: 'Physical page' },
    pageTransformations: {}, bookmarks: [], spaces: [], regionOverlayDisabled: new Map(),
  };
  const committed = {};
  const commitEnvironment = {
    pageStructureStateRef: { current: state }, annotationsByPageRef: { current: state.annotationsByPage },
    surveyMarkersRef: { current: state.surveyMarkers }, spacesRef: { current: state.spaces },
    resetPageStructureHistory: reset,
    clearAnnotationSelectionForContextChange: reason => { committed.selectionReason = reason; },
    pdfId: null, numPages: 2, pageNumberAfterOperation,
    setPageNum: update => { ui.page = update(ui.page); },
  };
  for (const key of ['AnnotationsByPage', 'SurveyMarkers', 'Annotations', 'PageNames', 'PageTransformations', 'Bookmarks', 'Spaces', 'RegionOverlayDisabled']) {
    commitEnvironment[`set${key}`] = value => { committed[key] = value; };
  }
  const commit = callback('commitPageStructureState', commitEnvironment);
  const operation = { type: 'move', from: 2, to: 1 };
  const next = transformPageState(state, operation);
  return { environment, ui, undoManager, legacy, flat, annotation, origin, ctx, commit, committed, commitEnvironment, state, next, operation };
}

function assertReset(f, { withYjs = true } = {}) {
  for (const name of historyRefs) assert.deepEqual(f.environment[name].current, [], name);
  assert.equal(f.environment.suppressBatchCheckpointsRef.current, 0);
  assert.equal(f.environment.objectModifiedInteractionCheckpointRef.current.size, 0);
  assert.equal(f.environment.previewBaselineByPageRef.current.size, 0);
  assert.equal(f.environment.lastCheckpointHashRef.current, null);
  assert.deepEqual(f.ui.undo, []);
  assert.deepEqual(f.ui.redo, []);
  assert.equal(f.ui.preview.size, 0);
  assert.equal(f.ui.version, 8);
  assert.equal(f.ui.toast, null);
  assert.equal(f.ui.dismissals, 1);
  if (withYjs) {
    assert.equal(f.undoManager.undoStack.length, 0);
    assert.equal(f.undoManager.redoStack.length, 0);
    assert.equal(f.undoManager.lastChange, 0, 'next user action starts a fresh capture');
  }
}

test('successful page persistence resets all history only at the actual viewer commit', async t => {
  const f = fixture(t);
  let release;
  const persisted = new Promise(resolve => { release = resolve; });
  const pending = persistThenCommitPageMutation({ file: {}, state: f.next, operation: f.operation, persist: () => persisted, commit: f.commit });
  await Promise.resolve();
  assert.equal(f.ui.dismissals, 0);
  assert.equal(f.undoManager.undoStack.length, 1);
  assert.equal(f.undoManager.redoStack.length, 1);
  assert.equal(f.commitEnvironment.pageStructureStateRef.current, f.state);
  release();
  await pending;
  assertReset(f);
  assert.equal(f.commitEnvironment.pageStructureStateRef.current, f.next);
  assert.equal(f.committed.AnnotationsByPage, f.next.annotationsByPage);
  assert.equal(f.committed.selectionReason, 'page-structure-change');
  assert.equal(f.ui.page, 1);
});

test('rejected persistence preserves all history, toast, flags and old page state', async t => {
  const f = fixture(t);
  const references = Object.fromEntries(Object.entries(f.environment).filter(([, value]) => value && 'current' in Object(value)).map(([key, value]) => [key, value.current]));
  const beforeUi = structuredClone(f.ui);
  const undo = [...f.undoManager.undoStack];
  const redo = [...f.undoManager.redoStack];
  await assert.rejects(persistThenCommitPageMutation({
    file: {}, state: f.next, operation: f.operation,
    persist: async () => { throw new Error('persistence rejected'); }, commit: f.commit,
  }), /persistence rejected/);
  for (const [name, value] of Object.entries(references)) assert.equal(f.environment[name].current, value, name);
  assert.equal(f.environment.objectModifiedInteractionCheckpointRef.current.get(2), 'old interaction');
  assert.equal(f.environment.previewBaselineByPageRef.current.get(2), 'old preview');
  assert.deepEqual(f.ui, beforeUi);
  assert.deepEqual(f.undoManager.undoStack, undo);
  assert.deepEqual(f.undoManager.redoStack, redo);
  assert.equal(f.commitEnvironment.pageStructureStateRef.current, f.state);
  assert.deepEqual(f.committed, {});
});

test('flat remap capture stays durable without refilling legacy undo; next real edit undoes only itself', async t => {
  const f = fixture(t);
  syncByPageToDoc(f.flat, f.state.annotationsByPage);
  await persistThenCommitPageMutation({ file: {}, state: f.next, operation: f.operation, persist: async () => {}, commit: f.commit });
  assertReset(f);
  // These are the real store and origin used by useAnnotationDoc's later effect.
  syncByPageToDoc(f.flat, f.next.annotationsByPage, { prevByPage: f.state.annotationsByPage, origin: 'local' });
  assert.equal(docToByPage(f.flat)[1].objects[0].id, 'flat-shape');
  assert.equal(docToByPage(f.flat)[2], undefined);
  assert.equal(f.undoManager.undoStack.length, 0);
  assert.equal(f.undoManager.redoStack.length, 0);
  const remappedBytes = Y.encodeStateAsUpdate(f.flat);
  f.legacy.transact(() => f.annotation.set('label', 'new user edit'), f.origin);
  assert.equal(f.undoManager.undoStack.length, 1);
  userUndo(f.legacy, f.undoManager, f.ctx);
  assert.equal(f.annotation.get('label'), 'kept');
  assert.equal(f.legacy.getMap('annotations').has('kept-shape'), true);
  assert.equal(f.undoManager.undoStack.length, 0);
  assert.equal(f.undoManager.redoStack.length, 1);
  assert.deepEqual(Y.encodeStateAsUpdate(f.flat), remappedBytes);
  assert.equal(f.ui.page, 1);
});

test('successful managed-local page operation resets history with no legacy Yjs manager', async t => {
  const f = fixture(t, { withYjs: false });
  await persistThenCommitPageMutation({ file: {}, state: f.next, operation: f.operation, persist: async () => {}, commit: f.commit });
  assertReset(f, { withYjs: false });
});
