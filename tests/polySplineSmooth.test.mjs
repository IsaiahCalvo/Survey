// Curved polyline draws a TRUE curve (owner 2026-11-12: "as I curve it, it
// becomes angular ... not using the correct curve, beziers, or whatever
// Takeoff uses"). The mark stores 12 samples per span; drawing those as
// straight pieces showed corners. Screen and canvas now draw each span as its
// cubic; PDF /Vertices, its appearance and XFDF get the cubics cut finely.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  SPLINE_FLAT_TOLERANCE, SPLINE_STEP, moveSplineHandle, polySplineSpans, sampleSpline,
  smoothPolylinePoints, splinePathD, splineSpans, trimPointsByLength,
} from '../src/utils/polySpline.js';
import { createServer } from 'vite';
import { drawAnnotationObject } from '../src/utils/annotationCanvasPainter.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { exportAnnotationsAsXfdf } from '../src/utils/xfdfExport/index.js';

// The renderers are JSX: load them through Vite, as the eraser render test does.
let vite = null;
let renderPolyline = null;
before(async () => {
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  ({ renderPolyline } = await vite.ssrLoadModule('/src/utils/svgAnnotationRenderers.jsx'));
});
after(async () => { await vite?.close(); });

const corners = [{ x: 0, y: 0 }, { x: 200, y: 160 }, { x: 400, y: 0 }];
// A span bent hard by its handle, the way the owner shapes a curve.
const bentPoints = () => moveSplineHandle(sampleSpline(corners, SPLINE_STEP), SPLINE_STEP, 0, 'c1', { x: -150, y: 380 });
const curvedMark = (points = bentPoints(), extra = {}) => ({
  type: 'polyline', id: 'curve-1', left: 0, top: 0, angle: 0, scaleX: 1, scaleY: 1,
  points, pathOffset: { x: 0, y: 0 }, stroke: '#0000ff', strokeWidth: 2, fill: 'transparent',
  data: { id: 'curve-1', spline: { step: SPLINE_STEP, bezier: true } },
  ...extra,
});

const cubicAt = (s, t) => {
  const mt = 1 - t;
  return {
    x: mt ** 3 * s.from.x + 3 * mt * mt * t * s.c1.x + 3 * mt * t * t * s.c2.x + t ** 3 * s.to.x,
    y: mt ** 3 * s.from.y + 3 * mt * mt * t * s.c1.y + 3 * mt * t * t * s.c2.y + t ** 3 * s.to.y,
  };
};
const segDist = (p, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - dx * k, p.y - a.y - dy * k);
};
// Largest gap between the true curve and a run of straight pieces.
const worstGap = (spans, pieces) => {
  let worst = 0;
  for (const s of spans) {
    for (let i = 0; i <= 400; i += 1) {
      const p = cubicAt(s, i / 400);
      let best = Infinity;
      for (let j = 1; j < pieces.length; j += 1) best = Math.min(best, segDist(p, pieces[j - 1], pieces[j]));
      worst = Math.max(worst, best);
    }
  }
  return worst;
};

test('the old 12 straight pieces show corners on a bent curve; the smooth cut does not', () => {
  const mark = curvedMark();
  const spans = polySplineSpans(mark);
  assert.equal(spans.length, 2);
  const oldGap = worstGap(spans, mark.points);
  assert.ok(oldGap > 1, `the stored 12 samples miss the curve by ${oldGap.toFixed(2)} pt (visible corners)`);
  const smooth = smoothPolylinePoints(mark);
  const newGap = worstGap(spans, smooth);
  assert.ok(newGap <= SPLINE_FLAT_TOLERANCE + 1e-6, `smooth cut misses by ${newGap}`);
  // Every clicked corner is kept.
  for (const c of [spans[0].from, spans[0].to, spans[1].to]) {
    assert.ok(smooth.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 1e-9));
  }
  // Cached per points array.
  assert.equal(smoothPolylinePoints(mark), smooth);
});

test('a plain polyline keeps its own points everywhere', () => {
  const plain = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] };
  assert.equal(smoothPolylinePoints(plain), plain.points);
  assert.deepEqual(polySplineSpans(plain), []);
});

test('the path is one cubic per span and goes through the stored samples', () => {
  const points = sampleSpline(corners, SPLINE_STEP);
  const d = splinePathD(points, SPLINE_STEP);
  assert.equal((d.match(/C/g) || []).length, 2);
  const spans = splineSpans(points, SPLINE_STEP);
  for (let k = 0; k <= SPLINE_STEP; k += 1) {
    const p = cubicAt(spans[0], k / SPLINE_STEP);
    const q = points[k];
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6, `sample ${k}`);
  }
});

test('ends are trimmed along the curve by the inset length', () => {
  const points = bentPoints();
  const d = splinePathD(points, SPLINE_STEP, 10, 6);
  const [mx, my] = d.slice(2).split(' ').map(Number);
  const smooth = smoothPolylinePoints(curvedMark(points));
  const trimmed = trimPointsByLength(smooth, 10, 6);
  // Path start and the trimmed fine cut agree (screen = print).
  assert.ok(Math.hypot(mx - trimmed[0].x, my - trimmed[0].y) < 0.05, `${mx},${my} vs ${trimmed[0].x},${trimmed[0].y}`);
  // And it sits about 10 along the curve from the first corner.
  assert.ok(Math.hypot(trimmed[0].x - smooth[0].x, trimmed[0].y - smooth[0].y) <= 10 + 1e-6);
  assert.ok(Math.hypot(trimmed[0].x - smooth[0].x, trimmed[0].y - smooth[0].y) > 9);
});

test('trimPointsByLength walks past short pieces and never cuts the whole line', () => {
  const pts = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
  const out = trimPointsByLength(pts, 2.5, 3);
  assert.deepEqual(out[0], { x: 2.5, y: 0 });
  assert.deepEqual(out[out.length - 1], { x: 7, y: 0 });
  const tiny = trimPointsByLength([{ x: 0, y: 0 }, { x: 1, y: 0 }], 5, 0);
  assert.equal(tiny.length, 2);
  assert.ok(tiny[0].x < tiny[1].x);
});

test('the screen draws a curved polyline as a cubic path, a plain one as a polyline', () => {
  const curved = renderPolyline(curvedMark(), 0);
  assert.equal(curved.type, 'path');
  assert.match(curved.props.d, /^M [-\d.]+ [-\d.]+ C /);
  assert.equal(curved.props['data-shape-kind'], 'polyline');
  const plain = renderPolyline({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, 1);
  assert.equal(plain.type, 'polyline');
  // With a line ending, the body is still the cubic path, trimmed.
  const ended = renderPolyline(curvedMark(undefined, { lineEnding2: 'OpenArrow', lineEnding1: 'Circle' }), 2);
  const kids = React.Children.toArray(ended.props.children);
  const body = kids.find((k) => k?.props?.['data-shape-kind'] === 'polyline');
  assert.equal(body.type, 'path');
});

test('the canvas painter draws the curve with bezierCurveTo', () => {
  const calls = [];
  const context = {
    save: () => {}, restore: () => {}, translate: () => {}, scale: () => {}, rotate: () => {},
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    bezierCurveTo: () => calls.push('bezierCurveTo'),
    closePath: () => {}, setLineDash: () => {}, stroke: () => calls.push('stroke'), fill: () => {},
  };
  drawAnnotationObject(context, curvedMark());
  assert.equal(calls.filter((c) => c === 'bezierCurveTo').length, 2);
  assert.equal(calls.filter((c) => c === 'lineTo').length, 0);
});

test('PDF export and XFDF carry the smooth curve, not the 12 straight pieces', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 600]);
  const bytes = await pdf.save();
  const file = { name: 'curve.pdf', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), size: bytes.length, type: 'application/pdf' };
  const mark = curvedMark(undefined, { left: 100, top: 100 });
  const model = { 1: { objects: [mark] } };
  const sizes = { 1: { width: 600, height: 600 } };
  const out = await savePDFWithAnnotationsPdfLib(file, model, sizes, null, { returnBytes: true });

  const task = pdfjsLib.getDocument({ data: new Uint8Array(out), disableWorker: true, verbosity: 0 });
  const doc = await task.promise;
  const annots = (await (await doc.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'PolyLine');
  await task.destroy();
  assert.equal(annots.length, 1);
  const raw = Array.from(annots[0].vertices, (v) => (typeof v === 'object' ? [v.x, v.y] : v)).flat();
  const vertices = [];
  for (let i = 0; i < raw.length; i += 2) vertices.push({ x: raw[i] - 100, y: 600 - raw[i + 1] - 100 });
  assert.ok(vertices.length > mark.points.length, `${vertices.length} vertices`);
  const gap = worstGap(polySplineSpans(mark), vertices);
  assert.ok(gap < 0.02, `PDF vertices miss the curve by ${gap}`);

  const { xfdf } = await exportAnnotationsAsXfdf(file, model, sizes, {});
  const xv = /<vertices>([^<]+)<\/vertices>/.exec(xfdf)?.[1].split(/[,;\s]+/).filter(Boolean).map(Number);
  assert.ok(xv && xv.length === vertices.length * 2, 'XFDF has the same fine vertices');
});
