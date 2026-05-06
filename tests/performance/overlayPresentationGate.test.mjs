import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const APP_SOURCE = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

test('overlay recorder samples include PDF/annotation presentation-gap metrics', () => {
  assert.match(APP_SOURCE, /const visiblePresentationGapPages = \[\];/);
  assert.match(APP_SOURCE, /const viewportPresentationGapPages = \[\];/);
  assert.match(APP_SOURCE, /const pdfReady = hasPdfSurface;/);
  assert.match(APP_SOURCE, /visiblePresentationGapCount: visiblePresentationGapPages\.length/);
  assert.match(APP_SOURCE, /viewportPresentationGapCount: viewportPresentationGapPages\.length/);
});

test('Syncfusion overlay portals are hidden until the PDF page surface is ready', () => {
  assert.match(APP_SOURCE, /const pagePdfReadyState = readSyncfusionPageVisitState\(pageNumber\);/);
  assert.match(APP_SOURCE, /const hideOverlayUntilPdfReady = pageAnnotationObjects\.length > 0 && !pagePdfReadyState\.hasPdfSurface;/);
  assert.match(APP_SOURCE, /visibility: hideOverlayUntilPdfReady \? 'hidden' : undefined/);
  assert.match(APP_SOURCE, /data-overlay-hidden-pending-pdf=\{hideOverlayUntilPdfReady \? 'true' : 'false'\}/);
});

test('page visit diagnostics recognize SVG annotation overlays', () => {
  assert.ok(APP_SOURCE.includes("const hasAnnotationOverlay = !!host?.querySelector?.(["));
  assert.ok(APP_SOURCE.includes("'.canvas-container'"));
  assert.ok(APP_SOURCE.includes("'[data-svg-annotation-layer]'"));
  assert.ok(APP_SOURCE.includes("'[data-overlay-hidden-pending-pdf=\"true\"]'"));
});

test('page visit diagnostics do not mark spinner-covered pages ready', () => {
  assert.match(APP_SOURCE, /ready: hasContainer && hasPdfSurface && !activeSpinner/);
});

test('cursor wheel zoom rejects suspicious Syncfusion 10 percent reports', () => {
  assert.match(APP_SOURCE, /const isSuspiciousWheelZoomPercent = \(reportedPercent, trustedPercent\) =>/);
  assert.match(APP_SOURCE, /reportedPercent <= 10/);
  assert.match(APP_SOURCE, /const correctedSuspiciousZoom = isSuspiciousWheelZoomPercent\(reportedZoom, trustedReactZoom\);/);
  assert.match(APP_SOURCE, /correctedSuspiciousZoom\s*\?\s*trustedReactZoom/);
  assert.match(APP_SOURCE, /debugMark\('zoom_wheel_request'/);
});

test('cursor wheel zoom exponent stays below runaway-to-minimum speed', () => {
  const match = APP_SOURCE.match(/const SYNCFUSION_WHEEL_ZOOM_EXPONENT = ([0-9.]+);/);
  assert.ok(match, 'SYNCFUSION_WHEEL_ZOOM_EXPONENT constant should exist');
  const exponent = Number(match[1]);
  assert.ok(exponent > 0, 'wheel zoom exponent should stay positive');
  assert.ok(exponent <= 0.0012, `wheel zoom exponent should not exceed 0.0012, got ${exponent}`);
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
