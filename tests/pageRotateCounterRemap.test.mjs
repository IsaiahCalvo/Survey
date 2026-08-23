import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  rotatePageSpaceCounter,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for live-created counter pins after page CW.
// Distinct from remapped-page ink / callout / mt/mtr/br clip,
// leftover-18 / X-01, Counter Start / series Delete / nubbin pointercancel.
// Live proof: debug/scenarios/e2e-page-rotate-counter-remap.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function emptyModel(objects = []) {
  return {
    annotationsByPage: { 1: { width: 612, height: 792, objects } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

function rotateModel(model, delta, pageWidth, pageHeight) {
  return transformPageState(model, {
    type: 'rotate',
    page: 1,
    delta,
    pageWidth,
    pageHeight,
  });
}

function liveCounter(id, {
  left = 180,
  top = 240,
  radius = 14,
  pointerAngle = 225,
  seriesId = 'series-xf',
  displayNumber = 1,
} = {}) {
  return {
    type: 'circle',
    left,
    top,
    radius,
    fill: '#ef4444',
    stroke: '#ffffff',
    data: {
      id,
      type: 'counter',
      pointerAngle,
      displayNumber,
      seriesId,
      seriesStart: 1,
    },
  };
}

test('rotate remaps live counter visual center + pointerAngle; empty invents 0; opposite restores', () => {
  const pin = liveCounter('ctr-xf');
  assert.equal(pin.width, undefined);
  assert.equal(pin.height, undefined);
  const cx = pin.left + pin.radius;
  const cy = pin.top + pin.radius;
  const expected = rotateDisplayedPoint(cx, cy, 612, 792, 90);
  const wrongAsCenter = rotateDisplayedPoint(pin.left, pin.top, 612, 792, 90);

  const cw = rotateModel(emptyModel([pin]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  assert.equal(after.data.id, 'ctr-xf');
  assert.equal(after.data.seriesId, 'series-xf');
  assert.equal(after.radius, 14);
  assert.equal('angle' in after, false);
  assert.ok(Math.abs((after.left + after.radius) - expected.x) < 1e-6);
  assert.ok(Math.abs((after.top + after.radius) - expected.y) < 1e-6);
  assert.ok(Math.abs((after.left + after.radius) - wrongAsCenter.x) > 1, 'must not treat left/top as center');
  assert.equal(after.data.pointerAngle, 315);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const empty = rotateModel(emptyModel([]), 90, 612, 792);
  assert.equal(empty.annotationsByPage[1].objects.length, 0);

  const restored = rotateModel(cw, -90, 792, 612);
  const back = restored.annotationsByPage[1].objects[0];
  assert.ok(Math.abs(back.left - pin.left) < 1e-6);
  assert.ok(Math.abs(back.top - pin.top) < 1e-6);
  assert.equal(back.data.pointerAngle, 225);
  assert.equal(back.data.seriesId, 'series-xf');
  assert.equal(restored.annotationsByPage[1].width, 612);
});

test('second pin keeps the series id through page CW', () => {
  const first = liveCounter('ctr-a', { displayNumber: 1, left: 120, top: 200 });
  const second = liveCounter('ctr-b', { displayNumber: 2, left: 260, top: 320 });
  const cw = rotateModel(emptyModel([first, second]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects;
  assert.equal(after.length, 2);
  assert.equal(after[0].data.seriesId, 'series-xf');
  assert.equal(after[1].data.seriesId, 'series-xf');
  assert.equal(after[0].data.id, 'ctr-a');
  assert.equal(after[1].data.id, 'ctr-b');
  assert.equal(after[1].data.pointerAngle, 315);
});

test('rotatePageSpaceCounter is invertible and does not invent a missing pin', () => {
  const pin = liveCounter('bare-ctr');
  const once = rotatePageSpaceCounter(pin, 612, 792, 90);
  const back = rotatePageSpaceCounter(once, 792, 612, -90);
  assert.ok(Math.abs(back.left - pin.left) < 1e-6);
  assert.ok(Math.abs(back.top - pin.top) < 1e-6);
  assert.equal(back.data.pointerAngle, 225);
  assert.equal(rotatePageSpaceCounter(null, 612, 792, 90), null);
  assert.deepEqual(rotatePageSpaceCounter({ id: 'bare' }, 612, 792, 90), { id: 'bare' });
});

test('missing pointerAngle uses the live 225 default then remaps', () => {
  const pin = liveCounter('ctr-default');
  delete pin.data.pointerAngle;
  const once = rotatePageSpaceCounter(pin, 612, 792, 90);
  assert.equal(once.data.pointerAngle, 315);
});

test('rect remapper still uses width/height; counter is the radius path', () => {
  const rect = {
    type: 'rect',
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    angle: 0,
    data: { id: 'xf-rect', type: 'rect', pageNumber: 1 },
  };
  const cw = rotateModel(emptyModel([rect]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(122.4 + 135.4 / 2, 205.9 + 152.2 / 2, 612, 792, 90);
  assert.ok(Math.abs((after.left + 135.4 / 2) - expected.x) < 1e-6);
  assert.equal(after.angle, 90);
});

test('reindex remaps counter visual center + pointerAngle; no file.id stamp', () => {
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const viewer = read('src/PDFViewer.jsx');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(reindex, /export function rotatePageSpaceCounter/);
  assert.match(reindex, /isCounterPin/);
  assert.match(reindex, /pointerAngle/);
  assert.match(reindex, /Do not invent an object angle/);
  assert.match(viewer, /left: x - COUNTER_RADIUS/);
  assert.match(viewer, /pointerAngle: initialAngle/);
  assert.match(layer, /const cx = \(renderObj\.left \|\| 0\) \+ r/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create then page CW counter remap, empty invent, restore, series, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-counter-remap.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty page rotate must invent 0/);
  assert.match(spec, /page rotate must keep the live counter/);
  assert.match(spec, /remapped counter center must follow displayed-space \+90/);
  assert.match(spec, /must not treat left\/top as center/);
  assert.match(spec, /nubbin pointerAngle must remap \+90/);
  assert.match(spec, /second pin must keep the series id/);
  assert.match(spec, /opposite page rotate must restore counter/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 remapped-counter edge/);
  assert.match(spec, /390 Pages rotate is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /dispatchEvent\('pointercancel'/);
  assert.doesNotMatch(spec, /startLocked|CounterStartNumberField|deleteSeries/);
});
