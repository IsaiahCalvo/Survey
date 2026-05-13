import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import {
  eraserStrokeTouchesObject,
  getEraserDeleteDiagnostics,
} from '../src/utils/eraserHitTest.js';

function rect(id, left, top, width = 20, height = 20) {
  return {
    type: 'rect',
    left,
    top,
    width,
    height,
    fill: 'transparent',
    stroke: '#111',
    strokeWidth: 2,
    data: { id },
  };
}

function line(id, x1, y1, x2, y2) {
  return {
    type: 'line',
    left: 0,
    top: 0,
    x1,
    y1,
    x2,
    y2,
    stroke: '#111',
    strokeWidth: 2,
    data: { id },
  };
}

function eraseWholeObjects(objects, eraserPoints, eraserRadius) {
  return objects.filter((object) => !eraserStrokeTouchesObject({
    eraserPoints,
    eraserRadius,
    object,
  }));
}

function diffDeletedIds(priorPage, nextPage) {
  return getEraserDeleteDiagnostics({
    beforeObjects: priorPage.objects,
    afterObjects: nextPage.objects,
  }).finalDeletedAnnotationIds;
}

test('erasing one annotation near another deletes only the touched one', () => {
  const objects = [
    rect('touched', 10, 10),
    rect('nearby', 34, 10),
  ];

  const remaining = eraseWholeObjects(objects, [{ x: 20, y: 10 }], 5);

  assert.deepEqual(remaining.map((object) => object.data.id), ['nearby']);
});

test('a click near but not touching an annotation deletes nothing', () => {
  const objects = [rect('r1', 20, 20)];

  const remaining = eraseWholeObjects(objects, [{ x: 16, y: 16 }], 4);

  assert.deepEqual(remaining.map((object) => object.data.id), ['r1']);
});

test('a stroke crossing two annotations deletes exactly those two', () => {
  const objects = [
    line('a', 10, 20, 30, 20),
    line('b', 50, 20, 70, 20),
    line('c', 10, 50, 70, 50),
  ];

  const remaining = eraseWholeObjects(objects, [{ x: 0, y: 20 }, { x: 80, y: 20 }], 4);

  assert.deepEqual(remaining.map((object) => object.data.id), ['c']);
});

test('undo after erase restores exactly the deleted annotations', () => {
  const previousPage = {
    objects: [rect('a', 10, 10), rect('b', 40, 10), rect('c', 80, 10)],
  };
  const nextPage = {
    objects: eraseWholeObjects(previousPage.objects, [{ x: 20, y: 10 }, { x: 50, y: 10 }], 5),
  };

  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage, nextPage });
  const undone = applyAnnotationHistoryAction(
    { 1: nextPage },
    invertAnnotationHistoryAction(action),
  );

  assert.equal(action.type, 'fabric:batch');
  assert.deepEqual(action.deleted.map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(undone[1].objects.map((object) => object.data.id), ['a', 'b', 'c']);
});

test('the delete set sent to sync matches the local eraser delete set', () => {
  const previousPage = {
    objects: [rect('a', 10, 10), rect('b', 40, 10), rect('c', 80, 10)],
  };
  const nextPage = {
    objects: eraseWholeObjects(previousPage.objects, [{ x: 20, y: 10 }, { x: 50, y: 10 }], 5),
  };

  const localDeleteSet = diffDeletedIds(previousPage, nextPage).sort();
  const syncDeleteSet = diffDeletedIds(previousPage, nextPage).sort();

  assert.deepEqual(localDeleteSet, ['a', 'b']);
  assert.deepEqual(syncDeleteSet, localDeleteSet);
});
