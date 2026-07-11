import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAnnotationCanvasBackingStore,
  drawAnnotationObject,
  paintAnnotationCanvas,
  traceFabricPath,
} from '../src/utils/annotationCanvasPainter.js';

test('annotation canvas backing store is DPR-correct at normal zoom', () => {
  const result = calculateAnnotationCanvasBackingStore({
    pageWidth: 600,
    pageHeight: 800,
    displayScale: 1,
    devicePixelRatio: 2,
  });

  assert.deepEqual(result, {
    width: 1200,
    height: 1600,
    drawScale: 2,
    clamped: false,
  });
});

test('annotation canvas backing store stays inside deep-zoom memory and dimension limits', () => {
  const result = calculateAnnotationCanvasBackingStore({
    pageWidth: 2000,
    pageHeight: 3000,
    displayScale: 40,
    devicePixelRatio: 2,
  });

  assert.ok(result.width <= 8192);
  assert.ok(result.height <= 8192);
  assert.ok(result.width * result.height <= 4 * 1024 * 1024);
  assert.equal(result.clamped, true);
  assert.ok(Math.abs((result.width / result.height) - (2 / 3)) < 0.001);
});

test('crossing the demo 2.5x raster cap always requests a detail tile', () => {
  const result = calculateAnnotationCanvasBackingStore({
    pageWidth: 100,
    pageHeight: 100,
    displayScale: 3,
    devicePixelRatio: 1,
  });

  assert.equal(result.drawScale, 2.5);
  assert.equal(result.clamped, true);
});

test('Fabric path commands map to the matching Canvas2D path operations', () => {
  const calls = [];
  const context = {
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    bezierCurveTo: (...args) => calls.push(['bezierCurveTo', ...args]),
    closePath: () => calls.push(['closePath']),
  };

  traceFabricPath(context, [
    ['M', 1, 2],
    ['L', 3, 4],
    ['Q', 5, 6, 7, 8],
    ['H', 15],
    ['V', 16],
    ['C', 9, 10, 11, 12, 13, 14],
    ['Z'],
  ]);

  assert.deepEqual(calls, [
    ['beginPath'],
    ['moveTo', 1, 2],
    ['lineTo', 3, 4],
    ['quadraticCurveTo', 5, 6, 7, 8],
    ['lineTo', 15, 8],
    ['lineTo', 15, 16],
    ['bezierCurveTo', 9, 10, 11, 12, 13, 14],
    ['closePath'],
  ]);
});

test('Canvas2D shapes preserve dashed survey-marker strokes', () => {
  const calls = [];
  const context = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    rect: () => {},
    fill: () => {},
    stroke: () => {},
    setLineDash: (dash) => calls.push(dash),
  };

  drawAnnotationObject(context, {
    type: 'rect',
    left: 10,
    top: 20,
    width: 30,
    height: 40,
    fill: 'transparent',
    stroke: '#4A90E2',
    strokeWidth: 2,
    strokeDashArray: [5, 5],
  });

  assert.deepEqual(calls, [[5, 5]]);
});

test('Canvas2D callouts paint their text inside the callout box', () => {
  const paintedText = [];
  const context = {
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillText: (text) => paintedText.push(text),
  };

  paintAnnotationCanvas(context, {
    canvasWidth: 600,
    canvasHeight: 800,
    drawScale: 1,
    displayScale: 1,
    pageWidth: 600,
    pageHeight: 800,
    objects: [],
    callouts: [{
      pageNumber: 1,
      text: 'Hello callout',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.3 },
      textBoxWidth: 0.25,
      textBoxHeight: 0.1,
      style: { fontSize: 12 },
    }],
  });

  assert.ok(paintedText.join(' ').includes('Hello'));
});

test('viewport detail painting offsets page geometry into its tile', () => {
  const transforms = [];
  const context = {
    setTransform: (...args) => transforms.push(args),
    clearRect: () => {},
  };

  paintAnnotationCanvas(context, {
    canvasWidth: 1200,
    canvasHeight: 800,
    drawScale: 10,
    displayScale: 5,
    pageWidth: 612,
    pageHeight: 792,
    offsetX: 180,
    offsetY: 70,
    objects: [],
    callouts: [],
  });

  assert.deepEqual(transforms[1], [10, 0, 0, 10, -1800, -700]);
});
