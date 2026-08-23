import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import {
  rotateDisplayedPoint,
  rotatePageSpaceInk,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for live-created pen/highlighter page-space ink after
// page CW. Distinct from remapped-page callout fractions, remapped
// mt/mtr/br clip, leftover-18 / X-01, and page-rotate-transformed (rect).
// Live proof: debug/scenarios/e2e-page-rotate-ink-remap.spec.mjs

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

function liveInk(id, tool = 'pen') {
  return createProductionPaperInk({
    id,
    tool,
    points: [
      { x: 180, y: 240 },
      { x: 260, y: 320 },
      { x: 300, y: 280 },
    ],
    color: tool === 'highlighter' ? '#ffff00' : '#111111',
    width: tool === 'highlighter' ? 8 : 4,
    data: { id, tool },
  });
}

test('rotate remaps live page-space ink path + centerline; empty invents 0; opposite restores', () => {
  const ink = liveInk('ink-xf', 'pen');
  assert.equal(ink.left, 0);
  assert.equal(ink.top, 0);
  assert.equal(ink.angle, 0);
  const first = ink.paperCenterline[0];
  const expected = rotateDisplayedPoint(first.x, first.y, 612, 792, 90);

  const cw = rotateModel(emptyModel([ink]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  assert.equal(after.data.id, 'ink-xf');
  assert.equal(after.left, 0);
  assert.equal(after.top, 0);
  assert.equal(after.angle, 0);
  assert.ok(Math.abs(after.paperCenterline[0].x - expected.x) < 1e-6);
  assert.ok(Math.abs(after.paperCenterline[0].y - expected.y) < 1e-6);
  assert.ok(Math.abs(after.paperCenterline[0].x - first.x) > 1, 'must not stay on the pre-rotate point');
  const path0 = after.path[0];
  const expectedPath = rotateDisplayedPoint(ink.path[0][1], ink.path[0][2], 612, 792, 90);
  assert.ok(Math.abs(path0[1] - expectedPath.x) < 1e-6);
  assert.ok(Math.abs(path0[2] - expectedPath.y) < 1e-6);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const empty = rotateModel(emptyModel([]), 90, 612, 792);
  assert.equal(empty.annotationsByPage[1].objects.length, 0);

  const restored = rotateModel(cw, -90, 792, 612);
  const back = restored.annotationsByPage[1].objects[0];
  assert.ok(Math.abs(back.paperCenterline[0].x - first.x) < 1e-6);
  assert.ok(Math.abs(back.paperCenterline[0].y - first.y) < 1e-6);
  assert.equal(back.angle, 0);
  assert.equal(restored.annotationsByPage[1].width, 612);
});

test('highlighter uses the same page-space ink remap', () => {
  const ink = liveInk('hi-xf', 'highlighter');
  const cw = rotateModel(emptyModel([ink]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(ink.paperCenterline[0].x, ink.paperCenterline[0].y, 612, 792, 90);
  assert.equal(after.tool, 'highlighter');
  assert.equal(after.angle, 0);
  assert.ok(Math.abs(after.paperCenterline[0].x - expected.x) < 1e-6);
  assert.ok(Math.abs(after.paperCenterline[0].y - expected.y) < 1e-6);
});

test('rotatePageSpaceInk is invertible and does not invent a missing stroke', () => {
  const ink = liveInk('bare-ink');
  const once = rotatePageSpaceInk(ink, 612, 792, 90);
  const back = rotatePageSpaceInk(once, 792, 612, -90);
  assert.ok(Math.abs(back.paperCenterline[0].x - ink.paperCenterline[0].x) < 1e-6);
  assert.ok(Math.abs(back.paperCenterline[0].y - ink.paperCenterline[0].y) < 1e-6);
  assert.equal(rotatePageSpaceInk(null, 612, 792, 90), null);
  assert.deepEqual(rotatePageSpaceInk({ id: 'bare' }, 612, 792, 90), { id: 'bare' });
});

test('line remapper still does not invent endpoint remap; ink is the page-space path', () => {
  const line = {
    type: 'line',
    left: 122.4,
    top: 205.9,
    width: 122.4,
    height: 142.6,
    x1: -61.2,
    y1: -71.3,
    x2: 61.2,
    y2: 71.3,
    angle: 0,
    data: { id: 'xf-line', type: 'line', tool: 'line', pageNumber: 1 },
  };
  const cw = rotateModel(emptyModel([line]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  assert.equal(after.x1, -61.2);
  assert.equal(after.y1, -71.3);
  assert.equal(after.angle, 90);
});

test('reindex remaps page-space ink path; no file.id stamp', () => {
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const ink = read('src/utils/productionPaperInk.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(reindex, /export function rotatePageSpaceInk/);
  assert.match(reindex, /isPageSpaceInk/);
  assert.match(reindex, /paperCenterline/);
  assert.match(reindex, /do not invent an object angle/);
  assert.match(ink, /left: 0/);
  assert.match(ink, /paperCenterline: centerline/);
  assert.match(layer, /pathOffset/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create then page CW ink remap, empty invent, restore, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-ink-remap.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty page rotate must invent 0/);
  assert.match(spec, /page rotate must keep the live ink/);
  assert.match(spec, /remapped ink centerline must follow displayed-space \+90/);
  assert.match(spec, /must not stay on the pre-rotate point/);
  assert.match(spec, /opposite page rotate must restore ink centerline/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 remapped-ink edge/);
  assert.match(spec, /390 Pages rotate is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
