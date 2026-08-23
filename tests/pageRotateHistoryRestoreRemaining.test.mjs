import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAnnotationHistoryAction,
  stampDisplayedPlacement,
} from '../src/utils/annotationLocalHistory.js';
import { buildAnnotationRestoreAction } from '../src/services/annotationTrashHistory.js';
import {
  applySurveyMarkerRestore,
  buildSurveyMarkerRestoreAction,
} from '../src/services/surveyMarkerHistory.js';
import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';
import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for local History restore AFTER page CW remaps live
// leftovers that only have rect+ink restore receipts: callout, counter,
// line, textbox, survey-marker. Named cloud Restore stays leftover-18 X-01.
// Live proof:
// debug/scenarios/e2e-page-rotate-history-restore-remaining.spec.mjs
// Distinct from leftover-18 / X-01 / remapped rect+ink History Restore /
// remapped-page export / create-after-rotate.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function emptyModel(objects = [], width = 612, height = 792, extra = {}) {
  return {
    annotationsByPage: { 1: { width, height, objects } },
    surveyMarkers: extra.surveyMarkers || {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

function deleteAction(annotation) {
  return {
    type: 'fabric:delete',
    pageNumber: 1,
    annotationId: annotation.data?.id || annotation.id,
    storageKey: annotation.data?.id || annotation.id,
    annotation,
    index: 0,
  };
}

function liveLine(id = 'xf-hist-line') {
  return {
    type: 'line',
    left: 110.16,
    top: 174.24,
    width: 146.88,
    height: 126.72,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    x1: -73.44,
    y1: -63.36,
    x2: 73.44,
    y2: 63.36,
    data: { id, type: 'line', tool: 'line', pageNumber: 1 },
  };
}

function liveTextbox(id = 'xf-hist-text') {
  return {
    type: 'textbox',
    left: 293.76,
    top: 158.40,
    width: 159.12,
    height: 110.88,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    text: 'A',
    fontFamily: 'Helvetica',
    data: { id, type: 'textbox', tool: 'text', pageNumber: 1, fontFamily: 'Helvetica' },
  };
}

function liveCounter(id = 'xf-hist-counter') {
  return {
    type: 'counter',
    left: 157.36,
    top: 397.84,
    radius: 14,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: {
      id,
      type: 'counter',
      annotationType: 'counter',
      pageNumber: 1,
      pointerAngle: 225,
    },
  };
}

function liveCallout() {
  return {
    id: 'callout-xf-hist',
    pageNumber: 1,
    arrowTip: { x: 0.16, y: 0.22 },
    knee: { x: 0.22, y: 0.28 },
    textBoxPosition: { x: 0.44, y: 0.42 },
    textBoxWidth: 120 / 612,
    textBoxHeight: 32 / 792,
    text: 'A',
    style: { fontFamily: 'Arial', lineStyle: 'solid' },
  };
}

function liveMarker(id = 'surveyMarker-xf-hist') {
  return {
    pageNumber: 1,
    name: 'walls-hist',
    bounds: { x: 306.00, y: 364.32, width: 134.64, height: 126.72, angle: 0 },
  };
}

function restoreAfterCw(created, { center } = {}) {
  const beforeCenter = center || {
    x: created.left + (created.width || 0) / 2,
    y: created.top + (created.height || 0) / 2,
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
  const restoreAction = buildAnnotationRestoreAction(deleteAction(remapped));
  const restored = applyAnnotationHistoryAction(
    { 1: { width: 792, height: 612, objects: [] } },
    restoreAction,
  );
  const second = applyAnnotationHistoryAction(restored, restoreAction);
  return { remapped, expected, restoreAction, restored, second, cw };
}

test('History restore after CW remap keeps remapped line endpoints + swapped page size', () => {
  const created = liveLine();
  const mid = {
    x: (created.left + created.width / 2),
    y: (created.top + created.height / 2),
  };
  const { remapped, expected, restored, second } = restoreAfterCw(created, { center: mid });
  assert.equal(remapped.data.id, 'xf-hist-line');
  assert.ok(Math.abs((remapped.left + remapped.width / 2) - expected.x) < 1e-6);
  assert.ok(Math.abs((remapped.top + remapped.height / 2) - expected.y) < 1e-6);
  assert.equal(restored[1].objects.length, 1);
  assert.equal(restored[1].objects[0].data.id, 'xf-hist-line');
  assert.ok(Math.abs(restored[1].objects[0].left - remapped.left) < 1e-6);
  assert.ok(Math.abs(restored[1].objects[0].top - remapped.top) < 1e-6);
  assert.ok(Math.abs(restored[1].objects[0].left - created.left) > 1, 'restore must not rewind to pre-rotate origin');
  assert.equal(restored[1].width, 792);
  assert.equal(restored[1].height, 612);
  assert.equal(second[1].objects.length, 1, 'second Restore must not invent an extra id');

  const fabricZero = {
    ...remapped,
    left: 0,
    top: 0,
    angle: 0,
    data: { ...remapped.data, left: remapped.left, top: remapped.top, angle: remapped.angle },
  };
  const stamped = stampDisplayedPlacement(fabricZero);
  assert.ok(Math.abs(stamped.left - remapped.left) < 1e-6, 'placeholder left 0 must yield remapped data.left');
  assert.ok(Math.abs(stamped.top - remapped.top) < 1e-6);
  const fromZero = applyAnnotationHistoryAction(
    { 1: { width: 792, height: 612, objects: [] } },
    buildAnnotationRestoreAction(deleteAction(fabricZero)),
  );
  assert.ok(Math.abs(fromZero[1].objects[0].left - remapped.left) < 1e-6, 'Restore must not keep Fabric left 0');
  assert.ok(Math.abs(fromZero[1].objects[0].top - remapped.top) < 1e-6);

  const fabricNearZero = {
    ...remapped,
    left: -0.000024,
    top: 0.000001,
    angle: remapped.angle,
    data: { ...remapped.data, left: remapped.left, top: remapped.top, angle: remapped.angle },
  };
  const stampedNear = stampDisplayedPlacement(fabricNearZero);
  assert.ok(Math.abs(stampedNear.left - remapped.left) < 1e-6, 'near-zero Fabric left must yield remapped data.left');
  assert.ok(Math.abs(stampedNear.top - remapped.top) < 1e-6);
  const fromNearZero = applyAnnotationHistoryAction(
    { 1: { width: 792, height: 612, objects: [] } },
    buildAnnotationRestoreAction(deleteAction(fabricNearZero)),
  );
  assert.ok(Math.abs(fromNearZero[1].objects[0].left - remapped.left) < 1e-6, 'Restore must not keep Fabric near-zero left');
});

test('History restore after CW remap keeps remapped textbox + single-name Helvetica', () => {
  const created = liveTextbox();
  const { remapped, expected, restored } = restoreAfterCw(created);
  assert.equal(remapped.data.id, 'xf-hist-text');
  assert.equal(remapped.fontFamily, 'Helvetica');
  assert.match(remapped.fontFamily, /^Helvetica$/);
  assert.doesNotMatch(remapped.fontFamily, /,/);
  assert.ok(Math.abs((remapped.left + remapped.width / 2) - expected.x) < 1e-6);
  assert.equal(restored[1].objects[0].fontFamily, 'Helvetica');
  assert.ok(Math.abs(restored[1].objects[0].left - remapped.left) < 1e-6);
  assert.ok(Math.abs(restored[1].objects[0].left - created.left) > 1);
  assert.equal(restored[1].width, 792);

  const fabricZero = {
    ...remapped,
    left: 0,
    top: 0,
    angle: 0,
    data: { ...remapped.data, left: remapped.left, top: remapped.top, angle: remapped.angle },
  };
  const fromZero = applyAnnotationHistoryAction(
    { 1: { width: 792, height: 612, objects: [] } },
    buildAnnotationRestoreAction(deleteAction(fabricZero)),
  );
  assert.ok(Math.abs(fromZero[1].objects[0].left - remapped.left) < 1e-6);
});

test('History restore after CW remap keeps remapped counter center + pointerAngle', () => {
  const created = liveCounter();
  const beforeCenter = { x: created.left + created.radius, y: created.top + created.radius };
  const { remapped, expected, restored } = restoreAfterCw(created, { center: beforeCenter });
  assert.equal(remapped.data.id, 'xf-hist-counter');
  assert.equal(remapped.data.pointerAngle, 315);
  assert.ok(Math.abs((remapped.left + remapped.radius) - expected.x) < 1e-6);
  assert.ok(Math.abs((remapped.top + remapped.radius) - expected.y) < 1e-6);
  assert.equal(restored[1].objects[0].data.pointerAngle, 315);
  assert.ok(Math.abs(restored[1].objects[0].left - remapped.left) < 1e-6);
  assert.ok(Math.abs(restored[1].objects[0].left - created.left) > 1);
  assert.equal(restored[1].width, 792);

  const fabricZero = {
    ...remapped,
    left: 0,
    top: 0,
    data: { ...remapped.data, left: remapped.left, top: remapped.top },
  };
  const fromZero = applyAnnotationHistoryAction(
    { 1: { width: 792, height: 612, objects: [] } },
    buildAnnotationRestoreAction(deleteAction(fabricZero)),
  );
  assert.ok(Math.abs(fromZero[1].objects[0].left - remapped.left) < 1e-6, 'Restore must not keep Fabric left 0');
});

test('History restore after CW remap keeps remapped callout 0–1 fractions', () => {
  const callout = liveCallout();
  const projected = calloutToAnnotationObject(callout, { width: 612, height: 792 });
  const { remapped, restored, second } = restoreAfterCw(projected);
  const beforeBox = callout.textBoxPosition;
  const remappedBox = remapped.data.legacyCallout.textBoxPosition;
  const restoredBox = restored[1].objects[0].data.legacyCallout.textBoxPosition;
  assert.equal(remapped.data.id, 'callout-xf-hist');
  assert.notEqual(remappedBox.x, beforeBox.x);
  assert.equal(restored[1].objects.length, 1);
  assert.ok(Math.abs(restoredBox.x - remappedBox.x) < 1e-6);
  assert.ok(Math.abs(restoredBox.y - remappedBox.y) < 1e-6);
  assert.ok(Math.abs(restoredBox.x - beforeBox.x) > 0.01, 'restore must not rewind to pre-rotate fraction');
  assert.equal(restored[1].width, 792);
  assert.equal(restored[1].height, 612);
  assert.equal(second[1].objects.length, 1);
});

test('History restore after CW remap keeps remapped survey-marker bounds', () => {
  const marker = liveMarker();
  const beforeCenter = {
    x: marker.bounds.x + marker.bounds.width / 2,
    y: marker.bounds.y + marker.bounds.height / 2,
  };
  const cw = transformPageState(emptyModel([], 612, 792, {
    surveyMarkers: { [marker.pageNumber ? 'surveyMarker-xf-hist' : 'surveyMarker-xf-hist']: { ...marker } },
  }), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  // transformPageState keys surveyMarkers by the same id
  const remapped = cw.surveyMarkers['surveyMarker-xf-hist'];
  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);
  assert.ok(remapped?.bounds, 'remapper must keep bounds (no invented Fabric left/top)');
  assert.equal(Object.hasOwn(remapped, 'left'), false);
  assert.ok(Math.abs((remapped.bounds.x + remapped.bounds.width / 2) - expected.x) < 1e-6);
  assert.ok(Math.abs((remapped.bounds.y + remapped.bounds.height / 2) - expected.y) < 1e-6);
  assert.ok(Math.abs(remapped.bounds.x - marker.bounds.x) > 1);

  const restoreAction = buildSurveyMarkerRestoreAction('surveyMarker-xf-hist', remapped);
  const restored = applySurveyMarkerRestore({}, restoreAction, { restoredAt: '2026-08-23T00:00:00.000Z' });
  assert.equal(restored.markerId, 'surveyMarker-xf-hist');
  assert.ok(Math.abs(restored.marker.bounds.x - remapped.bounds.x) < 1e-6);
  assert.ok(Math.abs(restored.marker.bounds.y - remapped.bounds.y) < 1e-6);
  assert.ok(Math.abs(restored.marker.bounds.x - marker.bounds.x) > 1);
  const again = applySurveyMarkerRestore(restored.surveyMarkers, restoreAction);
  assert.equal(Object.keys(again.surveyMarkers).length, 1, 'second Restore must not invent an extra id');
});

test('History restore remaining after remap uses live activity Restore; no file.id stamp', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-history-restore-remaining.spec.mjs');
  const panel = read('src/components/revisions/RevisionsPanel.jsx');
  const viewer = read('src/PDFViewer.jsx');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const history = read('src/utils/annotationLocalHistory.js');
  const trash = read('src/services/annotationTrashHistory.js');
  const markerHist = read('src/services/surveyMarkerHistory.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /leftover-18 X-01/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /after-rotate Restore must keep remapped center/);
  assert.match(spec, /after-rotate Restore must not rewind to pre-rotate center/);
  assert.match(spec, /after-rotate Restore must keep swapped viewBox/);
  assert.match(spec, /second Restore must not duplicate the remapped id/);
  assert.match(spec, /collapse\/dismiss must not apply Restore/);
  assert.match(spec, /create-event must omit Restore/);
  assert.match(spec, /390 History restore remaining after remap edge/);
  assert.match(spec, /desktop History restore after CW — callout/);
  assert.match(spec, /desktop History restore after CW — counter/);
  assert.match(spec, /desktop History restore after CW — line/);
  assert.match(spec, /desktop History restore after CW — textbox/);
  assert.match(spec, /desktop History restore after CW — survey-marker/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);

  assert.match(panel, /onRestoreHistoryActivity\(event\)/);
  assert.match(panel, /Only the document owner can save or restore versions/);
  assert.match(viewer, /source: 'history:restore-deleted-annotation'/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(reindex, /rotatePageSpaceCounter/);
  assert.match(reindex, /rotateSurveyMarkerBounds/);
  assert.match(reindex, /rotateCalloutFractions/);
  assert.match(history, /export function stampDisplayedPlacement/);
  assert.match(history, /After page CW remap, Fabric snapshots often store left\/top 0/);
  assert.match(trash, /export function buildAnnotationRestoreAction/);
  assert.match(markerHist, /export function applySurveyMarkerRestore/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
