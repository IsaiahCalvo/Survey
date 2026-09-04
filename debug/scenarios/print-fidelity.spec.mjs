import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
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

// Print through the app's own shortcut path and rasterise every sheet.
// Called twice: once outside survey mode (regular pages) and once inside it
// (survey pages) — print mirrors the screen, and the two screens differ by
// design (a template hides regular markup and shows only its module).
async function printAndRasterise(page, { expectedCalls, pdfPath, rasterDir }) {
  await page.keyboard.press(shortcut);
  await expect.poll(() => page.evaluate(() => window.__browserPrintCalls), { timeout: 60_000 }).toBe(expectedCalls);
  await expect(page.locator('[data-browser-print-document]')).toHaveAttribute('data-browser-print-ready', 'true');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  await mkdir(rasterDir, { recursive: true });
  await execFileAsync('pdftoppm', ['-png', '-r', '144', pdfPath, join(rasterDir, 'page')]);
  // pdftoppm zero-pads page numbers once the document has 10+ pages
  // (page-01.png); the comparer keys on page-N.png.
  for (const name of await readdir(rasterDir)) {
    const match = name.match(/^page-0+(\d+)\.png$/);
    if (match) await rename(join(rasterDir, name), join(rasterDir, `page-${match[1]}.png`));
  }
}

test('every supported annotation matches the real browser print path', async ({ page }) => {
  // Twelve fixture pages printed twice (regular + survey mode) plus ~100
  // region crops: the 2-minute default is too tight on a loaded machine.
  test.setTimeout(300_000);
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

  // Delete + erase imported marks BEFORE survey mode: a template hides regular
  // markup by design (module clean slate), so these targets only exist here.
  const pdfIdOf = (id) => manifest.annotationsByPage[10].objects.find((obj) => obj.id === id).pdfAnnotationId;
  const deleteSelector = `[data-pdf-annotation-id="${pdfIdOf('imported-delete-square')}"]`;
  const eraseSelector = `[data-pdf-annotation-id="${pdfIdOf('imported-erase-ink')}"]`;
  // The page loop ends on the last page; pages more than one away are
  // unmounted (virtualised), so bring page 10 back before locating its marks.
  const pageTenEl = page.locator('.survey-pdfjs-page-div[data-page-number="10"]');
  await pageTenEl.scrollIntoViewIfNeeded();
  await expect(pageTenEl).toBeVisible();
  const deleteTarget = page.locator(deleteSelector).first();
  await deleteTarget.scrollIntoViewIfNeeded();
  await page.keyboard.press('v');
  // Hollow square: its centre is not a hit target, so click the top edge.
  const deleteBox = await deleteTarget.boundingBox();
  expect(deleteBox).toBeTruthy();
  await page.mouse.click(deleteBox.x + deleteBox.width / 2, deleteBox.y + 2);
  await page.keyboard.press('Delete');
  await expect(page.locator(deleteSelector)).toHaveCount(0);

  const eraseTarget = page.locator(eraseSelector).first();
  await eraseTarget.scrollIntoViewIfNeeded();
  const eraseBox = await eraseTarget.boundingBox();
  expect(eraseBox).toBeTruthy();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count() === 0) await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(pen).toBeVisible();
  // Whole-stroke erase removes the imported ink in one pass (the batch-2 fix
  // records that removal for print/export). Switch the eraser type if needed.
  // Activate the eraser first ("Eraser type" only shows once it is active),
  // then switch it to whole-stroke mode.
  await page.getByRole('button', { name: 'Partial erase', exact: true }).click();
  if (await page.getByRole('button', { name: 'Full stroke erase', exact: true }).count() === 0) {
    await page.getByRole('button', { name: 'Eraser type', exact: true }).click();
    await page.getByRole('option', { name: 'Full stroke erase', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Full stroke erase', exact: true })).toHaveCount(1);
  // The toolbar's one size input is labelled "Size" while the eraser is active.
  const sizeInput = page.getByRole('textbox', { name: 'Size', exact: true });
  await expect(sizeInput).toHaveCount(1);
  await sizeInput.fill('40');
  await sizeInput.press('Tab');
  await page.mouse.move(eraseBox.x - 15, eraseBox.y + eraseBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(eraseBox.x + eraseBox.width + 15, eraseBox.y + eraseBox.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await expect(page.locator(eraseSelector)).toHaveCount(0);

  const pageTenAfter = page.locator('.survey-pdfjs-page-div[data-page-number="10"]');
  await pageTenAfter.screenshot({ path: join(outputRoot, 'screen-after-delete-erase.png'), animations: 'disabled' });

  // Print #1: regular pages, outside survey mode.
  await printAndRasterise(page, { expectedCalls: 1, pdfPath: join(outputRoot, 'browser-print.pdf'), rasterDir: printDir });

  // Survey-mode pages need the template flow; if the seeded marker never
  // materialises that is a FIXTURE failure for those regions — it must not
  // abort the comparison for the other 30+ regions.
  const surveyPages = manifest.pages.filter((item) => item.requiresSurveyMode);
  const surveyModeErrors = [];
  if (surveyPages.length > 0) {
    try {
      await page.getByRole('button', { name: 'Survey', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible();
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
      await expect(page.locator('[data-survey-marker-id="survey-marker-1"]')).toHaveCount(1, { timeout: 15_000 });
    } catch (error) {
      surveyModeErrors.push(`survey mode did not paint the seeded marker: ${error?.message?.split('\n')[0]}`);
    }
    for (const entry of surveyPages) {
      const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${entry.page}"]`);
      await pageEl.scrollIntoViewIfNeeded();
      await expect(pageEl).toBeVisible();
      await page.waitForTimeout(350);
      await pageEl.screenshot({ path: join(screenDir, `page-${entry.page}.png`), animations: 'disabled' });
    }
    // Print #2: the survey sheet as the screen shows it in this module.
    const surveyPrintDir = join(outputRoot, 'print-survey-mode');
    await printAndRasterise(page, { expectedCalls: 2, pdfPath: join(outputRoot, 'browser-print-survey-mode.pdf'), rasterDir: surveyPrintDir });
    for (const entry of surveyPages) {
      await copyFile(join(surveyPrintDir, `page-${entry.page}.png`), join(printDir, `page-${entry.page}.png`));
    }
  }

  // Fixture regions that never painted on screen are reported as their own
  // bucket at the end — they must not abort the print comparison for the
  // regions that did paint, or one bad seed hides every real print defect.
  const fixtureReport = await validatePrintFidelityScreenFixture({ manifestPath, screenDir });
  // The marker-element wait is advisory: the region validator below is the
  // real proof the Survey Marker painted. Only escalate the wait error when
  // the survey regions genuinely did not paint.
  const surveyRegionIds = new Set(manifest.regions.filter((r) => r.type === 'survey-marker').map((r) => r.id));
  const surveyRegionsFailed = fixtureReport.results.some((r) => surveyRegionIds.has(r.id) && !r.pass);
  if (surveyModeErrors.length && !surveyRegionsFailed) console.warn('[print-fidelity] advisory:', surveyModeErrors.join('; '));
  const fixtureFailures = [
    ...(surveyRegionsFailed ? surveyModeErrors.map((message) => ({ id: 'survey-mode', message })) : []),
    ...fixtureReport.results.filter((result) => !result.pass),
  ];

  const report = await comparePrintFidelity({ manifestPath, screenDir, printDir, outputDir: pairsDir });
  const printFailures = report.results.filter((result) => result.status === 'print-failure');
  expect(
    { fixtureFailures, printFailures },
    `Print fidelity:\nFIXTURE (did not paint on screen): ${JSON.stringify(fixtureFailures, null, 2)}\nPRINT (differs from screen): ${JSON.stringify(printFailures, null, 2)}`,
  ).toEqual({ fixtureFailures: [], printFailures: [] });
});
