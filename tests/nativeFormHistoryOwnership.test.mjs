import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAnnotationHistoryAction, filterAnnotationHistoryActionByOwner,
  applyAnnotationHistoryAction, invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { createManagedLocalEditingContext } from '../src/utils/managedLocalEditingContext.js';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
function evaluate(body, environment) {
  return new Function(...Object.keys(environment), body)(...Object.values(environment));
}
function actualRecorder(environment) {
  const marker = '  const pushLocalAnnotationHistoryAction = useCallback(';
  const start = source.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const end = source.indexOf('\n  }, [', start);
  assert.ok(end > start);
  return evaluate(`return (${source.slice(start, end + 4)});`, environment);
}
// This is the actual history-routing block inside handleSaveAnnotations, not
// a duplicate predicate. The full viewer remains covered by browser QA.
const routingStart = source.indexOf('    if (!shouldSkipCheckpointByPolicy && !shouldSkipCheckpointByInteraction) {');
const routingEnd = source.indexOf("    // 2026-07-17: the 'annotations:precise-fabric-commit'", routingStart);
assert.ok(routingStart > 0 && routingEnd > routingStart);
const routeSource = source.slice(routingStart, routingEnd);

const form = (value, authorId = 'owner') => ({
  type: 'form-field', data: { id: 'form-field:1:field-a', type: 'form-field', fieldId: 'field-a', value, pageNumber: 1 },
  meta: { authorId },
});
function fixture({ authorId = 'owner', restoring = false, local = false } = {}) {
  const previousPage = { objects: [form('before', authorId), { type: 'rect', data: { id: 'unrelated' }, left: 9 }] };
  const nextPage = { objects: [form('after', authorId), previousPage.objects[1]] };
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage });
  const events = [];
  const environment = {
    isUndoingRef: { current: restoring }, yjsUndoCtx: null, user: { id: 'owner' },
    documentOwnerId: 'other-document-owner', managedLocalEditingContext: null,
    filterAnnotationHistoryActionByOwner,
    pushHistoryDebugEvent: (name, details) => events.push({ name, details }),
    summarizeHistoryActionForLog: value => ({ type: value?.type }),
    historyCheckpointSeqRef: { current: 0 }, localAnnotationUndoRef: { current: [] },
    localAnnotationRedoRef: { current: ['existing redo'] },
    setLocalAnnotationHistoryVersion: () => {}, isBulkJournaledAnnotationId: () => false,
    pdfFile: null,
  };
  if (local) {
    const file = new File(['%PDF'], 'local-form.pdf');
    file.storageMode = 'local';
    file.localId = 'local:00000000-0000-4000-8000-000000000001';
    file._surveyPdfId = file.localId;
    environment.user = null;
    environment.documentOwnerId = null;
    environment.managedLocalEditingContext = createManagedLocalEditingContext(file);
    assert.ok(environment.managedLocalEditingContext);
  }
  const recorder = actualRecorder(environment);
  const legacy = [];
  const route = overrides => evaluate(routeSource, {
    localHistoryRecorded: false,
    shouldSkipCheckpointByPolicy: false, shouldSkipCheckpointByInteraction: false,
    pushLocalAnnotationHistoryAction: recorder, finalLocalHistoryAction: action,
    previewBaselineByPageRef: { current: new Map() }, interactionPageKey: '1',
    pushHistoryDebugEvent: environment.pushHistoryDebugEvent,
    source: 'form-field', interactionId: null, checkpointPolicy: 'normal', pageNumber: 1,
    previousObjectCount: 2, nextObjectCount: 2, objectDelta: 0,
    finalPageTransition: { changedObjectsCount: 1 },
    previousPageFingerprint: { hash: 'before' }, finalNextPageFingerprint: { hash: 'after' },
    undoHistoryRef: { current: [] }, redoHistoryRef: { current: [] }, normalizedSaveContext: {},
    isEraserCommit: false, yjsDoc: null, yjsUndoManager: null,
    objectModifiedInteractionCheckpointRef: { current: new Map() },
    addHistoryCheckpoint: (...args) => legacy.push(args),
    ...overrides,
  });
  return { environment, recorder, route, legacy, events, previousPage, nextPage, action };
}

test('native form edit has one local owner and one undo restores just that edit', () => {
  const f = fixture();
  f.route();
  assert.equal(f.environment.localAnnotationUndoRef.current.length, 1);
  assert.equal(f.legacy.length, 0);
  assert.equal(f.events.filter(event => event.name === 'local_annotation_history_added').length, 1);
  const undone = applyAnnotationHistoryAction({ 1: f.nextPage }, invertAnnotationHistoryAction(f.environment.localAnnotationUndoRef.current[0]));
  assert.deepEqual(undone[1], f.previousPage);
  assert.deepEqual(applyAnnotationHistoryAction(undone, f.action)[1], f.nextPage);
});

test('recorder returns a strict receipt only after storing the action', () => {
  const f = fixture();
  assert.equal(f.recorder(f.action), true);
  assert.equal(f.environment.localAnnotationUndoRef.current.length, 1);
  assert.deepEqual(f.environment.localAnnotationRedoRef.current, []);
  assert.equal(f.recorder(null), false);
  f.environment.isUndoingRef.current = true;
  assert.equal(f.recorder(f.action), false);
  assert.equal(f.environment.localAnnotationUndoRef.current.length, 1);
});

test('signed-out managed-local native form records one ownerless delta and one-step undo', () => {
  const f = fixture({ authorId: null, local: true });
  f.route();
  assert.equal(f.environment.localAnnotationUndoRef.current.length, 1);
  assert.equal(f.legacy.length, 0);
  const undone = applyAnnotationHistoryAction({ 1: f.nextPage }, invertAnnotationHistoryAction(f.environment.localAnnotationUndoRef.current[0]));
  assert.deepEqual(undone[1], f.previousPage);
});

test('owner-rejected native form record keeps the existing legacy fallback', () => {
  const f = fixture({ authorId: 'another-author' });
  assert.equal(f.recorder(f.action), false);
  f.route();
  assert.equal(f.environment.localAnnotationUndoRef.current.length, 0);
  assert.equal(f.legacy.length, 1);
});

for (const receipt of [undefined, false, 1, 'true']) {
  test(`native form cannot suppress fallback with non-true receipt ${String(receipt)}`, () => {
    const f = fixture();
    f.route({ pushLocalAnnotationHistoryAction: () => receipt });
    assert.equal(f.legacy.length, 1);
  });
}

for (const sourceName of ['object:modified', 'path:created', 'callout:edit', 'form-field:other']) {
  test(`single-owner form rule does not change ${sourceName} routing`, () => {
    const f = fixture();
    f.route({ source: sourceName });
    assert.equal(f.environment.localAnnotationUndoRef.current.length, 1);
    assert.equal(f.legacy.length, 1);
  });
}

for (const predicate of ['shouldSkipCheckpointByPolicy', 'shouldSkipCheckpointByInteraction']) {
  test(`native form preserves ${predicate} without recording either lane`, () => {
    const f = fixture();
    f.route({ [predicate]: true });
    assert.equal(f.environment.localAnnotationUndoRef.current.length, 0);
    assert.equal(f.legacy.length, 0);
  });
}

test('existing eraser and cloud Yjs checkpoint bypasses remain in force', () => {
  for (const overrides of [{ source: 'eraser:commit', isEraserCommit: true }, { source: 'object:modified', yjsDoc: {} }, { source: 'object:modified', yjsUndoManager: {} }]) {
    const f = fixture();
    f.route(overrides);
    assert.equal(f.legacy.length, 0);
  }
});
