/**
 * CaptureContext coordinator.
 *
 * Wires all four leaf capture modules (screenshot, console, state, performance)
 * and manages session lifecycle. Scenario test files create one CaptureContext
 * per test, call start(), step() for each user action, then finalize().
 *
 * Separates capture plumbing from scenario logic so test files read like
 * scripts of user actions (CAPT-02, CAPT-06).
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createSession, getSessionBaseDir, finalizeSession } from './session.mjs';
import { takeScreenshot } from './screenshot.mjs';
import { startConsoleCapture, stopConsoleCapture } from './console-capture.mjs';
import { captureState } from './state-capture.mjs';
import { startPerfCapture, stopPerfCapture } from './perf-capture.mjs';

export class CaptureContext {
  /**
   * @param {string} scenarioName - Name of the scenario (e.g., 'zoom-flicker')
   * @param {import('@playwright/test').Page} page - Playwright page instance
   */
  constructor(scenarioName, page) {
    this.page = page;
    this.scenarioName = scenarioName;
    this.stepCount = 0;
    this.artifacts = [];

    const { sessionDir, manifest, folderName } = createSession(
      scenarioName,
      getSessionBaseDir()
    );
    this.sessionDir = sessionDir;
    this.manifest = manifest;
    this.folderName = folderName;
  }

  /**
   * Starts all capture modules and takes a baseline screenshot.
   *
   * Records captureStartMs for video timestamp alignment (CAPT-06):
   * video frame offset = sessionMs - captureStartMs.
   */
  async start() {
    // Record capture start time for video alignment
    const captureStartMs = await this.page.evaluate(() => performance.now());
    this.manifest.captureStartMs = captureStartMs;

    // Start console and performance capture
    startConsoleCapture(this.page, this.sessionDir);
    await startPerfCapture(this.page, this.sessionDir);

    // Take baseline screenshot (step 0)
    await takeScreenshot(
      this.page,
      this.sessionDir,
      0,
      'baseline',
      'initial-state'
    );
  }

  /**
   * Executes a single scenario step with before/after capture.
   *
   * @param {string} actionName - Human-readable description of the action
   * @param {() => Promise<void>} actionFn - Async function performing the action
   */
  async step(actionName, actionFn) {
    this.stepCount++;

    // Before screenshot
    await takeScreenshot(
      this.page,
      this.sessionDir,
      this.stepCount,
      'before',
      actionName
    );

    // State snapshot before action
    await captureState(
      this.page,
      this.sessionDir,
      this.stepCount,
      actionName
    );

    // Execute the action
    await actionFn();

    // Wait for readiness after action
    await this.page.evaluate(() =>
      window.__debugReady.waitFor('ready', { timeout: 30000 })
    );

    // After screenshot
    await takeScreenshot(
      this.page,
      this.sessionDir,
      this.stepCount,
      'after',
      actionName
    );
  }

  /**
   * Finalizes the capture session: stops capture modules, builds artifact
   * list, writes manifest.
   *
   * @param {'pass'|'fail'} result - Test result
   * @param {Array<{name: string, passed: boolean, detail?: string}>} [criteriaResults] - Pass/fail criteria detail (CAPT-05)
   * @returns {string} sessionDir path for caller reference
   */
  async finalize(result, criteriaResults) {
    // Stop capture modules
    stopConsoleCapture(this.page);
    await stopPerfCapture(this.page, this.sessionDir);

    // Build artifacts list by scanning session directory
    const files = readdirSync(this.sessionDir);
    this.artifacts = files.map((f) => {
      const ext = path.extname(f).toLowerCase();
      let type = 'unknown';
      if (ext === '.png') type = 'screenshot';
      else if (ext === '.jsonl') type = 'data';
      else if (ext === '.json') type = 'manifest';
      else if (ext === '.webm') type = 'video';

      return {
        type,
        path: f,
        description: f,
      };
    });

    // Store criteria results for pass/fail detail
    if (criteriaResults) {
      this.manifest.criteriaResults = criteriaResults;
    }

    // Write final manifest
    finalizeSession(this.sessionDir, this.manifest, result, this.artifacts);

    return this.sessionDir;
  }

  /**
   * Returns the session directory path for callers that need to save
   * additional artifacts (e.g., video via page.video().saveAs()).
   *
   * @returns {string}
   */
  getSessionDir() {
    return this.sessionDir;
  }
}
