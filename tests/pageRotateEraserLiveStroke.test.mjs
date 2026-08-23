import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';
import { eraserStrokeTouchesObject } from '../src/utils/eraserHitTest.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { getEraserOperation } from '../src/utils/eraserPolicy.js';

// Source contracts: Partial / Full eraser live stroke AFTER page CW remaps
// live page-space ink (path + paperCenterline; left 0; viewBox 0 0 792 612).
// Distinct from unrotated e2e-eraser-live-stroke (portrait 0 0 612 792).
// Bite/delete must hit remapped centerline, not the pre-rotate ghost.
// Live proof: debug/scenarios/e2e-page-rotate-eraser-live-stroke.spec.mjs
// Do not pad rotatePageSpaceInk. Named Save version stays leftover-18 X-01.

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

function rotateModel(model, delta, pageWidth, pageHeight) {
  return transformPageState(model, {
    type: 'rotate',
    page: 1,
    delta,
    pageWidth,
    pageHeight,
  });
}

function liveInk(id, points) {
  return createProductionPaperInk({
    id,
    tool: 'pen',
    points,
    color: '#111111',
    width: 8,
    data: { id, tool: 'pen' },
  });
}

const INK_A_POINTS = [
  { x: 134.64, y: 237.60 },
  { x: 260, y: 320 },
  { x: 300, y: 280 },
];
const INK_B_POINTS = [
  { x: 134.64, y: 540.00 },
  { x: 260, y: 600 },
  { x: 300, y: 560 },
];

function remappedPair() {
  const inkA = liveInk('xf-erase-remap-a', INK_A_POINTS);
  const inkB = liveInk('xf-erase-remap-b', INK_B_POINTS);
  const cw = rotateModel(emptyModel([inkA, inkB]), 90, 612, 792);
  const page = cw.annotationsByPage[1];
  return {
    beforeA: inkA,
    beforeB: inkB,
    page,
    remappedA: page.objects[0],
    remappedB: page.objects[1],
    expectedA: rotateDisplayedPoint(inkA.paperCenterline[0].x, inkA.paperCenterline[0].y, 612, 792, 90),
    expectedB: rotateDisplayedPoint(inkB.paperCenterline[0].x, inkB.paperCenterline[0].y, 612, 792, 90),
  };
}

function swipeAround(point, radius = 10) {
  return [
    { x: point.x - radius, y: point.y },
    { x: point.x, y: point.y },
    { x: point.x + radius, y: point.y },
  ];
}

test('Partial erase bites remapped ink, misses pre-rotate ghost, isolates the second mark', () => {
  const { beforeA, page, remappedA, remappedB, expectedA } = remappedPair();
  assert.equal(page.width, 792);
  assert.equal(page.height, 612);
  assert.equal(remappedA.left, 0);
  assert.equal(remappedA.angle, 0);
  assert.ok(Math.abs(remappedA.paperCenterline[0].x - expectedA.x) < 1e-6);
  assert.ok(Math.abs(remappedA.paperCenterline[0].y - expectedA.y) < 1e-6);
  assert.ok(
    Math.abs(remappedA.paperCenterline[0].x - beforeA.paperCenterline[0].x) > 1,
    'must not stay on the pre-rotate point',
  );

  const remappedSwipe = swipeAround(expectedA, 14);
  const ghostSwipe = swipeAround(beforeA.paperCenterline[0], 14);
  const emptySwipe = [{ x: 40, y: 40 }, { x: 56, y: 52 }];

  assert.equal(
    eraserStrokeTouchesObject({ eraserPoints: remappedSwipe, eraserRadius: 16, object: remappedA }),
    true,
    'remapped swipe must hit remapped ink',
  );
  assert.equal(
    eraserStrokeTouchesObject({ eraserPoints: ghostSwipe, eraserRadius: 16, object: remappedA }),
    false,
    'pre-rotate ghost swipe must miss remapped ink',
  );
  assert.equal(
    eraserStrokeTouchesObject({ eraserPoints: remappedSwipe, eraserRadius: 16, object: remappedB }),
    false,
    'remapped A swipe must isolate B',
  );

  const ghost = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: ghostSwipe,
    eraserRadius: 16,
    mode: 'partial',
  });
  assert.equal(ghost.didChange, false, 'ghost swipe invents 0');
  assert.equal(ghost.changedIds.length, 0);
  assert.equal(ghost.deletedIds.length, 0);

  const empty = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: emptySwipe,
    eraserRadius: 16,
    mode: 'partial',
  });
  assert.equal(empty.didChange, false, 'empty swipe invents 0');

  const bite = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: remappedSwipe,
    eraserRadius: 16,
    mode: 'partial',
  });
  assert.equal(bite.didChange, true, 'remapped swipe must bite');
  assert.ok(bite.touchedIds.includes('xf-erase-remap-a') || bite.changedIds.includes('xf-erase-remap-a') || bite.deletedIds.includes('xf-erase-remap-a'));
  assert.equal(bite.touchedIds.includes('xf-erase-remap-b'), false);
  assert.equal(bite.changedIds.includes('xf-erase-remap-b'), false);
  assert.equal(bite.deletedIds.includes('xf-erase-remap-b'), false);
  const afterB = bite.pageAnnotations.objects.find((obj) => (obj.data?.id || obj.id) === 'xf-erase-remap-b');
  assert.ok(afterB, 'Partial bite must isolate remapped ink B');
  assert.ok(Math.abs(afterB.paperCenterline[0].x - remappedB.paperCenterline[0].x) < 1e-6);

  assert.equal(getEraserOperation(remappedA, 'partial'), 'partial');
  assert.equal(getEraserOperation(remappedA, 'entire'), 'entire');
});

test('Full erase deletes remapped ink A and isolates remapped ink B', () => {
  const { beforeA, page, remappedB, expectedA } = remappedPair();
  const remappedSwipe = swipeAround(expectedA, 14);
  const ghostSwipe = swipeAround(beforeA.paperCenterline[0], 14);

  const ghost = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: ghostSwipe,
    eraserRadius: 16,
    mode: 'entire',
  });
  assert.equal(ghost.didChange, false, 'Full ghost swipe invents 0');

  const wiped = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: remappedSwipe,
    eraserRadius: 16,
    mode: 'entire',
  });
  assert.equal(wiped.didChange, true);
  assert.ok(wiped.deletedIds.includes('xf-erase-remap-a'));
  assert.equal(wiped.deletedIds.includes('xf-erase-remap-b'), false);
  const ids = wiped.pageAnnotations.objects.map((obj) => obj.data?.id || obj.id);
  assert.equal(ids.includes('xf-erase-remap-a'), false);
  assert.ok(ids.includes('xf-erase-remap-b'));
  const afterB = wiped.pageAnnotations.objects.find((obj) => (obj.data?.id || obj.id) === 'xf-erase-remap-b');
  assert.ok(Math.abs(afterB.paperCenterline[0].x - remappedB.paperCenterline[0].x) < 1e-6);
});

test('live remapped-eraser spec + zoomGeneration / viewBox / pagePoint stay wired', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-eraser-live-stroke.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop remapped-ink eraser live stroke intended \+ break \+ edge/);
  assert.match(spec, /390 remapped-ink eraser live stroke edge/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must remap ink A centerline/);
  assert.match(spec, /page rotate must keep swapped viewBox/);
  assert.match(spec, /empty swipe invents 0/);
  assert.match(spec, /ghost swipe at pre-rotate location invents 0/);
  assert.match(spec, /Partial live drag must not commit yet/);
  assert.match(spec, /Partial pointerup must bite remapped ink/);
  assert.match(spec, /Partial bite must isolate remapped ink B/);
  assert.match(spec, /Full-stroke pointerup must delete remapped ink A/);
  assert.match(spec, /Full stroke isolates remapped ink B/);
  assert.match(spec, /zoom mid-stroke must flush the erase commit/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /Distinct from unrotated e2e-eraser-live-stroke/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /setActiveTool\('polygon'\)|setActiveTool\('polyline'\)/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);

  const canvas = read('src/components/FabricEraserCanvas.jsx');
  assert.match(canvas, /data-eraser-live-preview=\{pageNumber\}/);
  assert.match(canvas, /data-eraser-mask-clone/);
  assert.match(canvas, /zoomGeneration/);
  assert.match(canvas, /void commitPointerForZoom\(\)/);
  assert.match(canvas, /x: \(\(nativeEvent\.clientX - rect\.left\) \/ rect\.width\) \* pageWidth/);
  assert.match(canvas, /y: \(\(nativeEvent\.clientY - rect\.top\) \/ rect\.height\) \* pageHeight/);
  assert.doesNotMatch(canvas, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.doesNotMatch(canvas, /file\.id\s*=/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /beginPdfjsScaleConfirmPending/);
  assert.match(viewer, /pageWidth=\{resolvedPageSize\.width\}/);
  assert.match(viewer, /pageHeight=\{resolvedPageSize\.height\}/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /zoomGeneration/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const remapper = read('src/utils/pageAnnotationReindex.js');
  assert.match(remapper, /export function rotatePageSpaceInk/);

  const unrotated = read('debug/scenarios/e2e-eraser-live-stroke.spec.mjs');
  assert.match(unrotated, /0 0 612 792/);
  assert.doesNotMatch(unrotated, /0 0 792 612/);
  assert.doesNotMatch(unrotated, /page rotate must remap ink A centerline/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
