import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const APP_SOURCE = readFileSync(new URL('../../src/viewerShared.js', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../../src/PDFViewer.jsx', import.meta.url), 'utf8')
  // overlay-lag recorder summary logic was lifted into its own module (2026-05-29);
  // keep it in the scanned source so the guard still verifies the relocated code.
  + '\n' + readFileSync(new URL('../../src/utils/overlayDebug.js', import.meta.url), 'utf8');

test('overlay recorder samples include PDF/annotation presentation-gap metrics', () => {
  assert.match(APP_SOURCE, /const visiblePresentationGapPages = \[\];/);
  assert.match(APP_SOURCE, /const viewportPresentationGapPages = \[\];/);
  assert.match(APP_SOURCE, /const pdfReady = hasPdfSurface \|\| snapshotVisible \|\| paintReady;/);
  assert.match(APP_SOURCE, /visiblePresentationGapCount: visiblePresentationGapPages\.length/);
  assert.match(APP_SOURCE, /viewportPresentationGapCount: viewportPresentationGapPages\.length/);
});

test('Syncfusion overlay portals are hidden until the PDF page surface is ready', () => {
  assert.match(APP_SOURCE, /const pagePdfReadyState = readSyncfusionPageVisitState\(pageNumber\);/);
  assert.match(APP_SOURCE, /const pagePdfHasEverBeenReady = syncfusionPagePdfEverReadyRef\.current\.has\(pageNumber\);/);
  // The Syncfusion overlay readiness gate stays intact for the Syncfusion engine.
  // Under the owned pdf.js engine it is intentionally exempted (pdf.js has no
  // Syncfusion page surface for the readiness probe to detect, and rasters fast).
  assert.match(APP_SOURCE, /const hideOverlayUntilPdfReady = getPDFViewerEngine\(\) !== PDF_VIEWER_ENGINE_PDFJS &&\s*pageAnnotationObjects\.length > 0 &&\s*!pagePdfHasEverBeenReady &&\s*!pagePdfReadyState\.ready;/);
  assert.match(APP_SOURCE, /visibility: hideOverlayUntilPdfReady \? 'hidden' : undefined/);
  assert.match(APP_SOURCE, /data-pdf-ever-ready=\{pagePdfHasEverBeenReady \? 'true' : 'false'\}/);
  assert.match(APP_SOURCE, /data-overlay-hidden-pending-pdf=\{hideOverlayUntilPdfReady \? 'true' : 'false'\}/);
});

test('page visit diagnostics recognize SVG annotation overlays', () => {
  assert.ok(APP_SOURCE.includes("const hasAnnotationOverlay = !!host?.querySelector?.(["));
  assert.ok(APP_SOURCE.includes("'.canvas-container'"));
  assert.ok(APP_SOURCE.includes("'[data-svg-annotation-layer]'"));
  assert.ok(APP_SOURCE.includes("'[data-overlay-hidden-pending-pdf=\"true\"]'"));
});

test('page visit diagnostics treat painted pages as ready even if Syncfusion spinner lingers', () => {
  assert.match(APP_SOURCE, /const hasVisibleSyncfusionSpinner = \(host\) =>/);
  assert.match(APP_SOURCE, /const activeSpinner = hasVisibleSyncfusionSpinner\(host\);/);
  assert.match(APP_SOURCE, /const spinnerVisible = hasVisibleSyncfusionSpinner\(pageHost\);/);
  assert.match(APP_SOURCE, /ready: hasContainer && hasPdfSurface/);
});

test('cursor wheel zoom rejects suspicious Syncfusion 10 percent reports', () => {
  assert.match(APP_SOURCE, /const isSuspiciousWheelZoomPercent = \(reportedPercent, trustedPercent\) =>/);
  assert.match(APP_SOURCE, /reportedPercent <= 10/);
  assert.match(APP_SOURCE, /const correctedSuspiciousZoom = isSuspiciousWheelZoomPercent\(reportedZoom, trustedReactZoom\);/);
  assert.match(APP_SOURCE, /correctedSuspiciousZoom\s*\?\s*trustedReactZoom/);
  assert.match(APP_SOURCE, /debugMark\('zoom_wheel_request'/);
});

test('cursor wheel zoom response stays capped below runaway speed', () => {
  const match = APP_SOURCE.match(/const SYNCFUSION_WHEEL_ZOOM_EXPONENT = ([0-9.]+);/);
  assert.ok(match, 'SYNCFUSION_WHEEL_ZOOM_EXPONENT constant should exist');
  const exponent = Number(match[1]);
  assert.ok(exponent > 0, 'wheel zoom exponent should stay positive');
  assert.ok(exponent <= 0.004, `wheel zoom exponent should not exceed 0.004, got ${exponent}`);
  const maxStepMatch = APP_SOURCE.match(/const SYNCFUSION_WHEEL_ZOOM_MAX_STEP_PERCENT = (\d+);/);
  assert.ok(maxStepMatch, 'wheel zoom max-step cap should exist');
  const maxStepPercent = Number(maxStepMatch[1]);
  assert.ok(maxStepPercent < 25, `wheel zoom max step should stay below the recorder's big-jump threshold, got ${maxStepPercent}%`);
});

test('overlay recorder expected scale accounts for active zoom transform', () => {
  assert.ok(APP_SOURCE.includes('const overlayContentHasScaleTransform = Math.abs(observedScale - 1) > 0.001;'));
  assert.ok(APP_SOURCE.includes('const zoomOverlayBaseScale = Number(zoomOverlayBaseScaleRef.current) || pageBaseScale;'));
  assert.ok(APP_SOURCE.includes('const expectedScale = zoomOverlayTransformActiveRef.current && overlayContentHasScaleTransform'));
  assert.ok(APP_SOURCE.includes('? (viewerScale / zoomOverlayBaseScale)'));
});

test('Syncfusion scroll page-request delay stays within a one-to-two-frame budget', () => {
  const match = APP_SOURCE.match(/const SYNCFUSION_SCROLL_DELAY_MS = (\d+);/);
  assert.ok(match, 'SYNCFUSION_SCROLL_DELAY_MS constant should exist');
  const delayMs = Number(match[1]);
  assert.ok(delayMs > 0, 'scroll delay should remain explicit');
  assert.ok(delayMs <= 32, `scroll delay should be <= 32ms, got ${delayMs}ms`);
});

test('Syncfusion wheel scroll gain follows a smooth zoom-aware curve', () => {
  assert.match(APP_SOURCE, /const getSyncfusionZoomAwareScrollGain = \(zoomScale\) =>/);
  assert.match(APP_SOURCE, /Math\.log2\(safeZoom\)/);
  assert.match(APP_SOURCE, /SYNCFUSION_SCROLL_ZOOM_OUT_GAIN/);
  assert.match(APP_SOURCE, /SYNCFUSION_SCROLL_ZOOM_IN_GAIN/);
  assert.match(APP_SOURCE, /const currentZoomForScroll = Math\.max\(1, Number\(scaleRef\.current\) \|\| 1\);/);
  assert.match(APP_SOURCE, /const zoomAwareSensitivity = getSyncfusionZoomAwareScrollGain\(currentZoomForScroll\);/);
});

test('rapid Syncfusion page-window refreshes are batched during interaction', () => {
  assert.match(APP_SOURCE, /const SYNCFUSION_INTERACTION_VISIBLE_PAGE_REFRESH_MS = 160;/);
  assert.match(APP_SOURCE, /const scheduleSyncfusionVisiblePagesRefresh = useCallback/);
  assert.match(APP_SOURCE, /scheduleSyncfusionVisiblePagesRefresh\(\);/);
});

test('wheel scroll applies once per frame-sized batch', () => {
  assert.match(APP_SOURCE, /const SYNCFUSION_WHEEL_SCROLL_BATCH_MS = 24;/);
  assert.match(APP_SOURCE, /setTimeout\(flushWheelScroll, SYNCFUSION_WHEEL_SCROLL_BATCH_MS\)/);
});

test('overlay recorder attributes idle work categories', () => {
  assert.match(APP_SOURCE, /const OVERLAY_LAG_RECORDER_WORK_CATEGORIES = \[/);
  assert.match(APP_SOURCE, /'annotationRestoration'/);
  assert.match(APP_SOURCE, /'pageRenderCatchup'/);
  assert.match(APP_SOURCE, /'syncfusionInternals'/);
  assert.match(APP_SOURCE, /'measurementWork'/);
  assert.match(APP_SOURCE, /const OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_MS = 8;/);
  assert.match(APP_SOURCE, /const OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_FRAME_RATIO = 0\.2;/);
  assert.match(APP_SOURCE, /const measuredWork = \[/);
  assert.match(APP_SOURCE, /strongestMeasuredMs >= OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_MS/);
  assert.match(APP_SOURCE, /idleWorkHotspots/);
  assert.match(APP_SOURCE, /slowFrameAttributionHotspots/);
  assert.match(APP_SOURCE, /unattributedRafPause/);
});
