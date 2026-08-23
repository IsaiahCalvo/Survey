import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { transformPageState } from '../src/utils/pageAnnotationReindex.js';

// Source contracts for page insert with a currently transformed rect
// (rubber-band + bbox resize, then Pages Insert blank page). Live proof:
// debug/scenarios/e2e-page-insert-transformed.spec.mjs
// Distinct from wave 10 / wave 11 untransformed insert,
// page-duplicate leftover-coords, page-move leftover-coords,
// leftover-18 / X-01.
//
// Product: insert afterPage N keeps pages <= N, shifts pages > N by +1,
// and leaves the new slot empty. Overlay coords are not remapped.

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

const later = {
  ...resized,
  data: { ...resized.data, id: 'xf-later', pageNumber: 2 },
};

const twoPage = () => ({
  annotationsByPage: {
    1: { width: 612, height: 792, objects: [resized] },
    2: { width: 612, height: 792, objects: [] },
  },
  surveyMarkers: {},
  annotations: {},
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

test('insert keeps a resized rect on its page; later pages shift; overlay coords stay', () => {
  const stayed = transformPageState(twoPage(), { type: 'insert', afterPage: 1 });
  assert.deepEqual(geom(stayed.annotationsByPage[1].objects[0]), geom(resized));
  assert.equal(stayed.annotationsByPage[2], undefined);
  assert.equal(stayed.annotationsByPage[3].objects.length, 0);

  const withLater = {
    ...twoPage(),
    annotationsByPage: {
      1: { width: 612, height: 792, objects: [] },
      2: { width: 612, height: 792, objects: [later] },
    },
  };
  const shifted = transformPageState(withLater, { type: 'insert', afterPage: 1 });
  assert.equal(shifted.annotationsByPage[1].objects.length, 0);
  assert.equal(shifted.annotationsByPage[2], undefined);
  assert.deepEqual(geom(shifted.annotationsByPage[3].objects[0]), {
    id: 'xf-later',
    page: 3,
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    angle: 0,
  });

  const empty = transformPageState({
    ...twoPage(),
    annotationsByPage: {
      1: { width: 612, height: 792, objects: [] },
      2: { width: 612, height: 792, objects: [] },
    },
  }, { type: 'insert', afterPage: 1 });
  assert.equal(empty.annotationsByPage[1].objects.length, 0);
  assert.equal(empty.annotationsByPage[2], undefined);
  assert.equal(empty.annotationsByPage[3].objects.length, 0);

  const restored = transformPageState(stayed, { type: 'delete', page: 2 });
  assert.deepEqual(geom(restored.annotationsByPage[1].objects[0]), geom(resized));
  assert.equal(restored.annotationsByPage[2].objects.length, 0);
  assert.equal(restored.annotationsByPage[3], undefined);
});

test('usePageOperations insert stays persist-then-commit; undo lane is wiped; no file.id stamp', () => {
  const hook = read('src/hooks/usePageOperations.js');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const viewer = read('src/PDFViewer.jsx');
  const mutation = read('src/utils/pdfPageMutation.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(hook, /type: 'insert', afterPage: afterPageNumber/);
  assert.match(hook, /persistThenCommitPageMutation/);
  assert.match(reindex, /value <= afterPage \? value : value \+ 1/);
  assert.match(mutation, /pdf\.insertPage\(afterPage, \[width, height\]\)/);
  assert.match(viewer, /setUndoHistory\(\[\]\);\s*\n\s*setRedoHistory\(\[\]\);\s*\n\s*undoHistoryRef\.current = \[\];[\s\S]*Page mutations remap annotation addresses/);
  assert.match(viewer, /localAnnotationUndoRef\.current = \[\];/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create\/resize then page insert, empty invent, blank-page delete, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-insert-transformed.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /empty page insert must invent 0/);
  assert.match(spec, /br must grow the live rect/);
  assert.match(spec, /page insert must keep the resized rect on its original page/);
  assert.match(spec, /inserted blank must not steal the resized rect/);
  assert.match(spec, /store page stays 1 after insert-after-1/);
  assert.match(spec, /deleting the blank page must restore the resized rect/);
  assert.match(spec, /Undo.*toBeDisabled/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 page-insert edge/);
  assert.match(spec, /390 Pages insert is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
