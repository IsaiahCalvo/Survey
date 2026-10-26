// Nightly 'survey-report': the Survey panel's Report menu downloads the
// survey report as a PowerPoint deck (cover, progress chart, issues), a PDF,
// an Excel workbook with a chart, or a CSV table.
import JSZip from 'jszip';
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

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

async function pickReport(page, format) {
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await page.getByRole('menu', { name: 'Report format' }).getByRole('menuitem', { name: format }).click();
}

test('flag on: the PDF report and the Excel report with a chart', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);
  const fs = await import('node:fs/promises');

  let download = page.waitForEvent('download', { timeout: 60_000 });
  await pickReport(page, 'PDF (.pdf)');
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe(`${E2E_SURVEY.templateName} report.pdf`);
  expect((await fs.readFile(await pdf.path())).subarray(0, 5).toString()).toBe('%PDF-');

  download = page.waitForEvent('download', { timeout: 60_000 });
  await pickReport(page, 'Excel with chart (.xlsx)');
  const xlsx = await download;
  expect(xlsx.suggestedFilename()).toBe(`${E2E_SURVEY.templateName} report.xlsx`);
  const zip = await JSZip.loadAsync(await fs.readFile(await xlsx.path()));
  expect(await zip.file('xl/charts/chart1.xml').async('string')).toContain(E2E_SURVEY.categoryName);
  expect(zip.file('xl/worksheets/sheet3.xml')).not.toBeNull(); // Summary, Issues, Items
});

test('flag off: no Report button', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '0'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);
  await expect(page.getByRole('button', { name: 'Export data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report', exact: true })).toHaveCount(0);
});

test('flag on: CSV downloads the report as a table, one row per item', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await pickReport(page, 'CSV table (.csv)');
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${E2E_SURVEY.templateName} report.csv`);
  const rows = (await (await import('node:fs/promises')).readFile(await file.path(), 'utf8')).replace(/^\uFEFF/, '').trim().split('\r\n');
  expect(rows[0]).toBe('"Category","Item","Status","Lines answered","Lines","Issues"');
  expect(rows.length).toBeGreaterThan(1);
  expect(rows[1]).toContain(`"${E2E_SURVEY.categoryName}"`);
});

test('flag on: Report downloads a PowerPoint deck of the survey', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await pickReport(page, 'PowerPoint (.pptx)');
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

test('the template\'s report layout picks the blocks: Issues list is a cover and the issues', async ({ page }) => {
  const db = adminClient();
  const { data } = await db.from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  const original = data.config;
  try {
    // An output choice, not a new template version: no "template updated" prompt.
    const { error } = await db.from('templates').update({ config: { ...original, reportKitId: 'issues-report' } }).eq('id', E2E_SURVEY.templateId);
    if (error) throw error;
    await page.addInitScript(() => localStorage.setItem('survey.flag.survey-report', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);

    // The template editor shows the layout.
    await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
    await page.getByText(E2E_SURVEY.templateName, { exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('combobox', { name: 'Report layout' }).filter({ visible: true }).first()).toHaveValue('issues-report', { timeout: 30_000 });
    await page.getByText('Documents', { exact: true }).filter({ visible: true }).first().click();
    await openSurvey(page);
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await pickReport(page, 'PowerPoint (.pptx)');
    const file = await download;
    const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile(await file.path()));
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBe(2);
    expect(await zip.file('ppt/slides/slide2.xml').async('string')).toContain('Issues');
    expect(Object.keys(zip.files).some((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))).toBe(false);
  } finally {
    await db.from('templates').update({ config: original }).eq('id', E2E_SURVEY.templateId);
  }
});
