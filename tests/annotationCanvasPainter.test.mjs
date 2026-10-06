import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAnnotationCanvasBackingStore,
  cssFirstBaseline,
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
    drawScaleY: 2,
    cssWidth: 600,
    cssHeight: 800,
    clamped: false,
  });
});

test('backing store scales are re-derived per axis so the paint fills it exactly', () => {
  // Renderer-parity harness bug (2026-07-14): pageSize 612x792 at the measured
  // host scale 605.03125/612 floored the backing to 604x782 but kept the
  // unfloored drawScale — the painted extent missed the backing by <1px and
  // the CSS stretch drifted ALL canvas geometry ~1.0017x from the origin.
  const pageWidth = 612;
  const pageHeight = 792;
  const result = calculateAnnotationCanvasBackingStore({
    pageWidth,
    pageHeight,
    displayScale: 605.03125 / 612,
    devicePixelRatio: 1,
  });

  // Painted extent (page dim x drawScale) must equal the integer backing dim.
  assert.ok(Math.abs(pageWidth * result.drawScale - result.width) < 1e-9);
  assert.ok(Math.abs(pageHeight * result.drawScaleY - result.height) < 1e-9);
  // The fractional parts differ per axis — a single shared scale cannot be
  // exact for both.
  assert.notEqual(result.drawScale, result.drawScaleY);
  // Unclamped CSS box = backing / dpr: an integer device extent so the
  // compositor maps bitmap px 1:1 instead of snap-stretching a fractional box.
  assert.equal(result.cssWidth, result.width);
  assert.equal(result.cssHeight, result.height);
  // And the transform actually painted with both axes.
  const transforms = [];
  paintAnnotationCanvas({
    setTransform: (...args) => transforms.push(args),
    clearRect: () => {},
  }, {
    canvasWidth: result.width,
    canvasHeight: result.height,
    drawScale: result.drawScale,
    drawScaleY: result.drawScaleY,
    displayScale: 1,
    pageWidth,
    pageHeight,
    objects: [],
    callouts: [],
  });
  assert.deepEqual(transforms[1], [result.drawScale, 0, 0, result.drawScaleY, -0, -0]);
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

test('PDF hairlines stay one display pixel under anisotropic object transforms', () => {
  const paint = (path, pathOffset) => {
    const calls = [];
    const context = {
      save: () => {},
      restore: () => {},
      beginPath: () => calls.push(['beginPath']),
      moveTo: (...args) => calls.push(['moveTo', ...args]),
      lineTo: (...args) => calls.push(['lineTo', ...args]),
      quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
      bezierCurveTo: (...args) => calls.push(['bezierCurveTo', ...args]),
      closePath: () => calls.push(['closePath']),
      setLineDash: (dash) => calls.push(['dash', ...dash]),
      stroke: () => calls.push(['stroke', context.lineWidth]),
      fill: () => calls.push(['fill']),
    };
    drawAnnotationObject(context, {
      type: 'path',
      path,
      left: 100,
      top: 100,
      scaleX: 4,
      scaleY: 1,
      pathOffset,
      originX: 'center',
      originY: 'center',
      inkGeometryOrigin: 'center-v1',
      stroke: '#000',
      strokeWidth: 0,
      strokeDashArray: [3, 2],
      strokeDashOffset: 1,
      strokeLineCap: 'butt',
      strokeLineJoin: 'miter',
      strokeMiterLimit: 7,
      pdfStrokeHairline: true,
      data: { pdfStrokeHairline: true },
    }, 2);
    return { calls, context };
  };

  const horizontal = paint(
    [['M', 0, 5], ['L', 10, 5]],
    { x: 5, y: 5 },
  );
  const vertical = paint(
    [['M', 5, 0], ['L', 5, 10]],
    { x: 5, y: 5 },
  );

  assert.deepEqual(
    horizontal.calls.filter(([kind]) => kind === 'stroke'),
    [['stroke', 0.5]],
  );
  assert.deepEqual(
    vertical.calls.filter(([kind]) => kind === 'stroke'),
    [['stroke', 0.5]],
  );
  assert.deepEqual(
    horizontal.calls.find(([kind]) => kind === 'dash'),
    ['dash', 3, 2],
  );
  assert.equal(horizontal.context.lineDashOffset, 1);
  assert.equal(horizontal.context.lineCap, 'butt');
  assert.equal(horizontal.context.lineJoin, 'miter');
  assert.equal(horizontal.context.miterLimit, 7);

  const horizontalMove = horizontal.calls.find(([kind]) => kind === 'moveTo');
  const horizontalLine = horizontal.calls.find(([kind]) => kind === 'lineTo');
  const verticalMove = vertical.calls.find(([kind]) => kind === 'moveTo');
  const verticalLine = vertical.calls.find(([kind]) => kind === 'lineTo');
  assert.equal(horizontalLine[1] - horizontalMove[1], 40, 'scaleX affects centerline only');
  assert.equal(verticalLine[2] - verticalMove[2], 10, 'scaleY affects centerline only');
});

// 2026-10-06 (test plan 68): the survivor polygons are FILLED (even-odd). They
// used to clip the analytic source stroke; that clip edge sat on the stroke's
// own edge, so edge pixels were anti-aliased twice and thin lines lightened.
test('Canvas2D paints a partial-erased authored curve as its filled survivor polygons', () => {
  const calls = [];
  const context = {
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (...args) => calls.push(['translate', ...args]),
    rotate: (...args) => calls.push(['rotate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    transform: (...args) => calls.push(['transform', ...args]),
    beginPath: () => calls.push(['beginPath']),
    rect: (...args) => calls.push(['rect', ...args]),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    bezierCurveTo: (...args) => calls.push(['bezierCurveTo', ...args]),
    closePath: () => calls.push(['closePath']),
    clip: (...args) => calls.push(['clip', ...args]),
    setLineDash: (dash) => calls.push(['dash', ...dash]),
    stroke: () => calls.push(['stroke', context.lineWidth]),
    fill: (...args) => calls.push(['fill', ...args]),
  };

  drawAnnotationObject(context, {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 100, 0],
      ['L', 100, 20],
      ['L', 0, 20],
      ['Z'],
    ],
    polygons: [[[
      [0, 0],
      [100, 0],
      [100, 20],
      [0, 20],
      [0, 0],
    ]]],
    paperEraserGeometry: 'v1',
    paperSourceStroke: {
      path: [['M', 0, 10], ['Q', 50, -20, 100, 10]],
      matrix: [1, 0, 0, 1, 0, 0],
      stroke: '#111111',
      strokeWidth: 12,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    },
    paperEraserCuts: [[[
      [45, 0],
      [55, 0],
      [55, 20],
      [45, 20],
      [45, 0],
    ]]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    fill: '#2563eb',
    stroke: 'transparent',
    strokeWidth: 0,
  }, 1);

  assert.equal(calls.some(([kind]) => kind === 'clip'), false, 'no clip: one anti-aliased edge');
  assert.equal(calls.some(([kind]) => kind === 'stroke'), false);
  assert.equal(calls.some(([kind]) => kind === 'quadraticCurveTo'), false, 'the survivor, not the source, is painted');
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'moveTo' || kind === 'lineTo').slice(0, 4),
    [['moveTo', 0, 0], ['lineTo', 100, 0], ['lineTo', 100, 20], ['lineTo', 0, 20]],
  );
  assert.deepEqual(calls.filter(([kind]) => kind === 'fill'), [['fill', 'evenodd']]);
  assert.equal(context.fillStyle, '#2563eb', 'live survivor recolor wins over source snapshot');

  calls.length = 0;
  drawAnnotationObject(context, {
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0], ['L', 100, 20], ['L', 0, 20], ['Z']],
    polygons: [[[[0, 0], [100, 0], [100, 20], [0, 20], [0, 0]]]],
    paperEraserGeometry: 'v1',
    paperSourceStroke: {
      path: [['M', 0, 20], ['A', 50, 20, 0, 0, 1, 100, 20], ['Z']],
      operationalPath: [
        ['M', 0, 20],
        ['C', 0, 8.954, 22.386, 0, 50, 0],
        ['C', 77.614, 0, 100, 8.954, 100, 20],
        ['Z'],
      ],
      matrix: [1, 0, 0, 1, 0, 0],
      paintMode: 'fill',
      fill: '#111111',
      fillRule: 'evenodd',
    },
    paperEraserCuts: [[[[45, 0], [55, 0], [55, 20], [45, 20], [45, 0]]]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    fill: '#2563eb',
    stroke: 'transparent',
    strokeWidth: 0,
  }, 1);

  assert.equal(calls.some(([kind]) => kind === 'bezierCurveTo'), false);
  assert.equal(calls.some(([kind]) => kind === 'clip'), false);
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'fill'),
    [['fill', 'evenodd']],
  );
  assert.equal(context.fillStyle, '#2563eb', 'live survivor recolor wins over source snapshot');
  assert.equal(calls.some(([kind]) => kind === 'stroke'), false);
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

test('Canvas2D callouts honor stored bold/italic/underline/strikethrough flags', () => {
  // 2026-07-17 parity fix twin: the SVG view now renders the stored style
  // flags, so the eraser-presentation painter must too or callout text would
  // visibly un-style on every eraser toggle.
  const makeContext = (log) => ({
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
    stroke: () => { log.strokes += 1; },
    arc: () => {},
    fill: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillText: (text) => log.texts.push(text),
    set font(value) { log.fonts.push(value); },
    get font() { return log.fonts[log.fonts.length - 1] || ''; },
  });
  const paintWithStyle = (style) => {
    const log = { fonts: [], texts: [], strokes: 0 };
    paintAnnotationCanvas(makeContext(log), {
      canvasWidth: 600,
      canvasHeight: 800,
      drawScale: 1,
      displayScale: 1,
      pageWidth: 600,
      pageHeight: 800,
      objects: [],
      callouts: [{
        pageNumber: 1,
        text: 'Styled',
        arrowTip: { x: 0.1, y: 0.1 },
        knee: { x: 0.2, y: 0.2 },
        textBoxPosition: { x: 0.3, y: 0.3 },
        textBoxWidth: 0.25,
        textBoxHeight: 0.1,
        style: { fontSize: 12, ...style },
      }],
    });
    return log;
  };

  const plain = paintWithStyle({});
  assert.ok(plain.fonts.some((f) => f.includes('normal normal 12px')),
    `expected a normal-weight callout font, got: ${plain.fonts.join(' | ')}`);

  const boldItalic = paintWithStyle({ bold: true, italic: true });
  assert.ok(boldItalic.fonts.some((f) => f.includes('italic bold 12px')),
    `expected 'italic bold' in callout font shorthand, got: ${boldItalic.fonts.join(' | ')}`);
  assert.ok(boldItalic.texts.includes('Styled'));

  // One painted line + underline + strikethrough = exactly 2 extra strokes.
  const decorated = paintWithStyle({ underline: true, strikethrough: true });
  assert.equal(decorated.strokes - plain.strokes, 2,
    'underline + strikethrough should each stroke one decoration line');
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

test('counter canvas text receives a hard inner-width cap at the smallest radius', () => {
  const texts = [];
  const context = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 100 }),
    fillText: (...args) => texts.push(args),
  };

  drawAnnotationObject(context, {
    type: 'circle',
    left: 10,
    top: 20,
    radius: 4,
    fill: '#ef4444',
    data: { type: 'counter', displayNumber: 100 },
  });

  assert.equal(texts.length, 1);
  assert.deepEqual(texts[0].slice(0, 3), ['100', 14, 24]);
  assert.equal(texts[0][3], 4 * 1.55);
  assert.match(context.font, /^700 2\./, 'three digits shrink below the old 11px floor');
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

test('every callout stroke paints raw page-unit widths (scales with zoom)', () => {
  // 2026-07-14 zoom-scaling unification: connector lines, box border, AND
  // arrowhead are all page-unit strokes in SVG (no vector-effect pins), so
  // the painter must not descale ANY of them by displayScale. Historical
  // bugs both ways: the arrowhead was once wrongly descaled (halved at 200%),
  // then the lines were wrongly pinned while the arrowhead scaled.
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

  // Connector line: raw lineThickness in page units — NOT divided by
  // displayScale(2).
  assert.equal(beforeClose[0], 4);
  // Arrowhead (only closePath in the paint is the open triangle): raw
  // Math.max(2, lineThickness) from the shared spec, NOT descaled.
  assert.equal(afterClose[0], 4);
});

test('callout box strokes with square corners and callout text uses geometricPrecision', () => {
  // Two eraser-mode fidelity bugs this guards against returning:
  // (1) the leader lines set lineJoin 'round' and the box strokeRect in the
  //     same scope inherited it — every corner of the callout text box
  //     rounded off by lineWidth/2 (SVG rect is rx=0, miter = square);
  // (2) SVG callout text renders with text-rendering geometricPrecision
  //     (~13% less ink than canvas default), so without matching it the
  //     eraser view painted visibly BOLDER callout glyphs.
  let lineJoinAtStrokeRect = null;
  let currentLineJoin = 'miter';
  let textRenderingAtFillText = null;
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
    strokeRect: () => { lineJoinAtStrokeRect = currentLineJoin; },
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillText: () => { textRenderingAtFillText = context.textRendering; },
    textRendering: 'auto',
    set lineJoin(value) { currentLineJoin = value; },
    get lineJoin() { return currentLineJoin; },
    set lineWidth(value) {},
    get lineWidth() { return 0; },
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
      text: 'square corners please',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.3 },
      textBoxWidth: 0.25,
      textBoxHeight: 0.1,
      style: { fontSize: 12, lineThickness: 4 },
    }],
  });

  assert.equal(lineJoinAtStrokeRect, 'miter', 'box border must not inherit the leader lines\' round joins');
  assert.equal(textRenderingAtFillText, 'geometricPrecision', 'callout glyphs must match SVG\'s finer rasterization');
});

test('cssFirstBaseline worker fallback derives the CSS baseline from font metrics', () => {
  // No DOM in Node — the helper must fall back to measureText's
  // fontBoundingBox metrics: lineHeightPx/2 + (ascent − descent)/2, the SVG
  // dominant-baseline='central' formula the glyph correction is built on.
  const context = {
    measureText: () => ({ width: 10, fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 4 }),
  };
  const lineHeightPx = 18.08;
  const offset = cssFirstBaseline(context, 'normal normal 16px FallbackProbeFont', lineHeightPx);
  assert.equal(offset, lineHeightPx / 2 + (15 - 4) / 2);

  // Metrics unavailable (old runtimes / width-only stubs) -> null, so callers
  // keep the legacy textBaseline='middle' behavior.
  const bare = cssFirstBaseline(
    { measureText: () => ({ width: 10 }) },
    'normal normal 16px MetriclessProbeFont',
    lineHeightPx,
  );
  assert.equal(bare, null);
});

test('cssFirstBaseline memoizes per font + line-height key', () => {
  const font = 'normal normal 16px MemoProbeFont';
  let calls = 0;
  const contextA = {
    measureText: () => {
      calls += 1;
      return { width: 10, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3 };
    },
  };
  const first = cssFirstBaseline(contextA, font, 20);
  assert.equal(first, 20 / 2 + (12 - 3) / 2);
  // Same key -> cached: the second context's (different) metrics never run.
  const second = cssFirstBaseline(
    { measureText: () => ({ width: 10, fontBoundingBoxAscent: 100, fontBoundingBoxDescent: 0 }) },
    font,
    20,
  );
  assert.equal(calls, 1);
  assert.equal(second, first);
  // Different line-height -> different cache entry.
  const other = cssFirstBaseline(contextA, font, 40);
  assert.equal(calls, 2);
  assert.equal(other, 40 / 2 + (12 - 3) / 2);
});

test('counter numbers anchor on the alphabetic baseline at the SVG central-baseline offset', () => {
  // Canvas textBaseline='middle' anchors the em-square midpoint, ~0.8px above
  // where SVG dominant-baseline='central' puts the counter number — the number
  // nudged whenever eraser mode swapped presentations. With font metrics
  // available the painter must draw with textBaseline='alphabetic' at
  // centerY + (fontBoundingBoxAscent − fontBoundingBoxDescent)/2.
  const texts = [];
  const context = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 8, fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 4 }),
    fillText: (text, x, y) => texts.push([text, x, y, context.textBaseline]),
  };

  drawAnnotationObject(context, {
    type: 'circle',
    left: 100,
    top: 200,
    radius: 14,
    fill: '#ef4444',
    data: { type: 'counter', displayNumber: 7, pointerAngle: 225 },
  });

  assert.equal(texts.length, 1);
  const [label, x, y, baseline] = texts[0];
  assert.equal(label, '7');
  assert.equal(x, 114); // centerX = left + radius
  assert.equal(baseline, 'alphabetic');
  assert.equal(y, 214 + (14 - 4) / 2); // centerY + (ascent − descent)/2
});

test('text glyphs move to the CSS baseline while decorations keep their line-box positions', () => {
  // drawText once anchored 'middle' at the line-box center — ~0.5px above the
  // SVG foreignObject glyphs. With metrics available the glyph must anchor
  // 'alphabetic' at blockTop + cssFirstBaseline(...), while the underline
  // stays at its pre-correction position (old centerY + 0.36 * fontSize).
  const fillTexts = [];
  const moveTos = [];
  const context = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    setLineDash: () => {},
    moveTo: (...args) => moveTos.push(args),
    lineTo: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({
      width: String(text).length * 6,
      fontBoundingBoxAscent: 15,
      fontBoundingBoxDescent: 4,
    }),
    fillText: (text, x, y) => fillTexts.push([text, x, y, context.textBaseline]),
  };

  const fontSize = 16;
  drawAnnotationObject(context, {
    type: 'textbox',
    left: 0,
    top: 0,
    width: 200,
    height: 50,
    text: 'Hi',
    fontSize,
    fontFamily: 'TextProbeFont',
    fill: '#000',
    underline: true,
  });

  const lineHeightPx = fontSize * 1.16 * 1.13;
  const baselineInLine = lineHeightPx / 2 + (15 - 4) / 2; // worker fallback formula
  const blockTop = 6; // TEXT_PADDING, verticalAlign top
  assert.equal(fillTexts.length, 1);
  const [text, , glyphY, textBaseline] = fillTexts[0];
  assert.equal(text, 'Hi');
  assert.equal(textBaseline, 'alphabetic');
  assert.ok(Math.abs(glyphY - (blockTop + baselineInLine)) < 1e-9);
  // Underline did NOT move: still old centerY + 0.36 * fontSize.
  assert.equal(moveTos.length, 1);
  const underlineY = moveTos[0][1];
  assert.ok(Math.abs(underlineY - (blockTop + lineHeightPx / 2 + fontSize * 0.36)) < 1e-9);
});

test('callout text glyphs anchor on the CSS baseline when font metrics resolve', () => {
  // Same correction as drawText: 12px Arial callout text sat ~0.9px above the
  // SVG when anchored 'middle'. First line must land at
  // round(startY) + cssFirstBaseline(font, lineHeightPx) with
  // textBaseline='alphabetic' — the round() mirrors Blink's foreignObject
  // paint-offset snap (2026-07-14, probe-verified: SVG paints the callout
  // text block at round(textBox.y + flexTop), not the unrounded layout y).
  const fillTexts = [];
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
    measureText: (text) => ({
      width: String(text).length * 6,
      fontBoundingBoxAscent: 11,
      fontBoundingBoxDescent: 3,
    }),
    fillText: (text, x, y) => fillTexts.push([text, x, y, context.textBaseline]),
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
      text: 'Hi',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.3 },
      textBoxWidth: 0.25,
      textBoxHeight: 0.1,
      style: { fontSize: 12, fontFamily: 'CalloutProbeFont' },
    }],
  });

  const fontSize = 12;
  const lineHeightPx = fontSize * 1 * 1.13;
  const baselineInLine = lineHeightPx / 2 + (11 - 3) / 2; // worker fallback formula
  const boxY = 0.3 * 800;
  const boxHeightWithDescenders = 0.1 * 800 + fontSize * 0.35;
  const startY = boxY + (boxHeightWithDescenders - lineHeightPx) / 2;
  assert.equal(fillTexts.length, 1);
  const [text, , y, textBaseline] = fillTexts[0];
  assert.equal(text, 'Hi');
  assert.equal(textBaseline, 'alphabetic');
  // startY is fractional here (275.32) — the painted anchor must be the
  // SNAPPED block top, proving the Blink parity round is applied.
  assert.notEqual(Math.round(startY), startY);
  assert.ok(Math.abs(y - (Math.round(startY) + baselineInLine)) < 1e-9);
});

test('text block paint offset snaps to integer page units like Blink foreignObject paint', () => {
  // Root-caused 2026-07-14 (renderer-parity probe): Chromium PAINTS
  // foreignObject text with the block's paint offset rounded to an integer in
  // the fo's local px space — painted baseline_i = round(foY + blockTop)
  // + i*lineHeightPx + baselineInLine — while DOM geometry APIs report the
  // unrounded layout position. Anchoring unrounded left canvas glyphs up to
  // 0.5 page units off the SVG (zoom-proportional: 1 css px at 233%), the
  // "text jumps when switching to the eraser" bug. Lines advance UNROUNDED
  // from the single snapped block top (verified: two-line foreignObject
  // paints line1 at snap(line0) + lineHeight, not at its own round).
  const fillTexts = [];
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
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({
      width: String(text).length * 6,
      fontBoundingBoxAscent: 15,
      fontBoundingBoxDescent: 4,
    }),
    fillText: (text, x, y) => fillTexts.push([text, x, y, context.textBaseline]),
  };

  const fontSize = 16;
  drawAnnotationObject(context, {
    type: 'textbox',
    left: 0,
    top: 0,
    width: 200,
    height: 50,
    text: 'Hi\nYo',
    fontSize,
    fontFamily: 'SnapProbeFont',
    fill: '#000',
    verticalAlign: 'middle',
  });

  const lineHeightPx = fontSize * 1.16 * 1.13; // 20.9728
  const baselineInLine = lineHeightPx / 2 + (15 - 4) / 2;
  // verticalAlign middle: blockTop = pad + freeSpace/2 = 6.8272 (fractional).
  const innerDisplayHeight = (50 - 12) + fontSize * 0.35;
  const blockTop = 6 + Math.max(0, innerDisplayHeight - 2 * lineHeightPx) / 2;
  assert.notEqual(Math.round(blockTop), blockTop);
  assert.equal(fillTexts.length, 2);
  assert.ok(Math.abs(fillTexts[0][2] - (Math.round(blockTop) + baselineInLine)) < 1e-9);
  // Second line: snapped block top + ONE unrounded line advance.
  assert.ok(Math.abs(fillTexts[1][2] - (Math.round(blockTop) + lineHeightPx + baselineInLine)) < 1e-9);
});

test('legacy middle-anchor fallback keeps the unsnapped block top', () => {
  // Without font metrics there is no baseline anchor to snap against — the
  // approximate 'middle' path must not half-fix positions by rounding.
  const fillTexts = [];
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
    fillRect: () => {},
    strokeRect: () => {},
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillText: (text, x, y) => fillTexts.push([text, x, y, context.textBaseline]),
  };

  const fontSize = 16;
  drawAnnotationObject(context, {
    type: 'textbox',
    left: 0,
    top: 0,
    width: 200,
    height: 50,
    text: 'Hi',
    fontSize,
    fontFamily: 'NoMetricsProbeFont',
    fill: '#000',
    verticalAlign: 'middle',
  });

  const lineHeightPx = fontSize * 1.16 * 1.13;
  const innerDisplayHeight = (50 - 12) + fontSize * 0.35;
  const blockTop = 6 + Math.max(0, innerDisplayHeight - lineHeightPx) / 2;
  assert.equal(fillTexts.length, 1);
  const [, , glyphY, textBaseline] = fillTexts[0];
  assert.equal(textBaseline, 'middle');
  assert.ok(Math.abs(glyphY - (blockTop + lineHeightPx / 2)) < 1e-9);
});
