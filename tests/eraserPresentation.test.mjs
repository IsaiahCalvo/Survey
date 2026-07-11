import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEraserPreviewBaseline } from '../src/utils/eraserPreviewHandoff.js';
import { getCoalescedOrCurrentEvents } from '../src/utils/eraserPointerSamples.js';

const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const ERASER_SOURCE = readFileSync(
  new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url),
  'utf8',
);
const LEGACY_LAYER_SOURCE = readFileSync(
  new URL('../src/PageAnnotationLayer.jsx', import.meta.url),
  'utf8',
);
const LIGHTWEIGHT_SOURCE = readFileSync(
  new URL('../src/components/LightweightAnnotationOverlay.jsx', import.meta.url),
  'utf8',
);
const PDFJS_ENGINE_SOURCE = readFileSync(
  new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url),
  'utf8',
);
const ANNOTATION_WORKER_SOURCE = readFileSync(
  new URL('../src/components/annotationCanvasWorker.js', import.meta.url),
  'utf8',
);

test('production eraser cursor renders the selected diameter', () => {
  // The eraser cursor is page-local (FabricEraserCanvas). The legacy
  // document-level ring in PDFViewer was dead under pdf.js and removed
  // (de-fragilize P1 batch E) — the diameter contract lives on the
  // page-local cursor: size must route through the diameter→radius helper.
  assert.match(ERASER_SOURCE, /eraserDiameterToPageRadius/);
  assert.match(ERASER_SOURCE, /data-eraser-cursor="true"/);
  assert.match(PDFJS_ENGINE_SOURCE, /surveyPdfjsPanActive/);
  assert.match(PDFJS_ENGINE_SOURCE, /data-survey-pdfjs-pan-active='true'/);
});

test('pdf.js eraser cursor is page-local and advances on the same pointer stream as erase samples', () => {
  assert.match(ERASER_SOURCE, /const cursorRef = useRef\(null\)/);
  assert.match(ERASER_SOURCE, /const updateEraserCursor = useCallback/);
  assert.match(ERASER_SOURCE, /const handlePointerMove[\s\S]*?updateEraserCursor\(point, true\)[\s\S]*?const pointer = pointerRef\.current/);
  assert.match(ERASER_SOURCE, /data-eraser-cursor="true"/);
  // PDFViewer must NOT own a document-level eraser cursor: the legacy
  // tracker effect + ring overlay were removed outright (de-fragilize P1
  // batch E), so the page-local canvas is the only cursor owner.
  assert.doesNotMatch(VIEWER_SOURCE, /data-eraser-cursor="true"/);
  assert.match(VIEWER_SOURCE, /viewerScale=\{layerScale\}/);
  assert.doesNotMatch(ERASER_SOURCE, /viewerScaleRef\.current\s*\|\|\s*getInteractionScale/);
});

test('eraser preview copies the active detail tile without stretching it over the page', () => {
  assert.match(ERASER_SOURCE, /canvas\[data-annotation-detail-active="true"\]/);
  assert.match(ERASER_SOURCE, /preview\.style\.left = source\.style\.left/);
  assert.match(ERASER_SOURCE, /preview\.style\.top = source\.style\.top/);
  assert.match(ERASER_SOURCE, /pageOffsetX/);
  assert.match(ERASER_SOURCE, /pageOffsetY/);
});

test('production exposes the full and partial eraser menu from the eraser caret', () => {
  assert.match(VIEWER_SOURCE, /const hasSplitMenu = isEraser \|\| isHighlighterSplitMenu/);
  assert.match(VIEWER_SOURCE, /data-eraser-caret-button=\{isEraser \? 'true' : undefined\}/);
  assert.match(VIEWER_SOURCE, /setEraserCaretPopupOpen\(\(open\) => !open\)/);
  assert.match(VIEWER_SOURCE, />\s*Partial erase\s*</);
  assert.match(VIEWER_SOURCE, />\s*Full stroke erase\s*</);
});

test('production eraser previews the cut live on one canvas while dragging', () => {
  assert.match(ERASER_SOURCE, /data-eraser-live-preview/);
  assert.match(ERASER_SOURCE, /globalCompositeOperation = 'destination-out'/);
  assert.match(ERASER_SOURCE, /getCoalescedOrCurrentEvents/);
  assert.match(ERASER_SOURCE, /beginLiveErasePreview/);
  assert.match(ERASER_SOURCE, /finishLiveErasePreview/);
});

test('production uses the demo Canvas2D compositing contract during zoom and erase', () => {
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /desynchronized/);
  assert.doesNotMatch(ANNOTATION_WORKER_SOURCE, /desynchronized/);
  assert.doesNotMatch(ERASER_SOURCE, /desynchronized/);
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /getContext\('2d',/);
  assert.doesNotMatch(ANNOTATION_WORKER_SOURCE, /getContext\('2d',/);
  assert.doesNotMatch(ERASER_SOURCE, /getContext\('2d',/);
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /translateZ\(0\)/);
  assert.doesNotMatch(LIGHTWEIGHT_SOURCE, /contain:\s*'strict'/);
});

test('live preview is gated by the same geometry and permission transaction as commit', () => {
  assert.match(ERASER_SOURCE, /planPageEraserPreview/);
  assert.match(ERASER_SOURCE, /getEraseBlockReason/);
  const start = ERASER_SOURCE.indexOf('const handlePointerDown = useCallback');
  const end = ERASER_SOURCE.indexOf('const handlePointerMove = useCallback', start);
  const pointerDownSource = ERASER_SOURCE.slice(start, end);
  assert.match(pointerDownSource, /previewEraserGesture/);
  assert.doesNotMatch(pointerDownSource, /beginLiveErasePreview\(\)\) drawLiveErasePreviewSegment/);
});

test('production eraser commits the latest page model and waits for its exact repaint', () => {
  assert.match(ERASER_SOURCE, /annotationsRef\.current/);
  assert.match(ERASER_SOURCE, /spaceHeldRef\.current/);
  assert.match(ERASER_SOURCE, /window\.addEventListener\('keydown', activateSpacePan, true\)/);
  assert.match(ERASER_SOURCE, /canvasAnnotationRevision/);
  assert.match(ERASER_SOURCE, /closest\('\[data-annotation-real-surface\]'\)/);
  assert.doesNotMatch(ERASER_SOURCE, /canvas\.getObjects\(\)/);
  assert.doesNotMatch(ERASER_SOURCE, /document\.querySelector/);
  assert.doesNotMatch(ERASER_SOURCE, /performance\.now\(\) - started >= 750/);
  assert.match(LIGHTWEIGHT_SOURCE, /canvas\.dataset\.canvasAnnotationRevision/);
  assert.match(LIGHTWEIGHT_SOURCE, /annotations\?\.eraserPresentationRevision/);
  assert.doesNotMatch(ERASER_SOURCE, /flushSync/);
});

test('legacy fallback treats the configured eraser size as a diameter too', () => {
  assert.match(LEGACY_LAYER_SOURCE, /Eraser diameter in page pixels/);
  assert.equal(
    LEGACY_LAYER_SOURCE.match(/\(eraserSizeRef\.current \|\| 20\) \/ 2/g)?.length,
    2,
  );
});

test('rapid erase reuses the latest preview while the worker canvas is stale', () => {
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'eraser:2',
    sourceRevision: 'eraser:1',
    previewRevision: 'eraser:2',
    previewVisible: true,
  }), 'preview');
});

test('a settled worker canvas becomes the next gesture baseline', () => {
  assert.equal(selectEraserPreviewBaseline({
    expectedRevision: 'eraser:2',
    sourceRevision: 'eraser:2',
    previewRevision: '',
    previewVisible: false,
  }), 'source');
});

test('an empty coalesced-event list falls back to the current pointer event', () => {
  const nativeEvent = { getCoalescedEvents: () => [] };
  assert.deepEqual(getCoalescedOrCurrentEvents(nativeEvent), [nativeEvent]);
});

test('pointer-up samples and previews its endpoint before committing geometry', () => {
  const start = ERASER_SOURCE.indexOf('const finishPointer = useCallback');
  const end = ERASER_SOURCE.indexOf('\n  useEffect(() => {', start);
  const finishPointerSource = ERASER_SOURCE.slice(start, end);

  assert.match(finishPointerSource, /const releasePoint = pagePoint\(event\.nativeEvent\)/);
  assert.match(finishPointerSource, /pointer\.points\.push\(releasePoint\)/);
  assert.match(finishPointerSource, /previewEraserGesture/);
  assert.match(finishPointerSource, /applyEraserAndCommit\(pointer\.points\)/);
});

test('lost pointer capture cancels the stale erase session and permits the next down', () => {
  assert.match(ERASER_SOURCE, /const handleLostPointerCapture = useCallback/);
  assert.match(ERASER_SOURCE, /onLostPointerCapture=\{handleLostPointerCapture\}/);
  assert.match(ERASER_SOURCE, /const handlePointerDown[\s\S]*?if \(pointerRef\.current\) cancelPointer\(\)/);
  assert.match(ERASER_SOURCE, /const handlePointerMove[\s\S]*?event\.buttons === 0[\s\S]*?cancelPointer\(\)/);
});

test('preview handoff never reveals a known-stale presentation on a timer', () => {
  const start = ERASER_SOURCE.indexOf('const scheduleLiveErasePreviewFinish = useCallback');
  const end = ERASER_SOURCE.indexOf('\n  const getSpaceIdForRegion', start);
  const handoffSource = ERASER_SOURCE.slice(start, end);

  assert.doesNotMatch(handoffSource, /ERASER_PREVIEW_HANDOFF_TIMEOUT_MS/);
  assert.doesNotMatch(handoffSource, /now - startedAt/);
  assert.match(handoffSource, /canvasAnnotationRevision === expectedRevision/);
});

test('benchmark rendering and eraser interaction never use different page models', () => {
  assert.match(
    VIEWER_SOURCE,
    /annotations=\{isEraserTool \? pageAnnotations : benchmarkPageAnnotations\}/,
  );
});

test('eraser undo uses its precise local action instead of cloning the full document checkpoint', () => {
  const start = VIEWER_SOURCE.indexOf('const handleSaveAnnotations = useCallback');
  const end = VIEWER_SOURCE.indexOf('// KAL-313: Space restore', start);
  const saveSource = VIEWER_SOURCE.slice(start, end);
  const preciseSkip = saveSource.indexOf('else if (isEraserCommit)');
  const legacyCheckpoint = saveSource.indexOf("addHistoryCheckpoint('annotations:save'");

  assert.ok(preciseSkip >= 0, 'expected a precise eraser-history branch');
  assert.ok(legacyCheckpoint > preciseSkip, 'eraser branch must precede full-document checkpointing');
  assert.match(saveSource, /pushLocalAnnotationHistoryAction\(finalLocalHistoryAction\)/);
});
