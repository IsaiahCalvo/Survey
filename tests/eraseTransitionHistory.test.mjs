import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendLegacyHistoryCheckpoint,
  claimHistoryQuarantineEvent,
  createEraseTransitionHistoryMeta,
  createEraseTransitionHistorySentinel,
  isEraseTransitionHistorySentinel,
  moveEraseTransitionHistoryCheckpointByMutationId,
  moveLegacyHistoryCheckpoint,
  quarantineLegacyHistoryCheckpoint,
  removeEraseTransitionHistoryCheckpoints,
} from '../src/utils/eraseTransitionHistory.js';

function transitionContext(index) {
  const mutationId = `erase-${index}`;
  return {
    mutationId,
    pageNumber: 1,
    targetCount: 1,
    eraseHistoryTransition: {
      version: 1,
      mutationId,
      lanes: [],
      counterRenumbers: [],
    },
  };
}

function appendErase(state, index) {
  const context = transitionContext(index);
  return appendLegacyHistoryCheckpoint({
    ...state,
    entry: createEraseTransitionHistorySentinel(context.mutationId),
    meta: createEraseTransitionHistoryMeta({
      checkpointId: index + 1,
      context,
    }),
  });
}

test('55 unique erases retain 50 compact sentinels without document snapshots', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  for (let index = 0; index < 55; index += 1) {
    state = appendErase(state, index);
  }

  assert.equal(state.undoHistory.length, 50);
  assert.equal(state.undoMeta.length, 50);
  assert.equal(state.undoHistory[0].mutationId, 'erase-5');
  assert.equal(state.undoHistory.at(-1).mutationId, 'erase-54');
  assert.ok(state.undoHistory.every(isEraseTransitionHistorySentinel));
  assert.ok(state.undoHistory.every((entry) => !('annotationsByPage' in entry)));
  assert.ok(
    JSON.stringify({
      history: state.undoHistory,
      meta: state.undoMeta,
    }).length < 100_000,
  );
});

test('50 transition Undo and Redo operations preserve exact ordering and sentinel identity', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  for (let index = 0; index < 50; index += 1) state = appendErase(state, index);
  const originalSentinels = new Map(
    state.undoHistory.map((entry) => [entry.mutationId, entry]),
  );

  const undoOrder = [];
  for (let index = 0; index < 50; index += 1) {
    const moved = moveLegacyHistoryCheckpoint({ ...state, direction: 'undo' });
    undoOrder.push(moved.entry.mutationId);
    assert.equal(moved.entry, originalSentinels.get(moved.entry.mutationId));
    state = moved;
  }
  assert.deepEqual(
    undoOrder,
    Array.from({ length: 50 }, (_, index) => `erase-${49 - index}`),
  );
  assert.equal(state.undoHistory.length, 0);
  assert.equal(state.redoHistory.length, 50);

  const redoOrder = [];
  for (let index = 0; index < 50; index += 1) {
    const moved = moveLegacyHistoryCheckpoint({ ...state, direction: 'redo' });
    redoOrder.push(moved.entry.mutationId);
    assert.equal(moved.entry, originalSentinels.get(moved.entry.mutationId));
    state = moved;
  }
  assert.deepEqual(
    redoOrder,
    Array.from({ length: 50 }, (_, index) => `erase-${index}`),
  );
  assert.equal(state.undoHistory.length, 50);
  assert.equal(state.redoHistory.length, 0);
});

test('a new erase after Undo clears Redo without disturbing retained ordering', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  state = appendErase(state, 0);
  state = appendErase(state, 1);
  state = moveLegacyHistoryCheckpoint({ ...state, direction: 'undo' });
  assert.deepEqual(state.redoHistory.map((entry) => entry.mutationId), ['erase-1']);

  state = appendErase(state, 2);
  assert.deepEqual(
    state.undoHistory.map((entry) => entry.mutationId),
    ['erase-0', 'erase-2'],
  );
  assert.equal(state.redoHistory.length, 0);
  assert.equal(state.redoMeta.length, 0);
});

test('ordinary snapshots and transition sentinels keep mixed stack ordering', () => {
  const ordinary = { annotationsByPage: { 1: { objects: [{ id: 'shape' }] } } };
  const ordinaryMeta = { checkpointId: 1, reason: 'annotations:save' };
  let state = appendLegacyHistoryCheckpoint({
    undoHistory: [],
    undoMeta: [],
    entry: ordinary,
    meta: ordinaryMeta,
  });
  state = appendErase(state, 1);

  let moved = moveLegacyHistoryCheckpoint({ ...state, direction: 'undo' });
  assert.equal(moved.entry.mutationId, 'erase-1');
  state = moved;
  moved = moveLegacyHistoryCheckpoint({ ...state, direction: 'undo' });
  assert.equal(moved.entry, ordinary);
  state = moved;
  moved = moveLegacyHistoryCheckpoint({ ...state, direction: 'redo' });
  assert.equal(moved.entry, ordinary);
  state = moved;
  moved = moveLegacyHistoryCheckpoint({ ...state, direction: 'redo' });
  assert.equal(moved.entry.mutationId, 'erase-1');
});

test('conflicted transition is quarantined so an older checkpoint remains reachable', () => {
  const ordinary = { annotationsByPage: {} };
  let state = appendLegacyHistoryCheckpoint({
    undoHistory: [],
    undoMeta: [],
    entry: ordinary,
    meta: { checkpointId: 1, reason: 'annotations:save' },
  });
  state = appendErase(state, 1);
  state = quarantineLegacyHistoryCheckpoint({ ...state, direction: 'undo' });

  assert.equal(state.undoHistory.length, 1);
  assert.equal(state.undoHistory[0], ordinary);
  assert.equal(state.redoHistory.length, 0);
});

test('toast Undo moves its exact older transition without disturbing a newer erase', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  state = appendErase(state, 0);
  state = appendErase(state, 1);
  const moved = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-0',
  });

  assert.deepEqual(
    moved.undoHistory.map((entry) => entry.mutationId),
    ['erase-1'],
  );
  assert.deepEqual(
    moved.redoHistory.map((entry) => entry.mutationId),
    ['erase-0'],
  );
  assert.equal(moved.entry.mutationId, 'erase-0');
  assert.equal(moved.meta.context.eraseHistoryTransition.mutationId, 'erase-0');
});

test('targeted Redo moves the exact older transition and preserves newer Redo work', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  state = appendErase(state, 0);
  state = appendErase(state, 1);
  state = appendErase(state, 2);
  state = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-0',
    direction: 'undo',
  });
  state = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-1',
    direction: 'undo',
  });

  const moved = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-0',
    direction: 'redo',
  });

  assert.deepEqual(
    moved.undoHistory.map((entry) => entry.mutationId),
    ['erase-2', 'erase-0'],
  );
  assert.deepEqual(
    moved.redoHistory.map((entry) => entry.mutationId),
    ['erase-1'],
  );
  assert.deepEqual(
    moved.undoMeta.map((meta) => meta.context.eraseHistoryTransition.mutationId),
    ['erase-2', 'erase-0'],
  );
  assert.deepEqual(
    moved.redoMeta.map((meta) => meta.context.eraseHistoryTransition.mutationId),
    ['erase-1'],
  );
  assert.equal(moved.entry.mutationId, 'erase-0');
});

test('synchronous Undo rollback removal cannot reinstall stale history arrays', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  state = appendErase(state, 0);
  state = appendErase(state, 1);

  const existedBeforeApply = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-1',
    direction: 'undo',
  });
  assert.ok(existedBeforeApply);

  state = removeEraseTransitionHistoryCheckpoints({
    ...state,
    mutationIds: ['erase-1'],
  });
  const movedAfterApply = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-1',
    direction: 'undo',
  });

  assert.equal(movedAfterApply, null);
  assert.deepEqual(state.undoHistory.map((entry) => entry.mutationId), ['erase-0']);
  assert.deepEqual(
    state.undoMeta.map((meta) => meta.context.eraseHistoryTransition.mutationId),
    ['erase-0'],
  );
  assert.equal(state.redoHistory.length, 0);
  assert.equal(state.redoMeta.length, 0);
});

test('synchronous Redo rollback removal cannot reinstall stale history arrays', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  state = appendErase(state, 0);
  state = appendErase(state, 1);
  state = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-1',
    direction: 'undo',
  });

  const existedBeforeApply = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-1',
    direction: 'redo',
  });
  assert.ok(existedBeforeApply);

  state = removeEraseTransitionHistoryCheckpoints({
    ...state,
    mutationIds: ['erase-1'],
  });
  const movedAfterApply = moveEraseTransitionHistoryCheckpointByMutationId({
    ...state,
    mutationId: 'erase-1',
    direction: 'redo',
  });

  assert.equal(movedAfterApply, null);
  assert.deepEqual(state.undoHistory.map((entry) => entry.mutationId), ['erase-0']);
  assert.deepEqual(
    state.undoMeta.map((meta) => meta.context.eraseHistoryTransition.mutationId),
    ['erase-0'],
  );
  assert.equal(state.redoHistory.length, 0);
  assert.equal(state.redoMeta.length, 0);
});

test('definitive rejection removes an exact transition from both history directions', () => {
  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  state = appendErase(state, 0);
  state = appendErase(state, 1);
  state = moveLegacyHistoryCheckpoint({ ...state, direction: 'undo' });
  const cleaned = removeEraseTransitionHistoryCheckpoints({
    ...state,
    mutationIds: ['erase-0', 'erase-1'],
  });

  assert.equal(cleaned.removedCount, 2);
  assert.equal(cleaned.undoHistory.length, 0);
  assert.equal(cleaned.undoMeta.length, 0);
  assert.equal(cleaned.redoHistory.length, 0);
  assert.equal(cleaned.redoMeta.length, 0);
});

test('replayed quarantine event cannot clear history added after its first delivery', () => {
  const handledKeys = new Set();
  const event = { dedupeKey: 'doc\u0001writer\u0001generation:1' };
  assert.equal(claimHistoryQuarantineEvent(handledKeys, event), true);

  let state = {
    undoHistory: [],
    undoMeta: [],
    redoHistory: [],
    redoMeta: [],
  };
  state = appendErase(state, 9);
  if (claimHistoryQuarantineEvent(handledKeys, event)) {
    state = removeEraseTransitionHistoryCheckpoints({
      ...state,
      mutationIds: ['erase-9'],
    });
  }

  assert.deepEqual(state.undoHistory.map((entry) => entry.mutationId), ['erase-9']);
  assert.deepEqual(
    state.undoMeta.map((meta) => meta.context.eraseHistoryTransition.mutationId),
    ['erase-9'],
  );
});
