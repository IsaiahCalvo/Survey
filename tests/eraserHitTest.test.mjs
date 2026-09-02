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

// --- 2026-07-19 eraser-audit regression: filled-outline ink edge grazes -----
// Production pen/highlighter ink is stored as a FILLED outline path (fill set,
// strokeWidth 0). The live touch test must register the eraser circle's rim
// contacting the outline's edge — not only the center entering the fill —
// or live preview and commit disagree (nothing shows while dragging, ink
// changes at release).

function filledOutlineInk(id) {
  return {
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['L', 100, 0], ['L', 100, 10], ['L', 0, 10], ['Z']],
    fill: '#111111',
    stroke: 'transparent',
    strokeWidth: 0,
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    pathOffset: { x: 0, y: 0 },
    width: 100,
    height: 10,
    id,
  };
}

test('filled ink: rim graze with center OUTSIDE the fill still counts as touching', () => {
  const touched = eraserStrokeTouchesObject({
    eraserPoints: [{ x: 50, y: 15 }], // 5 units below the band's bottom edge
    eraserRadius: 10,
    object: filledOutlineInk('ink-rim'),
  });
  assert.equal(touched, true);
});

test('filled ink: center inside the fill counts as touching', () => {
  const touched = eraserStrokeTouchesObject({
    eraserPoints: [{ x: 50, y: 5 }],
    eraserRadius: 2,
    object: filledOutlineInk('ink-inside'),
  });
  assert.equal(touched, true);
});

test('filled ink: circle fully clear of the outline does not touch', () => {
  const touched = eraserStrokeTouchesObject({
    eraserPoints: [{ x: 50, y: 40 }], // 30 units away, radius 10
    eraserRadius: 10,
    object: filledOutlineInk('ink-clear'),
  });
  assert.equal(touched, false);
});

const touches = (object, points, eraserRadius = 2) => eraserStrokeTouchesObject({
  object,
  eraserPoints: points,
  eraserRadius,
});

const hollowEllipse = {
  type: 'ellipse',
  left: 20,
  top: 20,
  rx: 40,
  ry: 25,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 4,
};

test('hollow ellipse interior stroke does not hit', () => {
  assert.equal(touches(hollowEllipse, [{ x: 45, y: 45 }, { x: 75, y: 45 }]), false);
});

test('ellipse edge stroke hits', () => {
  assert.equal(touches(hollowEllipse, [{ x: 60, y: 17 }, { x: 60, y: 23 }]), true);
});

test('filled ellipse interior stroke hits', () => {
  assert.equal(touches({ ...hollowEllipse, fill: '#ffee00' }, [{ x: 50, y: 45 }]), true);
});

test('textbox only hits rendered text line boxes, not outer padding', () => {
  const textbox = {
    type: 'textbox',
    left: 10,
    top: 20,
    width: 100,
    height: 40,
    text: 'Hello',
    fontSize: 12,
    lineHeight: 1.16,
    textAlign: 'left',
    verticalAlign: 'top',
    fill: '#111111',
  };

  assert.equal(touches(textbox, [{ x: 12, y: 28 }]), false, 'inside box padding, beside text');
  assert.equal(touches(textbox, [{ x: 20, y: 28 }]), true, 'through the text line');
});

test('callout text ignores wrapped lines clipped by the renderer', () => {
  const calloutText = {
    type: 'textbox',
    left: 10,
    top: 20,
    width: 80,
    height: 60,
    text: 'First line\nSecond line\nClipped line',
    fontSize: 12,
    lineHeight: 1,
    maxLines: 2,
    calloutText: true,
  };

  assert.equal(touches(calloutText, [{ x: 20, y: 70 }]), false);
});

test('rect corner brush hits the outline', () => {
  const object = {
    type: 'rect',
    left: 20,
    top: 20,
    width: 50,
    height: 30,
    fill: 'none',
    stroke: '#111111',
    strokeWidth: 4,
  };
  assert.equal(touches(object, [{ x: 17.5, y: 17.5 }]), true);
});

test('line stroke parallel 10px away does not hit', () => {
  const object = {
    type: 'line',
    left: 20,
    top: 20,
    width: 80,
    height: 0,
    x1: -40,
    y1: 0,
    x2: 40,
    y2: 0,
    stroke: '#111111',
    strokeWidth: 4,
  };
  assert.equal(touches(object, [{ x: 30, y: 30 }, { x: 90, y: 30 }]), false);
});
