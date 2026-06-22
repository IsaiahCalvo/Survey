import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

const LOG_DIR = process.env.USER_REPLAY_LOG_DIR || 'Logs/2026-05-06_20-49-25';
const START_MS = Number(process.env.USER_REPLAY_START_MS || 3500);
const END_MS = Number(process.env.USER_REPLAY_END_MS || 73500);
const MAX_DELAY_MS = Number(process.env.USER_REPLAY_MAX_DELAY_MS || 120);

let session = null;

test.use({ video: 'off' });

function parseReplayEvents() {
  const consolePath = path.resolve(LOG_DIR, 'console.log');
  const text = readFileSync(consolePath, 'utf8');
  const events = [];
  const linePattern = /^\[DebugBridge \+([0-9.]+)ms\] (wheel_scroll_motion|zoom_wheel_request) (\{.*\})$/;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (!match) continue;
    const tMs = Number(match[1]);
    if (!Number.isFinite(tMs) || tMs < START_MS || tMs > END_MS) continue;
    let payload = null;
    try {
      payload = JSON.parse(match[3]);
    } catch {
      continue;
    }
    if (match[2] === 'wheel_scroll_motion') {
      events.push({
        tMs,
        type: 'scroll',
        deltaX: Number(payload.rawX) || 0,
        deltaY: Number(payload.rawY) || 0,
      });
    } else {
      events.push({
        tMs,
        type: 'zoom',
        deltaX: 0,
        deltaY: -(Number(payload.rawDeltaY) || 0),
      });
    }
  }

  return events.sort((left, right) => left.tMs - right.tMs);
}

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

async function dispatchWheel(page, event) {
  await page.evaluate(({ deltaX, deltaY, zoom }) => {
    const viewer = document.querySelector('.survey-pdfjs-viewer-container');
    const rect = viewer?.getBoundingClientRect?.();
    if (!viewer || !rect) return;
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const target = document.elementFromPoint(clientX, clientY) || viewer;
    target.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      deltaX,
      deltaY,
      clientX,
      clientY,
      ctrlKey: zoom,
    }));
  }, {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    zoom: event.type === 'zoom',
  });
}

function summarizeVisits(consoleMessages) {
  return consoleMessages
    .map((text) => text.match(/page_visit_(ready|timeout) \{([^}]*)\}/))
    .filter(Boolean)
    .map((match) => {
      const body = match[2];
      return {
        status: match[1],
        page: Number(body.match(/page:\s*(\d+)/)?.[1] || 0),
        waitMs: Number(body.match(/waitMs:\s*(\d+)/)?.[1] || 0),
        revisited: body.match(/revisited:\s*(true|false)/)?.[1] === 'true',
      };
    });
}

test('replays user logged scroll and zoom stress pattern', async ({ page }) => {
  test.setTimeout(240_000);
  session = createSession('user-log-replay', getSessionBaseDir());
  const events = parseReplayEvents();
  expect(events.length, 'Replay log should contain wheel events').toBeGreaterThan(0);

  const consoleErrors = [];
  const consoleMessages = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push(text);
    if (msg.type() === 'error') consoleErrors.push(text);
  });

  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf&userReplay=1');
  await waitForAppReady(page);

  await page.evaluate(() => {
    window.pdfOverlayRecorder.clear();
    window.pdfOverlayRecorder.start({
      samplePageLimit: 8,
      maxSamples: 12000,
      sampleIntervalMs: 24,
      capturePerfAttribution: true,
      captureWheelEvents: true,
    });
  });

  let previousMs = events[0].tMs;
  for (const event of events) {
    const delayMs = Math.min(MAX_DELAY_MS, Math.max(0, event.tMs - previousMs));
    if (delayMs > 0) await page.waitForTimeout(delayMs);
    await dispatchWheel(page, event);
    previousMs = event.tMs;
  }

  await page.waitForTimeout(1200);
  const dump = await page.evaluate(() => window.pdfOverlayRecorder.dump());
  const stopped = await page.evaluate(() => window.pdfOverlayRecorder.stop());
  const summary = stopped?.summary || dump?.summary || {};
  const visits = summarizeVisits(consoleMessages);
  const slowVisits = visits.filter((visit) => visit.waitMs >= 100);

  const artifacts = {
    replay: {
      logDir: LOG_DIR,
      startMs: START_MS,
      endMs: END_MS,
      maxDelayMs: MAX_DELAY_MS,
      eventCount: events.length,
      scrollEvents: events.filter((event) => event.type === 'scroll').length,
      zoomEvents: events.filter((event) => event.type === 'zoom').length,
    },
    overlaySummary: summary,
    visits,
    slowVisits,
    consoleErrors,
  };

  writeFileSync(path.join(session.sessionDir, 'user-replay-summary.json'), JSON.stringify(artifacts, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-samples.json'), JSON.stringify(dump?.samples || [], null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-wheel-events.json'), JSON.stringify(dump?.wheelEvents || [], null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'console-messages.json'), JSON.stringify(consoleMessages, null, 2), 'utf8');

  session.manifest.criteriaResults = {
    noConsoleErrors: { pass: consoleErrors.length === 0, errorCount: consoleErrors.length },
    noMissingOverlays: { pass: Number(summary.missingOverlayCountMax ?? 0) === 0, missingOverlayCountMax: summary.missingOverlayCountMax ?? null },
    noVisiblePresentationGap: { pass: Number(summary.visiblePresentationGapMax ?? 0) === 0, visiblePresentationGapMax: summary.visiblePresentationGapMax ?? null },
    noViewportPresentationGap: { pass: Number(summary.viewportPresentationGapMax ?? 0) === 0, viewportPresentationGapMax: summary.viewportPresentationGapMax ?? null },
    worstFrameUnder500: { pass: Number(summary.frameMsMax ?? Number.POSITIVE_INFINITY) < 500, frameMsMax: summary.frameMsMax ?? null },
    p95FrameUnder60: { pass: Number(summary.frameMsP95 ?? Number.POSITIVE_INFINITY) <= 60, frameMsP95: summary.frameMsP95 ?? null },
    sampledJankUnder10Pct: { pass: Number(summary.sampleJankFrameRatePct ?? Number.POSITIVE_INFINITY) <= 10, sampleJankFrameRatePct: summary.sampleJankFrameRatePct ?? null },
    noZoomBigJumps: { pass: Number(summary.wheelMotionSummary?.zoomBigJumpEvents ?? 0) === 0, zoomBigJumpEvents: summary.wheelMotionSummary?.zoomBigJumpEvents ?? null },
    slowVisitsUnder100ms: { pass: slowVisits.length === 0, slowVisits },
  };
  const passed = Object.values(session.manifest.criteriaResults).every((criterion) => criterion.pass === true);
  finalizeSession(
    session.sessionDir,
    session.manifest,
    passed ? 'pass' : 'fail',
    readdirSync(session.sessionDir).map((file) => ({
      type: path.extname(file).toLowerCase() === '.json' ? 'data' : 'unknown',
      path: file,
      description: file,
    }))
  );

  console.log('user-log-replay session', session.sessionDir);
  console.log('user-log-replay summary', JSON.stringify(artifacts, null, 2));

  expect(consoleErrors, 'No console errors during user replay').toEqual([]);
  expect(Number(summary.missingOverlayCountMax ?? Number.POSITIVE_INFINITY), 'No overlays should be missing').toBe(0);
  expect(Number(summary.visiblePresentationGapMax ?? Number.POSITIVE_INFINITY), 'Annotations must not appear before PDF pages').toBe(0);
  expect(Number(summary.viewportPresentationGapMax ?? Number.POSITIVE_INFINITY), 'Viewport annotations must not appear before PDF pages').toBe(0);
  expect(Number(summary.frameMsMax ?? Number.POSITIVE_INFINITY), 'Worst frame must stay below 500ms').toBeLessThan(500);
  expect(Number(summary.frameMsP95 ?? Number.POSITIVE_INFINITY), '95th percentile frame must stay under 60ms').toBeLessThanOrEqual(60);
  expect(Number(summary.sampleJankFrameRatePct ?? Number.POSITIVE_INFINITY), 'Sampled jank must stay under 10%').toBeLessThanOrEqual(10);
  expect(Number(summary.wheelMotionSummary?.zoomBigJumpEvents ?? Number.POSITIVE_INFINITY), 'Replay must not create big zoom jumps').toBe(0);
  expect(slowVisits, 'Page revisit waits must stay under 100ms').toEqual([]);
});
