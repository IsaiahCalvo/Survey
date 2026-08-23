import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { buildAnnotationRestoreAction } from '../src/services/annotationTrashHistory.js';
import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for local History restore AFTER page CW remaps a
// live rect. A-07 click-restore (jump + spotlight) was proved before
// the remappers — that is not this path. Named cloud Restore stays
// leftover-18 X-01. Live proof:
// debug/scenarios/e2e-page-rotate-history-restore.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect / create-after-rotate
// / remapped mt/mtr/br / remapped-page export.

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

function liveRect(id, left = 134.64, top = 237.60, width = 110.16, height = 95.04) {
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

test('History restore after CW remap keeps remapped placement + swapped page size; no extra ids', () => {
  const created = liveRect('xf-hist-restore');
  const beforeCenter = {
    x: created.left + created.width / 2,
    y: created.top + created.height / 2,
  };

  const portraitRestore = invertAnnotationHistoryAction(deleteAction(created));
  const beforePage = applyAnnotationHistoryAction(
    { 1: { width: 612, height: 792, objects: [] } },
    portraitRestore,
  );
  const beforeBack = beforePage[1].objects[0];
  assert.equal(beforeBack.data.id, 'xf-hist-restore');
  assert.equal(beforeBack.left, created.left);
  assert.equal(beforeBack.top, created.top);
  assert.equal(beforePage[1].width, 612);
  assert.equal(beforePage[1].height, 792);
  assert.equal(beforePage[1].objects.length, 1);

  const cw = transformPageState(emptyModel([created]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const remapped = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);
  assert.equal(remapped.data.id, 'xf-hist-restore');
  assert.ok(Math.abs((remapped.left + remapped.width / 2) - expected.x) < 1e-6);
  assert.ok(Math.abs((remapped.top + remapped.height / 2) - expected.y) < 1e-6);
  assert.ok(Math.abs(remapped.left - created.left) > 1, 'must not stay on the pre-rotate origin');
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);

  const restoreAction = buildAnnotationRestoreAction(deleteAction(remapped));
  assert.equal(restoreAction.type, 'fabric:create');
  assert.equal(restoreAction.annotationId, 'xf-hist-restore');
  assert.equal(restoreAction.annotation.data.id, 'xf-hist-restore');

  const afterDelete = {
    1: { width: 792, height: 612, objects: [] },
  };
  const restored = applyAnnotationHistoryAction(afterDelete, restoreAction);
  assert.equal(restored[1].objects.length, 1);
  assert.equal(restored[1].objects[0].data.id, 'xf-hist-restore');
  assert.ok(Math.abs(restored[1].objects[0].left - remapped.left) < 1e-6);
  assert.ok(Math.abs(restored[1].objects[0].top - remapped.top) < 1e-6);
  assert.ok(Math.abs(restored[1].objects[0].left - created.left) > 1, 'restore must not rewind to pre-rotate origin');
  assert.equal(restored[1].width, 792, 'restore must keep swapped page width');
  assert.equal(restored[1].height, 612, 'restore must keep swapped page height');

  const second = applyAnnotationHistoryAction(restored, restoreAction);
  assert.equal(second[1].objects.length, 1, 'second Restore must not invent an extra id');
  assert.equal(second[1].objects[0].data.id, 'xf-hist-restore');
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

  const created = liveRect('xf-dismiss');
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

test('History restore after remap uses live activity Restore; no file.id stamp', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-history-restore.spec.mjs');
  const panel = read('src/components/revisions/RevisionsPanel.jsx');
  const viewer = read('src/PDFViewer.jsx');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const history = read('src/utils/annotationLocalHistory.js');
  const trash = read('src/services/annotationTrashHistory.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /A-07 click-restore/);
  assert.match(spec, /leftover-18 X-01/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must keep the live rect/);
  assert.match(spec, /after-rotate Restore must keep remapped center/);
  assert.match(spec, /after-rotate Restore must not rewind to pre-rotate center/);
  assert.match(spec, /after-rotate Restore must keep swapped viewBox/);
  assert.match(spec, /after-rotate Restore must not invent extra ids/);
  assert.match(spec, /second Restore must not duplicate the remapped id/);
  assert.match(spec, /collapse\/dismiss must not apply Restore/);
  assert.match(spec, /create-event must omit Restore/);
  assert.match(spec, /390 History restore after remap edge/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);

  assert.match(panel, /onRestoreHistoryActivity\(event\)/);
  assert.match(panel, /Only the document owner can save or restore versions/);
  assert.match(panel, /Item is already present — no restore needed/);
  assert.match(panel, /not a full-document snapshot/);
  assert.doesNotMatch(panel, /handleActivityClick[\s\S]{0,400}restoreRevision/);

  assert.match(viewer, /source: 'history:restore-deleted-annotation'/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(reindex, /rotateDisplayedPoint/);
  assert.match(history, /export function applyAnnotationHistoryAction/);
  assert.match(trash, /export function buildAnnotationRestoreAction/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
