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

function mockPainterContext() {
  return {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    closePath() {},
    rect() {},
    arc() {},
    ellipse() {},
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    setLineDash() {},
    measureText(text) { return { width: String(text).length * 6 }; },
  };
}

test('drawAnnotationObject covers path/line/polygon/text/counter/group shapes', () => {
  const ctx = mockPainterContext();
  assert.doesNotThrow(() => drawAnnotationObject(null, { type: 'rect' }));
  assert.doesNotThrow(() => drawAnnotationObject(ctx, null));

  drawAnnotationObject(ctx, {
    type: 'path',
    left: 0,
    top: 0,
    path: [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z']],
    stroke: '#000',
    fill: '#f00',
    angle: 15,
  }, 2);

  drawAnnotationObject(ctx, {
    type: 'line',
    left: 0,
    top: 0,
    x1: 0,
    y1: 0,
    x2: 20,
    y2: 0,
    stroke: '#111',
    tool: 'arrow',
  });

  drawAnnotationObject(ctx, {
    type: 'polygon',
    left: 0,
    top: 0,
    width: 20,
    height: 20,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    fill: '#0f0',
    stroke: '#000',
  });

  drawAnnotationObject(ctx, {
    type: 'polyline',
    left: 0,
    top: 0,
    width: 20,
    height: 20,
    points: [{ x: 0, y: 0 }, { x: 8, y: 4 }],
    stroke: '#000',
  });

  drawAnnotationObject(ctx, {
    type: 'textbox',
    left: 0,
    top: 0,
    width: 40,
    height: 20,
    text: 'hi\nthere',
    fill: '#000',
  });

  drawAnnotationObject(ctx, {
    type: 'circle',
    left: 0,
    top: 0,
    width: 20,
    height: 20,
    radius: 10,
    fill: '#abc',
    stroke: '#000',
    data: { type: 'counter', displayNumber: 3 },
  });

  drawAnnotationObject(ctx, {
    type: 'ellipse',
    left: 0,
    top: 0,
    width: 30,
    height: 20,
    rx: 15,
    ry: 10,
    fill: '#ddd',
  });

  drawAnnotationObject(ctx, {
    type: 'group',
    left: 5,
    top: 5,
    tool: 'arrow',
    objects: [{ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#000' }],
  });

  drawAnnotationObject(ctx, {
    type: 'group',
    left: 1,
    top: 1,
    objects: [{ type: 'rect', left: 0, top: 0, width: 4, height: 4, fill: '#000' }],
  });

  drawAnnotationObject(ctx, {
    type: 'rect',
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    fill: 'none',
    stroke: 'transparent',
    globalCompositeOperation: 'multiply',
    opacity: 0.5,
  });

  drawAnnotationObject(ctx, {
    type: 'triangle',
    left: 0,
    top: 0,
    width: 12,
    height: 12,
    fill: '#abc',
    stroke: '#000',
  });

  const rounded = [];
  const roundCtx = {
    ...ctx,
    roundRect(x, y, w, h, r) { rounded.push({ x, y, w, h, r }); },
  };
  drawAnnotationObject(roundCtx, {
    type: 'rect',
    left: 0,
    top: 0,
    width: 20,
    height: 10,
    rx: 4,
    fill: '#ddd',
    stroke: '#000',
  });
  assert.equal(rounded.length, 1);
});

test('callout painter wraps long words and keeps blank paragraphs', () => {
  const painted = [];
  const context = {
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    fillRect() {},
    strokeRect() {},
    measureText(text) { return { width: String(text).length * 10 }; },
    fillText(text) { painted.push(text); },
  };
  paintAnnotationCanvas(context, {
    canvasWidth: 200,
    canvasHeight: 200,
    drawScale: 1,
    displayScale: 1,
    pageWidth: 200,
    pageHeight: 200,
    objects: [],
    callouts: [{
      pageNumber: 1,
      text: 'HELLO\n\nWORLD',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.1, y: 0.3 },
      textBoxWidth: 0.12,
      textBoxHeight: 0.3,
      style: { fontSize: 12 },
    }],
  });
  assert.ok(painted.length >= 2);
});

test('traceFabricPath handles arc segments', () => {
  const calls = [];
  const context = {
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
  };
  traceFabricPath(context, [['M', 0, 0], ['A', 1, 1, 0, 0, 1, 5, 6]]);
  assert.deepEqual(calls.at(-1), ['lineTo', 5, 6]);
});
