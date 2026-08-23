import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for undo/redo AFTER page-rotate remappers.
// Product: commitPageStructureState wipes undo + redo + local annotation
// lanes so stale pre-rotate addresses cannot zero remapped siblings.
// Invert of /Rotate + remapper is not invented. Live proof:
// debug/scenarios/e2e-page-rotate-undo-after-rotate.spec.mjs
// Distinct from leftover-18 / X-01 / undo-after-tool-switch / remappers.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function emptyModel(objects = [], width = 612, height = 792) {
  return {
    annotationsByPage: { 1: { width, height, objects } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

function liveRect(id = 'xf-undo-rotate', left = 134.64, top = 237.60, width = 110.16, height = 95.04) {
  return {
    type: 'rect',
    left,
    top,
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id, type: 'rect', tool: 'rect', pageNumber: 1 },
  };
}

test('page CW remaps live rect; wipe contract does not invent remapper invert', () => {
  const created = liveRect();
  const beforeCenter = {
    x: created.left + created.width / 2,
    y: created.top + created.height / 2,
  };
  const cw = transformPageState(emptyModel([created]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const remapped = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);
  assert.equal(remapped.data.id, 'xf-undo-rotate');
  assert.ok(Math.abs((remapped.left + remapped.width / 2) - expected.x) < 1e-6);
  assert.ok(Math.abs((remapped.top + remapped.height / 2) - expected.y) < 1e-6);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);
  assert.ok(Math.abs(remapped.left - created.left) > 1, 'must not stay on the pre-rotate origin');
});

test('undo/redo after page CW uses wipe remainder; no remapper invert; no file.id stamp', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-undo-after-rotate.spec.mjs');
  const viewer = read('src/PDFViewer.jsx');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const shell = read('src/AppShell.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /leftover-18 X-01/);
  assert.match(spec, /commitPageStructureState/);
  assert.match(spec, /page mutations wipe the local undo lane\. Undo cannot invert rotate\./);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /Ctrl\+Z after wipe must not rewind to portrait viewBox/);
  assert.match(spec, /Ctrl\+Z must not invent pre-rotate placement/);
  assert.match(spec, /tool-switch mid-rotate must invent 0 extra ids/);
  assert.match(spec, /empty stack: Undo disabled/);
  assert.match(spec, /new create after wipe must re-arm Undo/);
  assert.match(spec, /undo after wipe must drop only the post-rotate create/);
  assert.match(spec, /390 undo after remap edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /invent.*remapper|dest-XYZ|createRevision\(/);

  assert.match(viewer, /const commitPageStructureState = useCallback\(\(next, operation\) => \{/);
  assert.match(viewer, /setUndoHistory\(\[\]\);/);
  assert.match(viewer, /setRedoHistory\(\[\]\);/);
  assert.match(viewer, /localAnnotationUndoRef\.current = \[\];/);
  assert.match(viewer, /localAnnotationRedoRef\.current = \[\];/);
  assert.match(viewer, /Page mutations remap annotation addresses/);
  assert.match(viewer, /Stale local-lane actions/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(reindex, /export function transformPageState/);
  assert.match(shell, /aria-label="Undo"/);
  assert.match(shell, /disabled=\{!topToolbarApi\.canUndo\}/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
