import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAnnotationCanvasBackingStore,
  drawAnnotationObject,
  paintAnnotationCanvas,
  traceFabricPath,
} from '../src/utils/annotationCanvasPainter.js';
import { countWrappedLines } from '../src/utils/svgBoundingBox.js';

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
    closePath: () => {},
    translate: () => {},
    rotate: () => {},
    setLineDash: () => {},
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

test('counter pins paint the full Shottr-style bubble from radius-only circle JSON', () => {
  // Counters are hand-built Fabric Circle JSON carrying `radius` but NO
  // width/height. The old painter read width/height, degenerated the pin to a
  // ~1pt dot, and pins "disappeared" whenever the canvas presentation served a
  // frame. The pin must mirror renderCounter (svgAnnotationRenderers.jsx):
  // bubble+nubbin path at the stored radius, centered white number.
  const arcs = [];
  const texts = [];
  let fillCount = 0;
  const context = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    arc: (...args) => arcs.push(args),
    fill: () => { fillCount += 1; },
    fillText: (text, x, y) => texts.push([text, x, y]),
  };

  drawAnnotationObject(context, {
    type: 'circle',
    left: 100,
    top: 200,
    radius: 14,
    fill: '#ef4444',
    stroke: '#ffffff',
    strokeWidth: 1.5,
    data: { type: 'counter', displayNumber: 7, pointerAngle: 225 },
  });

  assert.equal(arcs.length, 1);
  const [cx, cy, r] = arcs[0];
  assert.equal(cx, 114); // left + radius
  assert.equal(cy, 214); // top + radius
  assert.equal(r, 14);   // stored radius, not width/2 (which is absent)
  assert.ok(fillCount >= 1);
  assert.deepEqual(texts[0], ['7', 114, 214]);
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

test('canvas lines decode fabric center-relative endpoints like the SVG renderer', () => {
  // fabric Line stores x1..y2 relative to the bbox CENTER. The old painter
  // added them to left/top, shifting every line up-left by half its bbox.
  const ops = [];
  const context = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    setLineDash: () => {},
    beginPath: () => {},
    moveTo: (...a) => ops.push(['moveTo', ...a]),
    lineTo: (...a) => ops.push(['lineTo', ...a]),
    stroke: () => {},
    fill: () => {},
    closePath: () => {},
  };
  drawAnnotationObject(context, {
    type: 'line',
    left: 100,
    top: 100,
    width: 50,
    height: 50,
    x1: -25,
    y1: -25,
    x2: 25,
    y2: 25,
    stroke: '#000',
    strokeWidth: 2,
  });
  assert.deepEqual(ops[0], ['moveTo', 100, 100]);
  assert.deepEqual(ops[1], ['lineTo', 150, 150]);
});

test('canvas callout tip is a solid-triangle arrowhead, not a dot', () => {
  // The old painter drew context.arc(tip, ~2px) — the "arrow looks like a
  // circle" bug. Default style must rasterize the shared solidTriangle spec.
  let arcCalls = 0;
  let triangleFilled = false;
  let sawClosePath = false;
  const context = {
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => { sawClosePath = true; },
    translate: () => {},
    rotate: () => {},
    setLineDash: () => {},
    stroke: () => {},
    arc: () => { arcCalls += 1; },
    fill: () => { if (sawClosePath) triangleFilled = true; },
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillText: () => {},
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
      text: 'tip check',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.3 },
      textBoxWidth: 0.25,
      textBoxHeight: 0.1,
      style: { fontSize: 12 },
    }],
  });
  assert.equal(arcCalls, 0);
  assert.equal(triangleFilled, true);
});

test('dimensionless text counts wrapped lines exactly like the SVG measure pass', () => {
  // Three ~60px words in a 100px container: word-boundary wrapping needs 3
  // lines (one word per line), but the old ceil(naturalWidth/containerWidth)
  // approximation said 2 — the block jumped a line height when the canvas
  // presentation swapped in. The painter must share countWrappedLines.
  const measureText = (text) => ({
    width: String(text).split('').reduce((w, ch) => w + (ch === ' ' ? 6 : 20), 0),
  });
  const text = 'abc def ghi'; // 3 words x 60px, spaces 6px -> natural 192px
  const containerWidth = 100;

  const svgLines = countWrappedLines({ measureText }, text, containerWidth);
  assert.equal(svgLines, 3);
  // Guard that this case actually diverges from the old approximation.
  assert.notEqual(svgLines, Math.ceil(measureText(text).width / containerWidth));

  const fillRects = [];
  const context = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    setLineDash: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    strokeRect: () => {},
    fillText: () => {},
    measureText,
    fillRect: (...args) => fillRects.push(args),
  };

  drawAnnotationObject(context, {
    type: 'i-text', // no stored height -> dimensionless measure fallback
    left: 0,
    top: 0,
    width: containerWidth,
    text,
    fontSize: 16,
    fill: '#000',
    backgroundColor: '#ffff00', // background rect exposes effective dims
  });

  const singleLineH = 16 * 1.16;
  const [, , effectiveWidth, effectiveHeight] = fillRects[0];
  assert.equal(effectiveWidth, containerWidth + 4);
  assert.equal(effectiveHeight, Math.max(svgLines * singleLineH + 4, singleLineH));
});

test('callout arrowhead strokes paint raw while connector lines stay non-scaling', () => {
  // SVG's renderArrowheadEl spreads the spec with NO vectorEffect — arrowhead
  // strokes scale with zoom. Only the connector lines and box border are
  // non-scaling-stroke. The painter once descaled the arrowhead too, halving
  // its thickness at 200% zoom when the canvas presentation opened.
  let sawClosePath = false;
  const beforeClose = [];
  const afterClose = [];
  const context = {
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => { sawClosePath = true; },
    translate: () => {},
    rotate: () => {},
    setLineDash: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillText: () => {},
    set lineWidth(value) { (sawClosePath ? afterClose : beforeClose).push(value); },
    get lineWidth() { return 0; },
  };

  paintAnnotationCanvas(context, {
    canvasWidth: 600,
    canvasHeight: 800,
    drawScale: 1,
    displayScale: 2,
    pageWidth: 600,
    pageHeight: 800,
    objects: [],
    callouts: [{
      pageNumber: 1,
      text: '',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.3 },
      textBoxWidth: 0.25,
      textBoxHeight: 0.1,
      style: { fontSize: 12, lineThickness: 4, arrowheadStyle: 'openTriangle' },
    }],
  });

  // Connector line: 4 / displayScale(2) — vectorEffect twin.
  assert.equal(beforeClose[0], 2);
  // Arrowhead (only closePath in the paint is the open triangle): raw
  // Math.max(2, lineThickness) from the shared spec, NOT descaled.
  assert.equal(afterClose[0], 4);
});
