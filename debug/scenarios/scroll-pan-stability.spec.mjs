import { test, expect } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

let session = null;

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

async function getViewerScrollPosition(page) {
  return page.evaluate(() => {
    const viewer = document.querySelector('.survey-pdfjs-viewer-container');
    return {
      left: Number(viewer?.scrollLeft || 0),
      top: Number(viewer?.scrollTop || 0),
    };
  });
}

async function getViewerBox(page) {
  const viewer = page.locator('.survey-pdfjs-viewer-container');
  const box = await viewer.boundingBox();
  expect(box, 'Syncfusion viewer box should be measurable').toBeTruthy();
  return box;
}

test('fast scroll and drag pan keep PDF and annotations stable', async ({ page }) => {
  test.setTimeout(180_000);
  session = createSession('scroll-pan-stability', getSessionBaseDir());

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
  await waitForAppReady(page);
  await goToPage(page, 6);
  await setToolbarZoom(page, 200);

  await page.evaluate(() => {
    window.pdfOverlayRecorder.clear();
    window.pdfOverlayRecorder.start({
      samplePageLimit: 8,
      maxSamples: 4000,
      sampleIntervalMs: 24,
      capturePerfAttribution: true,
    });
  });

  const box = await getViewerBox(page);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);

  for (let i = 0; i < 14; i += 1) {
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(35);
  }

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  const panStart = await getViewerScrollPosition(page);
  await page.mouse.move(centerX - 220, centerY - 90, { steps: 8 });
  const panAfterDrag = await getViewerScrollPosition(page);
  await page.mouse.move(centerX + 120, centerY + 60, { steps: 8 });
  await page.mouse.up();
  const panDelta = {
    left: Math.abs(panAfterDrag.left - panStart.left),
    top: Math.abs(panAfterDrag.top - panStart.top),
  };

  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(35);
  }

  await page.evaluate(() =>
    window.__debugReady.waitFor('ready', { timeout: 30_000 })
  );
  await page.waitForTimeout(300);

  const overlayRecorderResult = await page.evaluate(() =>
    window.pdfOverlayRecorder.stop()
  );
  const summary = overlayRecorderResult?.summary || {};
  const viewportPending = await page.evaluate(() => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return Array.from(document.querySelectorAll('[data-overlay-hidden-pending-pdf="true"]'))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
      })
      .length;
  });
  const criteriaResults = {
    noConsoleErrors: {
      pass: consoleErrors.length === 0,
      errorCount: consoleErrors.length,
    },
    overlayRecorderHasSamples: {
      pass: Number(summary.sampleCount) > 0,
      sampleCount: summary.sampleCount ?? 0,
    },
    noVisiblePresentationGap: {
      pass: summary.visiblePresentationGapMax === 0,
      visiblePresentationGapMax: summary.visiblePresentationGapMax ?? null,
      samplesWithVisiblePresentationGapPct: summary.samplesWithVisiblePresentationGapPct ?? null,
    },
    noViewportPresentationGap: {
      pass: summary.viewportPresentationGapMax === 0,
      viewportPresentationGapMax: summary.viewportPresentationGapMax ?? null,
      samplesWithViewportPresentationGapPct: summary.samplesWithViewportPresentationGapPct ?? null,
    },
    noViewportOverlayPendingPdfAtRest: {
      pass: viewportPending === 0,
      count: viewportPending,
    },
    dragPanMovesViewport: {
      pass: Math.max(panDelta.left, panDelta.top) >= 20,
      panStart,
      panAfterDrag,
      panDelta,
    },
    overlayAlignmentStable: {
      pass: Number(summary.worstDriftPxMax ?? 0) <= 1 &&
        Number(summary.scaleMismatchP95 ?? 0) <= 0.05,
      worstDriftPxMax: summary.worstDriftPxMax ?? null,
      worstDriftPxP95: summary.worstDriftPxP95 ?? null,
      scaleMismatchMax: summary.scaleMismatchMax ?? null,
      scaleMismatchP95: summary.scaleMismatchP95 ?? null,
    },
    scrollPanFrameBudget: {
      pass: Number(summary.frameMsP95) <= 150 && Number(summary.jankFrameRatePct) <= 30,
      frameMsAvg: summary.frameMsAvg ?? null,
      frameMsP95: summary.frameMsP95 ?? null,
      frameMsMax: summary.frameMsMax ?? null,
      fpsAvg: summary.fpsAvg ?? null,
      jankFrameRatePct: summary.jankFrameRatePct ?? null,
    },
  };
  const allCriteriaPassed = Object.values(criteriaResults).every((criterion) => criterion.pass === true);

  writeFileSync(
    path.join(session.sessionDir, 'overlay-recorder-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );
  session.manifest.criteriaResults = criteriaResults;
  finalizeSession(
    session.sessionDir,
    session.manifest,
    allCriteriaPassed ? 'pass' : 'fail',
    readdirSync(session.sessionDir).map((file) => ({
      type: path.extname(file).toLowerCase() === '.json' ? 'data' : 'unknown',
      path: file,
      description: file,
    }))
  );
  console.log('scroll-pan-stability session', session.sessionDir);

  expect(consoleErrors, 'No console errors during fast scroll/pan').toEqual([]);
  expect(summary.sampleCount, 'Overlay recorder must capture scroll/pan samples').toBeGreaterThan(0);
  expect(summary.visiblePresentationGapMax, 'Annotations must not be visible ahead of PDF pages').toBe(0);
  expect(summary.viewportPresentationGapMax, 'Viewport annotations must not be ahead of PDF pages').toBe(0);
  expect(viewportPending, 'No viewport overlay should remain hidden waiting for PDF at rest').toBe(0);
  expect(Math.max(panDelta.left, panDelta.top), 'Drag pan must move the Syncfusion viewport at 200% zoom').toBeGreaterThanOrEqual(20);
  expect(criteriaResults.overlayAlignmentStable.pass, 'Scroll/pan overlay alignment must stay within drift/scale mismatch budget').toBe(true);
  expect(summary.frameMsP95, 'Scroll/pan frame p95 must stay inside regression budget').toBeLessThanOrEqual(150);
  expect(summary.jankFrameRatePct, 'Scroll/pan jank rate must stay inside regression budget').toBeLessThanOrEqual(30);
});
