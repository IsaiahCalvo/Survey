import { test, expect } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

const START_PAGE = Number(process.env.START_PAGE || 6);
const START_ZOOM = Number(process.env.START_ZOOM || 160);
const STRESS_ROUNDS = Number(process.env.STRESS_ROUNDS || 10);
const SCROLL_EVENTS_PER_ROUND = Number(process.env.SCROLL_EVENTS_PER_ROUND || 56);
const ZOOM_EVENTS_PER_ROUND = Number(process.env.ZOOM_EVENTS_PER_ROUND || 8);
const WHEEL_DELAY_MS = Number(process.env.WHEEL_DELAY_MS || 8);
const ROUND_PAUSE_MS = Number(process.env.ROUND_PAUSE_MS || 40);
const SAMPLE_PAGE_LIMIT = Number(process.env.SAMPLE_PAGE_LIMIT || 6);
const SAMPLE_INTERVAL_MS = Number(process.env.SAMPLE_INTERVAL_MS || 24);
const CAPTURE_PERF_ATTRIBUTION = process.env.CAPTURE_PERF_ATTRIBUTION === 'true';

let session = null;

test.use({ video: 'off' });

async function waitForAppReady(page) {
  await page.locator('.survey-pdfjs-viewer-container').waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__debugBridge != null && window.pdfOverlayRecorder != null,
    { timeout: 30_000 }
  );
  await page.evaluate(() =>
    window.__debugReady.waitFor('pdfLoaded', { timeout: 30_000 })
  );
}

async function goToPage(page, pageNumber) {
  const pageInput = page.getByRole('textbox', { name: 'Current page' });
  await expect(pageInput).toBeVisible({ timeout: 15_000 });
  await pageInput.click();
  await pageInput.fill(String(pageNumber));
  await pageInput.press('Enter');
  await page.evaluate(() =>
    window.__debugReady.waitFor('ready', { timeout: 30_000 })
  );
}

async function setToolbarZoom(page, zoomLevel) {
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage' });
  await expect(zoomInput).toBeVisible({ timeout: 15_000 });
  await zoomInput.click();
  await zoomInput.fill(String(zoomLevel));
  await zoomInput.press('Enter');
  await page.evaluate(() =>
    window.__debugReady.waitFor('ready', { timeout: 30_000 })
  );
}

async function viewerCenter(page) {
  const viewer = page.locator('.survey-pdfjs-viewer-container');
  const box = await viewer.boundingBox();
  expect(box, 'Syncfusion viewer box should be measurable').toBeTruthy();
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function summarizeWorstFrames(samples) {
  return samples
    .filter((sample) => Number(sample.frameMs) >= 500)
    .sort((left, right) => Number(right.frameMs) - Number(left.frameMs))
    .slice(0, 20)
    .map((sample) => ({
      tMs: sample.tMs,
      frameMs: sample.frameMs,
      longTaskCount: sample.longTaskCount,
      longTaskTotalMs: sample.longTaskTotalMs,
      longTaskMaxMs: sample.longTaskMaxMs,
      eventTimingTotalMs: sample.eventTimingTotalMs,
      eventTimingMaxMs: sample.eventTimingMaxMs,
      interactionEventDeltas: sample.interactionEventDeltas,
      overlayTransformDeltas: sample.overlayTransformDeltas,
      expectedSampledPageCount: sample.expectedSampledPageCount,
      sampledPageCount: sample.sampledPageCount,
      missingOverlayCount: sample.missingOverlayCount,
      missingHostCount: sample.missingHostCount,
      visiblePresentationGapCount: sample.visiblePresentationGapCount,
      viewportPresentationGapCount: sample.viewportPresentationGapCount,
      worstDriftPx: sample.worstDriftPx,
      worstScaleMismatch: sample.worstScaleMismatch,
      sampleCaptureCostMs: sample.sampleCaptureCostMs,
      pages: Array.isArray(sample.pages)
        ? sample.pages.map((page) => ({
          pageNumber: page.pageNumber,
          viewportVisible: page.viewportVisible,
          viewportOverlapPct: page.viewportOverlapPct,
          hasPdfSurface: page.hasPdfSurface,
          spinnerVisible: page.spinnerVisible,
          pdfReady: page.pdfReady,
          hasAnnotationContent: page.hasAnnotationContent,
          presentationGap: page.presentationGap,
          driftPx: page.driftPx,
          ratioMismatch: page.ratioMismatch,
          observedScale: page.observedScale,
          expectedScale: page.expectedScale,
          scaleMismatch: page.scaleMismatch,
          presentationMode: page.presentationMode,
          snapshotStatus: page.snapshotStatus,
        }))
        : [],
    }));
}

function summarizeJankFrames(samples) {
  return samples
    .filter((sample) => Number(sample.frameMs) > 32)
    .sort((left, right) => Number(right.frameMs) - Number(left.frameMs))
    .slice(0, 80)
    .map((sample) => ({
      tMs: sample.tMs,
      frameMs: sample.frameMs,
      longTaskCount: sample.longTaskCount,
      longTaskTotalMs: sample.longTaskTotalMs,
      eventTimingTotalMs: sample.eventTimingTotalMs,
      eventTimingMaxMs: sample.eventTimingMaxMs,
      interactionEventDeltas: sample.interactionEventDeltas,
      expectedSampledPageCount: sample.expectedSampledPageCount,
      sampledPageCount: sample.sampledPageCount,
      missingOverlayCount: sample.missingOverlayCount,
      missingHostCount: sample.missingHostCount,
      missingOverlayPages: sample.missingOverlayPages,
      missingHostPages: sample.missingHostPages,
      hiddenPendingPageCount: sample.hiddenPendingPageCount,
      visiblePresentationGapCount: sample.visiblePresentationGapCount,
      viewportPresentationGapCount: sample.viewportPresentationGapCount,
      worstDriftPx: sample.worstDriftPx,
      worstScaleMismatch: sample.worstScaleMismatch,
      sampleCaptureCostMs: sample.sampleCaptureCostMs,
      pages: Array.isArray(sample.pages)
        ? sample.pages.map((page) => ({
          pageNumber: page.pageNumber,
          viewportVisible: page.viewportVisible,
          viewportOverlapPct: page.viewportOverlapPct,
          hasPdfSurface: page.hasPdfSurface,
          spinnerVisible: page.spinnerVisible,
          hasAnnotationContent: page.hasAnnotationContent,
          presentationGap: page.presentationGap,
          driftPx: page.driftPx,
          ratioMismatch: page.ratioMismatch,
          scaleMismatch: page.scaleMismatch,
          presentationMode: page.presentationMode,
        }))
        : [],
    }));
}

function summarizeMissingOverlaySamples(samples) {
  return samples
    .filter((sample) => Number(sample.missingOverlayCount) > 0 || Number(sample.missingHostCount) > 0)
    .slice(0, 40)
    .map((sample) => ({
      tMs: sample.tMs,
      frameMs: sample.frameMs,
      interactionActive: sample.interactionActive,
      interactionPhase: sample.interactionPhase,
      interactionReason: sample.interactionReason,
      currentPage: sample.currentPage,
      scrollTop: sample.scrollTop,
      expectedSampledPageCount: sample.expectedSampledPageCount,
      sampledPageCount: sample.sampledPageCount,
      missingOverlayCount: sample.missingOverlayCount,
      missingHostCount: sample.missingHostCount,
      missingOverlayPages: sample.missingOverlayPages,
      missingHostPages: sample.missingHostPages,
      missingOverlayDetails: sample.missingOverlayDetails,
      missingHostDetails: sample.missingHostDetails,
      staleOverlayRefCount: sample.staleOverlayRefCount,
      staleOverlayRefPages: sample.staleOverlayRefPages,
      staleOverlayRefDetails: sample.staleOverlayRefDetails,
      overlayLayerRefCount: sample.overlayLayerRefCount,
      residentPages: sample.residentPages,
      overlayWindowPages: sample.overlayWindowPages,
      interactionEventDeltas: sample.interactionEventDeltas,
      pages: Array.isArray(sample.pages)
        ? sample.pages.map((page) => ({
          pageNumber: page.pageNumber,
          viewportVisible: page.viewportVisible,
          viewportOverlapPct: page.viewportOverlapPct,
          hasAnnotationContent: page.hasAnnotationContent,
          hasPdfSurface: page.hasPdfSurface,
          spinnerVisible: page.spinnerVisible,
          presentationMode: page.presentationMode,
        }))
        : [],
    }));
}

test('dense scroll and zoom stress exposes frame stalls', async ({ page }) => {
  test.setTimeout(300_000);
  session = createSession('interaction-stall-stress', getSessionBaseDir());

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
  await waitForAppReady(page);
  await goToPage(page, START_PAGE);
  await setToolbarZoom(page, START_ZOOM);

  await page.evaluate(({ samplePageLimit, sampleIntervalMs, capturePerfAttribution }) => {
    window.pdfOverlayRecorder.clear();
    window.pdfOverlayRecorder.start({
      samplePageLimit,
      maxSamples: 12000,
      sampleIntervalMs,
      capturePerfAttribution,
    });
  }, {
    samplePageLimit: SAMPLE_PAGE_LIMIT,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    capturePerfAttribution: CAPTURE_PERF_ATTRIBUTION,
  });

  const center = await viewerCenter(page);
  await page.mouse.move(center.x, center.y);

  for (let round = 0; round < STRESS_ROUNDS; round += 1) {
    const scrollDirection = round % 2 === 0 ? 1 : -1;
    for (let i = 0; i < SCROLL_EVENTS_PER_ROUND; i += 1) {
      await page.mouse.wheel(0, scrollDirection * 260);
      await page.waitForTimeout(WHEEL_DELAY_MS);
    }

    await page.keyboard.down('Control');
    const zoomDirection = round % 2 === 0 ? -1 : 1;
    for (let i = 0; i < ZOOM_EVENTS_PER_ROUND; i += 1) {
      await page.mouse.wheel(0, zoomDirection * 180);
      await page.waitForTimeout(WHEEL_DELAY_MS);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(ROUND_PAUSE_MS);
  }

  // Do not wait for the generic "ready" signal here. This stress intentionally
  // scrolls far away from the annotated pages, and `ready` can remain false
  // when the current viewport has no mounted annotations even though PDF/zoom
  // settle signals are true. Dump recorder data regardless.
  await page.waitForTimeout(500);

  const dump = await page.evaluate(() => window.pdfOverlayRecorder.dump());
  const stopped = await page.evaluate(() => window.pdfOverlayRecorder.stop());
  const summary = stopped?.summary || dump?.summary || {};
  const samples = Array.isArray(dump?.samples) ? dump.samples : [];
  const worstFrames = summarizeWorstFrames(samples);
  const jankFrames = summarizeJankFrames(samples);
  const missingOverlaySamples = summarizeMissingOverlaySamples(samples);
  const finalSnap = await page.evaluate(() => window.__debugBridge.snapshot());

  const artifacts = {
    stressConfig: {
      START_PAGE,
      START_ZOOM,
      STRESS_ROUNDS,
      SCROLL_EVENTS_PER_ROUND,
      ZOOM_EVENTS_PER_ROUND,
      WHEEL_DELAY_MS,
      ROUND_PAUSE_MS,
      SAMPLE_PAGE_LIMIT,
      SAMPLE_INTERVAL_MS,
      CAPTURE_PERF_ATTRIBUTION,
    },
    summary,
    worstFrames,
    jankFrames,
    missingOverlaySamples,
    finalSnap: {
      canvasContainerCount: finalSnap.canvasContainerCount,
      svgAnnotationLayerCount: finalSnap.svgAnnotationLayerCount,
      portalHostCount: finalSnap.portalHostCount,
      currentPage: finalSnap.currentPage,
      visiblePages: finalSnap.visiblePages,
    },
    consoleErrors,
  };

  writeFileSync(
    path.join(session.sessionDir, 'overlay-recorder-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );
  writeFileSync(
    path.join(session.sessionDir, 'overlay-recorder-samples.json'),
    JSON.stringify(samples, null, 2),
    'utf8'
  );
  writeFileSync(
    path.join(session.sessionDir, 'worst-frames.json'),
    JSON.stringify(worstFrames, null, 2),
    'utf8'
  );
  writeFileSync(
    path.join(session.sessionDir, 'jank-frames.json'),
    JSON.stringify(jankFrames, null, 2),
    'utf8'
  );
  writeFileSync(
    path.join(session.sessionDir, 'missing-overlay-samples.json'),
    JSON.stringify(missingOverlaySamples, null, 2),
    'utf8'
  );
  writeFileSync(
    path.join(session.sessionDir, 'stress-artifacts.json'),
    JSON.stringify(artifacts, null, 2),
    'utf8'
  );

  session.manifest.criteriaResults = {
    baselineCaptured: {
      pass: Number(summary.sampleCount) > 0,
      sampleCount: summary.sampleCount ?? 0,
    },
    worstFramesCaptured: {
      pass: Number(summary.frameMsMax ?? Number.POSITIVE_INFINITY) < 500,
      framesOver500ms: worstFrames.length,
      frameMsMax: summary.frameMsMax ?? null,
    },
    jankUnder15Pct: {
      pass: Number(summary.jankFrameRatePct ?? Number.POSITIVE_INFINITY) < 15,
      jankFrameRatePct: summary.jankFrameRatePct ?? null,
      sampleJankFrameRatePct: summary.sampleJankFrameRatePct ?? null,
      rafFrameCount: summary.rafFrameCount ?? null,
    },
    noMissingOverlays: {
      pass: Number(summary.missingOverlayCountMax ?? 0) === 0,
      missingOverlayCountMax: summary.missingOverlayCountMax ?? null,
    },
    overlayAlignmentStable: {
      pass: Number(summary.worstDriftPxMax ?? 0) <= 1 &&
        Number(summary.scaleMismatchP95 ?? 0) <= 0.05,
      worstDriftPxMax: summary.worstDriftPxMax ?? null,
      scaleMismatchP95: summary.scaleMismatchP95 ?? null,
    },
  };

  finalizeSession(
    session.sessionDir,
    session.manifest,
    'baseline',
    readdirSync(session.sessionDir).map((file) => ({
      type: path.extname(file).toLowerCase() === '.json' ? 'data' : 'unknown',
      path: file,
      description: file,
    }))
  );
  console.log('interaction-stall-stress session', session.sessionDir);
  console.log('interaction-stall-stress summary', JSON.stringify(summary, null, 2));
  console.log('interaction-stall-stress worstFrames', JSON.stringify(worstFrames.slice(0, 5), null, 2));

  expect(summary.sampleCount, 'Overlay recorder must capture baseline samples').toBeGreaterThan(0);
  expect(Number(summary.frameMsMax ?? Number.POSITIVE_INFINITY), 'Worst frame must stay below 500ms').toBeLessThan(500);
  expect(Number(summary.jankFrameRatePct ?? Number.POSITIVE_INFINITY), 'RAF jank rate must stay under 15%').toBeLessThan(15);
  expect(Number(summary.missingOverlayCountMax ?? Number.POSITIVE_INFINITY), 'No visible overlays should be missing').toBe(0);
  expect(consoleErrors, 'No console errors during stall stress baseline').toEqual([]);
});
