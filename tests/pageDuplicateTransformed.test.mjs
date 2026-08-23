import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { transformPageState } from '../src/utils/pageAnnotationReindex.js';

// Source contracts for page duplicate with a currently transformed rect
// (rubber-band + bbox resize, then Pages Duplicate). Live proof:
// debug/scenarios/e2e-page-duplicate-transformed.spec.mjs
// Distinct from wave 3 / thin leftovers untransformed Duplicate,
// page-move leftover-coords, page-rotate leftover-coords,
// leftover-18 / X-01.

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

test('duplicate clones a resized rect with a new id and keeps overlay coords', () => {
  const duplicated = transformPageState(twoPage(), { type: 'duplicate', page: 1 }, {
    createId: () => 'xf-copy',
  });
  assert.deepEqual(geom(duplicated.annotationsByPage[1].objects[0]), {
    id: 'xf-rect',
    page: 1,
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    angle: 0,
  });
  assert.deepEqual(geom(duplicated.annotationsByPage[2].objects[0]), {
    id: 'xf-copy',
    page: 2,
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    angle: 0,
  });
  assert.notEqual(
    duplicated.annotationsByPage[1].objects[0].data.id,
    duplicated.annotationsByPage[2].objects[0].data.id,
  );

  const empty = transformPageState({
    ...twoPage(),
    annotationsByPage: {
      1: { width: 612, height: 792, objects: [] },
      2: { width: 612, height: 792, objects: [] },
    },
  }, { type: 'duplicate', page: 2 }, { createId: () => 'should-not-fire' });
  assert.equal(empty.annotationsByPage[1].objects.length, 0);
  assert.equal(empty.annotationsByPage[2].objects.length, 0);
  assert.equal(empty.annotationsByPage[3].objects.length, 0);

  const removed = transformPageState(duplicated, { type: 'delete', page: 2 });
  assert.deepEqual(geom(removed.annotationsByPage[1].objects[0]), geom(resized));
  assert.equal(removed.annotationsByPage[2].objects.length, 0);
  assert.equal(removed.annotationsByPage[3], undefined);
});

test('usePageOperations duplicate stays persist-then-commit; undo lane is wiped; no file.id stamp', () => {
  const hook = read('src/hooks/usePageOperations.js');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const viewer = read('src/PDFViewer.jsx');
  const identity = read('src/utils/pasteCloneIdentity.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(hook, /type: 'duplicate', page: pageNumber/);
  assert.match(hook, /persistThenCommitPageMutation/);
  assert.match(reindex, /type === 'duplicate' \|\| type === 'copy'/);
  assert.match(reindex, /mintPastedCloneIdentity/);
  assert.match(identity, /fresh data\.id/);
  assert.match(viewer, /setUndoHistory\(\[\]\);\s*\n\s*setRedoHistory\(\[\]\);\s*\n\s*undoHistoryRef\.current = \[\];[\s\S]*Page mutations remap annotation addresses/);
  assert.match(viewer, /localAnnotationUndoRef\.current = \[\];/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create\/resize then page duplicate, empty invent, clone-page delete, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-duplicate-transformed.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /empty page duplicate must invent 0/);
  assert.match(spec, /br must grow the live rect/);
  assert.match(spec, /page duplicate must keep the original resized rect/);
  assert.match(spec, /page duplicate must mint a resized copy on the new page/);
  assert.match(spec, /copy must get a new id/);
  assert.match(spec, /deleting the clone page must leave the original/);
  assert.match(spec, /Undo.*toBeDisabled/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 page-duplicate edge/);
  assert.match(spec, /390 Pages duplicate is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
