// Print-race proof harness: drives the MAIN-WINDOW print path (plain Cmd/Ctrl+P
// — the route the owner hit) end to end through Chromium's real print pipeline.
// The app's readiness gate must resolve, window.print() must fire, and every
// rasterised output page must carry real (non-blank) content. Run with
// PRINT_RACE_BASE_URL=<vite url> PRINT_RACE_ITERATIONS=20.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.PRINT_RACE_BASE_URL;
const iterations = Number.parseInt(process.env.PRINT_RACE_ITERATIONS || '1', 10);
const minimumCoverage = Number.parseFloat(process.env.PRINT_RACE_MIN_COVERAGE || '0.001');
const expectedPages = Number.parseInt(process.env.PRINT_RACE_EXPECTED_PAGES || '36', 10);
const fixture = process.env.PRINT_RACE_FIXTURE || 'package2-rev4.pdf';

if (!baseUrl) throw new Error('Set PRINT_RACE_BASE_URL to the Vite server URL.');
if (!Number.isInteger(iterations) || iterations < 1) throw new Error('PRINT_RACE_ITERATIONS must be a positive integer.');

const outputDir = mkdtempSync(join(tmpdir(), 'survey-print-race-'));
const browser = await chromium.launch({ headless: true });
let passed = 0;

async function nonWhiteCoverage(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let nonWhite = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245) nonWhite += 1;
  }
  return nonWhite / (info.width * info.height);
}

try {
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const page = await browser.newPage();
    // Stub the MAIN window's print(): record per-sheet image readiness at the
    // exact moment the app decided it was safe to print. (Plain Cmd+P prints
    // the in-page BrowserPrintDocument via window.print(); headless Chromium
    // has no dialog, so without a stub nothing observable happens.)
    await page.addInitScript(() => {
      if (window.top !== window) return;
      window.print = () => {
        const sheets = [...document.querySelectorAll('[data-browser-print-page] img, .survey-browser-print-sheet img')];
        window.__printCapture = {
          calledAt: Date.now(),
          placeholderAtPrint: document.querySelectorAll('.survey-browser-print-placeholder').length,
          sheets: sheets.map((image, index) => ({
            page: index + 1,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          })),
        };
      };
    });

    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    await page.goto(`${baseUrl}/?testPdf=${encodeURIComponent(fixture)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForFunction(() => window.__printCapture, null, { timeout: 120_000 });

    const capture = await page.evaluate(() => window.__printCapture);
    const readiness = capture.sheets;
    const unready = readiness.filter((image) => !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1);
    const pdfPath = join(outputDir, `iteration-${iteration}.pdf`);
    const rasterPrefix = join(outputDir, `iteration-${iteration}-page`);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: false, timeout: 120_000 });
    if (iteration === 1) {
      await page.screenshot({ path: join(outputDir, 'print-composed-dom.png'), fullPage: true });
    }
    execFileSync('pdftoppm', ['-r', '36', '-png', pdfPath, rasterPrefix], { stdio: 'ignore' });
    const rasterPaths = readdirSync(outputDir)
      .filter((name) => name.startsWith(`iteration-${iteration}-page-`) && name.endsWith('.png'))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .map((name) => join(outputDir, name));
    const coverage = await Promise.all(rasterPaths.map(nonWhiteCoverage));
    const blankPages = coverage
      .map((value, index) => ({ page: index + 1, value }))
      .filter(({ value }) => value < minimumCoverage);
    const readinessFailure = consoleMessages.some((message) => message.includes('print page readiness failed'));
    const placeholderCount = capture.placeholderAtPrint ?? 0;
    const errorToastVisible = await page.evaluate(() => [...document.querySelectorAll('.survey-browser-print-progress')].some((el) => /Could not prepare/.test(el.textContent || '')));
    const ok = readiness.length === expectedPages && unready.length === 0
      && rasterPaths.length === expectedPages && blankPages.length === 0 && !readinessFailure
      && placeholderCount === 0 && !errorToastVisible;
    if (ok) passed += 1;
    console.log(JSON.stringify({
      iteration,
      ok,
      imageCount: readiness.length,
      unreadyPages: unready.map(({ page: pageNumber }) => pageNumber),
      outputPages: rasterPaths.length,
      blankPages,
      readinessFailure,
      placeholderCount,
      errorToastVisible,
      minimumPageCoverage: coverage.length ? Number(Math.min(...coverage).toFixed(5)) : 0,
    }));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`print race: ${passed}/${iterations} passed; output=${outputDir}`);
if (passed !== iterations) process.exitCode = 1;
else rmSync(outputDir, { recursive: true, force: true });
