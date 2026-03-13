/**
 * State capture module.
 *
 * Captures debug bridge snapshots at step boundaries and writes them
 * as JSONL entries to state.jsonl. Uses drainMutations: true to atomically
 * read and clear the mutation ring buffer (CAPT-04).
 */

import { appendFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Captures a debug bridge snapshot and writes it to state.jsonl.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} sessionDir - Absolute path to session folder
 * @param {number} stepNum - Current step number
 * @param {string} actionName - Human-readable action description
 * @returns {Promise<object>} The captured state entry
 */
export async function captureState(page, sessionDir, stepNum, actionName) {
  const snapshot = await page.evaluate(() =>
    window.__debugBridge.snapshot({ drainMutations: true })
  );

  const entry = {
    sessionMs: snapshot.sessionMs,
    step: stepNum,
    action: actionName,
    zoomLevel: snapshot.zoomLevel,
    renderedScale: snapshot.renderedScale,
    targetScale: snapshot.targetScale,
    freezeState: snapshot.freezeState,
    canvasContainerCount: snapshot.canvasContainerCount,
    pageStatus: snapshot.pageStatus,
    mutations: snapshot.mutations,
    signals: snapshot.signals,
  };

  const filePath = path.join(sessionDir, 'state.jsonl');
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');

  return entry;
}
