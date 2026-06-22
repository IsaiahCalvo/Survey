import { test, expect } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, finalizeSession, getSessionBaseDir } from '../lib/session.mjs';

let session = null;

test.use({ video: 'off' });

async function waitForAppReady(page) {
  await page.locator('.survey-pdfjs-viewer-container').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => window.__debugBridge != null && window.pdfOverlayRecorder != null, { timeout: 30_000 });
  await page.evaluate(() => window.__debugReady.waitFor('pdfLoaded', { timeout: 30_000 }));
}

async function goToPage(page, pageNumber) {
  const pageInput = page.getByRole('textbox', { name: 'Current page' });
  await expect(pageInput).toBeVisible({ timeout: 15_000 });
  await pageInput.click();
  await pageInput.fill(String(pageNumber));
  await pageInput.press('Enter');
  await page.evaluate(() => window.__debugReady.waitFor('ready', { timeout: 30_000 }));
}

async function setToolbarZoom(page, zoomLevel) {
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage' });
  await expect(zoomInput).toBeVisible({ timeout: 15_000 });
  await zoomInput.click();
  await zoomInput.fill(String(zoomLevel));
  await zoomInput.press('Enter');
  await page.evaluate(() => window.__debugReady.waitFor('ready', { timeout: 30_000 }));
}

async function viewerCenter(page) {
  const box = await page.locator('.survey-pdfjs-viewer-container').boundingBox();
  expect(box, 'Syncfusion viewer box should be measurable').toBeTruthy();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function percentile(values, pct) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function parsePageVisitReady(consoleMessages) {
  return consoleMessages
    .map((text) => text.match(/page_visit_ready \{([^}]*)\}/))
    .filter(Boolean)
    .map((match) => {
      const body = match[1];
      const field = (name) => body.match(new RegExp(`${name}:\\s*([^,]+)`))?.[1]?.trim();
      return {
        page: Number(field('page')),
        revisited: field('revisited') === 'true',
        waitMs: Number(field('waitMs')),
        spinnerVisible: field('spinnerVisible') === 'true',
        hasPdfSurface: field('hasPdfSurface') === 'true',
        hasAnnotationOverlay: field('hasAnnotationOverlay') === 'true',
        ready: field('ready') === 'true',
      };
    })
    .filter((visit) => Number.isFinite(visit.page) && Number.isFinite(visit.waitMs));
}

function parseZoomStarts(consoleMessages) {
  return consoleMessages
    .map((text) => text.match(/zoom_start \{([^}]*)\}/))
    .filter(Boolean)
    .map((match) => {
      const body = match[1];
      const scaleMatch = body.match(/scale:\s*([0-9.]+)/);
      const targetMatch = body.match(/targetScale:\s*([0-9.]+)/);
      const sourceMatch = body.match(/source:\s*['"]?([^,'"}]+)/);
      return {
        scale: scaleMatch ? Number(scaleMatch[1]) : null,
        targetScale: targetMatch ? Number(targetMatch[1]) : null,
        source: sourceMatch?.[1] || null,
      };
    });
}

function summarizeProbe(probe, overlaySummary, overlaySamples, consoleMessages) {
  const wheelEvents = Array.isArray(probe?.wheelEvents) ? probe.wheelEvents : [];
  const scrollEvents = Array.isArray(probe?.scrollEvents) ? probe.scrollEvents : [];
  const frames = Array.isArray(probe?.frames) ? probe.frames : [];
  const zoomFrames = frames.filter((frame) => frame.ctrlKey || frame.zoomGesture);
  const pageVisits = parsePageVisitReady(consoleMessages);
  const revisits = pageVisits.filter((visit) => visit.revisited);
  const adjacentFirstVisits = pageVisits.filter((visit) => [5, 7].includes(visit.page) && !visit.revisited);
  const blankSamples = overlaySamples.filter((sample) =>
    Array.isArray(sample.pages) && sample.pages.some((page) => page.viewportVisible && !page.hasPdfSurface)
  );
  const frameDeltaY = frames.map((frame) => Math.abs(Number(frame.deltaTop) || 0));
  const frameDeltaX = frames.map((frame) => Math.abs(Number(frame.deltaLeft) || 0));
  const scrollDeltaY = scrollEvents.map((event) => Math.abs(Number(event.deltaTop) || 0));
  const scrollDeltaX = scrollEvents.map((event) => Math.abs(Number(event.deltaLeft) || 0));
  const zoomStarts = parseZoomStarts(consoleMessages);
  const zoomValues = frames.map((frame) => Number(frame.zoomLevel)).filter(Number.isFinite);
  const zoomAtExtremeScale = zoomStarts.filter((event) => Number(event.scale) <= 0.11);
  const spinnerReadyVisits = pageVisits.filter((visit) => visit.ready && visit.spinnerVisible);

  return {
    wheelEventCount: wheelEvents.length,
    scrollEventCount: scrollEvents.length,
    scrollEventsPerSecond: overlaySummary.durationMs ? Math.round((scrollEvents.length / (overlaySummary.durationMs / 1000)) * 100) / 100 : null,
    verticalScrollWorked: scrollDeltaY.some((value) => value > 0),
    horizontalScrollWorked: scrollDeltaX.some((value) => value > 0),
    diagonalScrollWorked: wheelEvents.some((event) => Math.abs(event.normalizedX) > 0 && Math.abs(event.normalizedY) > 0),
    scrollFrameDeltaYP95: percentile(frameDeltaY, 95),
    scrollFrameDeltaYMax: Math.max(0, ...frameDeltaY),
    scrollFrameDeltaXP95: percentile(frameDeltaX, 95),
    scrollFrameDeltaXMax: Math.max(0, ...frameDeltaX),
    revisitedPageReadyP95: percentile(revisits.map((visit) => visit.waitMs), 95),
    revisitedPageReadyMax: Math.max(0, ...revisits.map((visit) => visit.waitMs)),
    adjacentFirstPageReadyP95: percentile(adjacentFirstVisits.map((visit) => visit.waitMs), 95),
    spinnerReadyVisitCount: spinnerReadyVisits.length,
    spinnerReadyVisits: spinnerReadyVisits.slice(0, 12),
    blankSampleCount: blankSamples.length,
    missingOverlayCountMax: overlaySummary.missingOverlayCountMax ?? null,
    samplesWithMissingOverlayPct: overlaySummary.samplesWithMissingOverlayPct ?? null,
    visiblePresentationGapMax: overlaySummary.visiblePresentationGapMax ?? null,
    viewportPresentationGapMax: overlaySummary.viewportPresentationGapMax ?? null,
    frameMsAvg: overlaySummary.frameMsAvg ?? null,
    frameMsP95: overlaySummary.frameMsP95 ?? null,
    frameMsMax: overlaySummary.frameMsMax ?? null,
    fpsAvg: overlaySummary.fpsAvg ?? null,
    jankFrameRatePct: overlaySummary.jankFrameRatePct ?? null,
    scaleMismatchP95: overlaySummary.scaleMismatchP95 ?? null,
    scaleMismatchMax: overlaySummary.scaleMismatchMax ?? null,
    zoomStartCount: zoomStarts.length,
    zoomAtExtremeScaleCount: zoomAtExtremeScale.length,
    zoomAtExtremeScale,
    zoomLevelMin: zoomValues.length ? Math.min(...zoomValues) : null,
    zoomLevelMax: zoomValues.length ? Math.max(...zoomValues) : null,
    zoomFrameCount: zoomFrames.length,
  };
}

test('pdf interaction capability baseline', async ({ page }) => {
  test.setTimeout(300_000);
  session = createSession('pdf-interaction-capability-baseline', getSessionBaseDir());
  const consoleMessages = [];
  const consoleErrors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push(text);
    if (msg.type() === 'error') consoleErrors.push(text);
  });

  await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
  await waitForAppReady(page);
  await goToPage(page, 6);
  await setToolbarZoom(page, 160);

  await page.evaluate(() => {
    window.pdfOverlayRecorder.clear();
    window.pdfOverlayRecorder.start({ samplePageLimit: 8, maxSamples: 12000, sampleIntervalMs: 24, capturePerfAttribution: true });
  });

  await page.evaluate(() => {
    const viewer = document.querySelector('.survey-pdfjs-viewer-container');
    const normalize = (event) => {
      const rawX = Number(event.deltaX) || 0;
      const rawY = Number(event.deltaY) || 0;
      if (event.deltaMode === 1) return { x: rawX * 16, y: rawY * 16 };
      if (event.deltaMode === 2) return { x: rawX * window.innerWidth, y: rawY * window.innerHeight };
      return { x: rawX, y: rawY };
    };
    const probe = { startedAt: performance.now(), wheelEvents: [], scrollEvents: [], frames: [] };
    let lastTop = Number(viewer?.scrollTop || 0);
    let lastLeft = Number(viewer?.scrollLeft || 0);
    let lastFrameAt = performance.now();
    const zoomLevel = () => {
      try { return Number(window.__debugBridge?.snapshot?.()?.zoomLevel) || null; } catch { return null; }
    };
    const onWheel = (event) => {
      if (!viewer || !viewer.contains(event.target)) return;
      const n = normalize(event);
      probe.wheelEvents.push({
        tMs: Math.round((performance.now() - probe.startedAt) * 10) / 10,
        rawDeltaX: Number(event.deltaX) || 0,
        rawDeltaY: Number(event.deltaY) || 0,
        normalizedX: n.x,
        normalizedY: n.y,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        zoomLevel: zoomLevel(),
        scrollTop: Number(viewer.scrollTop || 0),
        scrollLeft: Number(viewer.scrollLeft || 0),
      });
    };
    const onScroll = () => {
      const top = Number(viewer?.scrollTop || 0);
      const left = Number(viewer?.scrollLeft || 0);
      const prev = probe.scrollEvents.at(-1) || { top: lastTop, left: lastLeft };
      probe.scrollEvents.push({
        tMs: Math.round((performance.now() - probe.startedAt) * 10) / 10,
        top,
        left,
        deltaTop: top - prev.top,
        deltaLeft: left - prev.left,
        zoomLevel: zoomLevel(),
      });
    };
    const tick = () => {
      const now = performance.now();
      const top = Number(viewer?.scrollTop || 0);
      const left = Number(viewer?.scrollLeft || 0);
      const recentWheel = probe.wheelEvents.at(-1);
      probe.frames.push({
        tMs: Math.round((now - probe.startedAt) * 10) / 10,
        frameMs: Math.round((now - lastFrameAt) * 1000) / 1000,
        top,
        left,
        deltaTop: top - lastTop,
        deltaLeft: left - lastLeft,
        zoomLevel: zoomLevel(),
        ctrlKey: !!recentWheel?.ctrlKey,
        zoomGesture: !!recentWheel?.ctrlKey || !!recentWheel?.metaKey,
      });
      lastTop = top;
      lastLeft = left;
      lastFrameAt = now;
      probe.rafId = requestAnimationFrame(tick);
    };
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    viewer?.addEventListener('scroll', onScroll, { passive: true });
    probe.rafId = requestAnimationFrame(tick);
    probe.stop = () => {
      document.removeEventListener('wheel', onWheel, { capture: true });
      viewer?.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(probe.rafId);
      return { wheelEvents: probe.wheelEvents, scrollEvents: probe.scrollEvents, frames: probe.frames };
    };
    window.__pdfInteractionCapabilityProbe = probe;
  });

  const center = await viewerCenter(page);
  await page.mouse.move(center.x, center.y);

  await page.keyboard.down('Control');
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(12);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);

  await page.keyboard.down('Control');
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, 180);
    await page.waitForTimeout(12);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);

  for (let i = 0; i < 26; i += 1) {
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(12);
  }
  for (let i = 0; i < 26; i += 1) {
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(12);
  }
  for (let i = 0; i < 34; i += 1) {
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(12);
  }
  for (let i = 0; i < 34; i += 1) {
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(12);
  }

  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(120, 160);
    await page.waitForTimeout(12);
  }
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(180, 0);
    await page.waitForTimeout(12);
  }
  for (let i = 0; i < 120; i += 1) {
    await page.mouse.wheel(0, i < 60 ? 260 : -260);
    await page.waitForTimeout(8);
  }

  await page.waitForTimeout(1000);
  const dump = await page.evaluate(() => window.pdfOverlayRecorder.dump());
  const stopped = await page.evaluate(() => window.pdfOverlayRecorder.stop());
  const probe = await page.evaluate(() => window.__pdfInteractionCapabilityProbe?.stop?.());
  const summary = stopped?.summary || dump?.summary || {};
  const samples = Array.isArray(dump?.samples) ? dump.samples : [];
  const baselineSummary = summarizeProbe(probe, summary, samples, consoleMessages);
  const finalSnap = await page.evaluate(() => window.__debugBridge.snapshot());

  writeFileSync(path.join(session.sessionDir, 'baseline-summary.json'), JSON.stringify(baselineSummary, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'overlay-recorder-samples.json'), JSON.stringify(samples, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'interaction-probe.json'), JSON.stringify(probe, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'console-messages.json'), JSON.stringify(consoleMessages, null, 2), 'utf8');
  writeFileSync(path.join(session.sessionDir, 'final-snapshot.json'), JSON.stringify(finalSnap, null, 2), 'utf8');

  session.manifest.criteriaResults = {
    noConsoleErrors: { pass: consoleErrors.length === 0, errorCount: consoleErrors.length },
    noMissingOverlays: { pass: Number(summary.missingOverlayCountMax ?? 0) === 0, missingOverlayCountMax: summary.missingOverlayCountMax ?? null },
    noPresentationGap: { pass: Number(summary.viewportPresentationGapMax ?? 0) === 0, viewportPresentationGapMax: summary.viewportPresentationGapMax ?? null },
    noBlankSamples: { pass: baselineSummary.blankSampleCount === 0, blankSampleCount: baselineSummary.blankSampleCount },
    noSpinnerReady: { pass: baselineSummary.spinnerReadyVisitCount === 0, spinnerReadyVisitCount: baselineSummary.spinnerReadyVisitCount },
    noExtremeZoom: {
      pass: baselineSummary.zoomAtExtremeScaleCount === 0 && Number(baselineSummary.zoomLevelMin ?? 1) > 0.11,
      zoomAtExtremeScaleCount: baselineSummary.zoomAtExtremeScaleCount,
      zoomLevelMin: baselineSummary.zoomLevelMin,
    },
    frameBudget: {
      pass: Number(summary.frameMsMax ?? Number.POSITIVE_INFINITY) < 500 &&
        Number(summary.jankFrameRatePct ?? Number.POSITIVE_INFINITY) <= 15 &&
        Number(summary.frameMsP95 ?? Number.POSITIVE_INFINITY) <= 120 &&
        Number(summary.fpsAvg ?? 0) >= 30,
      frameMsMax: summary.frameMsMax ?? null,
      frameMsP95: summary.frameMsP95 ?? null,
      fpsAvg: summary.fpsAvg ?? null,
      jankFrameRatePct: summary.jankFrameRatePct ?? null,
    },
    scrollAxesWork: {
      pass: baselineSummary.verticalScrollWorked && baselineSummary.horizontalScrollWorked && baselineSummary.diagonalScrollWorked,
      verticalScrollWorked: baselineSummary.verticalScrollWorked,
      horizontalScrollWorked: baselineSummary.horizontalScrollWorked,
      diagonalScrollWorked: baselineSummary.diagonalScrollWorked,
    },
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

  console.log('pdf-interaction-capability-baseline session', session.sessionDir);
  console.log('pdf-interaction-capability-baseline summary', JSON.stringify(baselineSummary, null, 2));

  expect(consoleErrors, 'No console errors during capability baseline').toEqual([]);
  expect(summary.sampleCount, 'Overlay recorder must capture baseline samples').toBeGreaterThan(0);
});
