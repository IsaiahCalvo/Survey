/**
 * Screenshot capture module.
 *
 * Captures readiness-gated screenshots with step-based naming convention:
 *   step-NN_MMMMMms_timing-description.png
 *
 * Waits for window.__debugReady.waitFor('ready') before each capture
 * to ensure DOM + Fabric.js annotations are fully settled (CAPT-08).
 */

import path from 'node:path';

/**
 * Takes a readiness-gated screenshot with standardized naming.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} sessionDir - Absolute path to session folder
 * @param {number} stepNum - Step number (0 = baseline)
 * @param {string} timing - Timing label (e.g., 'baseline', 'before', 'after')
 * @param {string} actionName - Human-readable action description
 * @returns {Promise<{ filename: string, sessionMs: number }>}
 */
export async function takeScreenshot(page, sessionDir, stepNum, timing, actionName) {
  // Wait for full readiness (DOM settled, annotations mounted, zoom settled)
  await page.evaluate(() => window.__debugReady.waitFor('ready', { timeout: 30000 }));

  // Get session-relative timestamp from the browser
  const sessionMs = await page.evaluate(() => performance.now());

  // Build filename per locked convention
  const stepStr = String(stepNum).padStart(2, '0');
  const msStr = String(Math.round(sessionMs)).padStart(5, '0');
  const safeName = actionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filename = `step-${stepStr}_${msStr}ms_${timing}-${safeName}.png`;

  await page.screenshot({
    path: path.join(sessionDir, filename),
    fullPage: false,
  });

  return { filename, sessionMs };
}
