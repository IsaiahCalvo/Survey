import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEraseHistoryScopeTargets,
  scopeEraseHistorySnapshot,
} from '../src/utils/eraseHistoryScope.js';

const ink = (id, revision) => ({
  type: 'path',
  data: { id, tool: 'pen' },
  revision,
});

test('eraser Undo/Redo changes only its exact lanes and preserves unrelated later work', () => {
  const beforeInk = ink('ink-1', 'before');
  const afterInk = ink('ink-1', 'after');
  const beforeCounter = {
    type: 'group',
    data: { id: 'counter-3', type: 'counter', displayNumber: 3 },
  };
  const afterCounter = {
    type: 'group',
    data: { id: 'counter-3', type: 'counter', displayNumber: 2 },
  };
  const deletedShape = { type: 'rect', data: { id: 'shape-1' } };
  const intent = {
    pageNumber: 1,
    targets: [
      {
        domain: 'page-object',
        storageKey: 'ink-1',
        pageNumber: 1,
        index: 0,
        operation: 'replace',
        before: beforeInk,
        after: afterInk,
      },
      {
        domain: 'page-object',
        storageKey: 'shape-1',
        pageNumber: 1,
        index: 1,
        operation: 'delete',
        before: deletedShape,
      },
      {
        domain: 'page-object',
        storageKey: 'counter-3',
        pageNumber: 2,
        index: 0,
        operation: 'replace',
        before: beforeCounter,
        after: afterCounter,
      },
    ],
  };
  const targets = buildEraseHistoryScopeTargets(intent);
  const before = {
    annotationsByPage: {
      1: { objects: [beforeInk, deletedShape] },
      2: { objects: [beforeCounter] },
    },
    surveyMarkers: { untouched: { id: 'untouched' } },
    spaces: [{ id: 'space-before' }],
    callouts: [],
  };
  const remote = { type: 'ellipse', data: { id: 'remote-shape' }, revision: 'remote' };
  const afterWithLaterWork = {
    annotationsByPage: {
      1: { objects: [afterInk, remote] },
      2: { objects: [afterCounter] },
      3: { objects: [{ type: 'rect', data: { id: 'later-page' } }] },
    },
    surveyMarkers: {},
    spaces: [{ id: 'space-later' }],
    callouts: [],
  };

  const undone = scopeEraseHistorySnapshot({
    currentSnapshot: afterWithLaterWork,
    targetSnapshot: before,
    targets,
  });
  assert.deepEqual(undone.annotationsByPage[1].objects, [beforeInk, deletedShape, remote]);
  assert.deepEqual(undone.annotationsByPage[2].objects, [beforeCounter]);
  assert.deepEqual(undone.annotationsByPage[3], afterWithLaterWork.annotationsByPage[3]);
  assert.deepEqual(undone.surveyMarkers, {});
  assert.deepEqual(undone.spaces, [{ id: 'space-later' }]);

  const redone = scopeEraseHistorySnapshot({
    currentSnapshot: undone,
    targetSnapshot: afterWithLaterWork,
    targets,
  });
  assert.deepEqual(redone.annotationsByPage[1].objects, [afterInk, remote]);
  assert.deepEqual(redone.annotationsByPage[2].objects, [afterCounter]);
  assert.deepEqual(redone.surveyMarkers, {});
  assert.deepEqual(redone.spaces, [{ id: 'space-later' }]);
});

test('mutation-scoped Undo refuses to overwrite a collaborator edit of the same target', () => {
  const before = ink('ink-1', 'before');
  const after = ink('ink-1', 'after');
  const collaborator = ink('ink-1', 'collaborator');
  const targets = buildEraseHistoryScopeTargets({
    pageNumber: 1,
    targets: [{
      domain: 'page-object',
      storageKey: 'ink-1',
      pageNumber: 1,
      index: 0,
      operation: 'replace',
      before,
      after,
    }],
  });
  const scoped = scopeEraseHistorySnapshot({
    currentSnapshot: { annotationsByPage: { 1: { objects: [collaborator] } } },
    targetSnapshot: { annotationsByPage: { 1: { objects: [before] } } },
    targets,
  });
  assert.deepEqual(scoped.annotationsByPage[1].objects, [collaborator]);
});
