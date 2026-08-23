import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for page rotate with a currently transformed rect
// (rubber-band + bbox resize, then Pages rotate). Live proof:
// debug/scenarios/e2e-page-rotate-transformed.spec.mjs
// Distinct from wave 11 untransformed rotate-ccw, leftover-18 / X-01,
// undo-across-tool-switch, and transform export/reimport.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('displayed-space +90 maps the visual center and swaps page size', () => {
  const center = rotateDisplayedPoint(160, 220, 612, 792, 90);
  assert.deepEqual(center, { x: 792 - 220, y: 160 });
  assert.deepEqual(rotateDisplayedPageSize(612, 792, 90), { width: 792, height: 612 });
  const back = rotateDisplayedPoint(center.x, center.y, 792, 612, -90);
  assert.deepEqual(back, { x: 160, y: 220 });
});

test('rotate remaps a resized rect; empty page invents 0; opposite delta restores', () => {
  const resized = {
    type: 'rect',
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'xf-rect', type: 'rect', tool: 'rect', pageNumber: 1 },
  };
  const cw = transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [resized] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });

  const after = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(122.4 + 135.4 / 2, 205.9 + 152.2 / 2, 612, 792, 90);
  assert.equal(after.data.id, 'xf-rect');
  assert.equal(after.data.pageNumber, 1);
  assert.ok(Math.abs((after.left + 135.4 / 2) - expected.x) < 1e-6);
  assert.ok(Math.abs((after.top + 152.2 / 2) - expected.y) < 1e-6);
  assert.equal(after.angle, 90);
  assert.equal(after.width, 135.4);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const empty = transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
  assert.equal(empty.annotationsByPage[1].objects.length, 0);

  const restored = transformPageState(cw, {
    type: 'rotate', page: 1, delta: -90, pageWidth: 792, pageHeight: 612,
  });
  const back = restored.annotationsByPage[1].objects[0];
  assert.ok(Math.abs(back.left - 122.4) < 1e-6);
  assert.ok(Math.abs(back.top - 205.9) < 1e-6);
  assert.equal(back.angle, 0);
  assert.equal(restored.annotationsByPage[1].width, 612);
});

test('usePageOperations peeks displayed size before rotate remap; no file.id stamp', () => {
  const hook = read('src/hooks/usePageOperations.js');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const mutation = read('src/utils/pdfPageMutation.js');
  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(hook, /peekDisplayedPageSize/);
  assert.match(hook, /pageWidth: displayed\.width/);
  assert.match(hook, /pageHeight: displayed\.height/);
  assert.match(mutation, /export async function peekDisplayedPageSize/);
  assert.match(reindex, /rotateDisplayedPoint/);
  assert.match(reindex, /rotatePageGeometry/);
  assert.match(viewer, /setUndoHistory\(\[\]\);\s*\n\s*setRedoHistory\(\[\]\);\s*\n\s*undoHistoryRef\.current = \[\];[\s\S]*Page mutations remap annotation addresses/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create\/resize then page rotate, empty invent, restore, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-transformed.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /empty page rotate must invent 0/);
  assert.match(spec, /br must grow the live rect/);
  assert.match(spec, /page rotate must keep the resized rect/);
  assert.match(spec, /rotated center must follow displayed-space \+90/);
  assert.match(spec, /opposite page rotate must restore placement/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
