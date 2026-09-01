import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { comparePrintFidelity } from '../../scripts/print-fidelity-compare.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..', '..');
const manifestPath = join(root, 'debug', 'fixtures', 'print-fidelity.manifest.json');
const outputRoot = join(root, 'debug', 'artifacts', 'print-fidelity');
const screenDir = join(outputRoot, 'screen');
const printDir = join(outputRoot, 'print');
const pairsDir = join(outputRoot, 'pairs');
const shortcut = process.platform === 'darwin' ? 'Meta+P' : 'Control+P';

test('every supported annotation matches the real browser print path', async ({ page }) => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(screenDir, { recursive: true });
  await mkdir(printDir, { recursive: true });

  const storageKey = `annotationsByPage_${manifest.pdfFile}-${manifest.pdfSize}`;
  await page.addInitScript(({ key, annotations, surveyMarkers }) => {
    localStorage.setItem(key, JSON.stringify(annotations));
    localStorage.setItem(key.replace('annotationsByPage_', 'surveyMarkers_'), JSON.stringify(surveyMarkers));
    window.__browserPrintCalls = 0;
    window.print = () => { window.__browserPrintCalls += 1; };
  }, { key: storageKey, annotations: manifest.annotationsByPage, surveyMarkers: manifest.surveyMarkers });

  await page.goto(`/?testPdf=${encodeURIComponent(manifest.pdfFile)}`);
  await page.locator('.survey-pdfjs-page-div[data-page-number]').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.keyboard.press('v');

  for (const entry of manifest.pages) {
    const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${entry.page}"]`);
    await pageEl.scrollIntoViewIfNeeded();
    await expect(pageEl).toBeVisible();
    await page.waitForTimeout(350);
    await pageEl.screenshot({ path: join(screenDir, `page-${entry.page}.png`), animations: 'disabled' });
  }

  await page.keyboard.press(shortcut);
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls), { timeout: 60_000 }).toBe(1);
  await expect(page.locator('[data-browser-print-document]')).toHaveAttribute('data-browser-print-ready', 'true');
  await page.emulateMedia({ media: 'print' });
  const printPdf = join(outputRoot, 'browser-print.pdf');
  await page.pdf({ path: printPdf, printBackground: true, preferCSSPageSize: true });
  await execFileAsync('pdftoppm', ['-png', '-r', '144', printPdf, join(printDir, 'page')]);

  const report = await comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir: pairsDir });
  expect(report.results.filter((result) => !result.pass), JSON.stringify(report.results.filter((result) => !result.pass), null, 2)).toEqual([]);
});
