import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.PRINT_RACE_BASE_URL;
const iterations = Number.parseInt(process.env.PRINT_RACE_ITERATIONS || '1', 10);
const minimumCoverage = Number.parseFloat(process.env.PRINT_RACE_MIN_COVERAGE || '0.001');

if (!baseUrl) throw new Error('Set PRINT_RACE_BASE_URL to the Vite server URL.');
if (!Number.isInteger(iterations) || iterations < 1) throw new Error('PRINT_RACE_ITERATIONS must be a positive integer.');

const outputDir = mkdtempSync(join(tmpdir(), 'survey-print-iframe-race-'));
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
    await page.addInitScript(() => {
      if (window.top === window) return;
      window.print = () => {
        const images = [...document.images];
        const readiness = images.map((image, index) => ({
          page: index + 1,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        }));
        const html = document.documentElement.outerHTML;
        window.top.document.open();
        window.top.document.write(html);
        window.top.document.close();
        window.top.document.documentElement.dataset.printCapture = JSON.stringify(readiness);
      };
    });

    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    await page.goto(`${baseUrl}/?testPdf=package2-rev4.pdf`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForFunction(() => document.documentElement.dataset.printCapture, null, { timeout: 120_000 });

    const readiness = JSON.parse(await page.locator('html').getAttribute('data-print-capture'));
    const unready = readiness.filter((image) => !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1);
    const pdfPath = join(outputDir, `iteration-${iteration}.pdf`);
    const rasterPrefix = join(outputDir, `iteration-${iteration}-page`);
    await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true, timeout: 120_000 });
    const composedSheets = await page.locator('.sheet').count();
    if (iteration === 1) {
      await page.emulateMedia({ media: 'print' });
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
    const bypassSeen = consoleMessages.some((message) => message.includes('PDF-native annotation print'));
    const ok = bypassSeen && readiness.length === 36 && unready.length === 0 && composedSheets === 36
      && rasterPaths.length === 36 && blankPages.length === 0;
    if (ok) passed += 1;
    console.log(JSON.stringify({
      iteration,
      ok,
      bypassSeen,
      imageCount: readiness.length,
      unreadyPages: unready.map(({ page: pageNumber }) => pageNumber),
      composedSheets,
      outputPages: rasterPaths.length,
      blankPages,
      minimumPageCoverage: coverage.length ? Math.min(...coverage) : 0,
    }));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`print iframe race: ${passed}/${iterations} passed; output=${outputDir}`);
if (passed !== iterations) process.exitCode = 1;
else rmSync(outputDir, { recursive: true, force: true });
