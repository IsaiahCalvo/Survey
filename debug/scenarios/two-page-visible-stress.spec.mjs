import { test, expect } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

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

async function getVisiblePageMetrics(page) {
  return page.evaluate(() => {
    const viewer = document.querySelector('.survey-pdfjs-viewer-container');
    const viewerRect = viewer?.getBoundingClientRect?.();
    if (!viewer || !viewerRect) return [];
    return Array.from(document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const overlapTop = Math.max(rect.top, viewerRect.top);
        const overlapBottom = Math.min(rect.bottom, viewerRect.bottom);
        const overlapHeight = Math.max(0, overlapBottom - overlapTop);
        const overlapPct = rect.height > 0 ? overlapHeight / rect.height : 0;
        return {
          page: Number(node.getAttribute('data-page-number')),
          overlapPct,
          hasPdfSurface: !!node.querySelector('canvas, .survey-pdfjs-page-canvas, .survey-pdfjs-text-layer'),
          hasAnnotationContent: !!node.querySelector('[data-svg-annotation-layer] [data-anno-id], .canvas-container'),
        };
      })
      .filter((item) => item.overlapPct > 0.05)
      .sort((left, right) => left.page - right.page);
  });
}

function countBlankPageSamples(samples) {
  return samples.filter((sample) =>
    Array.isArray(sample.pages) &&
    sample.pages.some((page) => page.viewportVisible && !page.hasPdfSurface)
  ).length;
}

function countSamplesWithTwoVisiblePages(samples) {
  return samples.filter((sample) =>
    Array.isArray(sample.pages) &&
    sample.pages.filter((page) => page.viewportVisible && Number(page.viewportOverlapPct) > 5).length >= 2
  ).length;
}

test('two visible pages remain stable during diagonal scroll and cursor zoom', async ({ page }) => {
  test.setTimeout(240_000);
  session = createSession('two-page-visible-stress', getSessionBaseDir());

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf&codexPerf=1');
  await waitForAppReady(page);
  await goToPage(page, 6);

  let twoPageBefore = [];
  for (const zoom of [90, 80, 70, 60]) {
    await setToolbarZoom(page, zoom);
    await page.evaluate(() => {
      const viewer = document.querySelector('.survey-pdfjs-viewer-container');
      const page6 = document.querySelector('.survey-pdfjs-page-div[data-page-number="6"]');
      if (!viewer || !page6) return;
      viewer.scrollTop = Math.max(0, page6.offsetTop + page6.clientHeight - Math.round(viewer.clientHeight * 0.55));
    });
    await page.waitForTimeout(600);
    twoPageBefore = await getVisiblePageMetrics(page);
    if (twoPageBefore.length >= 2) break;
  }

  await page.evaluate(() => {
    window.pdfOverlayRecorder.clear();
    window.pdfOverlayRecorder.start({
      samplePageLimit: 8,
      maxSamples: 8000,
      sampleIntervalMs: 24,
      capturePerfAttribution: true,
      captureWheelEvents: true,
    });
  });

  const beforePath = path.join(session.sessionDir, 'two-page-before.png');
  await page.screenshot({ path: beforePath, fullPage: false });

  const center = await viewerCenter(page);
  await page.mouse.move(center.x, center.y);
  for (let i = 0; i < 72; i += 1) {
    await page.mouse.wheel(i % 2 === 0 ? 18 : -14, i < 36 ? 36 : -32);
    if (i === 24) {
      await page.screenshot({ path: path.join(session.sessionDir, 'two-page-during-diagonal-scroll.png'), fullPage: false });
    }
    await page.waitForTimeout(8);
  }

  await page.keyboard.down('Control');
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, i < 4 ? -90 : 90);
    await page.waitForTimeout(16);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(800);

  const afterZoomPath = path.join(session.sessionDir, 'two-page-after-zoom.png');
  await page.screenshot({ path: afterZoomPath, fullPage: false });
  const twoPageAfter = await getVisiblePageMetrics(page);

  const navTimings = [];
  for (const targetPage of [5, 6, 7, 6, 5, 6]) {
    const started = Date.now();
    await goToPage(page, targetPage);
    navTimings.push({ page: targetPage, elapsedMs: Date.now() - started });
  }

  await page.waitForTimeout(500);
  const dump = await page.evaluate(() => window.pdfOverlayRecorder.dump());
  const stopped = await page.evaluate(() => window.pdfOverlayRecorder.stop());
  const summary = stopped?.summary || dump?.summary || {};
  const samples = Array.isArray(dump?.samples) ? dump.samples : [];
  const blankSampleCount = countBlankPageSamples(samples);
  const samplesWithTwoVisiblePages = countSamplesWithTwoVisiblePages(samples);
  const page6AnnotationCount = await page.evaluate(() =>
    document.querySelectorAll('.survey-pdfjs-page-div[data-page-number="6"] [data-svg-annotation-layer] [data-anno-id]').length
  );
  const finalSnap = await page.evaluate(() => window.__debugBridge.snapshot());

  const artifacts = {
    twoPageBefore,
    twoPageAfter,
    samplesWithTwoVisiblePages,
    blankSampleCount,
    page6AnnotationCount,
    navTimings,
    overlaySummary: summary,
    finalSnap: {
      currentPage: finalSnap.currentPage,
      visiblePages: finalSnap.visiblePages,
      svgAnnotationLayerCount: finalSnap.svgAnnotationLayerCount,
      canvasContainerCount: finalSnap.canvasContainerCount,
    },
    consoleErrors,
  };

  writeFileSync(path.join(session.sessionDir, 'two-page-visible-summary.json'), JSON.stringify(artifacts, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-samples.json'), JSON.stringify(samples, null, 2), 'utf8');

  session.manifest.criteriaResults = {
    noConsoleErrors: { pass: consoleErrors.length === 0, errorCount: consoleErrors.length },
    twoPagesVisibleBefore: { pass: twoPageBefore.length >= 2, twoPageBefore },
    twoPagesVisibleAfterZoom: { pass: twoPageAfter.length >= 2, twoPageAfter },
    recorderSawTwoVisiblePages: { pass: samplesWithTwoVisiblePages > 0, samplesWithTwoVisiblePages },
    page6AnnotationsPresent: { pass: page6AnnotationCount > 0, page6AnnotationCount },
    noMissingOverlays: { pass: Number(summary.missingOverlayCountMax ?? 0) === 0, missingOverlayCountMax: summary.missingOverlayCountMax ?? null },
    noVisiblePresentationGap: { pass: Number(summary.visiblePresentationGapMax ?? 0) === 0, visiblePresentationGapMax: summary.visiblePresentationGapMax ?? null },
    noViewportPresentationGap: { pass: Number(summary.viewportPresentationGapMax ?? 0) === 0, viewportPresentationGapMax: summary.viewportPresentationGapMax ?? null },
    noBlankSamples: { pass: blankSampleCount === 0, blankSampleCount },
    noZoomBigJumps: { pass: Number(summary.wheelMotionSummary?.zoomBigJumpEvents ?? 0) === 0, zoomBigJumpEvents: summary.wheelMotionSummary?.zoomBigJumpEvents ?? null },
    fastNavigationUnder1000ms: { pass: navTimings.every((item) => item.elapsedMs < 1000), navTimings },
  };
  const passed = Object.values(session.manifest.criteriaResults).every((criterion) => criterion.pass === true);

  finalizeSession(
    session.sessionDir,
    session.manifest,
    passed ? 'pass' : 'fail',
    readdirSync(session.sessionDir).map((file) => ({
      type: path.extname(file).toLowerCase() === '.png' ? 'screenshot' : 'data',
      path: file,
      description: file,
    }))
  );

  console.log('two-page-visible-stress session', session.sessionDir);
  console.log('two-page-visible-stress summary', JSON.stringify(artifacts, null, 2));

  expect(consoleErrors, 'No console errors during two-page visible stress').toEqual([]);
  expect(twoPageBefore.length, 'At least two pages must be visible before stress').toBeGreaterThanOrEqual(2);
  expect(twoPageAfter.length, 'At least two pages must remain visible after zoom').toBeGreaterThanOrEqual(2);
  expect(samplesWithTwoVisiblePages, 'Recorder must sample two visible pages during stress').toBeGreaterThan(0);
  expect(page6AnnotationCount, 'Page 6 annotations must remain present').toBeGreaterThan(0);
  expect(Number(summary.missingOverlayCountMax ?? Number.POSITIVE_INFINITY), 'No visible overlays should be missing').toBe(0);
  expect(Number(summary.visiblePresentationGapMax ?? Number.POSITIVE_INFINITY), 'Annotations must not appear before PDF pages').toBe(0);
  expect(Number(summary.viewportPresentationGapMax ?? Number.POSITIVE_INFINITY), 'Viewport annotations must not appear before PDF pages').toBe(0);
  expect(blankSampleCount, 'No visible PDF page should go blank during two-page stress').toBe(0);
  expect(Number(summary.wheelMotionSummary?.zoomBigJumpEvents ?? Number.POSITIVE_INFINITY), 'Two-page zoom must not create big jumps').toBe(0);
});
