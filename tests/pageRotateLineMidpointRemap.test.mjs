import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for live-created line/arrow data.midpoint after page CW.
// Distinct from remapped-page survey-marker / counter / ink / callout /
// mt/mtr/br clip, leftover-18 / X-01, and straight-line bbox+angle
// (endpoints stay local). Live proof:
// debug/scenarios/e2e-page-rotate-line-midpoint-remap.spec.mjs

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

function liveLine(id, {
  left = 122.4,
  top = 205.9,
  width = 122.4,
  height = 142.6,
  x1 = -61.2,
  y1 = -71.3,
  x2 = 61.2,
  y2 = 71.3,
  angle = 0,
  midpoint = { x: 183.6, y: 220.2 },
  tool = 'line',
} = {}) {
  return {
    type: 'line',
    left,
    top,
    width,
    height,
    x1,
    y1,
    x2,
    y2,
    angle,
    tool,
    data: { id, type: 'line', tool, pageNumber: 1, midpoint },
  };
}

function visualPoint(x, y, cx, cy, angle) {
  const rad = (Number(angle) || 0) * Math.PI / 180;
  const dx = Number(x) - cx;
  const dy = Number(y) - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function lineCenters(obj) {
  const cx = Number(obj.left) + Number(obj.width) / 2;
  const cy = Number(obj.top) + Number(obj.height) / 2;
  return { cx, cy };
}

test('rotate remaps live line midpoint via bbox translate; empty invents 0; opposite restores', () => {
  const line = liveLine('ln-xf');
  const { cx, cy } = lineCenters(line);
  const visualBefore = visualPoint(line.data.midpoint.x, line.data.midpoint.y, cx, cy, line.angle);
  const expectedVisual = rotateDisplayedPoint(visualBefore.x, visualBefore.y, 612, 792, 90);
  const staleStored = line.data.midpoint;

  const cw = rotateModel(emptyModel([line]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  assert.equal(after.data.id, 'ln-xf');
  assert.equal(after.x1, -61.2, 'endpoints stay local');
  assert.equal(after.y1, -71.3);
  assert.equal(after.x2, 61.2);
  assert.equal(after.y2, 71.3);
  assert.equal(after.angle, 90);
  assert.ok(after.data.midpoint, 'must keep the curved midpoint');
  assert.ok(Math.abs(after.data.midpoint.x - staleStored.x) > 1, 'must not leave midpoint in pre-rotate space');
  const afterCenter = lineCenters(after);
  const visualAfter = visualPoint(
    after.data.midpoint.x,
    after.data.midpoint.y,
    afterCenter.cx,
    afterCenter.cy,
    after.angle,
  );
  assert.ok(Math.abs(visualAfter.x - expectedVisual.x) < 1e-6);
  assert.ok(Math.abs(visualAfter.y - expectedVisual.y) < 1e-6);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const empty = rotateModel(emptyModel([]), 90, 612, 792);
  assert.equal(empty.annotationsByPage[1].objects.length, 0);

  const restored = rotateModel(cw, -90, 792, 612);
  const back = restored.annotationsByPage[1].objects[0];
  assert.ok(Math.abs(back.data.midpoint.x - staleStored.x) < 1e-6);
  assert.ok(Math.abs(back.data.midpoint.y - staleStored.y) < 1e-6);
  assert.equal(back.angle, 0);
  assert.equal(restored.annotationsByPage[1].width, 612);
  assert.equal(restored.annotationsByPage[1].height, 792);
});

test('arrow uses the same midpoint remap; straight line does not invent a midpoint', () => {
  const arrow = liveLine('ar-xf', { tool: 'arrow', midpoint: { x: 200, y: 240 } });
  const cw = rotateModel(emptyModel([arrow]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  assert.equal(after.tool, 'arrow');
  assert.equal(after.x1, -61.2);
  assert.ok(after.data.midpoint);
  assert.ok(Math.abs(after.data.midpoint.x - 200) > 1);

  const straight = liveLine('st-xf', { midpoint: undefined });
  delete straight.data.midpoint;
  const straightCw = rotateModel(emptyModel([straight]), 90, 612, 792);
  const straightAfter = straightCw.annotationsByPage[1].objects[0];
  assert.equal(straightAfter.angle, 90);
  assert.equal(straightAfter.data.midpoint, undefined, 'must not invent a midpoint');
});

test('reindex remaps line midpoint with bbox; no file.id stamp', () => {
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const helpers = read('src/utils/lineRenderHelpers.js');
  const drag = read('src/utils/lineDragMath.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(reindex, /data\.midpoint/);
  assert.match(reindex, /Do not independently/);
  assert.match(reindex, /rotateDisplayedPoint the midpoint/);
  assert.match(helpers, /obj\.data\?\.midpoint/);
  assert.match(drag, /absolute midpoint in page coords/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create then page CW midpoint remap, empty invent, restore, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-line-midpoint-remap.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty page rotate must invent 0/);
  assert.match(spec, /page rotate must keep the live curved line/);
  assert.match(spec, /remapped line midpoint must follow displayed-space \+90/);
  assert.match(spec, /must not leave midpoint in pre-rotate space/);
  assert.match(spec, /endpoints stay local/);
  assert.match(spec, /opposite page rotate must restore line midpoint/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 remapped-line-midpoint edge/);
  assert.match(spec, /390 Pages rotate is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /rotatePageSpaceCounter|rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
});
