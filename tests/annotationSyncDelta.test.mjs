import test from 'node:test';
import { deepStrictEqual, equal } from 'node:assert/strict';

import {
  buildFabricSyncDelta,
  buildCalloutSyncDelta,
  resolveFabricDeletedIds,
  shouldSuppressStaleCacheShrink,
} from '../src/utils/annotationSyncDelta.js';
import {
  applyAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';

const page = (objects) => ({ version: '5.3.0', objects });
const idsForPage = (byPage, pageNumber = 1) => (byPage[pageNumber]?.objects || []).map((obj) => obj.data?.id || obj.id);
const counter = (id, createdAt, displayNumber, extra = {}) => ({
  type: 'group',
  left: createdAt * 10,
  top: 20,
  fill: '#ef4444',
  ...extra,
  data: {
    id,
    type: 'counter',
    annotationType: 'counter',
    seriesId: 'series-a',
    seriesStart: 1,
    createdAt,
    displayNumber,
    ...extra.data,
  },
});
const penPath = (id, extra = {}) => ({
  type: 'path',
  data: { id },
  left: 1,
  top: 1,
  path: [['M', 0, 0]],
  ...extra,
});

test('moving one pen/path annotation dispatches one changed annotation', () => {
  const prior = {
    1: page([
      { type: 'path', data: { id: 'pen-1' }, left: 1, top: 1, path: [['M', 0, 0]] },
      { type: 'path', data: { id: 'pen-2' }, left: 20, top: 20, path: [['M', 1, 1]] },
    ]),
  };
  const current = {
    1: page([
      { type: 'path', data: { id: 'pen-1' }, left: 9, top: 7, path: [['M', 0, 0]] },
      prior[1].objects[1],
    ]),
  };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'move' });

  deepStrictEqual(idsForPage(delta.upsertByPage), ['pen-1']);
  deepStrictEqual(delta.changedIds, ['pen-1']);
  equal(delta.changedCount, 1);
  equal(delta.dispatchedCount, 1);
  equal(delta.fullFanOutReason, null);
});

test('creating one path on a page with many counters dispatches only that path', () => {
  const counters = Array.from({ length: 80 }, (_, index) => (
    counter(`counter-${index + 1}`, index + 1, index + 1)
  ));
  const prior = {
    1: page(counters),
  };
  const current = {
    1: page([
      ...counters,
      penPath('pen-created'),
    ]),
  };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'path:created' });

  deepStrictEqual(idsForPage(delta.upsertByPage), ['pen-created']);
  deepStrictEqual(delta.changedIds, ['pen-created']);
  equal(delta.changedCount, 1);
  equal(delta.dispatchedCount, 1);
  equal(delta.fullFanOutReason, null);
});

test('moving one path on a page with counters dispatches only that path', () => {
  const prior = {
    1: page([
      counter('counter-1', 1, 1),
      counter('counter-2', 2, 2),
      penPath('pen-1'),
    ]),
  };
  const current = {
    1: page([
      prior[1].objects[0],
      prior[1].objects[1],
      { ...prior[1].objects[2], left: 30, top: 40 },
    ]),
  };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'move' });

  deepStrictEqual(idsForPage(delta.upsertByPage), ['pen-1']);
  deepStrictEqual(delta.changedIds, ['pen-1']);
  equal(delta.changedCount, 1);
  equal(delta.dispatchedCount, 1);
});

test('moving one counter dispatches one changed counter', () => {
  const prior = {
    1: page([
      { type: 'group', data: { id: 'counter-1', type: 'counter', annotationType: 'counter' }, left: 10, top: 20 },
      { type: 'rect', data: { id: 'rect-1' }, left: 4, top: 5 },
    ]),
  };
  const current = {
    1: page([
      { ...prior[1].objects[0], left: 30, top: 40 },
      prior[1].objects[1],
    ]),
  };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'counter:move' });

  deepStrictEqual(idsForPage(delta.upsertByPage), ['counter-1']);
  deepStrictEqual(delta.changedIds, ['counter-1']);
  equal(delta.changedCount, 1);
  equal(delta.dispatchedCount, 1);
});

test('rotating one counter dispatches only that counter pointer angle', () => {
  const prior = {
    1: page([
      counter('counter-1', 1, 1, { data: { pointerAngle: 90 } }),
      counter('counter-2', 2, 2),
    ]),
  };
  const current = {
    1: page([
      { ...prior[1].objects[0], data: { ...prior[1].objects[0].data, pointerAngle: 180 } },
      prior[1].objects[1],
    ]),
  };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'counter:rotate' });

  deepStrictEqual(idsForPage(delta.upsertByPage), ['counter-1']);
  deepStrictEqual(delta.changedIds, ['counter-1']);
  equal(delta.changedCount, 1);
  equal(delta.dispatchedCount, 1);
});

test('resizing one counter dispatches only that counter geometry', () => {
  const prior = {
    1: page([
      counter('counter-1', 1, 1, { radius: 14 }),
      counter('counter-2', 2, 2),
    ]),
  };
  const current = {
    1: page([
      { ...prior[1].objects[0], radius: 20, left: 15, top: 25 },
      prior[1].objects[1],
    ]),
  };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'counter:resize' });

  deepStrictEqual(idsForPage(delta.upsertByPage), ['counter-1']);
  deepStrictEqual(delta.changedIds, ['counter-1']);
  equal(delta.changedCount, 1);
  equal(delta.dispatchedCount, 1);
});

test('counter group color update dispatches only intended counters', () => {
  const prior = {
    1: page([
      counter('counter-1', 1, 1),
      counter('counter-2', 2, 2),
      counter('counter-3', 3, 1, { data: { seriesId: 'series-b' }, fill: '#22c55e' }),
    ]),
  };
  const current = {
    1: page([
      { ...prior[1].objects[0], fill: '#000000' },
      { ...prior[1].objects[1], fill: '#000000' },
      prior[1].objects[2],
    ]),
  };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'counter:group-update' });

  deepStrictEqual(idsForPage(delta.upsertByPage), ['counter-1', 'counter-2']);
  deepStrictEqual(delta.changedIds, ['counter-1', 'counter-2']);
  equal(delta.changedCount, 2);
  equal(delta.dispatchedCount, 2);
});

test('editing one callout dispatches one callout', () => {
  const prior = [
    { id: 'callout-1', text: 'Old', pageNumber: 1 },
    { id: 'callout-2', text: 'Untouched', pageNumber: 1 },
  ];
  const current = [
    { id: 'callout-1', text: 'New', pageNumber: 1 },
    prior[1],
  ];

  const delta = buildCalloutSyncDelta({ currentCallouts: current, priorCallouts: prior, actionType: 'callout:edit' });

  deepStrictEqual(delta.upsertCallouts.map((c) => c.id), ['callout-1']);
  deepStrictEqual(delta.deletedIds, []);
  equal(delta.changedCount, 1);
  equal(delta.dispatchedCount, 1);
  equal(delta.fullFanOutReason, null);
});

test('deleting one annotation dispatches one delete and no upsert', () => {
  const prior = {
    1: page([
      { type: 'path', data: { id: 'delete-me' }, left: 1 },
      { type: 'path', data: { id: 'keep-me' }, left: 2 },
    ]),
  };
  const current = { 1: page([prior[1].objects[1]]) };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'delete' });

  deepStrictEqual(delta.deletedIds, ['delete-me']);
  deepStrictEqual(delta.changedIds, []);
  equal(delta.changedCount, 0);
  equal(delta.dispatchedCount, 1);
  equal(Object.keys(delta.upsertByPage).length, 0);
});

test('bulk delete dispatches all affected ids', () => {
  const prior = {
    1: page([
      { type: 'path', data: { id: 'a' }, left: 1 },
      { type: 'path', data: { id: 'b' }, left: 2 },
      { type: 'path', data: { id: 'c' }, left: 3 },
    ]),
  };
  const current = { 1: page([prior[1].objects[2]]) };

  const delta = buildFabricSyncDelta({ currentByPage: current, priorByPage: prior, actionType: 'bulk-delete' });

  deepStrictEqual(delta.deletedIds, ['a', 'b']);
  equal(delta.dispatchedCount, 2);
  equal(Object.keys(delta.upsertByPage).length, 0);
});

test('explicit bulk delete ids bypass stale-cache suppression and fan out deletes', () => {
  const explicitIds = Array.from({ length: 121 }, (_, index) => `bulk-${index + 1}`);
  const resolved = resolveFabricDeletedIds({
    fabricAction: {
      source: 'object:modified',
      action: 'delete',
      deletedIds: explicitIds,
    },
    detectedDeletedIds: ['diff-only'],
  });
  const delta = buildFabricSyncDelta({
    currentByPage: { 1: page([]) },
    priorByPage: { 1: page(explicitIds.map((id) => penPath(id))) },
    deletedIds: resolved.deletedIds,
    actionType: 'delete',
  });

  equal(resolved.explicit, true);
  equal(resolved.source, 'fabric-save-action');
  deepStrictEqual(delta.deletedIds, explicitIds);
  equal(delta.dispatchedCount, 121);
  equal(shouldSuppressStaleCacheShrink({
    deletedIds: resolved.deletedIds,
    priorObjectCount: 121,
    cutoverTs: Date.now(),
    hasYDoc: true,
    explicitDelete: resolved.explicit,
  }), false);
});

test('suspicious stale-cache wipe without explicit deleted ids is still suppressed', () => {
  const detectedDeletedIds = Array.from({ length: 121 }, (_, index) => `stale-${index + 1}`);
  const resolved = resolveFabricDeletedIds({
    fabricAction: {
      source: 'object:modified',
      action: 'unknown',
      deletedIds: [],
    },
    detectedDeletedIds,
  });

  equal(resolved.explicit, false);
  equal(resolved.source, 'diff');
  deepStrictEqual(resolved.deletedIds, detectedDeletedIds);
  equal(shouldSuppressStaleCacheShrink({
    deletedIds: resolved.deletedIds,
    priorObjectCount: 121,
    cutoverTs: Date.now(),
    hasYDoc: true,
    explicitDelete: resolved.explicit,
  }), true);
});

// RULED 2026-09-28 owner: open editing + lock — a step is no longer trimmed
// to the recorder's own marks (their edit to a colleague's mark is theirs to
// undo), so both edited marks are dispatched; an untouched mark still is not.
test('undo/redo dispatches only the annotations the step touched', () => {
  const prior = {
    1: page([
      { type: 'rect', data: { id: 'mine', authorId: 'user-a' }, left: 1 },
      { type: 'rect', data: { id: 'theirs', authorId: 'user-b' }, left: 2 },
      { type: 'rect', data: { id: 'untouched', authorId: 'user-b' }, left: 3 },
    ]),
  };
  const action = {
    type: 'fabric:batch',
    pageNumber: 1,
    updated: [
      { id: 'mine', before: prior[1].objects[0], after: { ...prior[1].objects[0], left: 10 } },
      { id: 'theirs', before: prior[1].objects[1], after: { ...prior[1].objects[1], left: 20 } },
    ],
  };
  const scopedRedo = filterAnnotationHistoryActionByOwner(action, 'user-a');
  const afterRedo = applyAnnotationHistoryAction(prior, scopedRedo);
  const redoDelta = buildFabricSyncDelta({ currentByPage: afterRedo, priorByPage: prior, actionType: 'redo' });
  const scopedUndo = filterAnnotationHistoryActionByOwner(invertAnnotationHistoryAction(action), 'user-a');
  const afterUndo = applyAnnotationHistoryAction(afterRedo, scopedUndo);
  const undoDelta = buildFabricSyncDelta({ currentByPage: afterUndo, priorByPage: afterRedo, actionType: 'undo' });

  deepStrictEqual(idsForPage(redoDelta.upsertByPage).sort(), ['mine', 'theirs']);
  deepStrictEqual([...redoDelta.changedIds].sort(), ['mine', 'theirs']);
  deepStrictEqual(idsForPage(undoDelta.upsertByPage).sort(), ['mine', 'theirs']);
  deepStrictEqual([...undoDelta.changedIds].sort(), ['mine', 'theirs']);
});
