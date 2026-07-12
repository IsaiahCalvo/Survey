import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAnnotationBBox,
  getAnnotationWorldAABB,
  getGroupBBox,
  getHandlePositions,
  isImportedPath,
  isAbsoluteCoordPath,
  translatePathData,
  scalePathData,
  getLineEndpoints,
  computeLineBboxCenter,
  measureTextBounds,
} from '../src/utils/svgBoundingBox.js';

test('getAnnotationBBox returns empty box for null', () => {
  assert.deepEqual(getAnnotationBBox(null), { left: 0, top: 0, width: 0, height: 0, angle: 0 });
});

test('getAnnotationBBox covers rect/circle/ellipse/text/default', () => {
  assert.equal(getAnnotationBBox({ type: 'rect', left: 1, top: 2, width: 10, height: 5 }).width, 10);
  assert.equal(getAnnotationBBox({ type: 'circle', left: 0, top: 0, radius: 5 }).width, 10);
  assert.equal(getAnnotationBBox({ type: 'ellipse', left: 0, top: 0, rx: 4, ry: 3 }).width, 8);
  assert.ok(getAnnotationBBox({ type: 'textbox', left: 0, top: 0, width: 40, height: 20, text: 'hi' }).width > 0);
  assert.equal(getAnnotationBBox({ type: 'unknown', left: 3, top: 4, width: 2, height: 2 }).left, 3);
});

test('getAnnotationBBox covers absolute and pathOffset paths', () => {
  const abs = getAnnotationBBox({
    type: 'path',
    path: [['M', 10, 20], ['L', 30, 40]],
  });
  assert.equal(abs.left, 10);
  assert.equal(abs.top, 20);
  assert.equal(abs.width, 20);
  assert.equal(abs.height, 20);

  const centered = getAnnotationBBox({
    type: 'path',
    left: 50,
    top: 60,
    width: 20,
    height: 10,
    pathOffset: { x: 1, y: 2 },
    path: [['M', 0, 0], ['L', 1, 1]],
  });
  assert.equal(centered.left, 40);
  assert.equal(centered.top, 55);
  assert.equal(centered.width, 20);
});

test('getAnnotationBBox covers line with midpoint curve and group arrow', () => {
  const line = getAnnotationBBox({
    type: 'line',
    left: 0,
    top: 0,
    width: 100,
    height: 0,
    x1: -50,
    y1: 0,
    x2: 50,
    y2: 0,
    data: { midpoint: { x: 50, y: -40 } },
  });
  assert.ok(line.height > 0);

  const arrow = getAnnotationBBox({
    type: 'group',
    left: 10,
    top: 20,
    angle: 15,
    objects: [{ type: 'line', x1: 0, y1: 0, x2: 40, y2: 30 }],
  });
  assert.equal(arrow.angle, 15);
  assert.ok(arrow.width >= 10);
});

test('getAnnotationBBox covers polygon points', () => {
  const bbox = getAnnotationBBox({
    type: 'polygon',
    left: 5,
    top: 5,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }],
  });
  assert.equal(bbox.width, 10);
  assert.equal(bbox.height, 8);
});

test('getAnnotationWorldAABB expands rotated boxes', () => {
  const world = getAnnotationWorldAABB({
    type: 'rect',
    left: 0,
    top: 0,
    width: 20,
    height: 10,
    angle: 90,
  });
  assert.equal(world.angle, 0);
  assert.ok(world.width >= 10);
  assert.deepEqual(
    getAnnotationWorldAABB({ type: 'rect', left: 1, top: 2, width: 3, height: 4 }),
    { left: 1, top: 2, width: 3, height: 4, angle: 0 },
  );
});

test('getGroupBBox unions boxes and handles empty', () => {
  assert.deepEqual(getGroupBBox([]), { left: 0, top: 0, width: 0, height: 0, angle: 0 });
  const union = getGroupBBox([
    { left: 0, top: 0, width: 10, height: 10 },
    { left: 5, top: 5, width: 20, height: 5 },
  ]);
  assert.equal(union.left, 0);
  assert.equal(union.top, 0);
  assert.equal(union.width, 25);
  assert.equal(union.height, 10);
});

test('getHandlePositions returns nine handles', () => {
  const h = getHandlePositions({ left: 10, top: 20, width: 30, height: 40 }, 2);
  assert.deepEqual(h.tl, { x: 8, y: 18 });
  assert.deepEqual(h.br, { x: 42, y: 62 });
  assert.equal(h.mtr.y, 20 - 2 - 40);
});

test('path helpers detect and transform path data', () => {
  assert.equal(isImportedPath({ type: 'path', path: [['M', 0, 0]] }), true);
  assert.equal(isImportedPath({ type: 'path', left: 1, path: [['M', 0, 0]] }), false);
  assert.equal(isAbsoluteCoordPath({ type: 'path', left: 0, top: 0, path: [['M', 1, 1]] }), true);
  assert.equal(isAbsoluteCoordPath({ type: 'path', left: 5, path: [['M', 1, 1]] }), false);

  assert.deepEqual(
    translatePathData([['M', 1, 2], ['L', 3, 4]], 10, 20),
    [['M', 11, 22], ['L', 13, 24]],
  );
  assert.deepEqual(
    scalePathData([['M', 0, 0], ['L', 10, 10]], 2, 3, 0, 0),
    [['M', 0, 0], ['L', 20, 30]],
  );
});

test('getLineEndpoints and computeLineBboxCenter', () => {
  const ep = getLineEndpoints({ left: 0, top: 0, width: 10, height: 10, x1: -5, y1: -5, x2: 5, y2: 5 });
  assert.deepEqual(ep, { x1: 0, y1: 0, x2: 10, y2: 10 });
  const center = computeLineBboxCenter(ep, { x: 5, y: -10 });
  assert.ok(Number.isFinite(center.x));
  assert.ok(Number.isFinite(center.y));

  // Midpoint that produces an interior quadratic extremum on X
  const curved = computeLineBboxCenter(
    { x1: 0, y1: 0, x2: 100, y2: 0 },
    { x: 50, y: -40 },
  );
  assert.ok(Number.isFinite(curved.x));

  // Asymmetric midpoint → tx ∈ (0,1) X-extremum branch
  const xExtremum = computeLineBboxCenter(
    { x1: 0, y1: 0, x2: 100, y2: 0 },
    { x: 20, y: 0 },
  );
  assert.ok(Number.isFinite(xExtremum.x));
});

test('line bbox diag throttle + thin-line pad + empty polygon', () => {
  const originalDiag = globalThis.__LINE_BBOX_DIAG;
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  globalThis.__LINE_BBOX_DIAG = true;
  try {
    const thin = {
      type: 'line',
      id: 'thin-1',
      left: 0,
      top: 0,
      width: 100,
      height: 0,
      x1: -50,
      y1: 0,
      x2: 50,
      y2: 0,
    };
    const bbox = getAnnotationBBox(thin);
    assert.ok(bbox.height >= 10);
    // Second call within 150ms should not log again for same id
    getAnnotationBBox(thin);
    // Anon object uses WeakMap throttle path
    const anon = { type: 'line', left: 0, top: 0, width: 2, height: 2, x1: -1, y1: -1, x2: 1, y2: 1 };
    getAnnotationBBox(anon);
    getAnnotationBBox(anon);
    assert.ok(logs.some((line) => line.includes('[LineBboxDiag]')));
  } finally {
    console.log = originalLog;
    if (originalDiag === undefined) delete globalThis.__LINE_BBOX_DIAG;
    else globalThis.__LINE_BBOX_DIAG = originalDiag;
  }

  assert.deepEqual(
    getAnnotationBBox({ type: 'polygon', left: 1, top: 2, points: [] }),
    { left: 0, top: 0, width: 0, height: 0, angle: 0 },
  );
  assert.deepEqual(
    getAnnotationBBox({ type: 'polyline', left: 0, top: 0, points: [{}, null] }),
    { left: 0, top: 0, width: 0, height: 0, angle: 0 },
  );
});

test('measureTextBounds works with a mocked canvas context', () => {
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        getContext() {
          return {
            font: '',
            measureText(text) {
              return { width: String(text).length * 8 };
            },
          };
        },
      };
    },
  };
  try {
    const empty = measureTextBounds({ text: '   ' });
    assert.ok(empty.width > 0);
    const tight = measureTextBounds({ text: 'hi', width: 100 });
    assert.ok(tight.width > 0);
    const wrapped = measureTextBounds({
      text: 'one two three four five six seven',
      width: 40,
      fontSize: 12,
    });
    assert.ok(wrapped.height > 12);
    const multiline = measureTextBounds({ text: 'a\n\nb', width: 100 });
    assert.ok(multiline.height > tight.height);
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('getAnnotationBBox expands counter pin tip and empty path/group fallbacks', () => {
  const counter = getAnnotationBBox({
    type: 'circle',
    left: 0,
    top: 0,
    radius: 10,
    data: { type: 'counter', pointerAngle: 0 },
  });
  assert.ok(counter.width > 20);

  assert.deepEqual(
    getAnnotationBBox({ type: 'path', path: [] }),
    { left: 0, top: 0, width: 0, height: 0, angle: 0 },
  );
  assert.deepEqual(
    getAnnotationBBox({ type: 'group', left: 3, top: 4, objects: [] }),
    { left: 3, top: 4, width: 10, height: 10, angle: 0 },
  );
  const groupFallback = getAnnotationBBox({
    type: 'group',
    left: 1,
    top: 2,
    width: 30,
    height: 20,
    objects: [{ type: 'rect' }],
  });
  assert.equal(groupFallback.width, 30);
  assert.equal(groupFallback.height, 20);
});

test('getAnnotationBBox covers empty polygon and i-text measurement', () => {
  assert.deepEqual(
    getAnnotationBBox({ type: 'polygon', points: [] }),
    { left: 0, top: 0, width: 0, height: 0, angle: 0 },
  );

  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        getContext() {
          return { font: '', measureText(t) { return { width: String(t).length * 5 }; } };
        },
      };
    },
  };
  try {
    const itext = getAnnotationBBox({ type: 'i-text', text: 'abc', left: 2, top: 3 });
    assert.equal(itext.left, 2);
    assert.ok(itext.width > 0);
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('getAnnotationBBox straight near-axis line enforces min handle strip', () => {
  const horiz = getAnnotationBBox({
    type: 'line',
    left: 0,
    top: 0,
    width: 100,
    height: 0,
    x1: -50,
    y1: 0,
    x2: 50,
    y2: 0,
  });
  assert.equal(horiz.height, 10);
});

test('line bbox diag path runs when __LINE_BBOX_DIAG is enabled', () => {
  const prev = globalThis.__LINE_BBOX_DIAG;
  globalThis.__LINE_BBOX_DIAG = true;
  const logs = [];
  const prevLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    getAnnotationBBox({
      id: 'line-diag-1',
      type: 'line',
      left: 0,
      top: 0,
      width: 40,
      height: 40,
      x1: -20,
      y1: -20,
      x2: 20,
      y2: 20,
      data: { midpoint: { x: 0, y: -30 } },
    });
    // Second call within throttle window should still be safe.
    getAnnotationBBox({
      id: 'line-diag-1',
      type: 'line',
      left: 0,
      top: 0,
      width: 40,
      height: 40,
      x1: -20,
      y1: -20,
      x2: 20,
      y2: 20,
    });
  } finally {
    console.log = prevLog;
    if (prev === undefined) delete globalThis.__LINE_BBOX_DIAG;
    else globalThis.__LINE_BBOX_DIAG = prev;
  }
});

test('LineBboxDiag swallows console.log failures', () => {
  const prev = globalThis.__LINE_BBOX_DIAG;
  const prevLog = console.log;
  const prevWarn = console.warn;
  const warnings = [];
  globalThis.__LINE_BBOX_DIAG = true;
  console.log = () => { throw new Error('log-boom'); };
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    getAnnotationBBox({
      type: 'line',
      id: `diag-fail-${Date.now()}`,
      left: 0,
      top: 0,
      width: 40,
      height: 0,
      x1: -20,
      y1: 0,
      x2: 20,
      y2: 0,
    });
    assert.ok(warnings.some((w) => w.includes('[LineBboxDiag]')));
  } finally {
    console.log = prevLog;
    console.warn = prevWarn;
    if (prev === undefined) delete globalThis.__LINE_BBOX_DIAG;
    else globalThis.__LINE_BBOX_DIAG = prev;
  }
});
