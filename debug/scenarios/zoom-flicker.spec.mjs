/**
 * Zoom-Flicker Debug Scenario (CAPT-05, FOUN-07)
 *
 * Drives the app through a parameterizable zoom sequence on a page with
 * annotations, capturing synchronized artifacts at each step. Determines
 * pass/fail automatically based on:
 *   - Annotation layers still present after full zoom cycle
 *   - No console errors during execution
 *
 * Uses CaptureContext for all artifact collection (screenshots, console,
 * state, performance). Video is saved in afterEach (Playwright requirement).
 *
 * Parameterization via environment variables (FOUN-07):
 *   ZOOM_MIN  - Starting zoom level (default: 10)
 *   ZOOM_MAX  - Maximum zoom level (default: 200)
 *   ZOOM_STEP - Zoom increment per step (default: 30)
 *   START_PAGE - Page to navigate to (default: 6)
 *
 * Usage:
 *   npm run debug:scenario -- zoom-flicker
 *   ZOOM_MAX=300 START_PAGE=8 npm run debug:scenario -- zoom-flicker
 */

import { test, expect } from '@playwright/test';
import { CaptureContext } from '../lib/capture.mjs';
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ── Environment variable parameters (FOUN-07) ──
const ZOOM_MIN = Number(process.env.ZOOM_MIN || 10);
const ZOOM_MAX = Number(process.env.ZOOM_MAX || 200);
const ZOOM_STEP = Number(process.env.ZOOM_STEP || 30);
const START_PAGE = Number(process.env.START_PAGE || 6);

// ── Module-level state for afterEach video handling ──
let ctx = null;

async function setToolbarZoom(page, zoomLevel) {
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage' });
  await expect(zoomInput).toBeVisible({ timeout: 15_000 });
  await zoomInput.click();
  await zoomInput.fill(String(zoomLevel));
  await zoomInput.press('Enter');
}

async function readToolbarZoom(page) {
  const raw = await page.getByRole('textbox', { name: 'Zoom percentage' }).inputValue();
  return Number(raw);
}

async function countViewportHiddenPendingOverlays(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return Array.from(document.querySelectorAll('[data-overlay-hidden-pending-pdf="true"]'))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
      })
      .length;
  });
}

test.afterEach(async ({ page }) => {
  // Copy video from Playwright's temp location to the session directory.
  // page.video().path() returns the temp path immediately (no wait).
  // The file is finalized when the browser context closes, which happens
  // AFTER afterEach. So we close the page ourselves first.
  if (ctx && page.video()) {
    try {
      const tempVideoPath = page.video().path();
      // Close the page to trigger video finalization
      await page.close();
      // Now saveAs works because the page is closed
      await page.video().saveAs(
        path.join(ctx.getSessionDir(), 'recording.webm')
      );
    } catch {
      // Video may not be available if test failed very early
    }
  }
});

test('zoom-flicker scenario', async ({ page }) => {
  // Zoom scenarios are slow: each step requires readiness waits (up to 30s)
  // and there are 9+ zoom steps plus navigation. 5 minutes is generous.
  test.setTimeout(300_000);

  // ── Console error tracking (independent from console-capture.mjs) ──
  let consoleErrorCount = 0;
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrorCount++;
    }
  });

  // ── 1. Navigate to test page (before capture init -- bridge must exist) ──
  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
  await page.locator('.survey-pdfjs-viewer-container').waitFor({
    state: 'visible',
    timeout: 60_000,
  });

  // Wait for debug bridge availability
  await page.waitForFunction(
    () => window.__debugBridge != null,
    { timeout: 30_000 }
  );

  // Wait for PDF to fully load
  await page.evaluate(() =>
    window.__debugReady.waitFor('pdfLoaded', { timeout: 30000 })
  );

  // ── 2. Navigate to START_PAGE ──
  if (START_PAGE !== 1) {
    const pageInput = page.getByRole('textbox', { name: 'Current page' });
    await expect(pageInput).toBeVisible({ timeout: 15_000 });
    await pageInput.click();
    await pageInput.fill(String(START_PAGE));
    await pageInput.press('Enter');

    // Wait for page navigation + annotation mount
    await page.evaluate(() =>
      window.__debugReady.waitFor('ready', { timeout: 30000 })
    );
  }

  // ── 3. Initialize capture (after page is loaded and ready) ──
  await page.evaluate(() => {
    window.pdfOverlayRecorder?.clear?.();
    window.pdfOverlayRecorder?.start?.({
      samplePageLimit: 6,
      maxSamples: 3000,
      sampleIntervalMs: 24,
      capturePerfAttribution: true,
    });
  });

  ctx = new CaptureContext('zoom-flicker', page);
  await ctx.start();

  // ── 4. Zoom sequence (up) ──
  const requestedZoomLevels = [];
  const observedZoomLevels = [];
  const viewportHiddenPendingDuringZoomCounts = [];
  const zoomLevelsUp = [];
  for (let level = ZOOM_MIN; level <= ZOOM_MAX; level += ZOOM_STEP) {
    zoomLevelsUp.push(level);
  }
  // Ensure ZOOM_MAX is included even if not exactly on a step boundary
  if (zoomLevelsUp[zoomLevelsUp.length - 1] !== ZOOM_MAX) {
    zoomLevelsUp.push(ZOOM_MAX);
  }

  for (const zoomLevel of zoomLevelsUp) {
    await ctx.step(`zoom-${zoomLevel}pct`, async () => {
      requestedZoomLevels.push(zoomLevel);
      await setToolbarZoom(page, zoomLevel);
      await page.waitForTimeout(60);
      viewportHiddenPendingDuringZoomCounts.push(await countViewportHiddenPendingOverlays(page));
    });
    observedZoomLevels.push(await readToolbarZoom(page));
  }

  // ── 5. Zoom sequence (back down) ──
  const zoomLevelsDown = [];
  for (let level = ZOOM_MAX - ZOOM_STEP; level >= ZOOM_MIN; level -= ZOOM_STEP) {
    zoomLevelsDown.push(level);
  }
  // Ensure ZOOM_MIN is included
  if (zoomLevelsDown.length > 0 && zoomLevelsDown[zoomLevelsDown.length - 1] !== ZOOM_MIN) {
    zoomLevelsDown.push(ZOOM_MIN);
  }

  for (const zoomLevel of zoomLevelsDown) {
    await ctx.step(`zoom-${zoomLevel}pct`, async () => {
      requestedZoomLevels.push(zoomLevel);
      await setToolbarZoom(page, zoomLevel);
      await page.waitForTimeout(60);
      viewportHiddenPendingDuringZoomCounts.push(await countViewportHiddenPendingOverlays(page));
    });
    observedZoomLevels.push(await readToolbarZoom(page));
  }

  // ── 6. Pass/fail determination (CAPT-05) ──
  const finalSnap = await page.evaluate(() =>
    window.__debugBridge.snapshot()
  );
  const overlayRecorderDump = await page.evaluate(() =>
    window.pdfOverlayRecorder?.dump?.() || null
  );
  const overlayRecorderResult = await page.evaluate(() =>
    window.pdfOverlayRecorder?.stop?.() || null
  );
  const overlaySummary = overlayRecorderResult?.summary || null;
  if (overlayRecorderDump) {
    writeFileSync(
      path.join(ctx.getSessionDir(), 'overlay-recorder-dump.json'),
      JSON.stringify(overlayRecorderDump, null, 2),
      'utf8'
    );
  }
  if (overlaySummary) {
    writeFileSync(
      path.join(ctx.getSessionDir(), 'overlay-recorder-summary.json'),
      JSON.stringify(overlaySummary, null, 2),
      'utf8'
    );
  }

  const annotationLayersPresent = {
    pass: (finalSnap.canvasContainerCount >= 1 || finalSnap.svgAnnotationLayerCount >= 1),
    canvasContainerCount: finalSnap.canvasContainerCount,
    svgAnnotationLayerCount: finalSnap.svgAnnotationLayerCount,
  };

  const noConsoleErrors = {
    pass: consoleErrorCount === 0,
    errorCount: consoleErrorCount,
  };
  const zoomLevelsReached = {
    pass: requestedZoomLevels.every((requested, index) => {
      const observed = observedZoomLevels[index];
      return Number.isFinite(observed) && Math.abs(observed - requested) <= 1;
    }),
    requestedZoomLevels,
    observedZoomLevels,
  };
  const noViewportOverlayPendingPdfAtRest = await page.evaluate(() => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const pending = Array.from(document.querySelectorAll('[data-overlay-hidden-pending-pdf="true"]'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
        const pageNumber = Number(node.closest?.('.survey-pdfjs-page-div[data-page-number]')?.dataset?.pageNumber);
        return {
          pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
          inViewport,
          rect: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
    const viewportPending = pending.filter((item) => item.inViewport);
    return {
      pass: viewportPending.length === 0,
      count: viewportPending.length,
      totalPendingCount: pending.length,
      pending,
    };
  });
  const overlayRecorderHasSamples = {
    pass: Number(overlaySummary?.sampleCount) > 0,
    sampleCount: overlaySummary?.sampleCount ?? 0,
  };
  const annotationsPersistDuringZoom = {
    pass: viewportHiddenPendingDuringZoomCounts.every((count) => count === 0),
    viewportHiddenPendingDuringZoomCounts,
  };
  const zoomPresentationGapObserved = {
    pass: Number(overlaySummary?.visiblePresentationGapMax ?? 0) === 0 &&
      Number(overlaySummary?.viewportPresentationGapMax ?? 0) === 0,
    visiblePresentationGapMax: overlaySummary?.visiblePresentationGapMax ?? null,
    samplesWithVisiblePresentationGapPct: overlaySummary?.samplesWithVisiblePresentationGapPct ?? null,
    viewportPresentationGapMax: overlaySummary?.viewportPresentationGapMax ?? null,
    samplesWithViewportPresentationGapPct: overlaySummary?.samplesWithViewportPresentationGapPct ?? null,
  };
  const overlayAlignmentStable = {
    pass: Number(overlaySummary?.worstDriftPxMax ?? 0) <= 1 &&
      Number(overlaySummary?.scaleMismatchP95 ?? 0) <= 0.05,
    worstDriftPxMax: overlaySummary?.worstDriftPxMax ?? null,
    worstDriftPxP95: overlaySummary?.worstDriftPxP95 ?? null,
    scaleMismatchMax: overlaySummary?.scaleMismatchMax ?? null,
    scaleMismatchP95: overlaySummary?.scaleMismatchP95 ?? null,
  };
  const zoomFrameBudget = {
    pass: Number(overlaySummary?.frameMsP95) <= 150 &&
      Number(overlaySummary?.jankFrameRatePct) <= 25,
    frameMsAvg: overlaySummary?.frameMsAvg ?? null,
    frameMsP95: overlaySummary?.frameMsP95 ?? null,
    frameMsMax: overlaySummary?.frameMsMax ?? null,
    fpsAvg: overlaySummary?.fpsAvg ?? null,
    jankFrameRatePct: overlaySummary?.jankFrameRatePct ?? null,
  };

  const criteriaResults = {
    annotationLayersPresent,
    noConsoleErrors,
    zoomLevelsReached,
    noViewportOverlayPendingPdfAtRest,
    overlayRecorderHasSamples,
    annotationsPersistDuringZoom,
    zoomPresentationGapObserved,
    overlayAlignmentStable,
    zoomFrameBudget,
  };

  const allCriteriaPassed =
    annotationLayersPresent.pass &&
    noConsoleErrors.pass &&
    zoomLevelsReached.pass &&
    noViewportOverlayPendingPdfAtRest.pass &&
    overlayRecorderHasSamples.pass &&
    annotationsPersistDuringZoom.pass &&
    zoomPresentationGapObserved.pass &&
    overlayAlignmentStable.pass &&
    zoomFrameBudget.pass;
  const result = allCriteriaPassed ? 'pass' : 'fail';

  // ── 7. Finalize ──
  await ctx.finalize(result, criteriaResults);

  // Playwright assertion for CI-friendly output
  expect(
    finalSnap.canvasContainerCount + finalSnap.svgAnnotationLayerCount,
    'Annotation layers must be present after zoom cycle'
  ).toBeGreaterThanOrEqual(1);
  expect(zoomLevelsReached.pass, 'Toolbar zoom must reach every requested level').toBe(true);
  expect(noViewportOverlayPendingPdfAtRest.count, 'No viewport annotation overlay should remain hidden waiting for PDF at rest').toBe(0);
  expect(overlayRecorderHasSamples.pass, 'Overlay recorder must capture samples').toBe(true);
  expect(annotationsPersistDuringZoom.pass, 'Viewport annotations must persist during zoom').toBe(true);
  expect(zoomPresentationGapObserved.pass, 'Zoom must not show annotations without a PDF surface').toBe(true);
  expect(overlayAlignmentStable.pass, 'Zoom overlay alignment must stay within drift/scale mismatch budget').toBe(true);
  expect(zoomFrameBudget.pass, 'Zoom frame budget regression gate must pass').toBe(true);
});
