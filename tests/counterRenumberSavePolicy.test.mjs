import test from 'node:test';
import assert from 'node:assert/strict';

import { renumberCounters } from '../src/utils/counterNumbering.js';
import {
  preserveExistingCountersOnPage,
  shouldRenumberCountersForSave,
} from '../src/utils/counterRenumberSavePolicy.js';
import {
  buildFabricSyncDelta,
} from '../src/utils/annotationSyncDelta.js';
import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';

const page = (objects) => ({ version: '5.3.0', objects });
const counter = (id, createdAt, displayNumber, extra = {}) => ({
  type: 'group',
  left: 10 + createdAt,
  top: 20,
  fill: '#ef4444',
  ...extra,
  data: {
    id,
    type: 'counter',
    seriesId: 'series-a',
    seriesStart: 1,
    createdAt,
    displayNumber,
    ...extra.data,
  },
});
const path = (id, extra = {}) => ({
  type: 'path',
  left: 1,
  top: 1,
  path: [['M', 0, 0]],
  data: { id },
  ...extra,
});
const idsForPage = (byPage, pageNumber = 1) => (byPage[pageNumber]?.objects || []).map((obj) => obj.data?.id || obj.id);

test('path creation with dirty incoming counters preserves old counters and syncs only the path', () => {
  const previousPage = page([
    counter('counter-1', 1, 1),
    counter('counter-2', 2, 2),
    counter('counter-3', 3, 3),
  ]);
  const incomingPage = page([
    { ...previousPage.objects[0], data: { ...previousPage.objects[0].data, displayNumber: 99 } },
    { ...previousPage.objects[1], data: { ...previousPage.objects[1].data, displayNumber: 100 } },
    { ...previousPage.objects[2], data: { ...previousPage.objects[2].data, displayNumber: 101 } },
    path('path-1'),
  ]);
  const action = buildAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage: incomingPage,
  });
  const decision = shouldRenumberCountersForSave({
    source: 'path:created',
    action: 'path:created',
    localHistoryAction: action,
  });
  const preserved = preserveExistingCountersOnPage(incomingPage, previousPage);

  assert.equal(decision.shouldRenumber, false);
  assert.equal(decision.shouldPreserveExistingCounters, true);
  assert.deepEqual(
    preserved.objects.filter((obj) => obj.data?.type === 'counter'),
    previousPage.objects
  );
  assert.equal(preserved.objects.at(-1).data.id, 'path-1');

  const delta = buildFabricSyncDelta({
    currentByPage: { 1: preserved },
    priorByPage: { 1: previousPage },
    actionType: 'path:created',
  });
  assert.deepEqual(idsForPage(delta.upsertByPage), ['path-1']);
  assert.equal(delta.changedCount, 1);
});

test('path move preserves dirty incoming counters while counter move is not overwritten', () => {
  const previousPage = page([
    counter('counter-1', 1, 1),
    path('path-1'),
  ]);
  const pathMoved = page([
    { ...previousPage.objects[0], data: { ...previousPage.objects[0].data, displayNumber: 99 } },
    { ...previousPage.objects[1], left: 50 },
  ]);
  const counterMoved = page([
    { ...previousPage.objects[0], left: 80 },
    previousPage.objects[1],
  ]);

  const pathDecision = shouldRenumberCountersForSave({
    source: 'object:modified',
    action: 'move',
    localHistoryAction: buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage: pathMoved }),
  });
  const pathPreserved = preserveExistingCountersOnPage(pathMoved, previousPage);

  assert.equal(pathDecision.shouldRenumber, false);
  assert.equal(pathDecision.shouldPreserveExistingCounters, true);
  assert.deepEqual(pathPreserved.objects[0], previousPage.objects[0]);
  assert.equal(pathPreserved.objects[1].left, 50);

  const counterDecision = shouldRenumberCountersForSave({
    source: 'object:modified',
    action: 'move',
    localHistoryAction: buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage: counterMoved }),
  });

  assert.equal(counterDecision.shouldRenumber, false);
  assert.equal(counterDecision.shouldPreserveExistingCounters, false);
  assert.equal(counterMoved.objects[0].left, 80);
});

test('counter rotate and resize skip renumbering without preserving over the edit', () => {
  const previousPage = page([
    counter('counter-1', 1, 1, { radius: 14, data: { pointerAngle: 90 } }),
    path('path-1'),
  ]);
  const rotated = page([
    { ...previousPage.objects[0], data: { ...previousPage.objects[0].data, pointerAngle: 180 } },
    previousPage.objects[1],
  ]);
  const resized = page([
    { ...previousPage.objects[0], radius: 20, left: 15, top: 25 },
    previousPage.objects[1],
  ]);

  const rotateDecision = shouldRenumberCountersForSave({
    source: 'counter:handle-rotate-commit',
    action: 'counter-rotate',
    localHistoryAction: buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage: rotated }),
  });
  const resizeDecision = shouldRenumberCountersForSave({
    source: 'object:modified',
    action: 'scale',
    localHistoryAction: buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage: resized }),
  });

  assert.equal(rotateDecision.shouldRenumber, false);
  assert.equal(rotateDecision.shouldPreserveExistingCounters, false);
  assert.equal(rotated.objects[0].data.pointerAngle, 180);
  assert.equal(resizeDecision.shouldRenumber, false);
  assert.equal(resizeDecision.shouldPreserveExistingCounters, false);
  assert.equal(resized.objects[0].radius, 20);
  assert.equal(resized.objects[0].left, 15);
});

test('mixed counter and path move preserves intended counter edit and restores unrelated dirty counters', () => {
  const previousPage = page([
    counter('counter-1', 1, 1),
    path('path-1'),
    counter('counter-2', 2, 2),
  ]);
  const mixedMoved = page([
    { ...previousPage.objects[0], left: 80, top: 90 },
    { ...previousPage.objects[1], left: 50, top: 60 },
    { ...previousPage.objects[2], data: { ...previousPage.objects[2].data, displayNumber: 99 } },
  ]);
  const action = buildAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage: mixedMoved,
  });
  const decision = shouldRenumberCountersForSave({
    source: 'object:modified',
    action: 'group-move',
    localHistoryAction: action,
  });

  assert.equal(action.type, 'fabric:batch');
  assert.equal(action.updated.length, 3);
  assert.equal(decision.shouldRenumber, false);
  assert.equal(decision.shouldPreserveExistingCounters, true);
  assert.deepEqual(decision.intentionalCounterChangeIds, ['counter-1']);

  const preserved = preserveExistingCountersOnPage(mixedMoved, previousPage, {
    intentionalCounterChangeIds: decision.intentionalCounterChangeIds,
  });
  assert.equal(preserved.objects[0].left, 80);
  assert.equal(preserved.objects[0].top, 90);
  assert.equal(preserved.objects[0].data.displayNumber, 1);
  assert.equal(preserved.objects[1].left, 50);
  assert.deepEqual(preserved.objects[2], previousPage.objects[2]);

  const delta = buildFabricSyncDelta({
    currentByPage: { 1: preserved },
    priorByPage: { 1: previousPage },
    actionType: 'group-move',
  });
  assert.deepEqual(idsForPage(delta.upsertByPage), ['counter-1', 'path-1']);
  assert.equal(delta.changedCount, 2);
});

test('counter create/delete and series changes request renumbering', () => {
  const previousPage = page([
    counter('counter-1', 1, 1),
    counter('counter-2', 2, 2),
  ]);
  const withCreatedCounter = page([
    ...previousPage.objects,
    counter('counter-3', 3, 3),
  ]);
  const withDeletedCounter = page([
    previousPage.objects[1],
  ]);
  const withSeriesStartChange = page([
    { ...previousPage.objects[0], data: { ...previousPage.objects[0].data, seriesStart: 10 } },
    previousPage.objects[1],
  ]);

  const createDecision = shouldRenumberCountersForSave({
    source: 'counter:create',
    action: 'counter:create',
    localHistoryAction: buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage: withCreatedCounter }),
  });

  const deleteDecision = shouldRenumberCountersForSave({
    source: 'object:modified',
    action: 'delete',
    localHistoryAction: buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage: withDeletedCounter }),
  });

  const seriesDecision = shouldRenumberCountersForSave({
    source: 'counter:group-update',
    action: 'counter-group-update',
    localHistoryAction: buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage: withSeriesStartChange }),
  });

  assert.equal(createDecision.shouldRenumber, true);
  assert.equal(createDecision.shouldPreserveExistingCounters, false);
  assert.equal(deleteDecision.shouldRenumber, true);
  assert.equal(deleteDecision.shouldPreserveExistingCounters, false);
  assert.equal(seriesDecision.shouldRenumber, true);
  assert.equal(seriesDecision.shouldPreserveExistingCounters, false);
});

test('counter group color update skips renumbering but preserves intended color changes only', () => {
  const previousPage = page([
    counter('counter-1', 1, 1),
    counter('counter-2', 2, 2),
    counter('counter-3', 3, 3, { data: { seriesId: 'series-b' }, fill: '#22c55e' }),
  ]);
  const nextPage = page([
    { ...previousPage.objects[0], fill: '#000000' },
    { ...previousPage.objects[1], fill: '#000000' },
    previousPage.objects[2],
  ]);
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage });
  const decision = shouldRenumberCountersForSave({
    source: 'counter:group-update',
    action: 'counter-group-update',
    localHistoryAction: action,
  });

  assert.equal(decision.shouldRenumber, false);
  assert.equal(decision.shouldPreserveExistingCounters, false);

  const delta = buildFabricSyncDelta({
    currentByPage: { 1: nextPage },
    priorByPage: { 1: previousPage },
    actionType: 'counter:group-update',
  });
  assert.deepEqual(idsForPage(delta.upsertByPage), ['counter-1', 'counter-2']);
  assert.equal(delta.changedCount, 2);
  assert.equal(nextPage.objects[0].fill, '#000000');
  assert.equal(nextPage.objects[1].fill, '#000000');
  assert.equal(nextPage.objects[2].fill, '#22c55e');
});

test('counter delete renumbering and undo/redo restore numbering', () => {
  const initial = {
    1: page([
      counter('counter-1', 1, 1),
      counter('counter-2', 2, 2),
      counter('counter-3', 3, 3),
    ]),
  };
  const afterDeleteUnnumbered = applyAnnotationHistoryAction(initial, {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: 'counter-2',
    annotation: initial[1].objects[1],
    index: 1,
  });
  renumberCounters(afterDeleteUnnumbered);

  assert.deepEqual(afterDeleteUnnumbered[1].objects.map((obj) => obj.data.displayNumber), [1, 2]);

  const undoAction = invertAnnotationHistoryAction({
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: 'counter-2',
    annotation: initial[1].objects[1],
    index: 1,
  });
  const afterUndo = applyAnnotationHistoryAction(afterDeleteUnnumbered, undoAction);
  renumberCounters(afterUndo);
  assert.deepEqual(afterUndo[1].objects.map((obj) => obj.data.displayNumber), [1, 2, 3]);

  const redoAction = invertAnnotationHistoryAction(undoAction);
  const afterRedo = applyAnnotationHistoryAction(afterUndo, redoAction);
  renumberCounters(afterRedo);
  assert.deepEqual(afterRedo[1].objects.map((obj) => obj.data.displayNumber), [1, 2]);
});
