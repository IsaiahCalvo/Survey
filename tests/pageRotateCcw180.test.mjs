import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import {
  normalizeRotationDelta,
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  rotateNormalizedBox,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for CCW (-90 / 270) and 180 page rotate.
// Existing remapper proofs are clockwise-only. 180 is two live CWs
// (no dedicated 180 menu item). Live proof:
// debug/scenarios/e2e-page-rotate-ccw-180.spec.mjs
// Distinct from leftover-18 / X-01 / CW catalog (not replayed).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const PAGE_W = 612;
const PAGE_H = 792;

function emptyModel(objects = []) {
  return {
    annotationsByPage: { 1: { width: PAGE_W, height: PAGE_H, objects } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

function rotateModel(model, delta, pageWidth = PAGE_W, pageHeight = PAGE_H) {
  return transformPageState(model, {
    type: 'rotate',
    page: 1,
    delta,
    pageWidth,
    pageHeight,
  });
}

function liveRect() {
  return {
    type: 'rect',
    id: 'r1',
    left: 122.4,
    top: 205.92,
    width: 122.4,
    height: 142.56,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'r1', type: 'rect', tool: 'rect', pageNumber: 1 },
  };
}

function liveInk() {
  return createProductionPaperInk({
    id: 'ink1',
    tool: 'pen',
    points: [
      { x: 134.64, y: 237.6 },
      { x: 244.64, y: 332.6 },
    ],
    color: '#111111',
    width: 4,
    data: { id: 'ink1', tool: 'pen' },
  });
}

function liveCallout() {
  return calloutToAnnotationObject({
    id: 'callout-c1',
    pageNumber: 1,
    arrowTip: { x: 0.16, y: 0.22 },
    knee: { x: 0.22, y: 0.28 },
    textBoxPosition: { x: 0.16, y: 0.22 },
    textBoxWidth: 120 / PAGE_W,
    textBoxHeight: 32 / PAGE_H,
    text: 'A',
    style: { fontFamily: 'Helvetica', lineStyle: 'solid' },
  }, { width: PAGE_W, height: PAGE_H });
}

function liveCounter() {
  return {
    type: 'circle',
    id: 'n1',
    left: 171.36,
    top: 411.84,
    radius: 14,
    data: {
      id: 'n1',
      type: 'counter',
      pointerAngle: 225,
    },
  };
}

function liveLine() {
  return {
    type: 'line',
    id: 'l1',
    left: 110.16,
    top: 174.24,
    width: 146.88,
    height: 126.72,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    x1: -73.44,
    y1: -63.36,
    x2: 73.44,
    y2: 63.36,
    data: { id: 'l1', type: 'line', tool: 'line', pageNumber: 1 },
  };
}

test('normalizeRotationDelta maps CCW -90 to 270 and 180 stays 180', () => {
  assert.equal(normalizeRotationDelta(-90), 270);
  assert.equal(normalizeRotationDelta(270), 270);
  assert.equal(normalizeRotationDelta(180), 180);
  assert.equal(normalizeRotationDelta(-180), 180);
  assert.equal(normalizeRotationDelta(90), 90);
});

test('rotateDisplayedPageSize: CCW/270 swaps; 180 keeps portrait', () => {
  assert.deepEqual(rotateDisplayedPageSize(PAGE_W, PAGE_H, -90), { width: PAGE_H, height: PAGE_W });
  assert.deepEqual(rotateDisplayedPageSize(PAGE_W, PAGE_H, 270), { width: PAGE_H, height: PAGE_W });
  assert.deepEqual(rotateDisplayedPageSize(PAGE_W, PAGE_H, 180), { width: PAGE_W, height: PAGE_H });
});

test('rotateDisplayedPoint: CCW 270 and 180 are not identity or CW', () => {
  const cw = rotateDisplayedPoint(200, 300, PAGE_W, PAGE_H, 90);
  const ccw = rotateDisplayedPoint(200, 300, PAGE_W, PAGE_H, -90);
  const half = rotateDisplayedPoint(200, 300, PAGE_W, PAGE_H, 180);

  assert.deepEqual(cw, { x: PAGE_H - 300, y: 200 });
  assert.deepEqual(ccw, { x: 300, y: PAGE_W - 200 });
  assert.deepEqual(half, { x: PAGE_W - 200, y: PAGE_H - 300 });
  assert.notDeepEqual(ccw, cw);
  assert.notDeepEqual(ccw, { x: 200, y: 300 });
  assert.notDeepEqual(half, { x: 200, y: 300 });
  assert.notDeepEqual(half, cw);
});

test('double CW 90+90 equals one 180 on displayed points', () => {
  const afterFirst = rotateDisplayedPoint(180, 240, PAGE_W, PAGE_H, 90);
  const afterSecond = rotateDisplayedPoint(afterFirst.x, afterFirst.y, PAGE_H, PAGE_W, 90);
  const half = rotateDisplayedPoint(180, 240, PAGE_W, PAGE_H, 180);
  assert.deepEqual(afterSecond, half);
});

test('transformPageState CCW remaps rect/ink/callout/counter/line (not leftover portrait)', () => {
  const before = emptyModel([liveRect(), liveInk(), liveCallout(), liveCounter(), liveLine()]);
  const after = rotateModel(before, -90);
  assert.equal(after.annotationsByPage[1].width, PAGE_H);
  assert.equal(after.annotationsByPage[1].height, PAGE_W);

  const rect = after.annotationsByPage[1].objects.find((o) => o.id === 'r1' || o.data?.id === 'r1');
  const ink = after.annotationsByPage[1].objects.find((o) => o.data?.id === 'ink1');
  const callout = after.annotationsByPage[1].objects.find((o) => o.data?.type === 'callout');
  const counter = after.annotationsByPage[1].objects.find((o) => o.data?.id === 'n1');
  const line = after.annotationsByPage[1].objects.find((o) => o.id === 'l1' || o.data?.id === 'l1');
  assert.ok(rect && ink && callout && counter && line);

  const rectCenter = rotateDisplayedPoint(122.4 + 61.2, 205.92 + 71.28, PAGE_W, PAGE_H, -90);
  assert.ok(Math.abs((rect.left + 61.2) - rectCenter.x) < 1e-6);
  assert.ok(Math.abs((rect.top + 71.28) - rectCenter.y) < 1e-6);
  assert.equal(rect.width, 122.4);
  assert.equal(rect.height, 142.56);
  assert.equal(rect.angle, -90);
  assert.notEqual(rect.left, 122.4);

  assert.equal(ink.left, 0);
  assert.equal(ink.angle, 0);
  const ink0 = ink.paperCenterline[0];
  const wantInk = rotateDisplayedPoint(134.64, 237.6, PAGE_W, PAGE_H, -90);
  assert.ok(Math.abs(ink0.x - wantInk.x) < 1e-6);
  assert.ok(Math.abs(ink0.y - wantInk.y) < 1e-6);
  assert.notEqual(ink0.x, 134.64);

  const wantBox = rotateNormalizedBox({ x: 0.16, y: 0.22 }, 120 / PAGE_W, 32 / PAGE_H, PAGE_W, PAGE_H, -90);
  const box = callout.data.legacyCallout.textBoxPosition;
  assert.ok(Math.abs(box.x - wantBox.x) < 1e-6);
  assert.ok(Math.abs(box.y - wantBox.y) < 1e-6);
  assert.notEqual(box.x, 0.16);

  const wantCounter = rotateDisplayedPoint(171.36 + 14, 411.84 + 14, PAGE_W, PAGE_H, -90);
  assert.ok(Math.abs((counter.left + 14) - wantCounter.x) < 1e-6);
  assert.ok(Math.abs((counter.top + 14) - wantCounter.y) < 1e-6);
  assert.equal(counter.data.pointerAngle, 135);

  const lineCx = 110.16 + 146.88 / 2;
  const lineCy = 174.24 + 126.72 / 2;
  const wantLine = rotateDisplayedPoint(lineCx, lineCy, PAGE_W, PAGE_H, -90);
  assert.ok(Math.abs((line.left + 146.88 / 2) - wantLine.x) < 1e-6);
  assert.ok(Math.abs((line.top + 126.72 / 2) - wantLine.y) < 1e-6);
  assert.notEqual(line.left, 110.16);
});

test('transformPageState 180 remaps objects but keeps page size portrait', () => {
  const before = emptyModel([liveRect(), liveInk(), liveCallout(), liveCounter(), liveLine()]);
  const after = rotateModel(before, 180);
  assert.equal(after.annotationsByPage[1].width, PAGE_W);
  assert.equal(after.annotationsByPage[1].height, PAGE_H);

  const rect = after.annotationsByPage[1].objects.find((o) => o.id === 'r1' || o.data?.id === 'r1');
  const ink = after.annotationsByPage[1].objects.find((o) => o.data?.id === 'ink1');
  const callout = after.annotationsByPage[1].objects.find((o) => o.data?.type === 'callout');
  const counter = after.annotationsByPage[1].objects.find((o) => o.data?.id === 'n1');
  const line = after.annotationsByPage[1].objects.find((o) => o.id === 'l1' || o.data?.id === 'l1');

  const rectCenter = rotateDisplayedPoint(122.4 + 61.2, 205.92 + 71.28, PAGE_W, PAGE_H, 180);
  assert.ok(Math.abs((rect.left + 61.2) - rectCenter.x) < 1e-6);
  assert.ok(Math.abs((rect.top + 71.28) - rectCenter.y) < 1e-6);
  assert.equal(rect.width, 122.4);
  assert.equal(rect.height, 142.56);
  assert.equal(rect.angle, 180);
  assert.notEqual(rect.left, 122.4);

  const ink0 = ink.paperCenterline[0];
  const wantInk = rotateDisplayedPoint(134.64, 237.6, PAGE_W, PAGE_H, 180);
  assert.ok(Math.abs(ink0.x - wantInk.x) < 1e-6);
  assert.ok(Math.abs(ink0.y - wantInk.y) < 1e-6);
  assert.notEqual(ink0.x, 134.64);
  assert.equal(ink.left, 0);

  const wantBox = rotateNormalizedBox({ x: 0.16, y: 0.22 }, 120 / PAGE_W, 32 / PAGE_H, PAGE_W, PAGE_H, 180);
  const box = callout.data.legacyCallout.textBoxPosition;
  assert.ok(Math.abs(box.x - wantBox.x) < 1e-6);
  assert.ok(Math.abs(box.y - wantBox.y) < 1e-6);
  assert.notEqual(box.x, 0.16);

  const wantCounter = rotateDisplayedPoint(171.36 + 14, 411.84 + 14, PAGE_W, PAGE_H, 180);
  assert.ok(Math.abs((counter.left + 14) - wantCounter.x) < 1e-6);
  assert.equal(counter.data.pointerAngle, 45);

  const lineCx = 110.16 + 146.88 / 2;
  const lineCy = 174.24 + 126.72 / 2;
  const wantLine = rotateDisplayedPoint(lineCx, lineCy, PAGE_W, PAGE_H, 180);
  assert.ok(Math.abs((line.left + 146.88 / 2) - wantLine.x) < 1e-6);
  assert.notEqual(line.left, 110.16);
});

test('transformPageState two sequential CWs equals one 180 for rect/line/counter', () => {
  const before = emptyModel([liveRect(), liveCounter(), liveLine()]);
  const afterCw1 = rotateModel(before, 90, PAGE_W, PAGE_H);
  const afterCw2 = rotateModel(afterCw1, 90, PAGE_H, PAGE_W);
  const after180 = rotateModel(before, 180, PAGE_W, PAGE_H);

  const r2 = afterCw2.annotationsByPage[1].objects.find((o) => o.data?.id === 'r1');
  const r180 = after180.annotationsByPage[1].objects.find((o) => o.data?.id === 'r1');
  assert.ok(Math.abs(r2.left - r180.left) < 1e-6);
  assert.ok(Math.abs(r2.top - r180.top) < 1e-6);
  assert.equal(r2.width, r180.width);
  assert.equal(r2.height, r180.height);
  assert.equal(((r2.angle % 360) + 360) % 360, ((r180.angle % 360) + 360) % 360);
  assert.equal(afterCw2.annotationsByPage[1].width, PAGE_W);
  assert.equal(afterCw2.annotationsByPage[1].height, PAGE_H);

  const n2 = afterCw2.annotationsByPage[1].objects.find((o) => o.data?.id === 'n1');
  const n180 = after180.annotationsByPage[1].objects.find((o) => o.data?.id === 'n1');
  assert.equal(((n2.data.pointerAngle % 360) + 360) % 360, ((n180.data.pointerAngle % 360) + 360) % 360);

  const l2 = afterCw2.annotationsByPage[1].objects.find((o) => o.data?.id === 'l1');
  const l180 = after180.annotationsByPage[1].objects.find((o) => o.data?.id === 'l1');
  assert.ok(Math.abs(l2.left - l180.left) < 1e-6);
  assert.ok(Math.abs(l2.top - l180.top) < 1e-6);
});

test('empty annotation stack stays empty after CCW and 180', () => {
  const emptyCcw = rotateModel(emptyModel([]), -90);
  const empty180 = rotateModel(emptyModel([]), 180);
  assert.equal(emptyCcw.annotationsByPage[1].objects.length, 0);
  assert.equal(empty180.annotationsByPage[1].objects.length, 0);
  assert.equal(emptyCcw.annotationsByPage[1].width, PAGE_H);
  assert.equal(empty180.annotationsByPage[1].width, PAGE_W);
});

test('page-ops UI still exposes only CW (+90) and CCW (-90); 180 is two CWs', () => {
  const src = read('src/hooks/usePageOperations.js');
  assert.match(src, /delta:\s*90/);
  assert.match(src, /delta:\s*-90/);
  assert.doesNotMatch(src, /delta:\s*180/);
});

test('live spec covers CCW + 180 remap, persist, empty, cancel, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-ccw-180.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Rotate counter-clockwise/);
  assert.match(spec, /two CWs/);
  assert.match(spec, /empty CCW/);
  assert.match(spec, /empty two-CW/);
  assert.match(spec, /cancel rotate/);
  assert.match(spec, /wipe\+reload invents 0/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /dest-XYZ|captcha|stamps|Group|Extract|Note\/Link/);
});
