import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';
import {
  rotateCalloutFractions,
  rotateDisplayedPageSize,
  rotateNormalizedBox,
  rotateNormalizedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for live-created callout 0-1 fractions after page CW.
// Distinct from remapped-page mt/mtr/br clip, leftover-18 / X-01, and
// page-rotate-transformed (rect visual-center). Live proof:
// debug/scenarios/e2e-page-rotate-callout-remap.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const PAGE = { width: 612, height: 792 };
const CALLOUT = {
  id: 'callout-xf',
  pageNumber: 1,
  arrowTip: { x: 0.16, y: 0.22 },
  knee: { x: 0.22, y: 0.28 },
  textBoxPosition: { x: 0.44, y: 0.42 },
  textBoxWidth: 120 / 612,
  textBoxHeight: 32 / 792,
  text: 'A',
  style: { fontFamily: 'Arial', lineStyle: 'solid' },
};

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

test('normalized 90deg point and visual-center box remap onto 792x612', () => {
  const tip = rotateNormalizedPoint({ x: 0.16, y: 0.22 }, 612, 792, 90);
  assert.ok(Math.abs(tip.x - (1 - 0.22)) < 1e-9);
  assert.ok(Math.abs(tip.y - 0.16) < 1e-9);
  const box = rotateNormalizedBox({ x: 0.44, y: 0.42 }, 120 / 612, 32 / 792, 612, 792, 90);
  const oldCx = 0.44 * 612 + 60;
  const oldCy = 0.42 * 792 + 16;
  const expectedCx = 792 - oldCy;
  const expectedCy = oldCx;
  assert.ok(Math.abs((box.x * 792 + 60) - expectedCx) < 1e-6);
  assert.ok(Math.abs((box.y * 612 + 16) - expectedCy) < 1e-6);
  assert.ok(Math.abs(box.width * 792 - 120) < 1e-6);
  assert.ok(Math.abs(box.height * 612 - 32) < 1e-6);
  assert.deepEqual(rotateDisplayedPageSize(612, 792, 90), { width: 792, height: 612 });
});

test('rotate remaps live callout fractions; empty invents 0; opposite restores', () => {
  const projected = calloutToAnnotationObject(CALLOUT, PAGE);
  const cw = rotateModel(emptyModel([projected]), 90, 612, 792);
  const after = cw.annotationsByPage[1].objects[0];
  const expectedTip = rotateNormalizedPoint(CALLOUT.arrowTip, 612, 792, 90);
  const expectedKnee = rotateNormalizedPoint(CALLOUT.knee, 612, 792, 90);
  const expectedBox = rotateNormalizedBox(
    CALLOUT.textBoxPosition,
    CALLOUT.textBoxWidth,
    CALLOUT.textBoxHeight,
    612,
    792,
    90,
  );
  const legacy = after.data.legacyCallout;
  const coords = after.data.legacyNormalizedCoords;
  assert.equal(after.data.type, 'callout');
  assert.equal(after.data.id, 'callout-xf');
  assert.ok(Math.abs(legacy.arrowTip.x - expectedTip.x) < 1e-9);
  assert.ok(Math.abs(legacy.arrowTip.y - expectedTip.y) < 1e-9);
  assert.ok(Math.abs(legacy.knee.x - expectedKnee.x) < 1e-9);
  assert.ok(Math.abs(legacy.knee.y - expectedKnee.y) < 1e-9);
  assert.ok(Math.abs(legacy.textBoxPosition.x - expectedBox.x) < 1e-9);
  assert.ok(Math.abs(legacy.textBoxPosition.y - expectedBox.y) < 1e-9);
  assert.ok(Math.abs(legacy.textBoxWidth - expectedBox.width) < 1e-9);
  assert.ok(Math.abs(legacy.textBoxHeight - expectedBox.height) < 1e-9);
  assert.ok(Math.abs(coords.arrowTip.x - expectedTip.x) < 1e-9);
  assert.ok(Math.abs(coords.knee.x - expectedKnee.x) < 1e-9);
  assert.ok(legacy.arrowTip.x > 0 && legacy.arrowTip.x < 1);
  assert.ok(legacy.knee.x > 0 && legacy.knee.x < 1);
  assert.ok(legacy.textBoxPosition.x > 0 && legacy.textBoxPosition.x < 1);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const line2 = after.objects.find((child) => child.data?.calloutPart === 'line2');
  assert.ok(Math.abs(line2.x2 - expectedTip.x * 792) < 1e-6);
  assert.ok(Math.abs(line2.y2 - expectedTip.y * 612) < 1e-6);
  const textbox = after.objects.find((child) => child.data?.calloutPart === 'textBox');
  assert.ok(Math.abs(textbox.left - expectedBox.x * 792) < 1e-6);
  assert.ok(Math.abs(textbox.width - 120) < 1e-6);

  const empty = rotateModel(emptyModel([]), 90, 612, 792);
  assert.equal(empty.annotationsByPage[1].objects.length, 0);

  const restored = rotateModel(cw, -90, 792, 612);
  const back = restored.annotationsByPage[1].objects[0].data.legacyCallout;
  assert.ok(Math.abs(back.arrowTip.x - CALLOUT.arrowTip.x) < 1e-9);
  assert.ok(Math.abs(back.arrowTip.y - CALLOUT.arrowTip.y) < 1e-9);
  assert.ok(Math.abs(back.knee.x - CALLOUT.knee.x) < 1e-9);
  assert.ok(Math.abs(back.textBoxPosition.x - CALLOUT.textBoxPosition.x) < 1e-9);
  assert.ok(Math.abs(back.textBoxPosition.y - CALLOUT.textBoxPosition.y) < 1e-9);
  assert.ok(Math.abs(back.textBoxWidth - CALLOUT.textBoxWidth) < 1e-9);
  assert.ok(Math.abs(back.textBoxHeight - CALLOUT.textBoxHeight) < 1e-9);
  assert.equal(restored.annotationsByPage[1].width, 612);
});

test('rotateCalloutFractions is invertible and does not invent a missing callout', () => {
  const once = rotateCalloutFractions(CALLOUT, 612, 792, 90);
  const back = rotateCalloutFractions(once, 792, 612, -90);
  assert.ok(Math.abs(back.arrowTip.x - CALLOUT.arrowTip.x) < 1e-9);
  assert.ok(Math.abs(back.knee.y - CALLOUT.knee.y) < 1e-9);
  assert.equal(rotateCalloutFractions(null, 612, 792, 90), null);
  assert.deepEqual(rotateCalloutFractions({ id: 'bare' }, 612, 792, 90), { id: 'bare' });
});

test('line remapper still does not invent endpoint remap; callout is the fraction path', () => {
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

test('reindex remaps legacyCallout fractions; no file.id stamp', () => {
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const types = read('src/components/Callout/types.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const bridge = read('src/utils/calloutAnnotationBridge.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(reindex, /export function rotateCalloutFractions/);
  assert.match(reindex, /export function rotateNormalizedPoint/);
  assert.match(reindex, /export function rotateNormalizedBox/);
  assert.match(reindex, /isCalloutLike/);
  assert.match(reindex, /data\.legacyCallout/);
  assert.match(reindex, /data\.legacyNormalizedCoords/);
  assert.match(reindex, /[Vv]isual-center contract/);
  assert.match(types, /arrowTip - Position as percentage of page \(0-1\)/);
  assert.match(layer, /const arrowTipNorm = \{ x: state\.arrowTip\.x \/ W, y: state\.arrowTip\.y \/ H \}/);
  assert.match(layer, /120 \/ W/);
  assert.match(layer, /32 \/ H/);
  assert.match(bridge, /data\.legacyCallout/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create then page CW remap, knee\/box hit, empty invent, restore, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-callout-remap.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty page rotate must invent 0/);
  assert.match(spec, /page rotate must keep the live callout/);
  assert.match(spec, /remapped callout box center must follow displayed-space \+90/);
  assert.match(spec, /knee handle must stay on the remapped page/);
  assert.match(spec, /box handle must stay on the remapped page/);
  assert.match(spec, /opposite page rotate must restore callout fractions/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 remapped-callout edge/);
  assert.match(spec, /390 Pages rotate is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
