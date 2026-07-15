import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const OVERLAY_SOURCE = readFileSync(
  new URL('../src/components/LightweightAnnotationOverlay.jsx', import.meta.url),
  'utf8',
);
const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const SHARED_SOURCE = readFileSync(new URL('../src/viewerShared.js', import.meta.url), 'utf8');
const WORKER_SOURCE = readFileSync(
  new URL('../src/components/annotationCanvasWorker.js', import.meta.url),
  'utf8',
);

test('SVG is the one committed renderer; Canvas2D serves only eraser + proxy windows', () => {
  assert.match(OVERLAY_SOURCE, /paintAnnotationCanvas/);
  assert.match(OVERLAY_SOURCE, /<canvas/);
  assert.doesNotMatch(OVERLAY_SOURCE, /<svg/);
  assert.doesNotMatch(OVERLAY_SOURCE, /objectPreviews\.map/);
  // Unified renderer (2026-07-14): committed annotations are painted by
  // SVGAnnotationLayer in EVERY tool mode. The canvas presentation is visible
  // only (a) while an erase stroke's live preview is carving that page
  // (erasePreviewPages — mere eraser mode must NOT swap: the two rasterizers
  // disagree by ±1 device px at fractional zoom stops, so a settled-state
  // swap visibly bobs text on E/P toggling), and (b) during the transient
  // zoom/scroll proxy window. Reintroducing a per-tool renderer swap
  // regresses the counter-dot / tool-switch-flicker / text-bob bug family.
  assert.match(VIEWER_SOURCE, /const useCanvasPresentation = isEraserTool && erasePreviewPages\.has\(pageNumber\);/);
  assert.match(VIEWER_SOURCE, /data-annotation-presentation=\{useCanvasPresentation \? 'canvas2d' : 'svg-edit'\}/);
  assert.match(VIEWER_SOURCE, /<LightweightAnnotationOverlay[\s\S]*?visible=\{useCanvasPresentation \|\| suspendFullSvgForProxy\}/);
  // The canvas overlay wrapper must fill the page host (inset/100%), never
  // size itself from `pageSize * scale` px — a stale scale scalar would drift
  // the whole committed layer off the page box.
  assert.doesNotMatch(OVERLAY_SOURCE, /width: `\$\{overlayWidth\}px`/);
});

test('interaction snapshots do not truncate visible annotations or callouts', () => {
  assert.doesNotMatch(VIEWER_SOURCE, /\.slice\(0, 520\)/);
  assert.doesNotMatch(VIEWER_SOURCE, /\.slice\(0, 180\)/);
  assert.doesNotMatch(OVERLAY_SOURCE, /MAX_PREVIEW_OBJECTS/);
  assert.doesNotMatch(OVERLAY_SOURCE, /MAX_PREVIEW_CALLOUTS/);
});

test('Canvas2D presentation includes survey markers stored outside annotation objects', () => {
  assert.match(OVERLAY_SOURCE, /surveyMarkers = EMPTY_ARR/);
  assert.match(OVERLAY_SOURCE, /surveyMarkerObjects/);
  assert.match(OVERLAY_SOURCE, /globalCompositeOperation: 'multiply'/);
});

test('production viewer never starts a timer-based renderer handoff for pan or zoom', () => {
  const viewerMount = VIEWER_SOURCE.slice(
    VIEWER_SOURCE.indexOf('<PdfjsViewerContainer'),
    VIEWER_SOURCE.indexOf('/>', VIEWER_SOURCE.indexOf('<PdfjsViewerContainer')),
  );
  assert.doesNotMatch(viewerMount, /onViewportInteraction/);
  assert.doesNotMatch(viewerMount, /restrictZoomRequest/);
});

test('E activates the eraser without overwriting its remembered erase mode', () => {
  const eraserHotkey = VIEWER_SOURCE.slice(
    VIEWER_SOURCE.indexOf("// 'E' key to switch to Eraser Tool"),
    VIEWER_SOURCE.indexOf("// 'Shift+E' key to switch to Partial Erase Tool"),
  );

  assert.match(eraserHotkey, /setActiveTool\('eraser'\)/);
  assert.doesNotMatch(eraserHotkey, /setEraserMode/);
});

test('dense annotation pages paint off the main thread and swap one finished bitmap', () => {
  assert.match(OVERLAY_SOURCE, /WORKER_OBJECT_THRESHOLD = 500/);
  assert.match(OVERLAY_SOURCE, /new Worker\(new URL\('\.\/annotationCanvasWorker\.js'/);
  assert.match(OVERLAY_SOURCE, /worker\.postMessage/);
  assert.match(OVERLAY_SOURCE, /context\.drawImage\(message\.bitmap, 0, 0\)/);
  assert.match(WORKER_SOURCE, /paintAnnotationCanvas/);
  assert.match(WORKER_SOURCE, /transferToImageBitmap/);
});

test('dense zoom repaints reuse worker-cached annotation data', () => {
  assert.match(OVERLAY_SOURCE, /workerSentDataRevisionRef/);
  assert.match(OVERLAY_SOURCE, /const alreadyCached =/);
  assert.match(OVERLAY_SOURCE, /\? \{ type: 'render', \.\.\.renderOnlyPayload \}/);
  assert.match(WORKER_SOURCE, /let cachedDataRevision = null/);
  assert.match(WORKER_SOURCE, /request\.dataRevision !== cachedDataRevision/);
  assert.match(WORKER_SOURCE, /objects: cachedObjects/);
  assert.match(VIEWER_SOURCE, /productionAnnotationBenchmarkMergeCacheRef/);
});

test('clamped full-page canvases switch to a DPR-correct viewport detail tile', () => {
  assert.match(OVERLAY_SOURCE, /calculateAnnotationDetailTile/);
  assert.match(OVERLAY_SOURCE, /data-annotation-detail-active/);
  assert.match(OVERLAY_SOURCE, /detailCanvasRef/);
  assert.match(OVERLAY_SOURCE, /addEventListener\('scroll'/);
  assert.match(WORKER_SOURCE, /offsetX: request\.offsetX/);
  assert.match(WORKER_SOURCE, /offsetY: request\.offsetY/);
});

test('annotation detail repaint pauses for the owned zoom and pan gestures', () => {
  assert.match(OVERLAY_SOURCE, /survey-pdfjs-zoom-start/);
  assert.match(OVERLAY_SOURCE, /survey-pdfjs-zoom-end/);
  assert.match(OVERLAY_SOURCE, /survey-pdfjs-pan-start/);
  assert.match(OVERLAY_SOURCE, /survey-pdfjs-pan-end/);
  assert.match(OVERLAY_SOURCE, /if \(viewportInteractionRef\.current\) return/);
});
