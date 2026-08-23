import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { transformPageState } from '../src/utils/pageAnnotationReindex.js';
import { cssForPageTransform, togglePageMirror } from '../src/utils/pageContextOps.js';

// Source contracts for page move with a currently transformed rect
// (rubber-band + bbox resize, then Pages Move down). Live proof:
// debug/scenarios/e2e-page-move-transformed.spec.mjs
// Distinct from wave 11 / pages move-up-down untransformed create,
// page-rotate leftover-coords, leftover-18 / X-01.
// Remapper hunt of insert / duplicate / mirror H+V is in this file;
// live sibling receipt is Move only.

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

test('move carries a resized rect to the destination page and keeps overlay coords', () => {
  const moved = transformPageState(twoPage(), { type: 'move', from: 1, to: 2 });
  const dest = moved.annotationsByPage[2].objects[0];
  assert.equal(moved.annotationsByPage[1].objects.length, 0);
  assert.deepEqual(geom(dest), {
    id: 'xf-rect',
    page: 2,
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
  }, { type: 'move', from: 1, to: 2 });
  assert.equal(empty.annotationsByPage[1].objects.length, 0);
  assert.equal(empty.annotationsByPage[2].objects.length, 0);

  const restored = transformPageState(moved, { type: 'move', from: 2, to: 1 });
  assert.deepEqual(geom(restored.annotationsByPage[1].objects[0]), geom(resized));
  assert.equal(restored.annotationsByPage[2].objects.length, 0);
});

test('insert / duplicate remappers keep transformed placement; mirror is CSS-only', () => {
  const withLater = {
    annotationsByPage: {
      1: { width: 612, height: 792, objects: [] },
      2: {
        width: 612,
        height: 792,
        objects: [{ ...resized, data: { ...resized.data, id: 'xf-later', pageNumber: 2 } }],
      },
    },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
  const inserted = transformPageState(withLater, { type: 'insert', afterPage: 1 });
  assert.equal(inserted.annotationsByPage[2], undefined);
  assert.equal(inserted.annotationsByPage[1].objects.length, 0);
  assert.deepEqual(geom(inserted.annotationsByPage[3].objects[0]), {
    id: 'xf-later',
    page: 3,
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    angle: 0,
  });

  const duplicated = transformPageState(twoPage(), { type: 'duplicate', page: 1 }, {
    createId: () => 'xf-copy',
  });
  assert.deepEqual(geom(duplicated.annotationsByPage[1].objects[0]), geom(resized));
  assert.deepEqual(geom(duplicated.annotationsByPage[2].objects[0]), {
    id: 'xf-copy',
    page: 2,
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    angle: 0,
  });

  const mirrored = togglePageMirror({}, 1, 'horizontal');
  assert.equal(mirrored[1].mirrorH, true);
  assert.equal(cssForPageTransform(mirrored[1]), 'scaleX(-1)');
  assert.throws(() => transformPageState(twoPage(), { type: 'mirror', page: 1 }), /unknown op type/);
});

test('usePageOperations move / insert / duplicate stay persist-then-commit; no file.id stamp', () => {
  const hook = read('src/hooks/usePageOperations.js');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const ops = read('src/utils/pageContextOps.js');
  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(hook, /type: 'move', from: sourcePageNumber, to: targetPageNumber/);
  assert.match(hook, /type: 'duplicate', page: pageNumber/);
  assert.match(hook, /type: 'insert', afterPage: afterPageNumber/);
  assert.match(hook, /togglePageMirror/);
  assert.match(hook, /persistThenCommitPageMutation/);
  assert.match(reindex, /if \(value === from\) return to;/);
  assert.match(ops, /scaleX\(-1\)/);
  assert.match(viewer, /Page mutations remap annotation addresses/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers create\/resize then page move, empty invent, restore, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-move-transformed.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /empty page move must invent 0/);
  assert.match(spec, /br must grow the live rect/);
  assert.match(spec, /page move must keep the resized rect/);
  assert.match(spec, /moved rect must not stay on the old page/);
  assert.match(spec, /overlay coords must travel unchanged/);
  assert.match(spec, /opposite page move must restore placement/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 page-move edge/);
  assert.match(spec, /390 Pages move is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
