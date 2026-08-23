import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import {
  applyAnnotationHistoryAction,
  invertAnnotationHistoryAction,
  stampDisplayedPlacement,
} from '../src/utils/annotationLocalHistory.js';
import { buildAnnotationRestoreAction } from '../src/services/annotationTrashHistory.js';
import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for local History restore AFTER page CW remaps live
// page-space ink (path + paperCenterline; left 0 is normal).
// stampDisplayedPlacement lifts Fabric-0 rects via remapped data.left —
// that must not invent a left on clean ink (no data.left).
// A-07 click-restore was proved before the remappers — that is not this path.
// Named cloud Restore stays leftover-18 X-01. Live proof:
// debug/scenarios/e2e-page-rotate-history-restore-ink.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect History Restore /
// remapped ink / create-after-rotate / remapped mt/mtr/br.

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

function liveInk(id) {
  return createProductionPaperInk({
    id,
    tool: 'pen',
    points: [
      { x: 134.64, y: 237.60 },
      { x: 260, y: 320 },
      { x: 300, y: 280 },
    ],
    color: '#111111',
    width: 4,
    data: { id, tool: 'pen' },
  });
}

function deleteAction(annotation) {
  return {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: annotation.data.id,
    storageKey: annotation.data.id,
    annotation,
    index: 0,
  };
}

test('History restore after CW remap keeps remapped ink centerline; left 0 stays normal', () => {
  const created = liveInk('xf-hist-restore-ink');
  assert.equal(created.left, 0);
  assert.equal(created.top, 0);
  assert.equal(created.data.left, undefined);
  const first = created.paperCenterline[0];

  const portraitRestore = invertAnnotationHistoryAction(deleteAction(created));
  const beforePage = applyAnnotationHistoryAction(
    { 1: { width: 612, height: 792, objects: [] } },
    portraitRestore,
  );
  const beforeBack = beforePage[1].objects[0];
  assert.equal(beforeBack.data.id, 'xf-hist-restore-ink');
  assert.equal(beforeBack.left, 0);
  assert.ok(Math.abs(beforeBack.paperCenterline[0].x - first.x) < 1e-6);
  assert.equal(beforePage[1].width, 612);
  assert.equal(beforePage[1].height, 792);

  const cw = transformPageState(emptyModel([created]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const remapped = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(first.x, first.y, 612, 792, 90);
  assert.equal(remapped.data.id, 'xf-hist-restore-ink');
  assert.equal(remapped.left, 0, 'page-space ink left 0 is normal after CW');
  assert.equal(remapped.top, 0);
  assert.equal(remapped.angle, 0);
  assert.equal(remapped.data.left, undefined);
  assert.ok(Math.abs(remapped.paperCenterline[0].x - expected.x) < 1e-6);
  assert.ok(Math.abs(remapped.paperCenterline[0].y - expected.y) < 1e-6);
  assert.ok(Math.abs(remapped.paperCenterline[0].x - first.x) > 1, 'must not stay on the pre-rotate point');
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const stamped = stampDisplayedPlacement(remapped);
  assert.equal(stamped.left, 0, 'stamp must not invent a left on clean remapped ink');
  assert.equal(stamped.top, 0);
  assert.equal(stamped, remapped);

  const restoreAction = buildAnnotationRestoreAction(deleteAction(remapped));
  assert.equal(restoreAction.type, 'fabric:create');
  assert.equal(restoreAction.annotationId, 'xf-hist-restore-ink');
  assert.equal(restoreAction.annotation.data.id, 'xf-hist-restore-ink');
  assert.equal(restoreAction.annotation.left, 0);
  assert.ok(Math.abs(restoreAction.annotation.paperCenterline[0].x - expected.x) < 1e-6);

  const afterDelete = {
    1: { width: 792, height: 612, objects: [] },
  };
  const restored = applyAnnotationHistoryAction(afterDelete, restoreAction);
  assert.equal(restored[1].objects.length, 1);
  assert.equal(restored[1].objects[0].data.id, 'xf-hist-restore-ink');
  assert.equal(restored[1].objects[0].left, 0);
  assert.equal(restored[1].objects[0].angle, 0);
  assert.ok(Math.abs(restored[1].objects[0].paperCenterline[0].x - remapped.paperCenterline[0].x) < 1e-6);
  assert.ok(Math.abs(restored[1].objects[0].paperCenterline[0].y - remapped.paperCenterline[0].y) < 1e-6);
  assert.ok(
    Math.abs(restored[1].objects[0].paperCenterline[0].x - first.x) > 1,
    'restore must not rewind to pre-rotate centerline',
  );
  assert.equal(restored[1].width, 792, 'restore must keep swapped page width');
  assert.equal(restored[1].height, 612, 'restore must keep swapped page height');

  const second = applyAnnotationHistoryAction(restored, restoreAction);
  assert.equal(second[1].objects.length, 1, 'second Restore must not invent an extra id');
  assert.equal(second[1].objects[0].data.id, 'xf-hist-restore-ink');
});

test('empty rotate invents 0; dismiss without Restore leaves the remapped page empty', () => {
  const empty = transformPageState(emptyModel([]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  assert.equal(empty.annotationsByPage[1].objects.length, 0);
  assert.equal(empty.annotationsByPage[1].width, 792);

  const created = liveInk('xf-ink-dismiss');
  const cw = transformPageState(emptyModel([created]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const remapped = cw.annotationsByPage[1].objects[0];
  const deleted = applyAnnotationHistoryAction(
    { 1: cw.annotationsByPage[1] },
    deleteAction(remapped),
  );
  assert.equal(deleted[1].objects.length, 0);
  assert.equal(deleted[1].width, 792);
  assert.equal(deleted[1].height, 612);
});

test('History restore after remap ink uses live activity Restore; no file.id stamp', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-history-restore-ink.spec.mjs');
  const panel = read('src/components/revisions/RevisionsPanel.jsx');
  const viewer = read('src/PDFViewer.jsx');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const history = read('src/utils/annotationLocalHistory.js');
  const trash = read('src/services/annotationTrashHistory.js');
  const ink = read('src/utils/productionPaperInk.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /A-07 click-restore/);
  assert.match(spec, /leftover-18 X-01/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must keep the live ink/);
  assert.match(spec, /after-rotate Restore must keep remapped centerline/);
  assert.match(spec, /after-rotate Restore must keep remapped path commands/);
  assert.match(spec, /after-rotate Restore must not rewind to pre-rotate centerline/);
  assert.match(spec, /after-rotate Restore must keep swapped viewBox/);
  assert.match(spec, /after-rotate Restore must not invent extra ids/);
  assert.match(spec, /second Restore must not duplicate the remapped id/);
  assert.match(spec, /collapse\/dismiss must not apply Restore/);
  assert.match(spec, /create-event must omit Restore/);
  assert.match(spec, /390 History restore ink after remap edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /left 0 is normal/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);

  assert.match(panel, /onRestoreHistoryActivity\(event\)/);
  assert.match(panel, /Only the document owner can save or restore versions/);
  assert.match(panel, /Item is already present — no restore needed/);
  assert.doesNotMatch(panel, /handleActivityClick[\s\S]{0,400}restoreRevision/);

  assert.match(viewer, /source: 'history:restore-deleted-annotation'/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(reindex, /export function rotatePageSpaceInk/);
  assert.match(history, /export function stampDisplayedPlacement/);
  assert.match(history, /After page CW remap, Fabric snapshots often store left\/top 0/);
  assert.match(trash, /export function buildAnnotationRestoreAction/);
  assert.match(ink, /left: 0/);
  assert.match(ink, /paperCenterline: centerline/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
