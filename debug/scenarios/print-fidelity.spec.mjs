import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { comparePrintFidelity, validatePrintFidelityScreenFixture } from '../../scripts/print-fidelity-compare.mjs';

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
  await page.addInitScript(({ key, annotations, surveyMarkers, callouts }) => {
    localStorage.setItem(key, JSON.stringify(annotations));
    localStorage.setItem(key.replace('annotationsByPage_', 'surveyMarkers_'), JSON.stringify(surveyMarkers));
    localStorage.setItem(key.replace('annotationsByPage_', 'callouts_'), JSON.stringify(callouts));
    window.__browserPrintCalls = 0;
    window.print = () => { window.__browserPrintCalls += 1; };
  }, { key: storageKey, annotations: manifest.annotationsByPage, surveyMarkers: manifest.surveyMarkers, callouts: manifest.callouts });

  await page.goto(`/?testPdf=${encodeURIComponent(manifest.pdfFile)}&surveyTransitionE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number]').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.keyboard.press('v');
  // Let any load or migration toast leave before element screenshots. A fixed
  // toast inside the page crop is not PDF paint and must never enter metrics.
  await page.waitForTimeout(4_800);

  for (const entry of manifest.pages.filter((item) => !item.requiresSurveyMode)) {
    const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${entry.page}"]`);
    await pageEl.scrollIntoViewIfNeeded();
    await expect(pageEl).toBeVisible();
    await page.waitForTimeout(350);
    await pageEl.screenshot({ path: join(screenDir, `page-${entry.page}.png`), animations: 'disabled' });
  }

  const surveyPages = manifest.pages.filter((item) => item.requiresSurveyMode);
  if (surveyPages.length > 0) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();
    await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
    await expect(page.locator('[data-survey-marker-id="survey-marker-1"]')).toHaveCount(1);
    for (const entry of surveyPages) {
      const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${entry.page}"]`);
      await pageEl.scrollIntoViewIfNeeded();
      await expect(pageEl).toBeVisible();
      await page.waitForTimeout(350);
      await pageEl.screenshot({ path: join(screenDir, `page-${entry.page}.png`), animations: 'disabled' });
    }
  }

  // Fixture regions that never painted on screen are reported as their own
  // bucket at the end — they must not abort the print comparison for the
  // regions that did paint, or one bad seed hides every real print defect.
  const fixtureReport = await validatePrintFidelityScreenFixture({ manifestPath, screenDir });
  const fixtureFailures = fixtureReport.results.filter((result) => !result.pass);

  await page.keyboard.press(shortcut);
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls), { timeout: 60_000 }).toBe(1);
  await expect(page.locator('[data-browser-print-document]')).toHaveAttribute('data-browser-print-ready', 'true');
  await page.emulateMedia({ media: 'print' });
  const printPdf = join(outputRoot, 'browser-print.pdf');
  await page.pdf({ path: printPdf, printBackground: true, preferCSSPageSize: true });
  await execFileAsync('pdftoppm', ['-png', '-r', '144', printPdf, join(printDir, 'page')]);

  const report = await comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir: pairsDir });
  const printFailures = report.results.filter((result) => result.status === 'print-failure');
  expect(
    { fixtureFailures, printFailures },
    `Print fidelity:\nFIXTURE (did not paint on screen): ${JSON.stringify(fixtureFailures, null, 2)}\nPRINT (differs from screen): ${JSON.stringify(printFailures, null, 2)}`,
  ).toEqual({ fixtureFailures: [], printFailures: [] });
});
