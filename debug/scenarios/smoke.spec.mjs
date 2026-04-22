/**
 * Smoke test -- Phase 5 gate validation.
 *
 * Proves the debug artifact pipeline works end-to-end:
 * 1. Opens dev test route with test PDF
 * 2. Navigates to page 6 (first page with annotations)
 * 3. Validates Fabric.js canvas has non-blank pixel content
 * 4. Takes screenshot and creates session folder with manifest
 *
 * If this test passes, Playwright can capture real annotation content
 * and the entire debug artifact strategy is validated.
 */

import { test, expect } from '@playwright/test';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

let sessionDir;
let manifest;

test.beforeEach(async () => {
  const baseDir = getSessionBaseDir();
  const session = createSession('smoke', baseDir);
  sessionDir = session.sessionDir;
  manifest = session.manifest;
});

test.afterEach(async () => {
  // Finalize session even on failure so we get a manifest with result='fail'
  if (manifest && manifest.result === null) {
    finalizeSession(sessionDir, manifest, 'fail', manifest.artifacts || []);
  }
});

test('smoke test - loads PDF, captures canvas content, creates session', async ({ page }) => {
  // ── Step 1: Navigate to dev test route ──
  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');

  // ── Step 2: Wait for PDF viewer to load ──
  await page.locator('.e-pv-viewer-container').waitFor({
    state: 'visible',
    timeout: 60_000,
  });

  // Conservative wait for Syncfusion + PDF.js initialization
  await page.waitForTimeout(5000);

  // ── Step 3: Navigate to page 6 (first page with annotations) ──
  const pageInput = page.getByRole('textbox', { name: 'Current page' });
  await expect(pageInput).toBeVisible({ timeout: 15_000 });
  await pageInput.click();
  await pageInput.fill('6');
  await pageInput.press('Enter');

  // Wait for page change + Fabric.js render
  await page.waitForTimeout(5000);

  // ── Step 4: Wait for Fabric.js canvas content ──
  await page.locator('.canvas-container').first().waitFor({
    state: 'visible',
    timeout: 30_000,
  });

  // Additional wait for Fabric.js to finish rendering objects onto canvases
  await page.waitForTimeout(2000);

  // ── Step 5: Validate canvas has actual content (Phase 5 gate) ──
  const hasCanvasContent = await page.evaluate(() => {
    const containers = document.querySelectorAll('.canvas-container');
    if (containers.length === 0) return false;

    // Check each canvas container for non-blank content
    for (const container of containers) {
      const canvases = container.querySelectorAll('canvas');
      for (const canvas of canvases) {
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          let nonBlankPixels = 0;
          // Sample every 100th pixel for speed
          for (let i = 0; i < data.length; i += 400) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a > 0 && !(r === 255 && g === 255 && b === 255)) {
              nonBlankPixels++;
            }
          }
          if (nonBlankPixels > 10) return true; // Found canvas with content
        } catch {
          // getImageData can fail on tainted canvases -- skip
          continue;
        }
      }
    }
    return false;
  });

  // Log canvas container count for debugging
  const canvasContainerCount = await page.locator('.canvas-container').count();
  console.log(`Canvas containers found: ${canvasContainerCount}`);
  console.log(`Canvas has non-blank content: ${hasCanvasContent}`);

  // ── Step 6: Take screenshot of page 6 ──
  const screenshotPath = path.join(sessionDir, 'page6-annotated.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });

  // ── Step 7: Assertions ──
  // Phase 5 gate: canvas must have non-blank pixels
  expect(hasCanvasContent,
    'PHASE 5 GATE FAILED: Fabric.js canvas content not captured in screenshot. ' +
    'Canvas containers found but content is blank.'
  ).toBe(true);

  // Verify screenshot file exists and has non-zero size
  const screenshotStat = statSync(screenshotPath);
  expect(screenshotStat.size).toBeGreaterThan(0);

  // Verify at least one canvas container exists
  expect(canvasContainerCount).toBeGreaterThanOrEqual(1);

  // ── Step 8: Finalize session ──
  const artifacts = [
    {
      type: 'screenshot',
      path: 'page6-annotated.png',
      description: 'Page 6 with Fabric.js annotations',
    },
  ];
  const result = hasCanvasContent ? 'pass' : 'fail';
  finalizeSession(sessionDir, manifest, result, artifacts);

  // ── Step 9: Verify manifest ──
  const manifestData = JSON.parse(
    readFileSync(path.join(sessionDir, 'manifest.json'), 'utf-8')
  );
  expect(manifestData.scenario).toBe('smoke');
  expect(manifestData.gitSha).toMatch(/^[0-9a-f]{40}$/);
  expect(manifestData.startTime).toBeTruthy();
  expect(manifestData.endTime).toBeTruthy();
  expect(manifestData.result).toBe('pass');
  expect(manifestData.artifacts).toHaveLength(1);
  expect(manifestData.artifacts[0].type).toBe('screenshot');
});
