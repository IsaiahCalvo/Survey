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

test('local fabric redo replays a step on another author\'s mark (open editing)', () => {
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

  // RULED 2026-09-28 owner: open editing + lock — a user's step on anyone's mark is their own Redo step.
  deepStrictEqual(scoped, foreignRedo);
  deepStrictEqual(afterRedo[1].objects.map((obj) => obj.data.id), ['mine', 'theirs']);
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

test('precise canonical-id selectors win over stale annotation-id lists for mixed delete and update', () => {
  const firstBefore = {
    type: 'rect',
    data: { id: 'dup-a', legacyDuplicateId: 'dup' },
    left: 10,
  };
  const secondBefore = {
    type: 'rect',
    data: { id: 'dup-b', legacyDuplicateId: 'dup' },
    left: 30,
  };
  const firstAfter = { ...firstBefore, left: 11 };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: { objects: [firstBefore, secondBefore] },
    nextPage: { objects: [firstAfter] },
    deletedIds: ['dup-a'],
    changedIds: ['dup-b'],
    deletedStorageKeys: ['dup-b'],
    changedStorageKeys: ['dup-a'],
  });

  equal(action.type, 'fabric:batch');
  deepStrictEqual(action.deleted.map((entry) => entry.storageKey), ['dup-b']);
  deepStrictEqual(action.updated.map((entry) => entry.storageKey), ['dup-a']);

  const undone = applyAnnotationHistoryAction(
    { 1: { objects: [firstAfter] } },
    invertAnnotationHistoryAction(action),
  );
  deepStrictEqual(undone[1].objects.map((object) => object.left), [10, 30]);
  deepStrictEqual(undone[1].objects.map((object) => object.data.id), ['dup-a', 'dup-b']);

  const redone = applyAnnotationHistoryAction(undone, action);
  deepStrictEqual(redone[1].objects.map((object) => object.left), [11]);
  deepStrictEqual(redone[1].objects.map((object) => object.data.id), ['dup-a']);
});

test('precise history merges keyed and id-only selectors in one exact batch', () => {
  const untouched = { type: 'rect', data: { id: 'untouched' }, left: 0 };
  const deleteKeyed = { type: 'rect', data: { id: 'delete-keyed' }, left: 10 };
  const deleteIdOnly = { type: 'rect', data: { id: 'delete-id-only' }, left: 20 };
  const updateKeyedBefore = { type: 'path', data: { id: 'update-keyed' }, value: 1 };
  const updateIdOnlyBefore = { type: 'path', data: { id: 'update-id-only' }, value: 2 };
  const updateKeyedAfter = { ...updateKeyedBefore, value: 11 };
  const updateIdOnlyAfter = { ...updateIdOnlyBefore, value: 12 };
  const previousPage = {
    objects: [
      untouched,
      deleteKeyed,
      deleteIdOnly,
      updateKeyedBefore,
      updateIdOnlyBefore,
    ],
  };
  const nextPage = {
    objects: [untouched, updateKeyedAfter, updateIdOnlyAfter],
  };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['delete-keyed', 'delete-id-only'],
    deletedStorageKeys: ['delete-keyed'],
    changedIds: ['update-keyed', 'update-id-only'],
    changedStorageKeys: ['update-keyed'],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  deepStrictEqual(
    action.deleted.map((entry) => entry.storageKey),
    ['delete-keyed', 'delete-id-only'],
  );
  deepStrictEqual(
    action.updated.map((entry) => entry.storageKey),
    ['update-keyed', 'update-id-only'],
  );
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('mixed selector inverse restores exact z-order when the id-only deletion precedes the keyed deletion', () => {
  const idOnlyA = { type: 'path', data: { id: 'A' }, value: 'id-only selector' };
  const keyedB = { type: 'path', data: { id: 'B' }, value: 'keyed selector' };
  const untouchedC = { type: 'rect', data: { id: 'C' } };
  const untouchedD = { type: 'rect', data: { id: 'D' } };
  const previousPage = {
    objects: [idOnlyA, keyedB, untouchedC, untouchedD],
  };
  const nextPage = {
    objects: [untouchedC, untouchedD],
  };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['A', 'B'],
    deletedStorageKeys: ['B'],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action.type, 'fabric:batch');
  deepStrictEqual(action.deleted.map((entry) => entry.storageKey), ['A', 'B']);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('uniquely promoted duplicate reorder/delete [0,1,0] to [1,0] replays exactly', () => {
  const previous = [0, 1, 0].map((left, occurrence) => {
    const id = `dup-${occurrence}`;
    const object = {
      type: 'rect',
      data: { id, legacyDuplicateId: 'dup' },
      left,
    };
    return object;
  });
  const next = [previous[1], previous[2]];
  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: { objects: previous },
    nextPage: { objects: next },
    deletedIds: ['dup-0'],
    deletedStorageKeys: ['dup-0'],
  });

  equal(action.type, 'fabric:delete');
  equal(action.storageKey, 'dup-0');
  const undone = applyAnnotationHistoryAction(
    { 1: { objects: next } },
    invertAnnotationHistoryAction(action),
  );
  deepStrictEqual(undone[1].objects.map((object) => object.left), [0, 1, 0]);
  const redone = applyAnnotationHistoryAction(undone, action);
  deepStrictEqual(redone[1].objects.map((object) => object.left), [1, 0]);
  deepStrictEqual(redone[1].objects.map((object) => object.data.id), ['dup-1', 'dup-2']);
});

test('canonical promoted-id history is exact across 2,904 bounded mutation cases', () => {
  const valuePatterns = [
    (index) => index,
    () => 0,
    (index) => index % 2,
    (index) => [0, 1, 0, 2, 0][index],
  ];
  const snapshot = (objects) => objects.map((object) => JSON.stringify(object));
  let cases = 0;

  for (const idless of [false, true]) {
    for (let size = 1; size <= 5; size += 1) {
      for (const valueAt of valuePatterns) {
        const previous = Array.from({ length: size }, (_unused, occurrence) => {
          const storageKey = `${idless ? 'promoted-idless' : 'promoted-duplicate'}-${occurrence}`;
          const object = {
            type: 'rect',
            data: {
              id: storageKey,
              ...(idless ? {} : { legacyDuplicateId: 'dup' }),
            },
            left: valueAt(occurrence),
          };
          return object;
        });

        for (let assignment = 0; assignment < 3 ** size; assignment += 1) {
          let digits = assignment;
          const deletedStorageKeys = [];
          const changedStorageKeys = [];
          const next = [];
          for (let index = 0; index < size; index += 1) {
            const operation = digits % 3;
            digits = Math.floor(digits / 3);
            const storageKey = previous[index].data.id;
            if (operation === 1) {
              deletedStorageKeys.push(storageKey);
              continue;
            }
            if (operation === 2) {
              const modified = { ...previous[index], left: previous[index].left + 1000 };
              changedStorageKeys.push(storageKey);
              next.push(modified);
              continue;
            }
            next.push(previous[index]);
          }

          const action = buildPreciseAnnotationHistoryAction({
            pageNumber: 1,
            previousPage: { objects: previous },
            nextPage: { objects: next },
            deletedIds: deletedStorageKeys,
            changedIds: changedStorageKeys,
            deletedStorageKeys,
            changedStorageKeys,
          });
          const forward = action
            ? applyAnnotationHistoryAction({ 1: { objects: previous } }, action)
            : { 1: { objects: previous } };
          deepStrictEqual(snapshot(forward[1].objects), snapshot(next));

          const undone = action
            ? applyAnnotationHistoryAction(forward, invertAnnotationHistoryAction(action))
            : forward;
          deepStrictEqual(snapshot(undone[1].objects), snapshot(previous));

          const redone = action
            ? applyAnnotationHistoryAction(undone, action)
            : undone;
          deepStrictEqual(snapshot(redone[1].objects), snapshot(next));
          cases += 1;
        }
      }
    }
  }

  equal(cases, 2904);
});

test('history diff reads frozen canonical snapshots without mutating inputs', () => {
  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  };
  const previousPage = deepFreeze({
    objects: [
      { type: 'path', data: { id: 'frozen-ink' }, path: [['M', 0, 0], ['L', 20, 0]] },
      { type: 'rect', data: { id: 'frozen-shape' }, left: 30 },
    ],
  });
  const nextPage = deepFreeze({
    objects: [
      {
        type: 'path',
        data: { id: 'frozen-ink' },
        path: [['M', 0, 0], ['L', 10, 0]],
        paperEraserGeometry: 'v1',
      },
    ],
  });
  const previousJson = JSON.stringify(previousPage);
  const nextJson = JSON.stringify(nextPage);

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedStorageKeys: ['frozen-shape'],
    changedStorageKeys: ['frozen-ink'],
  });

  equal(action?.type, 'fabric:batch');
  equal(JSON.stringify(previousPage), previousJson);
  equal(JSON.stringify(nextPage), nextJson);
});

test('deep-cloned canonical ids target the same object after z-order reorder', () => {
  const untouched = { type: 'path', data: { id: 'ink-a' }, path: [['M', 0, 0]] };
  const beforeTarget = { type: 'path', data: { id: 'ink-b' }, path: [['M', 1, 1]] };
  const afterTarget = { ...beforeTarget, path: [['M', 2, 2]] };
  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: { objects: [untouched, beforeTarget] },
    nextPage: { objects: [untouched, afterTarget] },
    changedIds: ['ink-b'],
    changedStorageKeys: ['ink-b'],
  });
  const reorderedAfter = JSON.parse(JSON.stringify({
    1: { objects: [afterTarget, untouched] },
  }));
  const undone = applyAnnotationHistoryAction(
    reorderedAfter,
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(
    JSON.parse(JSON.stringify(undone)),
    action,
  );

  deepStrictEqual(undone[1].objects, [beforeTarget, untouched]);
  deepStrictEqual(redone[1].objects, [afterTarget, untouched]);
});

test('malformed duplicate canonical ids fail safe instead of choosing an occurrence', () => {
  const first = { type: 'rect', data: { id: 'dup' }, left: 10 };
  const second = { type: 'rect', data: { id: 'dup' }, left: 30 };
  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: { objects: [first, second] },
    nextPage: { objects: [{ ...first, left: 11 }, second] },
    changedIds: ['dup'],
  });

  equal(action, null);
});

test('mixed pen/highlighter carve plus atomic annotations stay one exact Undo/Redo action', () => {
  const penBefore = {
    type: 'path',
    tool: 'pen',
    data: { id: 'pen-1', authorId: 'user-a' },
    path: [['M', 0, 0], ['L', 40, 0]],
  };
  const penAfter = {
    ...penBefore,
    paperEraserGeometry: 'v1',
    polygons: [[[[0, 0], [15, 0], [15, 4], [0, 4], [0, 0]]]],
  };
  const highlighterBefore = {
    type: 'path',
    tool: 'highlighter',
    data: { id: 'highlight-1', authorId: 'user-a' },
    path: [['M', 0, 20], ['L', 40, 20]],
  };
  const highlighterAfter = {
    ...highlighterBefore,
    paperEraserGeometry: 'v1',
    polygons: [[[[25, 18], [40, 18], [40, 22], [25, 22], [25, 18]]]],
  };
  const atomics = [
    { type: 'rect', data: { id: 'shape-1', authorId: 'user-a' }, left: 50, top: 50 },
    { type: 'textbox', data: { id: 'text-1', authorId: 'user-a' }, text: 'Delete atomically' },
    { type: 'group', data: { id: 'callout-1', type: 'callout', authorId: 'user-a' }, objects: [] },
    { type: 'rect', annotationId: 'marker-1', data: { id: 'marker-1', authorId: 'user-a' } },
    {
      type: 'path',
      isPdfImported: true,
      pdfAnnotationType: 'Underline',
      data: { id: 'markup-1', authorId: 'user-a' },
      path: [['M', 0, 30], ['L', 40, 30]],
    },
  ];
  const previousPage = {
    objects: [penBefore, highlighterBefore, ...atomics],
  };
  const nextPage = { objects: [penAfter, highlighterAfter] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: atomics.map((object) => object.data.id),
    changedIds: ['pen-1', 'highlight-1'],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action?.deleted?.length, atomics.length);
  equal(action?.updated?.length, 2);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('owner filter keeps every entry of a mixed-author local undo batch (open editing)', () => {
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
  // RULED 2026-09-28 owner: open editing + lock — foreign entries are no longer trimmed from the user's own step.
  deepStrictEqual(scoped.created.map((entry) => entry.id), ['mine-new', 'theirs-new']);
  deepStrictEqual(scoped.deleted.map((entry) => entry.id), ['mine-old', 'theirs-old']);
  deepStrictEqual(scoped.updated.map((entry) => entry.id), ['mine-update', 'theirs-update']);
});

test('owner filter keeps foreign single-annotation undo actions for a known viewer', () => {
  const action = {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: 'theirs',
    annotation: { type: 'rect', data: { id: 'theirs', authorId: 'user-b' } },
  };

  // RULED 2026-09-28 owner: open editing + lock — deleting a colleague's mark is the user's own undoable step.
  equal(filterAnnotationHistoryActionByOwner(action, 'user-a'), action);
});

test('history replay fails closed while viewer identity is unresolved', () => {
  const action = {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: 'boot-window-mark',
    storageKey: 'boot-window-mark',
    annotation: {
      type: 'path',
      data: { id: 'boot-window-mark', authorId: 'eventual-user' },
    },
  };

  equal(filterAnnotationHistoryActionByOwner(action, null, 'document-owner'), null);
  equal(filterAnnotationHistoryActionByOwner(action, '', 'document-owner'), null);
  equal(
    filterAnnotationHistoryActionByOwner(
      invertAnnotationHistoryAction(action),
      undefined,
      'document-owner',
    ),
    null,
  );
});

test('contributor history keeps missing-author single actions for both Undo and Redo', () => {
  const legacyAnnotation = {
    type: 'path',
    data: { id: 'legacy-missing-author' },
    path: [['M', 0, 0], ['L', 10, 0]],
  };
  const redoDelete = {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: 'legacy-missing-author',
    storageKey: 'legacy-missing-author',
    annotation: legacyAnnotation,
    index: 0,
  };
  const undoCreate = invertAnnotationHistoryAction(redoDelete);

  // RULED 2026-09-28 owner: open editing + lock — unattributed marks are editable by any editor, so their steps stay on the stack.
  equal(
    filterAnnotationHistoryActionByOwner(
      redoDelete,
      'cloud-contributor',
      'document-owner',
    ),
    redoDelete,
  );
  equal(
    filterAnnotationHistoryActionByOwner(
      undoCreate,
      'cloud-contributor',
      'document-owner',
    ),
    undoCreate,
  );
});

test('contributor batch Undo/Redo keeps self-authored and missing-author entries together', () => {
  const own = {
    type: 'path',
    data: { id: 'own-ink', authorId: 'cloud-contributor' },
    path: [['M', 0, 0], ['L', 10, 0]],
  };
  const legacy = {
    type: 'path',
    data: { id: 'legacy-ink' },
    path: [['M', 0, 5], ['L', 10, 5]],
  };
  const redoDelete = {
    type: 'fabric:batch',
    pageNumber: 1,
    created: [],
    deleted: [
      {
        id: 'own-ink',
        annotationId: 'own-ink',
        storageKey: 'own-ink',
        annotation: own,
        index: 0,
      },
      {
        id: 'legacy-ink',
        annotationId: 'legacy-ink',
        storageKey: 'legacy-ink',
        annotation: legacy,
        index: 1,
      },
    ],
    updated: [],
  };
  const undoCreate = invertAnnotationHistoryAction(redoDelete);
  const scopedRedo = filterAnnotationHistoryActionByOwner(
    redoDelete,
    'cloud-contributor',
    'document-owner',
  );
  const scopedUndo = filterAnnotationHistoryActionByOwner(
    undoCreate,
    'cloud-contributor',
    'document-owner',
  );

  // RULED 2026-09-28 owner: open editing + lock — the whole batch replays; missing-author entries are no longer dropped.
  deepStrictEqual(scopedRedo.deleted.map((entry) => entry.id), ['own-ink', 'legacy-ink']);
  deepStrictEqual(scopedUndo.created.map((entry) => entry.id), ['own-ink', 'legacy-ink']);
  const afterRedo = applyAnnotationHistoryAction(
    { 1: { objects: [own, legacy] } },
    scopedRedo,
  );
  const afterUndo = applyAnnotationHistoryAction(afterRedo, scopedUndo);
  deepStrictEqual(afterRedo[1].objects.map((object) => object.data.id), []);
  deepStrictEqual(
    afterUndo[1].objects.map((object) => object.data.id),
    ['own-ink', 'legacy-ink'],
  );
});

test('document owner keeps one exact cross-author erase action for Undo and Redo', () => {
  const previousPage = {
    objects: [
      { type: 'path', data: { id: 'foreign-ink', authorId: 'user-b' }, value: 1 },
      { type: 'rect', data: { id: 'foreign-shape', authorId: 'user-c' }, value: 2 },
    ],
  };
  const nextPage = { objects: [] };
  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['foreign-ink', 'foreign-shape'],
  });
  const inverse = invertAnnotationHistoryAction(action);
  const ownerScopedInverse = filterAnnotationHistoryActionByOwner(
    inverse,
    'document-owner',
    'document-owner',
  );
  const undone = applyAnnotationHistoryAction({ 1: nextPage }, ownerScopedInverse);
  const ownerScopedRedo = filterAnnotationHistoryActionByOwner(
    action,
    'document-owner',
    'document-owner',
  );
  const redone = applyAnnotationHistoryAction(undone, ownerScopedRedo);

  deepStrictEqual(ownerScopedInverse, inverse);
  deepStrictEqual(ownerScopedRedo, action);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('filtered eraser undo restores every annotation the user erased, including other authors\' marks', () => {
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

  // RULED 2026-09-28 owner: open editing + lock — the user may erase anyone's mark, so one Undo brings all of it back.
  deepStrictEqual(undone[1].objects.map((obj) => obj.data.id), ['mine', 'theirs', 'survivor']);
});
