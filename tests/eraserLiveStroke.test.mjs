import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getEraserOperation } from '../src/utils/eraserPolicy.js';

// Source contracts for D-03 / D-04 leftover: live Partial / Full eraser
// stroke then commit (in-drag preview + pointerup). Live proof:
// debug/scenarios/e2e-eraser-live-stroke.spec.mjs
// Distinct from Size catalog, type dropdown, leftover-18.
// Line single-click mtr is 0 (p1/p2/midpoint only). No create-poly tool.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('live eraser preview + zoomGeneration flush + pointercancel commit stay wired', () => {
  const canvas = read('src/components/FabricEraserCanvas.jsx');
  assert.match(canvas, /data-eraser-live-preview=\{pageNumber\}/);
  assert.match(canvas, /data-eraser-mask-clone/);
  assert.match(canvas, /data-eraser-carve-chunk/);
  assert.match(canvas, /zoomGeneration/);
  assert.match(canvas, /zoom starting mid-swipe COMMITS the partial erase instead of/);
  assert.match(canvas, /void commitPointerForZoom\(\)/);
  assert.match(canvas, /pointercancel \(OS gesture takeover etc\.\): commit the erase performed/);
  assert.match(canvas, /void commitInterruptedPointer\(pointer\)/);
  assert.match(canvas, /onPointerCancel=\{\(event\) => finishPointer\(event, true\)\}/);
  assert.match(canvas, /onPointerUp=\{\(event\) => finishPointer\(event, false\)\}/);
  assert.match(canvas, /beginMaskClonePreview/);
  assert.match(canvas, /void queueEraserCommit\(pointer\)/);
  assert.doesNotMatch(canvas, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /beginPdfjsScaleConfirmPending/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /const isLineType = String\(selectionObj\.type \|\| ''\)\.toLowerCase\(\) === 'line'/);
  assert.match(layer, /if \(isLineType && !lineInBboxMode\)/);
  assert.match(layer, /handleHandlePointerDown\(e, 'p1'\)/);
  assert.match(layer, /handleHandlePointerDown\(e, 'p2'\)/);
  assert.match(layer, /handleHandlePointerDown\(e, 'midpoint'\)/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const rect = { type: 'rect', left: 10, top: 10, width: 40, height: 20 };
  const ink = { type: 'path', tool: 'pen', path: [['M', 0, 0], ['L', 20, 20]], stroke: '#111', strokeWidth: 4 };
  assert.equal(getEraserOperation(rect, 'partial'), 'skip');
  assert.equal(getEraserOperation(ink, 'partial'), 'partial');
  assert.equal(getEraserOperation(rect, 'entire'), 'entire');
  assert.equal(getEraserOperation(ink, 'entire'), 'entire');

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /\{false && \(/);
  assert.doesNotMatch(shell, /setActiveTool\('polygon'\)|setActiveTool\('polyline'\)/);

  const viewerNoStamp = read('src/PDFViewer.jsx');
  assert.doesNotMatch(viewerNoStamp, /setActiveTool\('stamp'\)/);
  assert.doesNotMatch(viewerNoStamp, /setActiveTool\('image'\)/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers preview / commit / cancel-commit / zoom flush / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-eraser-live-stroke.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop eraser live stroke intended \+ break \+ edge/);
  assert.match(spec, /390 eraser live stroke intended \+ break \+ edge/);
  assert.match(spec, /empty page live eraser preview 0/);
  assert.match(spec, /empty swipe must not paint eraser preview/);
  assert.match(spec, /empty swipe invents 0/);
  assert.match(spec, /live eraser preview must paint before pointerup/);
  assert.match(spec, /Partial live drag must not commit yet/);
  assert.match(spec, /Partial pointerup must drop the preview/);
  assert.match(spec, /Partial pointerup must bite ink/);
  assert.match(spec, /pointercancel must drop the preview/);
  assert.match(spec, /pointercancel must commit the live erase \(not discard\)/);
  assert.match(spec, /zoom mid-stroke starts with live preview/);
  assert.match(spec, /zoom mid-stroke must flush the erase commit/);
  assert.match(spec, /zoom mid-stroke must drop the preview/);
  assert.match(spec, /Full-stroke live drag must not commit yet/);
  assert.match(spec, /Full-stroke live preview must paint before pointerup/);
  assert.match(spec, /Full-stroke pointerup must drop the preview/);
  assert.match(spec, /Full-stroke pointerup must delete rect A/);
  assert.match(spec, /setEraserType/);
  assert.match(spec, /setMobileEraserMode/);
  assert.match(spec, /Pen hides eraser wrapper/);
  assert.match(spec, /390 Partial live drag must not commit yet/);
  assert.match(spec, /390 Partial live preview must paint before pointerup/);
  assert.match(spec, /390 Full-stroke pointerup must delete the rect/);
  assert.match(spec, /data-eraser-mask-clone/);
  assert.match(spec, /data-eraser-live-preview/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('live eraser stroke is not type\/Size catalog / Line mtr / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-eraser-live-stroke.spec.mjs');
  assert.match(spec, /D-03 \/ D-04 leftover: live Partial \/ Full eraser stroke then commit/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.match(spec, /Line single-click mtr is 0/);
  assert.match(spec, /No create-poly tool/);
  assert.doesNotMatch(spec, /Eraser type catalog|Shift\+E forces Partial erase|caret flyout/);
  assert.doesNotMatch(spec, /data-rotation-handle="mtr"|dragResizeHandle|Match fill/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /freehand-creation-preview/);
  assert.doesNotMatch(spec, /setActiveTool\('polygon'\)|setActiveTool\('polyline'\)/);

  const canvas = read('src/components/FabricEraserCanvas.jsx');
  assert.doesNotMatch(canvas, /file\.id\s*=/);
  assert.match(canvas, /zoomGeneration/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
