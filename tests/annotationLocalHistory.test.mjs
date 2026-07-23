import test from 'node:test';
import { deepStrictEqual, equal } from 'node:assert/strict';

import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  buildPreciseAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import {
  getAnnotationStorageKey,
  setAnnotationStorageKey,
} from '../src/utils/annotationStorageIdentity.js';
import { normalizeCanvasJsonForHistory } from '../src/utils/historyNormalization.js';

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

test('precise eraser gives an id-less legacy deletion one deterministic undo/redo identity', () => {
  const legacy = {
    type: 'rect',
    left: 12,
    top: 34,
    width: 40,
    height: 20,
    fill: '#2563eb',
  };
  const previousPage = { objects: [legacy] };
  const nextPage = { objects: [] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['index:0'],
    changedIds: [],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:delete');
  equal(action?.annotationId, 'index:0');
  deepStrictEqual(undone[1].objects, [legacy]);
  deepStrictEqual(redone[1].objects, []);
});

test('precise eraser keeps an id-less mutation when an earlier id-less deletion shifts its index', () => {
  const deleted = {
    type: 'rect',
    left: 10,
    top: 10,
    width: 20,
    height: 20,
  };
  const inkBefore = {
    type: 'path',
    path: [['M', 0, 0], ['L', 40, 0]],
    stroke: '#dc3545',
  };
  const inkAfter = {
    ...inkBefore,
    path: [['M', 20, 0], ['L', 40, 0]],
  };
  const stableAnchor = {
    type: 'textbox',
    data: { id: 'stable-anchor' },
    text: 'unchanged',
  };
  const previousPage = { objects: [deleted, inkBefore, stableAnchor] };
  const nextPage = { objects: [inkAfter, stableAnchor] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['index:0'],
    changedIds: ['index:1'],
  });
  const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action?.deleted?.length, 1);
  equal(action?.updated?.length, 1);
  deepStrictEqual(applied[1].objects, nextPage.objects);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('precise eraser preserves two byte-identical id-less occurrences across mixed delete and update', () => {
  const makeInk = () => ({
    type: 'path',
    path: [['M', 0, 0], ['L', 40, 0]],
    stroke: '#dc3545',
  });
  const first = makeInk();
  const second = makeInk();
  const carved = {
    ...makeInk(),
    path: [['M', 20, 0], ['L', 40, 0]],
  };
  const previousPage = { objects: [first, second] };
  const nextPage = { objects: [carved] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['index:0'],
    changedIds: ['index:1'],
  });
  const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action?.deleted?.length, 1);
  equal(action?.updated?.length, 1);
  deepStrictEqual(applied[1].objects, nextPage.objects);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('precise eraser restores every byte-identical id-less full-delete occurrence', () => {
  const makeRect = () => ({
    type: 'rect',
    left: 10,
    top: 10,
    width: 20,
    height: 20,
    fill: '#2563eb',
  });
  const first = makeRect();
  const second = makeRect();
  const previousPage = { objects: [first, second] };
  const nextPage = { objects: [] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['index:0', 'index:1'],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action?.deleted?.length, 2);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('precise eraser records mixed delete and update for duplicate stable IDs', () => {
  const first = {
    type: 'rect',
    data: { id: 'dup', authorId: 'user-a' },
    left: 10,
    top: 10,
  };
  const second = {
    type: 'rect',
    data: { id: 'dup', authorId: 'user-a' },
    left: 80,
    top: 10,
  };
  const mutatedSurvivor = {
    ...first,
    left: 25,
  };
  const previousPage = { objects: [first, second] };
  const nextPage = { objects: [mutatedSurvivor] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['dup'],
    changedIds: ['dup'],
  });
  const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action?.deleted?.length, 1);
  equal(action?.updated?.length, 1);
  deepStrictEqual(applied[1].objects, nextPage.objects);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('precise eraser updates the correct byte-identical stable-id occurrence', () => {
  const makeDuplicate = (value = 0) => ({
    type: 'rect',
    data: { id: 'dup', authorId: 'user-a' },
    value,
  });
  const previousPage = { objects: [makeDuplicate(), makeDuplicate()] };
  const nextPage = { objects: [makeDuplicate(100), makeDuplicate()] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    changedIds: ['dup'],
  });
  const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:update');
  deepStrictEqual(applied[1].objects, nextPage.objects);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('precise eraser preserves order for three identical id-less occurrences with delete plus update', () => {
  const makeInk = (value = 0) => ({
    type: 'path',
    path: [['M', 0, 0], ['L', 40, 0]],
    stroke: '#dc3545',
    value,
  });
  const previousPage = { objects: [makeInk(), makeInk(), makeInk()] };
  const nextPage = { objects: [makeInk(100), makeInk()] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['index:0'],
    changedIds: ['index:1'],
  });
  const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  deepStrictEqual(applied[1].objects, nextPage.objects);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('precise eraser exact-replay property holds for every id-less delete/update pattern through five duplicates', () => {
  const makeInk = (value = 0) => ({
    type: 'path',
    path: [['M', 0, 0], ['L', 40, 0]],
    stroke: '#dc3545',
    value,
  });
  let checked = 0;

  for (let count = 1; count <= 5; count += 1) {
    const patternCount = 3 ** count;
    for (let encoded = 1; encoded < patternCount; encoded += 1) {
      let pattern = encoded;
      const deletedIds = [];
      const changedIds = [];
      const previousObjects = Array.from({ length: count }, () => makeInk());
      const nextObjects = [];

      for (let index = 0; index < count; index += 1) {
        const operation = pattern % 3;
        pattern = Math.floor(pattern / 3);
        if (operation === 1) {
          deletedIds.push(`index:${index}`);
          continue;
        }
        if (operation === 2) {
          changedIds.push(`index:${index}`);
          nextObjects.push(makeInk(100 + index));
          continue;
        }
        nextObjects.push(makeInk());
      }

      const previousPage = { objects: previousObjects };
      const nextPage = { objects: nextObjects };
      const action = buildPreciseAnnotationHistoryAction({
        pageNumber: 1,
        previousPage,
        nextPage,
        deletedIds,
        changedIds,
      });
      const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
      const undone = applyAnnotationHistoryAction(
        { 1: nextPage },
        invertAnnotationHistoryAction(action),
      );
      const redone = applyAnnotationHistoryAction(undone, action);
      const context = `count=${count} encoded=${encoded}`;

      deepStrictEqual(applied[1].objects, nextPage.objects, `apply ${context}`);
      deepStrictEqual(undone[1].objects, previousPage.objects, `undo ${context}`);
      deepStrictEqual(redone[1].objects, nextPage.objects, `redo ${context}`);
      checked += 1;
    }
  }

  equal(checked, 358);
});

test('keyed precise history exact-replay property covers 2,904 duplicate/id-less cases', () => {
  const valuePatterns = [
    () => 0,
    (index) => index % 2,
    (index) => [0, 1, 0, 2, 0][index],
    (index) => index,
  ];
  let checked = 0;

  for (const idless of [false, true]) {
    for (const valueAt of valuePatterns) {
      for (let count = 1; count <= 5; count += 1) {
        const patternCount = 3 ** count;
        for (let encoded = 0; encoded < patternCount; encoded += 1) {
          let pattern = encoded;
          const deletedIds = [];
          const changedIds = [];
          const deletedStorageKeys = [];
          const changedStorageKeys = [];
          const previousObjects = [];
          const nextObjects = [];

          for (let index = 0; index < count; index += 1) {
            const storageKey = idless
              ? `\u0000idless:1:${index}`
              : (index === 0 ? 'dup' : `\u0000duplicate:dup:1:${index}`);
            const makeObject = (value) => setAnnotationStorageKey({
              type: 'path',
              ...(idless ? {} : { data: { id: 'dup' } }),
              value,
            }, storageKey);
            const before = makeObject(valueAt(index));
            previousObjects.push(before);

            const operation = pattern % 3;
            pattern = Math.floor(pattern / 3);
            if (operation === 1) {
              deletedIds.push(idless ? `index:${index}` : 'dup');
              deletedStorageKeys.push(storageKey);
              continue;
            }
            if (operation === 2) {
              changedIds.push(idless ? `index:${index}` : 'dup');
              changedStorageKeys.push(storageKey);
              nextObjects.push(makeObject(100 + index));
              continue;
            }
            nextObjects.push(makeObject(valueAt(index)));
          }

          const previousPage = { objects: previousObjects };
          const nextPage = { objects: nextObjects };
          const action = buildPreciseAnnotationHistoryAction({
            pageNumber: 1,
            previousPage,
            nextPage,
            deletedIds,
            changedIds,
            deletedStorageKeys,
            changedStorageKeys,
          });
          const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
          const undone = applyAnnotationHistoryAction(
            { 1: nextPage },
            invertAnnotationHistoryAction(action),
          );
          const redone = applyAnnotationHistoryAction(undone, action);
          const context = `idless=${idless} count=${count} encoded=${encoded}`;
          const expectedPreviousKeys = previousObjects.map(getAnnotationStorageKey);
          const expectedNextKeys = nextObjects.map(getAnnotationStorageKey);

          deepStrictEqual(applied[1].objects, nextObjects, `apply JSON ${context}`);
          deepStrictEqual(applied[1].objects.map(getAnnotationStorageKey), expectedNextKeys, `apply keys ${context}`);
          deepStrictEqual(undone[1].objects, previousObjects, `undo JSON ${context}`);
          deepStrictEqual(undone[1].objects.map(getAnnotationStorageKey), expectedPreviousKeys, `undo keys ${context}`);
          deepStrictEqual(redone[1].objects, nextObjects, `redo JSON ${context}`);
          deepStrictEqual(redone[1].objects.map(getAnnotationStorageKey), expectedNextKeys, `redo keys ${context}`);
          checked += 1;
        }
      }
    }
  }

  equal(checked, 2904);
});

for (const idless of [false, true]) {
  test(`${idless ? 'id-less' : 'duplicate-id'} occurrence one uses durable storage identity through concurrent drift and cold reload`, () => {
    const makeObject = (value) => ({
      type: 'path',
      ...(idless ? {} : { data: { id: 'dup', authorId: 'user-a' } }),
      value,
    });
    const firstKey = idless ? '\u0000idless:1:0' : 'dup';
    const secondKey = idless ? '\u0000idless:1:1' : '\u0000duplicate:dup:1:1';
    const beforeFirst = setAnnotationStorageKey(makeObject(0), firstKey);
    const beforeSecond = setAnnotationStorageKey(makeObject(0), secondKey);
    const afterFirst = setAnnotationStorageKey(makeObject(0), firstKey);
    const afterSecond = setAnnotationStorageKey(makeObject(100), secondKey);
    const action = buildPreciseAnnotationHistoryAction({
      pageNumber: 1,
      previousPage: { objects: [beforeFirst, beforeSecond] },
      nextPage: { objects: [afterFirst, afterSecond] },
      changedIds: [idless ? 'index:1' : 'dup'],
      changedStorageKeys: [secondKey],
    });

    equal(action?.storageKey, secondKey);

    const concurrentTarget = setAnnotationStorageKey(makeObject(200), secondKey);
    const concurrentSibling = setAnnotationStorageKey(makeObject(0), firstKey);
    const reorderedConcurrent = { 1: { objects: [concurrentTarget, concurrentSibling] } };
    const undone = applyAnnotationHistoryAction(
      reorderedConcurrent,
      invertAnnotationHistoryAction(JSON.parse(JSON.stringify(action))),
    );
    equal(undone[1].objects[0].value, 0, 'Undo targets occurrence one despite reorder/drift');
    equal(undone[1].objects[1].value, 0, 'sibling occurrence stays untouched');
    equal(getAnnotationStorageKey(undone[1].objects[0]), secondKey);

    const redone = applyAnnotationHistoryAction(
      undone,
      JSON.parse(JSON.stringify(action)),
    );
    equal(redone[1].objects[0].value, 100, 'Redo targets the same durable occurrence');
    equal(redone[1].objects[1].value, 0);
    equal(getAnnotationStorageKey(redone[1].objects[0]), secondKey);

    const missingTarget = {
      1: { objects: [setAnnotationStorageKey(makeObject(0), firstKey)] },
    };
    const safeNoop = applyAnnotationHistoryAction(missingTarget, action);
    deepStrictEqual(safeNoop[1].objects, missingTarget[1].objects);
  });
}

test('storage-key selectors win over ambiguous duplicate IDs for mixed delete and update', () => {
  const firstKey = 'dup';
  const secondKey = '\u0000duplicate:dup:1:1';
  const first = setAnnotationStorageKey(
    { type: 'rect', data: { id: 'dup' }, value: 0 },
    firstKey,
  );
  const second = setAnnotationStorageKey(
    { type: 'rect', data: { id: 'dup' }, value: 1 },
    secondKey,
  );
  const mutatedSecond = setAnnotationStorageKey(
    { type: 'rect', data: { id: 'dup' }, value: 100 },
    secondKey,
  );
  const previousPage = { objects: [first, second] };
  const nextPage = { objects: [mutatedSecond] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['dup'],
    changedIds: ['dup'],
    deletedStorageKeys: [firstKey],
    changedStorageKeys: [secondKey],
  });
  const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action.deleted[0].storageKey, firstKey);
  equal(action.updated[0].storageKey, secondKey);
  deepStrictEqual(applied[1].objects, nextPage.objects);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
});

test('duplicate-id deletion preserves order for 0,1,0 → 1,0 with keyed and legacy selectors', () => {
  const makeObject = (value, storageKey = null) => setAnnotationStorageKey({
    type: 'rect',
    data: { id: 'dup' },
    value,
  }, storageKey);

  for (const keyed of [false, true]) {
    const firstKey = '\u0000duplicate:dup:1:0';
    const previousPage = {
      objects: [
        makeObject(0, keyed ? firstKey : null),
        makeObject(1, keyed ? '\u0000duplicate:dup:1:1' : null),
        makeObject(0, keyed ? '\u0000duplicate:dup:1:2' : null),
      ],
    };
    const nextPage = {
      objects: [
        makeObject(1, keyed ? '\u0000duplicate:dup:1:1' : null),
        makeObject(0, keyed ? '\u0000duplicate:dup:1:2' : null),
      ],
    };
    const action = buildPreciseAnnotationHistoryAction({
      pageNumber: 1,
      previousPage,
      nextPage,
      deletedIds: ['dup'],
      ...(keyed ? { deletedStorageKeys: [firstKey] } : {}),
    });
    const applied = applyAnnotationHistoryAction({ 1: previousPage }, action);
    const undone = applyAnnotationHistoryAction(
      { 1: nextPage },
      invertAnnotationHistoryAction(action),
    );
    const redone = applyAnnotationHistoryAction(undone, action);

    deepStrictEqual(applied[1].objects, nextPage.objects, `apply keyed=${keyed}`);
    deepStrictEqual(undone[1].objects, previousPage.objects, `undo keyed=${keyed}`);
    deepStrictEqual(redone[1].objects, nextPage.objects, `redo keyed=${keyed}`);
  }
});

test('history normalization preserves storage identity through duplicate reorder', () => {
  const first = setAnnotationStorageKey(
    { type: 'path', data: { id: 'dup' }, value: 0, dirty: true },
    'dup',
  );
  const second = setAnnotationStorageKey(
    { type: 'path', data: { id: 'dup' }, value: 1, dirty: true },
    '\u0000duplicate:dup:1:1',
  );
  const normalized = normalizeCanvasJsonForHistory({
    1: { objects: [second, first] },
  });

  deepStrictEqual(
    normalized[1].objects.map(getAnnotationStorageKey),
    ['\u0000duplicate:dup:1:1', 'dup'],
  );
  deepStrictEqual(
    normalized[1].objects.map((object) => object.value),
    [1, 0],
  );
  equal(normalized[1].objects[0].dirty, undefined);
});

test('precise eraser preserves every duplicate stable-id occurrence through one undo/redo action', () => {
  const first = {
    type: 'rect',
    data: { id: 'duplicate-id', authorId: 'user-a' },
    left: 10,
    top: 10,
  };
  const second = {
    type: 'circle',
    data: { id: 'duplicate-id', authorId: 'user-a' },
    left: 80,
    top: 80,
  };
  const previousPage = { objects: [first, second] };
  const nextPage = { objects: [] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['duplicate-id'],
    changedIds: [],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action?.deleted?.length, 2);
  deepStrictEqual(undone[1].objects, [first, second]);
  deepStrictEqual(redone[1].objects, []);
});

test('mixed carve plus atomic callout and marker deletes stay one undo/redo action', () => {
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
  const shape = {
    type: 'rect',
    data: { id: 'shape-1', authorId: 'user-a' },
    left: 50,
    top: 50,
  };
  const text = {
    type: 'textbox',
    data: { id: 'text-1', authorId: 'user-a' },
    text: 'Delete atomically',
  };
  const callout = {
    type: 'group',
    data: { id: 'callout-1', type: 'callout', authorId: 'user-a' },
    objects: [],
  };
  const marker = {
    type: 'rect',
    annotationId: 'marker-1',
    data: { authorId: 'user-a' },
  };
  const previousPage = {
    objects: [penBefore, highlighterBefore, shape, text, callout, marker],
  };
  const nextPage = { objects: [penAfter, highlighterAfter] };

  const action = buildPreciseAnnotationHistoryAction({
    pageNumber: 1,
    previousPage,
    nextPage,
    deletedIds: ['shape-1', 'text-1', 'callout-1', 'marker-1'],
    changedIds: ['pen-1', 'highlight-1'],
  });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );
  const redone = applyAnnotationHistoryAction(undone, action);

  equal(action?.type, 'fabric:batch');
  equal(action?.deleted?.length, 4);
  equal(action?.updated?.length, 2);
  deepStrictEqual(undone[1].objects, previousPage.objects);
  deepStrictEqual(redone[1].objects, nextPage.objects);
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
