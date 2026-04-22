/**
 * Performance capture module.
 *
 * Polls CDP Performance.getMetrics every 500ms and collects performance
 * marks at session end. Writes all entries to performance.jsonl with
 * sessionMs timestamps for timeline correlation (CAPT-07).
 */

import { appendFileSync } from 'node:fs';
import path from 'node:path';

/** @type {import('playwright-core').CDPSession|null} */
let cdpClient = null;

/** @type {ReturnType<typeof setInterval>|null} */
let pollInterval = null;

/**
 * Starts CDP performance metric polling.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} sessionDir - Absolute path to session folder
 */
export async function startPerfCapture(page, sessionDir) {
  const filePath = path.join(sessionDir, 'performance.jsonl');

  cdpClient = await page.context().newCDPSession(page);
  await cdpClient.send('Performance.enable');

  pollInterval = setInterval(async () => {
    try {
      const { metrics } = await cdpClient.send('Performance.getMetrics');
      const sessionMs = await page.evaluate(() => performance.now());

      const entry = {
        sessionMs: Math.round(sessionMs),
        type: 'cdp',
        metrics: Object.fromEntries(metrics.map((m) => [m.name, m.value])),
      };

      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Page may be closed or navigating; skip this poll cycle
    }
  }, 500);
}

/**
 * Stops CDP performance polling, flushes performance marks, and detaches CDP.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} sessionDir - Absolute path to session folder
 */
export async function stopPerfCapture(page, sessionDir) {
  const filePath = path.join(sessionDir, 'performance.jsonl');

  // Stop polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // Final flush: collect performance marks from the browser
  try {
    const marks = await page.evaluate(() =>
      performance
        .getEntriesByType('mark')
        .filter((m) => m.name.includes('_'))
        .map((m) => ({ name: m.name, startTime: m.startTime, detail: m.detail }))
    );

    for (const mark of marks) {
      const entry = {
        sessionMs: Math.round(mark.startTime),
        type: 'mark',
        name: mark.name,
        detail: mark.detail,
      };
      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    }
  } catch {
    // Page may be closed; skip mark collection
  }

  // Detach CDP session
  if (cdpClient) {
    try {
      await cdpClient.detach();
    } catch {
      // Session may already be detached
    }
    cdpClient = null;
  }
}
