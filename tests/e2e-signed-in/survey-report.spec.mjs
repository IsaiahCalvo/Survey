// Nightly 'survey-report': the Survey panel's Report button downloads a
// PowerPoint deck of the survey (cover, progress chart, issues).
import JSZip from 'jszip';
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function openSurvey(page) {
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${E2E_SURVEY.documentName}` })).toBeVisible({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  const chooser = page.getByText('Choose a survey template', { exact: true });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(chooser.or(category).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      // An earlier spec may have changed the template since this document used it.
      const keep = page.getByRole('button', { name: 'Keep previous version' });
      if (await keep.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await keep.click();
    }
  }
  await expect(category).toBeVisible({ timeout: 30_000 });
}

test('flag off: no Report button', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '0'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);
  await expect(page.getByRole('button', { name: 'Export data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report', exact: true })).toHaveCount(0);
});

test('flag on: Report downloads a PowerPoint deck of the survey', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${E2E_SURVEY.templateName} report.pptx`);
  const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile(await file.path()));
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  expect(slides.length).toBeGreaterThanOrEqual(4);
  const progress = await zip.file('ppt/slides/slide2.xml').async('string');
  expect(progress).toContain('Progress');
  expect(Object.keys(zip.files).some((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))).toBe(true);
  const chart = await zip.file(Object.keys(zip.files).find((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))).async('string');
  expect(chart).toContain(E2E_SURVEY.categoryName);
});
