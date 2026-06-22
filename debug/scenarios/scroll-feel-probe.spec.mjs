import { test, expect } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

const START_PAGE = Number(process.env.START_PAGE || 6);
const START_ZOOM = Number(process.env.START_ZOOM || 160);
const WHEEL_DELTA_Y = Number(process.env.WHEEL_DELTA_Y || 260);
const WHEEL_DELAY_MS = Number(process.env.WHEEL_DELAY_MS || 8);
const RUNS = [
  { direction: 1, count: Number(process.env.DOWN_1_EVENTS || 90) },
  { direction: -1, count: Number(process.env.UP_1_EVENTS || 120) },
  { direction: 1, count: Number(process.env.DOWN_2_EVENTS || 90) },
  { direction: -1, count: Number(process.env.UP_2_EVENTS || 60) },
];

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

function percentile(values, pct) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function max(values) {
  const numeric = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return numeric.length ? Math.max(...numeric) : 0;
}

function summarizeScrollProbe(probe, overlaySummary, overlaySamples, consoleMessages) {
  const wheels = Array.isArray(probe?.wheelEvents) ? probe.wheelEvents : [];
  const scrolls = Array.isArray(probe?.scrollEvents) ? probe.scrollEvents : [];
  const frames = Array.isArray(probe?.frames) ? probe.frames : [];
  const appliedY = wheels.map((event) => Math.abs(Number(event.appliedY) || 0));
  const frameY = frames.map((frame) => Math.abs(Number(frame.deltaTop) || 0));
  const scrollEventY = scrolls.map((event) => Math.abs(Number(event.deltaTop) || 0));
  const blankSamples = overlaySamples.filter((sample) =>
    Array.isArray(sample.pages) &&
    sample.pages.some((page) => page.viewportVisible && !page.hasPdfSurface)
  );
  const pageVisitReady = consoleMessages
    .map((text) => text.match(/page_visit_ready \{([^}]*)\}/))
    .filter(Boolean)
    .map((match) => {
      const body = match[1];
      const pageMatch = body.match(/page:\s*(\d+)/);
      const waitMatch = body.match(/waitMs:\s*(\d+)/);
      const revisitedMatch = body.match(/revisited:\s*(true|false)/);
      if (!pageMatch || !waitMatch || !revisitedMatch) return null;
      return {
        page: Number(pageMatch[1]),
        waitMs: Number(waitMatch[1]),
        revisited: revisitedMatch[1] === 'true',
      };
    })
    .filter(Boolean);
  const page567Revisits = pageVisitReady.filter((visit) =>
    [5, 6, 7].includes(Number(visit.page)) && visit.revisited === true
  );
  return {
    wheelEventCount: wheels.length,
    scrollEventCount: scrolls.length,
    frameCount: frames.length,
    zoomLevelsSeen: [...new Set(wheels.map((event) => Number(event.zoomLevel)).filter(Number.isFinite))],
    totalRawWheelY: wheels.reduce((total, event) => total + Math.abs(Number(event.rawDeltaY) || 0), 0),
    totalAppliedWheelY: wheels.reduce((total, event) => total + Math.abs(Number(event.appliedY) || 0), 0),
    appliedWheelYAvg: appliedY.length ? appliedY.reduce((total, value) => total + value, 0) / appliedY.length : 0,
    appliedWheelYP95: percentile(appliedY, 95),
    appliedWheelYMax: max(appliedY),
    scrollEventDeltaYP95: percentile(scrollEventY, 95),
    scrollEventDeltaYMax: max(scrollEventY),
    frameDeltaYP95: percentile(frameY, 95),
    frameDeltaYMax: max(frameY),
    extremeFrameJumpCount: frameY.filter((value) => value > 180).length,
    extremeAppliedWheelCount: appliedY.filter((value) => value > 64).length,
    overlayFrameMsMax: overlaySummary.frameMsMax ?? null,
    overlayJankFrameRatePct: overlaySummary.jankFrameRatePct ?? null,
    missingOverlayCountMax: overlaySummary.missingOverlayCountMax ?? null,
    visiblePresentationGapMax: overlaySummary.visiblePresentationGapMax ?? null,
    viewportPresentationGapMax: overlaySummary.viewportPresentationGapMax ?? null,
    blankSampleCount: blankSamples.length,
    page567RevisitCount: page567Revisits.length,
    page567RevisitWaitMsMax: max(page567Revisits.map((visit) => visit.waitMs)),
    page567RevisitWaitMsP95: percentile(page567Revisits.map((visit) => visit.waitMs), 95),
  };
}

test('scroll feel probe records wheel input to rendered movement', async ({ page }) => {
  test.setTimeout(240_000);
  session = createSession('scroll-feel-probe', getSessionBaseDir());

  const consoleErrors = [];
  const consoleMessages = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push(text);
    if (msg.type() === 'error') consoleErrors.push(text);
  });

  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
  await waitForAppReady(page);
  await goToPage(page, START_PAGE);
  await setToolbarZoom(page, START_ZOOM);

  await page.evaluate(() => {
    window.pdfOverlayRecorder.clear();
    window.pdfOverlayRecorder.start({
      samplePageLimit: 8,
      maxSamples: 8000,
      sampleIntervalMs: 24,
      capturePerfAttribution: true,
    });
  });

  await page.evaluate(() => {
    const viewer = document.querySelector('.survey-pdfjs-viewer-container');
    const normalize = (event) => {
      const rawX = Number(event?.deltaX) || 0;
      const rawY = Number(event?.deltaY) || 0;
      if (event?.deltaMode === 1) return { x: rawX * 16, y: rawY * 16 };
      if (event?.deltaMode === 2) {
        const pageSize = Math.max(1, window.innerHeight || 800);
        return { x: rawX * pageSize, y: rawY * pageSize };
      }
      return { x: rawX, y: rawY };
    };
    const probe = {
      wheelEvents: [],
      scrollEvents: [],
      frames: [],
      startedAt: performance.now(),
      stop: null,
    };
    let lastFrameAt = performance.now();
    let lastTop = Number(viewer?.scrollTop || 0);
    let lastLeft = Number(viewer?.scrollLeft || 0);
    let rafId = null;

    const getZoomLevel = () => {
      try {
        return Number(window.__debugBridge?.snapshot?.()?.zoomLevel) || null;
      } catch {
        return null;
      }
    };
    const onWheel = (event) => {
      if (!viewer || !viewer.contains(event.target)) return;
      const beforeTop = Number(viewer.scrollTop || 0);
      const beforeLeft = Number(viewer.scrollLeft || 0);
      const normalized = normalize(event);
      const entry = {
        tMs: Math.round((performance.now() - probe.startedAt) * 10) / 10,
        rawDeltaX: Number(event.deltaX) || 0,
        rawDeltaY: Number(event.deltaY) || 0,
        normalizedX: normalized.x,
        normalizedY: normalized.y,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        zoomLevel: getZoomLevel(),
        beforeTop,
        beforeLeft,
        afterTop: beforeTop,
        afterLeft: beforeLeft,
        appliedY: 0,
        appliedX: 0,
      };
      probe.wheelEvents.push(entry);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          entry.afterTop = Number(viewer.scrollTop || 0);
          entry.afterLeft = Number(viewer.scrollLeft || 0);
          entry.appliedY = entry.afterTop - beforeTop;
          entry.appliedX = entry.afterLeft - beforeLeft;
        });
      });
    };
    const onScroll = () => {
      const top = Number(viewer?.scrollTop || 0);
      const left = Number(viewer?.scrollLeft || 0);
      const prev = probe.scrollEvents.length > 0
        ? probe.scrollEvents[probe.scrollEvents.length - 1]
        : { top: lastTop, left: lastLeft };
      probe.scrollEvents.push({
        tMs: Math.round((performance.now() - probe.startedAt) * 10) / 10,
        top,
        left,
        deltaTop: top - Number(prev.top || 0),
        deltaLeft: left - Number(prev.left || 0),
        zoomLevel: getZoomLevel(),
      });
    };
    const tick = () => {
      const now = performance.now();
      const top = Number(viewer?.scrollTop || 0);
      const left = Number(viewer?.scrollLeft || 0);
      probe.frames.push({
        tMs: Math.round((now - probe.startedAt) * 10) / 10,
        frameMs: Math.round((now - lastFrameAt) * 1000) / 1000,
        top,
        left,
        deltaTop: top - lastTop,
        deltaLeft: left - lastLeft,
        zoomLevel: getZoomLevel(),
      });
      lastFrameAt = now;
      lastTop = top;
      lastLeft = left;
      rafId = requestAnimationFrame(tick);
    };
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    viewer?.addEventListener('scroll', onScroll, { passive: true });
    rafId = requestAnimationFrame(tick);
    probe.stop = () => {
      document.removeEventListener('wheel', onWheel, { capture: true });
      viewer?.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
      return {
        wheelEvents: probe.wheelEvents,
        scrollEvents: probe.scrollEvents,
        frames: probe.frames,
      };
    };
    window.__scrollFeelProbe = probe;
  });

  const center = await viewerCenter(page);
  await page.mouse.move(center.x, center.y);

  for (const run of RUNS) {
    for (let i = 0; i < run.count; i += 1) {
      await page.mouse.wheel(0, run.direction * WHEEL_DELTA_Y);
      await page.waitForTimeout(WHEEL_DELAY_MS);
    }
    await page.waitForTimeout(180);
  }

  const probe = await page.evaluate(() => window.__scrollFeelProbe?.stop?.());

  for (const revisitPage of [5, 6, 7]) {
    await goToPage(page, revisitPage);
  }

  await page.waitForTimeout(500);
  const dump = await page.evaluate(() => window.pdfOverlayRecorder.dump());
  const stopped = await page.evaluate(() => window.pdfOverlayRecorder.stop());
  const summary = stopped?.summary || dump?.summary || {};
  const samples = Array.isArray(dump?.samples) ? dump.samples : [];
  const scrollSummary = summarizeScrollProbe(probe, summary, samples, consoleMessages);
  const finalSnap = await page.evaluate(() => window.__debugBridge.snapshot());

  const artifacts = {
    config: {
      START_PAGE,
      START_ZOOM,
      WHEEL_DELTA_Y,
      WHEEL_DELAY_MS,
      RUNS,
    },
    scrollSummary,
    overlaySummary: summary,
    finalSnap: {
      zoomLevel: finalSnap.zoomLevel,
      currentPage: finalSnap.currentPage,
      visiblePages: finalSnap.visiblePages,
    },
    consoleErrors,
  };

  writeFileSync(path.join(session.sessionDir, 'scroll-summary.json'), JSON.stringify(scrollSummary, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'scroll-probe.json'), JSON.stringify(probe, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'console-messages.json'), JSON.stringify(consoleMessages, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-samples.json'), JSON.stringify(samples, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'scroll-artifacts.json'), JSON.stringify(artifacts, null, 2), 'utf8');

  session.manifest.criteriaResults = {
    noConsoleErrors: { pass: consoleErrors.length === 0, errorCount: consoleErrors.length },
    noMissingOverlays: { pass: Number(summary.missingOverlayCountMax ?? 0) === 0, missingOverlayCountMax: summary.missingOverlayCountMax ?? null },
    noVisiblePresentationGap: { pass: Number(summary.visiblePresentationGapMax ?? 0) === 0, visiblePresentationGapMax: summary.visiblePresentationGapMax ?? null },
    noViewportPresentationGap: { pass: Number(summary.viewportPresentationGapMax ?? 0) === 0, viewportPresentationGapMax: summary.viewportPresentationGapMax ?? null },
    noPageBlanking: { pass: scrollSummary.blankSampleCount === 0, blankSampleCount: scrollSummary.blankSampleCount },
    worstFrameUnder500: { pass: Number(summary.frameMsMax ?? Number.POSITIVE_INFINITY) < 500, frameMsMax: summary.frameMsMax ?? null },
    jankUnder15Pct: { pass: Number(summary.jankFrameRatePct ?? Number.POSITIVE_INFINITY) < 15, jankFrameRatePct: summary.jankFrameRatePct ?? null },
    page567RevisitsUnder50ms: { pass: Number(scrollSummary.page567RevisitWaitMsMax ?? 0) < 50, page567RevisitWaitMsMax: scrollSummary.page567RevisitWaitMsMax },
  };
  const allCriteriaPassed = Object.values(session.manifest.criteriaResults).every((criterion) => criterion.pass === true);

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
  console.log('scroll-feel-probe session', session.sessionDir);
  console.log('scroll-feel-probe summary', JSON.stringify(scrollSummary, null, 2));

  expect(consoleErrors, 'No console errors during scroll feel probe').toEqual([]);
  expect(Number(summary.missingOverlayCountMax ?? Number.POSITIVE_INFINITY), 'No overlays should be missing').toBe(0);
  expect(Number(summary.visiblePresentationGapMax ?? Number.POSITIVE_INFINITY), 'Annotations must not appear before PDF pages').toBe(0);
  expect(Number(summary.viewportPresentationGapMax ?? Number.POSITIVE_INFINITY), 'Viewport annotations must not appear before PDF pages').toBe(0);
  expect(scrollSummary.blankSampleCount, 'No visible PDF page should go blank during scroll probe').toBe(0);
  expect(Number(summary.frameMsMax ?? Number.POSITIVE_INFINITY), 'Worst frame must stay below 500ms').toBeLessThan(500);
  expect(Number(summary.jankFrameRatePct ?? Number.POSITIVE_INFINITY), 'RAF jank rate must stay under 15%').toBeLessThan(15);
  expect(Number(scrollSummary.page567RevisitWaitMsMax ?? 0), 'Page 5/6/7 revisits must stay under 50ms').toBeLessThan(50);
});
