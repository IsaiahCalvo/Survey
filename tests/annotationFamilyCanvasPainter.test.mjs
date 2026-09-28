// w52 (2026-09-28) "annotations are annotations": the Canvas2D painter
// (thumbnails, the zoom/scroll proxy, the eraser raster base) must paint every
// mark type the SVG layer paints. Imported stamps (image proxies) and text
// markup (quads) had no branch at all, so thumbnails silently left them out.
import test from 'node:test';
import assert from 'node:assert/strict';

import { paintAnnotationCanvas } from '../src/utils/annotationCanvasPainter.js';
import {
  annotationImagesReady,
  preloadAnnotationImages,
  setAnnotationImageDecoder,
} from '../src/utils/annotationImageCache.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4mAAAAAElFTkSuQmCC';

function recordingContext() {
  const calls = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  const stack = [];
  const record = (name) => (...args) => calls.push({ name, args, alpha: state.globalAlpha, op: state.globalCompositeOperation, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, lineWidth: state.lineWidth });
  const context = new Proxy(state, {
    get(target, key) {
      if (key === 'save') return () => stack.push({ ...target });
      if (key === 'restore') return () => Object.assign(target, stack.pop() || {});
      if (key in target) return target[key];
      if (typeof key !== 'string') return undefined;
      return record(key);
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { context, calls };
}

const paint = (objects) => {
  const { context, calls } = recordingContext();
  const result = paintAnnotationCanvas(context, {
    canvasWidth: 200, canvasHeight: 200, drawScale: 1, displayScale: 1,
    pageWidth: 200, pageHeight: 200, objects, callouts: [],
  });
  return { calls, result };
};

const stamp = (overrides = {}) => ({
  id: 'stamp-1', type: 'image', src: PNG,
  left: 20, top: 30, width: 40, height: 20, scaleX: 1.5, scaleY: 1,
  opacity: 0.8, isPdfImported: true, pdfAnnotationType: 'Stamp',
  ...overrides,
});

const quad = (x, y, w, h) => ({ x1: x, y1: y, x2: x + w, y2: y, x3: x, y3: y + h, x4: x + w, y4: y + h });

test.afterEach(() => setAnnotationImageDecoder(null));

test('an imported stamp paints its decoded image at the SVG <image> box once decoded', async () => {
  const fakeImage = { kind: 'decoded-stamp' };
  setAnnotationImageDecoder(async (src) => (src === PNG ? fakeImage : null));
  const first = paint([stamp()]);
  assert.equal(first.result.pendingImageCount, 1, 'first paint reports the stamp as still decoding');
  assert.equal(first.calls.filter((c) => c.name === 'drawImage').length, 0);

  assert.equal(await preloadAnnotationImages([stamp()]), true);
  assert.equal(annotationImagesReady([stamp()]), true);
  const second = paint([stamp()]);
  assert.equal(second.result.pendingImageCount, 0);
  const draws = second.calls.filter((c) => c.name === 'drawImage');
  assert.equal(draws.length, 1);
  assert.equal(draws[0].args[0], fakeImage);
  // getPdfStampProxySvgProps: x=left, y=top, width*|scaleX|, height*|scaleY|.
  assert.deepEqual(draws[0].args.slice(1), [20, 30, 60, 20]);
  assert.equal(draws[0].alpha, 0.8);
});

test('a rotated stamp rotates about its box centre unless the rotation is baked into the image', async () => {
  setAnnotationImageDecoder(async () => ({ kind: 'img' }));
  await preloadAnnotationImages([stamp()]);
  const rotated = paint([stamp({ angle: 90 })]).calls;
  assert.ok(rotated.some((c) => c.name === 'rotate' && Math.abs(c.args[0] - Math.PI / 2) < 1e-9));
  const baked = paint([stamp({ angle: 90, data: { pdfStampAppearanceRotationBaked: true } })]).calls;
  assert.ok(!baked.some((c) => c.name === 'rotate'));
});

test('text-markup highlight fills its quads with the markup colour and opacity (multiply when layered)', () => {
  const { calls } = paint([{
    id: 'hl', type: 'group', fill: '#ffeb3b', opacity: 0.4,
    data: { type: 'text-markup', markupType: 'highlight', overlapMode: 'layered', quads: [quad(10, 10, 50, 12)] },
  }]);
  const fill = calls.find((c) => c.name === 'fill');
  assert.ok(fill, 'highlight was filled');
  assert.equal(fill.fillStyle, '#ffeb3b');
  assert.equal(fill.alpha, 0.4);
  assert.equal(fill.op, 'multiply');
  const moves = calls.filter((c) => c.name === 'moveTo').map((c) => c.args);
  assert.deepEqual(moves, [[10, 10]]);
  const lines = calls.filter((c) => c.name === 'lineTo').map((c) => c.args);
  // Quad order x1 -> x2 -> x4 -> x3, same as renderTextMarkup's path.
  assert.deepEqual(lines, [[60, 10], [60, 22], [10, 22]]);
});

test('text-markup strikeout strokes the quad mid-line at the authored width', () => {
  const { calls } = paint([{
    id: 'so', type: 'group', stroke: '#ff0000', opacity: 1,
    data: { type: 'text-markup', markupType: 'strikeout', lineWidth: 2, quads: [quad(10, 10, 50, 12)] },
  }]);
  const stroke = calls.find((c) => c.name === 'stroke');
  assert.ok(stroke);
  assert.equal(stroke.strokeStyle, '#ff0000');
  assert.equal(stroke.lineWidth, 2);
  assert.deepEqual(calls.filter((c) => c.name === 'moveTo').map((c) => c.args), [[10, 16]]);
  assert.deepEqual(calls.filter((c) => c.name === 'lineTo').map((c) => c.args), [[60, 16]]);
});

test('uniform-overlap highlights paint ONE merged mask beneath every mark, not per highlight', () => {
  const uniform = (id, q) => ({
    id, type: 'group', fill: '#00ff00', opacity: 0.3,
    data: { type: 'text-markup', markupType: 'highlight', overlapMode: 'uniform', quads: [q] },
  });
  const { calls } = paint([
    { id: 'r', type: 'rect', left: 0, top: 0, width: 5, height: 5, fill: '#123456', stroke: null, strokeWidth: 0 },
    uniform('a', quad(10, 10, 20, 10)),
    uniform('b', quad(20, 10, 20, 10)),
  ]);
  const fills = calls.filter((c) => c.name === 'fill');
  assert.equal(fills.length, 2, 'one merged highlight fill + the rect');
  assert.equal(fills[0].fillStyle, '#00ff00', 'the merged mask paints first, beneath the rect');
  assert.equal(fills[0].alpha, 0.3);
  assert.equal(fills[1].fillStyle, '#123456');
});

test('the painter spec keeps the SVG renderer formulas it twins (drift guard)', async () => {
  const { readFile } = await import('node:fs/promises');
  const svg = await readFile(new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url), 'utf8');
  const spec = await readFile(new URL('../src/utils/textMarkupRenderSpec.js', import.meta.url), 'utf8');
  const shared = [
    "const opacity = Math.max(0, Math.min(1, Number(obj.opacity ?? 0.3)));",
    "const lineWidth = Number.isFinite(data.lineWidth) ? Math.max(0, data.lineWidth) : 1.2;",
    "const startX = type === 'strikeout' ? (q.x1 + q.x3) / 2 : q.x3;",
    "const startY = type === 'strikeout' ? (q.y1 + q.y3) / 2 : q.y3 - underlineInset;",
    "const amplitude = Math.max(0.7, Math.min(1.8, height * 0.12));",
    "const segments = Math.max(6, Math.ceil(length / 2.5));",
    "if (type === 'link' && obj?.isPdfImported) return null;",
  ];
  for (const line of shared) {
    assert.ok(svg.includes(line), `renderTextMarkup still has: ${line}`);
    assert.ok(spec.includes(line), `textMarkupRenderSpec still has: ${line}`);
  }
});
