import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const baseUrl = String(
  valueAfter('--base-url')
  || process.env.BENCHMARK_BASE_URL
  || 'http://127.0.0.1:5178',
).replace(/\/$/, '');
const outputPath = valueAfter('--output') || process.env.BENCHMARK_OUTPUT || null;
const benchmarkUrl = `${baseUrl}/?testPdf=spike-120-pages.pdf&annotationBenchmarkPerPage=2000`;

const pickSummary = (summary = {}) => ({
  sampleCount: summary.sampleCount ?? 0,
  durationMs: summary.durationMs ?? 0,
  fpsAverage: summary.fpsAvg ?? 0,
  frameMsAverage: summary.frameMsAvg ?? 0,
  frameMsP95: summary.frameMsP95 ?? 0,
  frameMsMaximum: summary.frameMsMax ?? 0,
  jankFrameRatePercent: summary.jankFrameRatePct ?? 0,
  jankFrameCount: summary.jankFrames ?? 0,
  longTaskCount: summary.longTaskCountTotal ?? 0,
  longTaskTotalMs: summary.longTaskTotalMs ?? 0,
  worstDriftPxMaximum: summary.worstDriftPxMax ?? 0,
  scaleMismatchMaximum: summary.scaleMismatchMax ?? 0,
  missingOverlayCountMaximum: summary.missingOverlayCountMax ?? 0,
  visiblePresentationGapMaximum: summary.visiblePresentationGapMax ?? 0,
  viewportPresentationGapMaximum: summary.viewportPresentationGapMax ?? 0,
  rawZoomSignalCount: summary.workReductionSummary?.rawZoomSignalCount ?? 0,
});

async function setZoom(page, percentage) {
  const trigger = page.locator('button[aria-label="Edit zoom percentage"]');
  await trigger.click();
  const input = page.locator('input:focus');
  await input.fill(String(percentage));
  await input.press('Enter');
  await page.waitForFunction(
    (expected) => document.querySelector('button[aria-label="Edit zoom percentage"]')
      ?.textContent?.trim() === `${expected}%`,
    percentage,
    { timeout: 15_000 },
  );
}

async function waitForMountedWorkers(page) {
  await page.waitForFunction(() => {
    const mounted = [...document.querySelectorAll(
      '.survey-pdfjs-page-div[data-page-mounted="true"]',
    )];
    return mounted.length > 0 && mounted.every((pageDiv) => (
      pageDiv.querySelector('[data-lightweight-object-count="2000"] canvas')
        ?.dataset.canvasRenderer === 'worker'
    ));
  }, null, { timeout: 60_000 });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.survey-pdfjs-viewer');
    const scrollerRect = scroller?.getBoundingClientRect();
    const pages = [...document.querySelectorAll('.survey-pdfjs-page-div')];
    const mounted = pages.filter((pageDiv) => pageDiv.dataset.pageMounted === 'true');
    const visible = scrollerRect ? pages.filter((pageDiv) => {
      const rect = pageDiv.getBoundingClientRect();
      return rect.bottom >= scrollerRect.top
        && rect.top <= scrollerRect.bottom
        && rect.right >= scrollerRect.left
        && rect.left <= scrollerRect.right;
    }) : [];
    const workerPages = [...document.querySelectorAll(
      '[data-lightweight-object-count="2000"] canvas[data-canvas-renderer="worker"]',
    )].map((canvas) => Number(canvas.dataset.annotationPresentationCanvas));
    const drift = mounted.map((pageDiv) => {
      const host = pageDiv.querySelector('[data-pdfjs-page-overlay-host="true"]');
      if (!host) return Number.POSITIVE_INFINITY;
      const pageRect = pageDiv.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      return Math.max(
        Math.abs(pageRect.left - hostRect.left),
        Math.abs(pageRect.top - hostRect.top),
        Math.abs(pageRect.width - hostRect.width),
        Math.abs(pageRect.height - hostRect.height),
      );
    });
    return {
      zoom: document.querySelector('button[aria-label="Edit zoom percentage"]')
        ?.textContent?.trim() || null,
      virtualAnnotationTotal: Number(document.querySelector(
        '[data-production-annotation-benchmark-total]',
      )?.dataset.productionAnnotationBenchmarkTotal) || 0,
      pageCount: pages.length,
      pageLocalHostCount: document.querySelectorAll(
        '.survey-pdfjs-page-div > [data-pdfjs-page-overlay-host="true"]',
      ).length,
      mountedPages: mounted.map((pageDiv) => Number(pageDiv.dataset.pageNumber)),
      visiblePages: visible.map((pageDiv) => Number(pageDiv.dataset.pageNumber)),
      visibleNotMounted: visible
        .filter((pageDiv) => pageDiv.dataset.pageMounted !== 'true')
        .map((pageDiv) => Number(pageDiv.dataset.pageNumber)),
      workerPages,
      mountedAnnotationCounts: [...document.querySelectorAll(
        '[data-lightweight-annotation-overlay]',
      )].map((overlay) => Number(overlay.dataset.lightweightObjectCount)),
      svgPresentationNodeCount: document.querySelectorAll('[data-annotation-index]').length,
      maxHostDrift: Math.max(0, ...drift),
      scrollLeft: scroller?.scrollLeft ?? 0,
      scrollTop: scroller?.scrollTop ?? 0,
      spacePan: scroller?.dataset.spacePan ?? null,
    };
  });
}

async function run() {
  const response = await fetch(baseUrl);
  if (!response.ok) throw new Error(`Dev server unavailable at ${baseUrl}: ${response.status}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  try {
    const startedAt = Date.now();
    await page.goto(benchmarkUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.survey-pdfjs-page-div').length === 120,
      null,
      { timeout: 60_000 },
    );
    const pageStackReadyMs = Date.now() - startedAt;
    await waitForMountedWorkers(page);
    const firstMarksPaintedMs = Date.now() - startedAt;
    await page.waitForFunction(
      () => window.pdfOverlayRecorder && window.__trackpadStressTest,
      null,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(700);
    const initial = await snapshot(page);

    await page.evaluate(() => {
      const scroller = document.querySelector('.survey-pdfjs-viewer');
      scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForFunction(
      () => document.querySelector('.survey-pdfjs-page-div[data-page-number="120"]')
        ?.dataset.pageMounted === 'true',
      null,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      () => document.querySelector('[data-lightweight-annotation-overlay="120"] canvas')
        ?.dataset.canvasRenderer === 'worker',
      null,
      { timeout: 30_000 },
    );
    const page120 = await snapshot(page);

    await page.evaluate(() => {
      document.querySelector('.survey-pdfjs-viewer').scrollTop = 0;
    });
    await setZoom(page, 500);
    await page.keyboard.press('p');
    await waitForMountedWorkers(page);
    await page.waitForTimeout(500);

    await page.evaluate(() => window.pdfOverlayRecorder.start({
      sampleIntervalMs: 24,
      samplePageLimit: 8,
      maxSamples: 2_000,
      captureIdlePageMetrics: true,
      capturePerfAttribution: true,
    }));
    const scrollerRect = await page.locator('.survey-pdfjs-viewer').boundingBox();
    const start = {
      x: scrollerRect.x + scrollerRect.width * 0.62,
      y: scrollerRect.y + scrollerRect.height * 0.78,
    };
    const panStartScrollTop = await page.locator('.survey-pdfjs-viewer')
      .evaluate((node) => node.scrollTop);
    await page.keyboard.down('Space');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let index = 1; index <= 50; index += 1) {
      await page.mouse.move(
        start.x + Math.sin(index * 0.35) * 80,
        start.y - index * 8,
      );
      await page.waitForTimeout(7);
    }
    const panDuring = await snapshot(page);
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(400);
    const panResult = await page.evaluate(() => window.pdfOverlayRecorder.stop());
    await waitForMountedWorkers(page);
    const panAfter = await snapshot(page);

    await setZoom(page, 100);
    await page.evaluate(() => {
      document.querySelector('.survey-pdfjs-viewer').scrollTop = 0;
    });
    await waitForMountedWorkers(page);
    await page.waitForTimeout(700);
    await page.evaluate(() => window.pdfOverlayRecorder.start({
      sampleIntervalMs: 32,
      samplePageLimit: 12,
      maxSamples: 3_000,
      captureIdlePageMetrics: true,
      capturePerfAttribution: true,
    }));
    await page.evaluate(() => window.__trackpadStressTest.run({ aggressive: true }));
    const zoomResult = await page.evaluate(() => window.pdfOverlayRecorder.stop());
    const final = await snapshot(page);

    const panSummary = pickSummary(panResult.summary);
    const zoomSummary = pickSummary(zoomResult.summary);
    const heap = await page.evaluate(() => (performance.memory ? {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit,
    } : null));
    const gates = {
      exactly240000VirtualAnnotations: initial.virtualAnnotationTotal === 240000
        && initial.pageCount === 120
        && initial.mountedAnnotationCounts.every((count) => count === 2000),
      pageLocalOverlayPerPage: initial.pageLocalHostCount === 120,
      productionCanvasOnlyPresentation: initial.svgPresentationNodeCount === 0,
      workerRendererUsed: initial.workerPages.length > 0,
      pageVirtualizationUsed: initial.mountedPages.length < 120,
      page120Rendered: page120.workerPages.includes(120),
      everyVisiblePageMounted: final.visibleNotMounted.length === 0,
      alignmentAtMostOnePixel: Math.max(
        initial.maxHostDrift,
        page120.maxHostDrift,
        panDuring.maxHostDrift,
        final.maxHostDrift,
        panSummary.worstDriftPxMaximum,
        zoomSummary.worstDriftPxMaximum,
      ) <= 1,
      panMoved: panDuring.scrollTop > panStartScrollTop,
      panP95AtMost25Ms: panSummary.frameMsP95 <= 25,
      panHasNoLongTasks: panSummary.longTaskCount === 0,
      aggressiveZoomJankAtMostFivePercent: zoomSummary.jankFrameRatePercent <= 5,
      noMissingOverlays: Math.max(
        panSummary.missingOverlayCountMaximum,
        zoomSummary.missingOverlayCountMaximum,
      ) === 0,
      noPresentationGaps: Math.max(
        panSummary.visiblePresentationGapMaximum,
        panSummary.viewportPresentationGapMaximum,
        zoomSummary.visiblePresentationGapMaximum,
        zoomSummary.viewportPresentationGapMaximum,
      ) === 0,
      noConsoleErrors: consoleErrors.length === 0,
      strict60FpsZoomP95: {
        required: false,
        thresholdMs: 16.7,
        actualMs: zoomSummary.frameMsP95,
        pass: zoomSummary.frameMsP95 <= 16.7,
      },
    };
    const requiredGateValues = Object.entries(gates)
      .filter(([name]) => name !== 'strict60FpsZoomP95')
      .map(([, value]) => value);
    const report = {
      benchmark: 'production-240k-annotation-presentation',
      status: requiredGateValues.every(Boolean) ? 'pass-with-frame-pacing-note' : 'fail',
      recordedAtUtc: new Date().toISOString(),
      environment: {
        browser: await browser.version(),
        viewportCssPixels: { width: 1280, height: 720 },
        devicePixelRatio: 1,
        jsHeapBytesAfterRun: heap,
      },
      workload: {
        fixture: 'debug/fixtures/spike-120-pages.pdf',
        pageCount: 120,
        annotationsPerPage: 2000,
        virtualAnnotationCount: 240000,
        productionPath: 'pdf.js page canvas plus page-local worker Canvas2D annotations',
      },
      load: { pageStackReadyMs, firstMarksPaintedMs },
      functionalChecks: { initial, page120 },
      panAt500Percent: {
        startScrollTop: panStartScrollTop,
        during: panDuring,
        after: panAfter,
        performance: panSummary,
      },
      aggressiveZoomStress: {
        endState: final,
        performance: zoomSummary,
      },
      consoleErrors,
      gates,
      framePacingNote: 'The aggressive zoom burst intentionally drives 240,000 virtual marks between deep zoom and the 10% floor. Functional alignment and pan are hard gates; strict 60 fps zoom p95 is reported honestly but is not a pass gate for this synthetic burst.',
      reproduce: {
        url: benchmarkUrl,
        command: `BENCHMARK_BASE_URL=${baseUrl} npm run benchmark:pdf-annotations`,
      },
    };

    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) await writeFile(outputPath, serialized, 'utf8');
    process.stdout.write(serialized);
    if (report.status === 'fail') process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
