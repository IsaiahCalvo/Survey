/**
 * Console message capture module.
 *
 * Intercepts browser console messages and writes them as JSONL entries
 * to console.jsonl in the session directory. Each entry has a sessionMs
 * timestamp for timeline correlation with other capture modules (CAPT-03).
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** @type {Function|null} */
let handler = null;

/**
 * Starts capturing console messages from the page.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} sessionDir - Absolute path to session folder
 */
export function startConsoleCapture(page, sessionDir) {
  const filePath = path.join(sessionDir, 'console.jsonl');

  // Ensure file exists even if no console messages fire (complete artifact set)
  writeFileSync(filePath, '', { flag: 'a' });

  handler = async (msg) => {
    let sessionMs = -1;
    try {
      sessionMs = await page.evaluate(() => performance.now());
    } catch {
      // Page may be closed or navigating; use fallback
    }

    const entry = {
      sessionMs: Math.round(sessionMs),
      level: msg.type(),
      text: msg.text(),
      location: msg.location(),
    };

    if (msg.type() === 'error') {
      entry.stackTrace = msg.text();
    }

    appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  };

  page.on('console', handler);
}

/**
 * Stops capturing console messages by removing the listener.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export function stopConsoleCapture(page) {
  if (handler) {
    page.removeListener('console', handler);
    handler = null;
  }
}
