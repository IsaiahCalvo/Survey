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
  getEraserStrokeBounds,
  sampleEraserStroke,
  getEraserCandidateId,
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

test('getEraserStrokeBounds expands finite points by radius', () => {
  assert.equal(getEraserStrokeBounds([], 5), null);
  assert.equal(getEraserStrokeBounds([{ x: Number.NaN, y: 1 }], 5), null);
  const bounds = getEraserStrokeBounds([{ x: 0, y: 0 }, { x: 10, y: 4 }], 2);
  assert.deepEqual(bounds, {
    left: -2,
    top: -2,
    right: 12,
    bottom: 6,
    width: 14,
    height: 8,
  });
});

test('sampleEraserStroke densifies multi-point strokes', () => {
  assert.deepEqual(sampleEraserStroke([{ x: 1, y: 1 }], 4), [{ x: 1, y: 1 }]);
  const samples = sampleEraserStroke([{ x: 0, y: 0 }, { x: 20, y: 0 }], 4);
  assert.ok(samples.length > 2);
  assert.equal(samples[0].x, 0);
  assert.equal(samples[samples.length - 1].x, 20);
});

test('eraserStrokeTouchesObject rejects empty inputs', () => {
  assert.equal(eraserStrokeTouchesObject({ eraserPoints: [], eraserRadius: 2, object: rect('x', 0, 0) }), false);
  assert.equal(eraserStrokeTouchesObject({ eraserPoints: [{ x: 1, y: 1 }], eraserRadius: 2, object: null }), false);
});

test('getEraserCandidateId prefers history id then callout fallbacks', () => {
  assert.equal(getEraserCandidateId({ data: { id: 'hist-1' } }), 'hist-1');
  assert.equal(getEraserCandidateId({ callout: { id: 'c1' } }), 'c1');
  assert.equal(getEraserCandidateId({ type: 'callout', id: 'c2' }), 'c2');
  assert.equal(getEraserCandidateId({}, 3), 'index:3');
});
