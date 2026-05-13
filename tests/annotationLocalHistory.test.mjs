import test from 'node:test';
import { deepStrictEqual, equal } from 'node:assert/strict';

import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  buildPreciseAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';

test('buildAnnotationHistoryAction records one created annotation by id', () => {
  const previousPage = { version: '5.2.4', objects: [{ type: 'rect', data: { id: 'a1' }, left: 1 }] };
  const nextPage = {
    version: '5.2.4',
    objects: [
      { type: 'rect', data: { id: 'a1' }, left: 1 },
      { type: 'path', data: { id: 'a2' }, path: [['M', 1, 1]] },
    ],
  };

  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage });

  equal(action.type, 'fabric:create');
  equal(action.pageNumber, 1);
  equal(action.annotation.data.id, 'a2');
});

test('applyAnnotationHistoryAction undo removes a created annotation without touching others', () => {
  const page = {
    version: '5.2.4',
    objects: [
      { type: 'rect', data: { id: 'a1' }, left: 1 },
      { type: 'path', data: { id: 'a2' }, path: [['M', 1, 1]] },
    ],
  };
  const state = { 1: page, 2: { version: '5.2.4', objects: [{ type: 'circle', data: { id: 'b1' } }] } };
  const createAction = { type: 'fabric:create', pageNumber: 1, annotationId: 'a2', annotation: page.objects[1] };

  const next = applyAnnotationHistoryAction(state, invertAnnotationHistoryAction(createAction));

  deepStrictEqual(next[1].objects.map((obj) => obj.data.id), ['a1']);
  deepStrictEqual(next[2].objects.map((obj) => obj.data.id), ['b1']);
});

test('local fabric undo then redo before reload reapplies the annotation', () => {
  const initial = {
    1: {
      objects: [
        { type: 'rect', data: { id: 'existing', authorId: 'user-a' }, left: 1 },
      ],
    },
  };
  const createAction = {
    type: 'fabric:create',
    pageNumber: 1,
    annotationId: 'new-rect',
    annotation: { type: 'rect', data: { id: 'new-rect', authorId: 'user-a' }, left: 10 },
    index: 1,
  };

  const afterCreate = applyAnnotationHistoryAction(initial, createAction);
  const afterUndo = applyAnnotationHistoryAction(afterCreate, invertAnnotationHistoryAction(createAction));
  const afterRedo = applyAnnotationHistoryAction(afterUndo, createAction);

  deepStrictEqual(afterCreate[1].objects.map((obj) => obj.data.id), ['existing', 'new-rect']);
  deepStrictEqual(afterUndo[1].objects.map((obj) => obj.data.id), ['existing']);
  deepStrictEqual(afterRedo[1].objects.map((obj) => obj.data.id), ['existing', 'new-rect']);
});

test('local fabric redo remains owner scoped after undo', () => {
  const state = {
    1: {
      objects: [
        { type: 'rect', data: { id: 'mine', authorId: 'user-a' }, left: 1 },
      ],
    },
  };
  const foreignRedo = {
    type: 'fabric:create',
    pageNumber: 1,
    annotationId: 'theirs',
    annotation: { type: 'rect', data: { id: 'theirs', authorId: 'user-b' }, left: 2 },
  };

  const scoped = filterAnnotationHistoryActionByOwner(foreignRedo, 'user-a');
  const afterRedo = applyAnnotationHistoryAction(state, scoped);

  deepStrictEqual(scoped, null);
  deepStrictEqual(afterRedo[1].objects.map((obj) => obj.data.id), ['mine']);
});


test('buildAnnotationHistoryAction records one updated annotation before and after', () => {
  const previousPage = { objects: [{ type: 'line', data: { id: 'l1' }, left: 1, top: 2 }] };
  const nextPage = { objects: [{ type: 'line', data: { id: 'l1', midpoint: { x: 5, y: 6 } }, left: 1, top: 2 }] };

  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage });

  equal(action.type, 'fabric:update');
  deepStrictEqual(action.before.data, { id: 'l1' });
  deepStrictEqual(action.after.data, { id: 'l1', midpoint: { x: 5, y: 6 } });
});

test('buildAnnotationHistoryAction records a group move as one batch update', () => {
  const previousPage = {
    objects: [
      { type: 'rect', data: { id: 'r1', authorId: 'user-a' }, left: 10, top: 20 },
      { type: 'circle', data: { id: 'c1', authorId: 'user-a' }, left: 40, top: 50 },
      { type: 'line', data: { id: 'l1', authorId: 'user-b' }, left: 1, top: 2 },
    ],
  };
  const nextPage = {
    objects: [
      { type: 'rect', data: { id: 'r1', authorId: 'user-a' }, left: 15, top: 25 },
      { type: 'circle', data: { id: 'c1', authorId: 'user-a' }, left: 45, top: 55 },
      { type: 'line', data: { id: 'l1', authorId: 'user-b' }, left: 1, top: 2 },
    ],
  };

  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage });
  const undone = applyAnnotationHistoryAction({ 1: nextPage }, invertAnnotationHistoryAction(action));
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action.type, 'fabric:batch');
  equal(action.updated.length, 2);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('buildAnnotationHistoryAction records multi-delete as one undoable batch', () => {
  const previousPage = {
    objects: [
      { type: 'path', data: { id: 'p1', authorId: 'user-a' }, path: [['M', 0, 0]] },
      { type: 'path', data: { id: 'p2', authorId: 'user-a' }, path: [['M', 1, 1]] },
      { type: 'path', data: { id: 'p3', authorId: 'user-b' }, path: [['M', 2, 2]] },
    ],
  };
  const nextPage = { objects: [previousPage.objects[2]] };

  const action = buildAnnotationHistoryAction({ pageNumber: 2, previousPage, nextPage });
  const undone = applyAnnotationHistoryAction({ 2: nextPage }, invertAnnotationHistoryAction(action));
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action.type, 'fabric:batch');
  equal(action.deleted.length, 2);
  deepStrictEqual(undone[2].objects.map((obj) => obj.data.id), ['p1', 'p2', 'p3']);
  deepStrictEqual(redone[2].objects.map((obj) => obj.data.id), ['p3']);
});

test('precise eraser no-op creates no local history action despite serialization churn', () => {
  const previousPage = {
    objects: [
      { type: 'rect', data: { id: 'a' }, left: 1 },
      { type: 'rect', data: { id: 'b' }, left: 2 },
    ],
  };
  const nextPage = {
    objects: [
      { type: 'rect', data: { id: 'b' }, left: 2 },
      { type: 'rect', data: { id: 'a' }, left: 1 },
    ],
  };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: [],
    changedIds: [],
  });

  equal(action, null);
});

test('precise eraser one-delete history excludes untouched serialized changes', () => {
  const previousPage = {
    objects: [
      { type: 'path', data: { id: 'delete-me' }, path: [['M', 0, 0]] },
      { type: 'rect', data: { id: 'untouched-a' }, left: 10 },
      { type: 'rect', data: { id: 'untouched-b' }, left: 20 },
    ],
  };
  const nextPage = {
    objects: [
      { type: 'rect', data: { id: 'untouched-b' }, left: 20, normalized: true },
      { type: 'rect', data: { id: 'untouched-a' }, left: 10, normalized: true },
    ],
  };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['delete-me'],
    changedIds: [],
  });
  const undone = applyAnnotationHistoryAction({ 1: nextPage }, invertAnnotationHistoryAction(action));

  equal(action.type, 'fabric:delete');
  equal(action.annotationId, 'delete-me');
  deepStrictEqual(undone[1].objects.map((obj) => obj.data.id), ['delete-me', 'untouched-b', 'untouched-a']);
});

test('precise eraser multi-delete history records exactly deleted ids', () => {
  const previousPage = {
    objects: [
      { type: 'path', data: { id: 'a' }, path: [['M', 0, 0]] },
      { type: 'path', data: { id: 'b' }, path: [['M', 1, 1]] },
      { type: 'path', data: { id: 'c' }, path: [['M', 2, 2]] },
      { type: 'path', data: { id: 'd' }, path: [['M', 3, 3]] },
    ],
  };
  const nextPage = { objects: [previousPage.objects[2], { ...previousPage.objects[3], normalized: true }] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 2,
    previousPage,
    nextPage,
    deletedIds: ['a', 'b'],
    changedIds: [],
  });
  const undone = applyAnnotationHistoryAction({ 2: nextPage }, invertAnnotationHistoryAction(action));

  equal(action.type, 'fabric:batch');
  deepStrictEqual(action.deleted.map((entry) => entry.id), ['a', 'b']);
  deepStrictEqual(action.updated, []);
  deepStrictEqual(undone[2].objects.map((obj) => obj.data.id), ['a', 'b', 'c', 'd']);
});

test('owner filter keeps local undo scoped to current user annotations', () => {
  const action = {
    type: 'fabric:batch',
    pageNumber: 1,
    created: [
      { id: 'mine-new', annotation: { type: 'rect', data: { id: 'mine-new', authorId: 'user-a' } }, index: 0 },
      { id: 'theirs-new', annotation: { type: 'rect', data: { id: 'theirs-new', authorId: 'user-b' } }, index: 1 },
    ],
    deleted: [
      { id: 'mine-old', annotation: { type: 'circle', data: { id: 'mine-old', authorId: 'user-a' } }, index: 2 },
      { id: 'theirs-old', annotation: { type: 'circle', data: { id: 'theirs-old', authorId: 'user-b' } }, index: 3 },
    ],
    updated: [
      {
        id: 'mine-update',
        before: { type: 'line', data: { id: 'mine-update', authorId: 'user-a' }, left: 1 },
        after: { type: 'line', data: { id: 'mine-update', authorId: 'user-a' }, left: 2 },
      },
      {
        id: 'theirs-update',
        before: { type: 'line', data: { id: 'theirs-update', authorId: 'user-b' }, left: 1 },
        after: { type: 'line', data: { id: 'theirs-update', authorId: 'user-b' }, left: 2 },
      },
    ],
  };

  const scoped = filterAnnotationHistoryActionByOwner(action, 'user-a');

  equal(scoped.type, 'fabric:batch');
  deepStrictEqual(scoped.created.map((entry) => entry.id), ['mine-new']);
  deepStrictEqual(scoped.deleted.map((entry) => entry.id), ['mine-old']);
  deepStrictEqual(scoped.updated.map((entry) => entry.id), ['mine-update']);
});

test('owner filter drops foreign single-annotation undo actions', () => {
  const action = {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: 'theirs',
    annotation: { type: 'rect', data: { id: 'theirs', authorId: 'user-b' } },
  };

  equal(filterAnnotationHistoryActionByOwner(action, 'user-a'), null);
});

test('filtered eraser undo restores only current user deleted annotations', () => {
  const previousPage = {
    objects: [
      { type: 'path', data: { id: 'mine', authorId: 'user-a' }, path: [['M', 0, 0]] },
      { type: 'path', data: { id: 'theirs', authorId: 'user-b' }, path: [['M', 1, 1]] },
      { type: 'rect', data: { id: 'survivor', authorId: 'user-b' }, left: 2 },
    ],
  };
  const nextPage = { objects: [previousPage.objects[2]] };
  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['mine', 'theirs'],
    changedIds: [],
  });

  const inverse = invertAnnotationHistoryAction(action);
  const scopedInverse = filterAnnotationHistoryActionByOwner(inverse, 'user-a');
  const undone = applyAnnotationHistoryAction({ 1: nextPage }, scopedInverse);

  deepStrictEqual(undone[1].objects.map((obj) => obj.data.id), ['mine', 'survivor']);
});
