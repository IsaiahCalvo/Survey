import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail item Copy → space:
// Excel actions chevron → Open linked / Update existing fail-closed
// when no linkedExcelPath. Distinct from leftover-18 X-06 writeback
// and from the already-proven EXPORT download. Not checklist Y/N/N-A.
// Not category Move/Copy stub. UL-31 Continue pin stays parked.
// No file.id. Do not invent a linked workbook.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const KAL436 = /KAL-436 Preservation Template/;

async function openEditor(page, { width = 1440, height = 900 } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(SURVEY_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function excelChevron(page) {
  return page.getByRole('button', { name: 'Excel actions' });
}

function openLinked(page) {
  return page.getByRole('menuitem', { name: 'Open linked' });
}

function updateExisting(page) {
  return page.getByRole('menuitem', { name: 'Update existing' });
}

function linkedToast(page) {
  return page.getByRole('status').filter({ hasText: /No Excel file is linked to this survey/ });
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function openExcelMenu(page) {
  const chevron = excelChevron(page);
  await expect(chevron).toBeVisible({ timeout: 8_000 });
  if ((await chevron.getAttribute('aria-expanded')) !== 'true') {
    await chevron.click();
  }
  await expect(openLinked(page)).toBeVisible({ timeout: 8_000 });
  await expect(updateExisting(page)).toBeVisible();
}

async function assertFailClosedItem(page, item) {
  let downloadFired = false;
  const onDownload = () => { downloadFired = true; };
  page.once('download', onDownload);
  await item.click();
  await expect(linkedToast(page)).toBeVisible({ timeout: 8_000 });
  expect(downloadFired, 'fail-closed item must not start a workbook download').toBe(false);
  page.off('download', onDownload);
}

test('Excel actions Open linked / Update existing fail-closed without a path', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await enterSurveyWalls(page);

  const persist = await page.evaluate(() => {
    const templates = window.__e2eSurveyTemplates?.get?.() || [];
    const selected = templates.find((row) => /KAL-436/.test(row?.name || '')) || null;
    return {
      fileId: window.__devTestPdf?.id ?? null,
      linkedExcelPath: selected?.linkedExcelPath ?? null,
    };
  });
  expect(persist.fileId, 'no file.id').toBeNull();
  expect(persist.linkedExcelPath, 'no invented linked workbook').toBeNull();

  const exportBtn = page.locator('.survey-marker-export-compact-button').first();
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toHaveText('EXPORT');

  // Intended: chevron opens; Open linked / Update existing are disabled
  // (aria-disabled) and toast fail-closed without a path.
  await openExcelMenu(page);
  await expect(openLinked(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(updateExisting(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Open Excel')).toBeVisible();
  await expect(page.getByText('Push to Excel')).toBeVisible();
  await expect(page.getByText('Pull from Excel')).toHaveCount(0);
  await expect(page.getByText('Live Sync')).toHaveCount(0);

  // Break: click those items anyway — toast, no write.
  await assertFailClosedItem(page, openLinked(page));
  await openExcelMenu(page);
  await assertFailClosedItem(page, updateExisting(page));

  // Break: menu with no survey data — still fail-closed (no markers placed).
  const markerCount = await page.locator('[data-survey-marker-id]').count();
  expect(markerCount, 'no survey markers for empty-menu break').toBe(0);
  await openExcelMenu(page);
  await expect(openLinked(page)).toHaveAttribute('aria-disabled', 'true');
  await assertFailClosedItem(page, updateExisting(page));

  // Break: Pen-armed still fail-closed via the rail.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await openExcelMenu(page);
  await expect(openLinked(page)).toHaveAttribute('aria-disabled', 'true');
  await assertFailClosedItem(page, openLinked(page));

  // Edge: EXPORT download still works (smoke only — not leftover-18 replay).
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);
  await assertNoErrorBoundary(page);

  // Edge: 390 — desktop Excel actions chevron is absent (mobileMode).
  // Mobile sheet uses Export survey data; Sync Microsoft 365 is disabled.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  const mobile = {
    excelActions: await excelChevron(page).count(),
    exportSurvey: await page.getByRole('button', { name: 'Export survey data' }).count(),
  };
  expect(mobile.excelActions, '390 has no desktop Excel actions chevron').toBe(0);
  expect(mobile.exportSurvey, '390 has mobile export wrap').toBe(1);
  await page.getByRole('button', { name: 'Export survey data' }).click();
  const sync365 = page.getByRole('menuitem', { name: /Sync Microsoft 365/ });
  await expect(sync365).toBeVisible({ timeout: 8_000 });
  await expect(sync365).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /Export Excel/ })).toBeEnabled();
  await assertNoErrorBoundary(page);

  console.log('SURVEY_EXCEL_ACTIONS_FAILCLOSED_PROOF', JSON.stringify({
    linkedExcelPath: persist.linkedExcelPath,
    persist: persist.fileId,
    openLinkedDisabled: true,
    updateExistingDisabled: true,
    toastFailClosed: true,
    noWrite: true,
    emptySurveyFailClosed: true,
    penArmedFailClosed: true,
    exportFilename: download.suggestedFilename(),
    mobile,
  }));
});
