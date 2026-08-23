import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { transformPageState } from '../src/utils/pageAnnotationReindex.js';
import { resetPageTransform } from '../src/utils/pageContextOps.js';

// Source contracts for page delete of a currently transformed rect
// (rubber-band + bbox resize, then Pages Delete of that page). Live proof:
// debug/scenarios/e2e-page-delete-transformed.spec.mjs
// Distinct from wave 11 untransformed delete, insert/duplicate inverse-delete
// of a blank/clone page, leftover-18 / X-01, page-rotate-transformed.
//
// Reset-after-rotate hunt (first): Reset is CSS-only (already receipted
// after Mirror V). It is not a transformPageState remapper inverse.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

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

const neighbor = {
  type: 'rect',
  left: 80,
  top: 90,
  width: 40,
  height: 50,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  data: { id: 'xf-neighbor', type: 'rect', tool: 'rect', pageNumber: 2 },
};

const threePage = () => ({
  annotationsByPage: {
    1: { width: 612, height: 792, objects: [resized] },
    2: { width: 612, height: 792, objects: [neighbor] },
    3: { width: 612, height: 792, objects: [] },
  },
  surveyMarkers: {},
  annotations: {
    'xf-rect': { ...resized, pageNumber: 1 },
    'xf-neighbor': { ...neighbor, pageNumber: 2 },
  },
  pageNames: {},
  pageTransformations: {},
  bookmarks: [],
  spaces: [],
});

const geom = (object) => ({
  id: object?.data?.id,
  page: object?.data?.pageNumber,
  left: object?.left,
  top: object?.top,
  width: object?.width,
  height: object?.height,
  angle: object?.angle,
});

test('Reset after rotate is CSS-only; remapped coords stay (not a remapper inverse)', () => {
  const cw = transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [resized] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: { 1: { rotation: 0, mirrorH: false, mirrorV: true } },
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });

  const remapped = cw.annotationsByPage[1].objects[0];
  assert.notEqual(remapped.left, 122.4);
  assert.equal(remapped.angle, 90);
  // Rotate bakes /Rotate and clears CSS rotation, but leftover mirrors stay.
  assert.deepEqual(cw.pageTransformations[1], { rotation: 0, mirrorH: false, mirrorV: true });

  const afterReset = resetPageTransform(cw.pageTransformations || {}, 1);
  assert.equal(afterReset[1], undefined);
  assert.equal(cw.annotationsByPage[1].objects[0].left, remapped.left);
  assert.equal(cw.annotationsByPage[1].objects[0].top, remapped.top);
  assert.equal(cw.annotationsByPage[1].objects[0].angle, 90);

  const hook = read('src/hooks/usePageOperations.js');
  const ops = read('src/utils/pageContextOps.js');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  assert.match(hook, /resetPageTransform\(prev, pageNumber\)/);
  assert.doesNotMatch(hook, /handleResetPage[\s\S]{0,180}runMutation/);
  assert.match(ops, /delete next\[pageNumber\]/);
  assert.doesNotMatch(reindex, /type === 'reset'/);
});

test('delete drops a resized rect; neighbor shifts and does not inherit the id', () => {
  const deleted = transformPageState(threePage(), { type: 'delete', page: 1 });
  assert.equal(deleted.annotationsByPage[1].objects[0].data.id, 'xf-neighbor');
  assert.deepEqual(geom(deleted.annotationsByPage[1].objects[0]), {
    id: 'xf-neighbor',
    page: 1,
    left: 80,
    top: 90,
    width: 40,
    height: 50,
    angle: 0,
  });
  assert.equal(deleted.annotationsByPage[2].objects.length, 0);
  assert.equal(deleted.annotationsByPage[3], undefined);
  assert.equal(deleted.annotations['xf-rect'], undefined);
  assert.equal(deleted.annotations['xf-neighbor'].pageNumber, 1);

  const empty = transformPageState({
    ...threePage(),
    annotationsByPage: {
      1: { width: 612, height: 792, objects: [] },
      2: { width: 612, height: 792, objects: [] },
      3: { width: 612, height: 792, objects: [] },
    },
    annotations: {},
  }, { type: 'delete', page: 3 });
  assert.equal(empty.annotationsByPage[1].objects.length, 0);
  assert.equal(empty.annotationsByPage[2].objects.length, 0);
  assert.equal(empty.annotationsByPage[3], undefined);

  const middle = transformPageState(threePage(), { type: 'delete', page: 2 });
  assert.deepEqual(geom(middle.annotationsByPage[1].objects[0]), geom(resized));
  assert.equal(middle.annotationsByPage[2].objects.length, 0);
  assert.equal(middle.annotations['xf-neighbor'], undefined);
  assert.equal(middle.annotations['xf-rect'].pageNumber, 1);
});

test('usePageOperations delete stays persist-then-commit; last page is refused; no file.id stamp', () => {
  const hook = read('src/hooks/usePageOperations.js');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const mutation = read('src/utils/pdfPageMutation.js');
  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(hook, /type: 'delete', page: pageNumber/);
  assert.match(hook, /persistThenCommitPageMutation/);
  assert.match(reindex, /value < page \? value : value === page \? null : value - 1/);
  assert.match(mutation, /A PDF must keep at least one page/);
  assert.match(viewer, /setUndoHistory\(\[\]\);\s*\n\s*setRedoHistory\(\[\]\);\s*\n\s*undoHistoryRef\.current = \[\];[\s\S]*Page mutations remap annotation addresses/);
  assert.match(viewer, /localAnnotationUndoRef\.current = \[\];/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create\/resize then page delete, empty invent, last-page refuse, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-delete-transformed.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /empty page delete must invent 0/);
  assert.match(spec, /br must grow the live rect/);
  assert.match(spec, /page delete must drop the resized rect/);
  assert.match(spec, /deleted id must not leak onto a neighbor page/);
  assert.match(spec, /store must forget the deleted id/);
  assert.match(spec, /Undo.*toBeDisabled/);
  assert.match(spec, /last remaining page delete must be refused/);
  assert.match(spec, /keep at least one page/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 page-delete edge/);
  assert.match(spec, /390 Pages delete is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
