/**
 * Zoom-Flicker Debug Scenario (CAPT-05, FOUN-07)
 *
 * Drives the app through a parameterizable zoom sequence on a page with
 * annotations, capturing synchronized artifacts at each step. Determines
 * pass/fail automatically based on:
 *   - Canvas containers still present after full zoom cycle
 *   - No console errors during execution
 *
 * Uses CaptureContext for all artifact collection (screenshots, console,
 * state, performance). Video is saved in afterEach (Playwright requirement).
 *
 * Parameterization via environment variables (FOUN-07):
 *   ZOOM_MIN  - Starting zoom level (default: 100)
 *   ZOOM_MAX  - Maximum zoom level (default: 200)
 *   ZOOM_STEP - Zoom increment per step (default: 25)
 *   START_PAGE - Page to navigate to (default: 6)
 *
 * Usage:
 *   npm run debug:scenario -- zoom-flicker
 *   ZOOM_MAX=300 START_PAGE=8 npm run debug:scenario -- zoom-flicker
 */

import { test, expect } from '@playwright/test';
import { CaptureContext } from '../lib/capture.mjs';
import { copyFileSync } from 'node:fs';
import path from 'node:path';

// ── Environment variable parameters (FOUN-07) ──
const ZOOM_MIN = Number(process.env.ZOOM_MIN || 100);
const ZOOM_MAX = Number(process.env.ZOOM_MAX || 200);
const ZOOM_STEP = Number(process.env.ZOOM_STEP || 25);
const START_PAGE = Number(process.env.START_PAGE || 6);

// ── Module-level state for afterEach video handling ──
let ctx = null;

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
  await page.locator('.e-pv-viewer-container').waitFor({
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
  ctx = new CaptureContext('zoom-flicker', page);
  await ctx.start();

  // ── 4. Zoom sequence (up) ──
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
      await page.evaluate((level) => {
        const viewer = document.querySelector('.e-pv-viewer-container');
        if (viewer?.ej2_instances?.[0]) {
          viewer.ej2_instances[0].magnification.zoomTo(level);
        }
      }, zoomLevel);
    });
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
      await page.evaluate((level) => {
        const viewer = document.querySelector('.e-pv-viewer-container');
        if (viewer?.ej2_instances?.[0]) {
          viewer.ej2_instances[0].magnification.zoomTo(level);
        }
      }, zoomLevel);
    });
  }

  // ── 6. Pass/fail determination (CAPT-05) ──
  const finalSnap = await page.evaluate(() =>
    window.__debugBridge.snapshot()
  );

  const canvasContainersPresent = {
    pass: finalSnap.canvasContainerCount >= 1,
    value: finalSnap.canvasContainerCount,
  };

  const noConsoleErrors = {
    pass: consoleErrorCount === 0,
    errorCount: consoleErrorCount,
  };

  const criteriaResults = {
    canvasContainersPresent,
    noConsoleErrors,
  };

  const allCriteriaPassed = canvasContainersPresent.pass && noConsoleErrors.pass;
  const result = allCriteriaPassed ? 'pass' : 'fail';

  // ── 7. Finalize ──
  await ctx.finalize(result, criteriaResults);

  // Playwright assertion for CI-friendly output
  expect(
    finalSnap.canvasContainerCount,
    'Canvas containers must be present after zoom cycle'
  ).toBeGreaterThanOrEqual(1);
});
