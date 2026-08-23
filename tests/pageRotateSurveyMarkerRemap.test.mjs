import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  rotateSurveyMarkerBounds,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for live-placed survey-marker bounds after page CW.
// Distinct from remapped-page counter / ink / callout / mt/mtr/br clip,
// leftover-18 / X-01. Does not invent checklist seed items.
// Live proof: debug/scenarios/e2e-page-rotate-survey-marker-remap.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function emptyModel(markers = {}) {
  return {
    annotationsByPage: { 1: { width: 612, height: 792, objects: [] } },
    surveyMarkers: markers,
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

function liveMarker(id, {
  x = 134.64,
  y = 237.60,
  width = 146.88,
  height = 142.56,
  angle = 0,
  name = 'walls-a',
} = {}) {
  return {
    annotationId: id,
    pageNumber: 1,
    bounds: { x, y, width, height, angle },
    categoryId: 'kal436-category',
    moduleId: 'kal436-module',
    name,
    color: '#d8a84e',
  };
}

test('rotate remaps live survey-marker bounds center + angle; empty invents 0; opposite restores', () => {
  const marker = liveMarker('sm-xf');
  const cx = marker.bounds.x + marker.bounds.width / 2;
  const cy = marker.bounds.y + marker.bounds.height / 2;
  const expected = rotateDisplayedPoint(cx, cy, 612, 792, 90);
  const stale = { x: marker.bounds.x, y: marker.bounds.y };

  const cw = rotateModel(emptyModel({ 'sm-xf': marker }), 90, 612, 792);
  const after = cw.surveyMarkers['sm-xf'];
  assert.equal(after.annotationId, 'sm-xf');
  assert.equal(after.pageNumber, 1);
  assert.equal(after.categoryId, 'kal436-category');
  assert.equal(after.name, 'walls-a');
  assert.equal(after.bounds.width, 146.88);
  assert.equal(after.bounds.height, 142.56);
  assert.equal(after.bounds.angle, 90);
  assert.equal('left' in after, false);
  assert.equal('top' in after, false);
  assert.ok(Math.abs((after.bounds.x + after.bounds.width / 2) - expected.x) < 1e-6);
  assert.ok(Math.abs((after.bounds.y + after.bounds.height / 2) - expected.y) < 1e-6);
  assert.ok(Math.abs(after.bounds.x - stale.x) > 1, 'must not leave bounds in pre-rotate space');
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const empty = rotateModel(emptyModel({}), 90, 612, 792);
  assert.deepEqual(empty.surveyMarkers, {});

  const restored = rotateModel(cw, -90, 792, 612);
  const back = restored.surveyMarkers['sm-xf'];
  assert.ok(Math.abs(back.bounds.x - marker.bounds.x) < 1e-6);
  assert.ok(Math.abs(back.bounds.y - marker.bounds.y) < 1e-6);
  assert.equal(back.bounds.angle, 0);
  assert.equal(back.name, 'walls-a');
  assert.equal(restored.annotationsByPage[1].width, 612);
});

test('second survey-marker keeps its id and remaps independently', () => {
  const first = liveMarker('sm-a', { name: 'walls-a', x: 120, y: 200 });
  const second = liveMarker('sm-b', { name: 'walls-b', x: 260, y: 320 });
  const cw = rotateModel(emptyModel({ 'sm-a': first, 'sm-b': second }), 90, 612, 792);
  const afterA = cw.surveyMarkers['sm-a'];
  const afterB = cw.surveyMarkers['sm-b'];
  assert.equal(afterA.name, 'walls-a');
  assert.equal(afterB.name, 'walls-b');
  assert.equal(afterA.bounds.angle, 90);
  assert.equal(afterB.bounds.angle, 90);
  const expectedB = rotateDisplayedPoint(260 + 146.88 / 2, 320 + 142.56 / 2, 612, 792, 90);
  assert.ok(Math.abs((afterB.bounds.x + afterB.bounds.width / 2) - expectedB.x) < 1e-6);
  assert.ok(Math.abs(afterA.bounds.x - afterB.bounds.x) > 1);
});

test('rotateSurveyMarkerBounds is invertible and does not invent a missing marker', () => {
  const marker = liveMarker('bare-sm');
  const once = rotateSurveyMarkerBounds(marker, 612, 792, 90);
  const back = rotateSurveyMarkerBounds(once, 792, 612, -90);
  assert.ok(Math.abs(back.bounds.x - marker.bounds.x) < 1e-6);
  assert.ok(Math.abs(back.bounds.y - marker.bounds.y) < 1e-6);
  assert.equal(back.bounds.angle, 0);
  assert.equal(rotateSurveyMarkerBounds(null, 612, 792, 90), null);
  assert.deepEqual(rotateSurveyMarkerBounds({ id: 'bare' }, 612, 792, 90), { id: 'bare' });
});

test('unlocated marker without bounds is left alone', () => {
  const unlocated = { annotationId: 'sm-seed', pageNumber: 1, name: 'Walls 1' };
  const cw = rotateModel(emptyModel({ 'sm-seed': unlocated }), 90, 612, 792);
  assert.deepEqual(cw.surveyMarkers['sm-seed'], unlocated);
});

test('rect remapper still uses Fabric left/top; survey-marker is the bounds path', () => {
  const rect = {
    type: 'rect',
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    angle: 0,
    data: { id: 'xf-rect', type: 'rect', pageNumber: 1 },
  };
  const cw = rotateModel({
    ...emptyModel({}),
    annotationsByPage: { 1: { width: 612, height: 792, objects: [rect] } },
  }, 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(122.4 + 135.4 / 2, 205.9 + 152.2 / 2, 612, 792, 90);
  assert.ok(Math.abs((after.left + 135.4 / 2) - expected.x) < 1e-6);
  assert.equal(after.angle, 90);
});

test('reindex remaps survey-marker bounds; no file.id stamp; no invented checklist seed', () => {
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const viewer = read('src/PDFViewer.jsx');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(reindex, /export function rotateSurveyMarkerBounds/);
  assert.match(reindex, /isSurveyMarkerBounds/);
  assert.match(reindex, /Live survey markers store geometry only in bounds/);
  assert.match(reindex, /Do not invent Fabric left\/top on the marker/);
  assert.match(viewer, /x: Number\(bounds\.x\) \|\| 0/);
  assert.match(layer, /left: h\.x/);
  assert.match(layer, /top: h\.y/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.match(dev, /surveyTransitionE2ETemplates/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  const seeds = dev.slice(
    dev.indexOf('const surveyTransitionE2ETemplates'),
    dev.indexOf('const SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY'),
  );
  assert.doesNotMatch(seeds, /checklist\s*:/);
  assert.doesNotMatch(seeds, /checklistItems:/);
});

test('live spec covers create then page CW survey-marker remap, empty invent, restore, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-survey-marker-remap.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf&surveyTransitionE2E=1/);
  assert.match(spec, /empty page rotate must invent 0/);
  assert.match(spec, /page rotate must keep the live survey-marker/);
  assert.match(spec, /remapped survey-marker center must follow displayed-space \+90/);
  assert.match(spec, /must not leave bounds in pre-rotate space/);
  assert.match(spec, /bounds\.angle must remap \+90/);
  assert.match(spec, /second marker must keep its id/);
  assert.match(spec, /opposite page rotate must restore survey-marker/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 remapped-survey-marker edge/);
  assert.match(spec, /390 Pages rotate is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /checklistItems/);
  assert.doesNotMatch(spec, /rotatePageSpaceCounter|rotatePageSpaceInk|rotateCalloutFractions/);
});
