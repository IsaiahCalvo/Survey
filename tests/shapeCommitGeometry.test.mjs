import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRAWN_CENTERED_STROKE_CONTRACT,
  computeDrawnBoundaryShapePreviewGeometry,
  normalizeDrawnBoundaryShapeCommitGeometry,
  tagDrawnCenteredStrokeGeometry,
} from '../src/utils/shapeCommitGeometry.js';

function svgRectVisibleOuterBounds(obj) {
  return {
    left: obj.left,
    top: obj.top,
    width: obj.width,
    height: obj.height,
  };
}

function svgEllipseVisibleOuterBounds(obj) {
  return {
    left: obj.left,
    top: obj.top,
    width: obj.rx * 2,
    height: obj.ry * 2,
  };
}

test('drawn rectangle commit stores the exact drag outer bounds from an inset Fabric preview', () => {
  const normalized = normalizeDrawnBoundaryShapeCommitGeometry({
    type: 'rect',
    left: 22,
    top: 32,
    width: 96,
    height: 56,
    strokeWidth: 4,
    fill: 'transparent',
  }, {
    left: 20,
    top: 30,
    width: 100,
    height: 60,
  });

  assert.equal(normalized.left, 20);
  assert.equal(normalized.top, 30);
  assert.equal(normalized.width, 100);
  assert.equal(normalized.height, 60);
  assert.deepEqual(svgRectVisibleOuterBounds(normalized), {
    left: 20,
    top: 30,
    width: 100,
    height: 60,
  });
});

test('drawn ellipse commit stores the exact drag outer bounds from an inset Fabric preview', () => {
  const normalized = normalizeDrawnBoundaryShapeCommitGeometry({
    type: 'ellipse',
    left: 22,
    top: 32,
    rx: 48,
    ry: 28,
    strokeWidth: 4,
    fill: 'transparent',
  }, {
    left: 20,
    top: 30,
    width: 100,
    height: 60,
  });

  assert.equal(normalized.left, 20);
  assert.equal(normalized.top, 30);
  assert.equal(normalized.rx, 50);
  assert.equal(normalized.ry, 30);
  assert.deepEqual(svgEllipseVisibleOuterBounds(normalized), {
    left: 20,
    top: 30,
    width: 100,
    height: 60,
  });
});

test('survey highlight rectangles are not expanded', () => {
  const highlight = {
    type: 'rect',
    left: 20,
    top: 30,
    width: 100,
    height: 60,
    strokeWidth: 0,
    globalCompositeOperation: 'multiply',
  };

  assert.equal(normalizeDrawnBoundaryShapeCommitGeometry(highlight), highlight);
});

test('drawn centered-stroke geometry keeps the Fabric preview geometry and marks SVG render contract', () => {
  const previewJSON = {
    type: 'rect',
    left: 22,
    top: 32,
    width: 96,
    height: 56,
    strokeWidth: 4,
    fill: 'transparent',
    data: { id: 'rect-1' },
  };

  const tagged = tagDrawnCenteredStrokeGeometry(previewJSON);

  assert.notEqual(tagged, previewJSON);
  assert.equal(tagged.left, 22);
  assert.equal(tagged.top, 32);
  assert.equal(tagged.width, 96);
  assert.equal(tagged.height, 56);
  assert.equal(tagged.data.id, 'rect-1');
  assert.equal(tagged.data.strokeRenderContract, DRAWN_CENTERED_STROKE_CONTRACT);
});

test('mouseup can recompute rect preview from the final release pointer', () => {
  const geometry = computeDrawnBoundaryShapePreviewGeometry({
    tool: 'rect',
    startX: 10,
    startY: 20,
    pointerX: 114,
    pointerY: 88,
    strokeWidth: 4,
  });

  assert.deepEqual(geometry.outerBounds, {
    left: 10,
    top: 20,
    width: 104,
    height: 68,
  });
  assert.deepEqual(geometry.fabricProps, {
    left: 12,
    top: 22,
    width: 100,
    height: 64,
  });
});

test('mouseup can recompute ellipse preview from the final release pointer', () => {
  const geometry = computeDrawnBoundaryShapePreviewGeometry({
    tool: 'ellipse',
    startX: 10,
    startY: 20,
    pointerX: 114,
    pointerY: 88,
    strokeWidth: 4,
  });

  assert.deepEqual(geometry.outerBounds, {
    left: 10,
    top: 20,
    width: 104,
    height: 68,
  });
  assert.deepEqual(geometry.fabricProps, {
    left: 12,
    top: 22,
    rx: 50,
    ry: 32,
  });
});
