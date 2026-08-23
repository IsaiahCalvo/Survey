import { test, expect } from '@playwright/test';

// Unique leftover after leaving the remapped-after-CW treadmill.
// Survey "Rows we couldn't place" (KAL-292) exists in the rail and has a
// DEV `?unplacedRows=` fixture, but no intended+break+edge live proof.
// Prior hunts counted unplaced **0** because they never passed the query.
// Parked "leftover-18 unplaced-rows" meant a live linked workbook / X-06
// writeback — this slice uses the DEV fixture only (like `?empty=1`).
// Distinct from leftover-18 / X-01 / X-06 writeback / Excel actions
// fail-closed / remapped-after-CW. No file.id. No lease.

const HUB = '/?hubPreview=1';
const EDITOR = '/?testPdf=clickable-link-test.pdf';
const MIXED = `${EDITOR}&surveyTransitionE2E=1&unplacedRows=mixed`;
const BATCH = `${EDITOR}&surveyTransitionE2E=1&unplacedRows=batch`;
const BOGUS = `${EDITOR}&surveyTransitionE2E=1&unplacedRows=bogus`;
const KAL436 = /KAL-436 Preservation Template/;

const MIXED_NAMES = [
  'Door D-114',
  'Door D-121',
  'Window W-08',
  'Unnamed row',
  'Window W-12',
];

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function openEditor(page, { width = 1440, height = 900, url = EDITOR } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function unplacedSection(page) {
  return page.getByRole('region', { name: 'Rows we couldn’t place' });
}

function dismissAll(page) {
  return unplacedSection(page).getByRole('button', { name: 'Dismiss all', exact: true });
}

function dismissNamed(page, name) {
  return page.getByRole('button', { name: `Dismiss ${name}`, exact: true });
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await expect(unplacedSection(page), 'choose-template screen must not show unplaced rows').toHaveCount(0);
  await page.getByRole('button', { name: KAL436 }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
}

async function persistId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function annotationCount(page) {
  return page.evaluate(() => (
    document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]').length
  ));
}

async function surveyMarkerCount(page) {
  return page.locator('[data-survey-marker-id]').count();
}

test('unplaced Excel rows intended + break + edge on mixed / batch / hub', async ({ page }) => {
  test.setTimeout(240_000);
  const downloads = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  // Hunt both required routes before the leftover.
  await openPage(page, { url: `${HUB}&tab=documents` });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(unplacedSection(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Survey', exact: true })).toHaveCount(0);
  await openPage(page, { url: `${HUB}&tab=projects` });
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 15_000 });
  await expect(unplacedSection(page)).toHaveCount(0);
  await openPage(page, { url: `${HUB}&unplacedRows=mixed` });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(unplacedSection(page), 'hubPreview must not honor editor unplacedRows').toHaveCount(0);

  await openEditor(page, { url: EDITOR });
  await assertNoErrorBoundary(page);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await expect(unplacedSection(page), 'default testPdf invents 0 unplaced').toHaveCount(0);
  expect(await persistId(page), 'must not stamp file.id').toBeNull();

  await openEditor(page, { url: BOGUS });
  await enterSurveyWalls(page);
  await expect(unplacedSection(page), 'bogus unplacedRows invents 0').toHaveCount(0);
  expect(await persistId(page)).toBeNull();

  // Intended — mixed fixture names each unmatched Excel row with a reason.
  await openEditor(page, { url: MIXED });
  await enterSurveyWalls(page);
  await expect(unplacedSection(page)).toBeVisible({ timeout: 15_000 });
  await expect(unplacedSection(page).getByText('Rows we couldn’t place (5)')).toBeVisible();
  await expect(unplacedSection(page).getByText(/couldn’t be matched to a Survey Marker/)).toBeVisible();
  for (const name of MIXED_NAMES) {
    await expect(unplacedSection(page).getByText(name, { exact: true })).toBeVisible();
  }
  await expect(unplacedSection(page).getByText(/More than one Survey Marker could match/)).toBeVisible();
  await expect(unplacedSection(page).getByText(/different survey/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /apply anyway/i })).toHaveCount(0);
  await expect(unplacedSection(page).getByText('ambiguous-identity')).toHaveCount(0);
  expect(await persistId(page), 'must not stamp file.id').toBeNull();
  expect(await annotationCount(page), 'fixture must not invent annotations').toBe(0);
  expect(await surveyMarkerCount(page), 'fixture must not invent Survey marks').toBe(0);

  // Intended — Dismiss one row; the rest stay. No apply / no write.
  await dismissNamed(page, 'Door D-114').click();
  await expect(unplacedSection(page).getByText('Door D-114')).toHaveCount(0);
  await expect(unplacedSection(page).getByText('Rows we couldn’t place (4)')).toBeVisible();
  await expect(unplacedSection(page).getByText('Door D-121')).toBeVisible();
  await expect(unplacedSection(page).getByText('Window W-12')).toBeVisible();
  expect(downloads, 'dismiss must not download a workbook').toEqual([]);
  expect(await persistId(page)).toBeNull();
  expect(await annotationCount(page)).toBe(0);

  // Intended — Dismiss all clears the surface. Visual only.
  await dismissAll(page).click();
  await expect(unplacedSection(page)).toHaveCount(0);
  await expect(page.getByText('Door D-121')).toHaveCount(0);
  expect(await persistId(page)).toBeNull();
  expect(await annotationCount(page)).toBe(0);
  expect(await surveyMarkerCount(page)).toBe(0);

  // Break — empty page click after dismiss invents 0.
  await page.locator('[data-svg-annotation-layer="1"]').click({ position: { x: 24, y: 24 } });
  await expect(unplacedSection(page)).toHaveCount(0);
  expect(await annotationCount(page)).toBe(0);

  // Edge — whole-batch hold explains once; per-row reasons stay off.
  await openEditor(page, { url: BATCH });
  await enterSurveyWalls(page);
  await expect(unplacedSection(page)).toBeVisible({ timeout: 15_000 });
  await expect(unplacedSection(page).getByText('Your Excel changes weren’t applied')).toBeVisible();
  await expect(unplacedSection(page).getByText(/None of your Excel changes were applied/)).toBeVisible();
  await expect(unplacedSection(page).getByText('Door D-101')).toBeVisible();
  await expect(unplacedSection(page).getByText('Door D-112')).toBeVisible();
  await expect(unplacedSection(page).locator('.survey-unplaced-row')).toHaveCount(12);
  await expect(unplacedSection(page).getByText(/This change was held for review/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /apply anyway/i })).toHaveCount(0);
  expect(await persistId(page)).toBeNull();
  await dismissAll(page).click();
  await expect(unplacedSection(page)).toHaveCount(0);
  expect(downloads).toEqual([]);

  await assertNoErrorBoundary(page);
});

test('390 unplaced mixed dismiss + hubPreview isolation', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: `${HUB}&tab=documents` });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(unplacedSection(page)).toHaveCount(0);

  await openEditor(page, { width: 390, height: 844, url: MIXED });
  await enterSurveyWalls(page);
  await expect(unplacedSection(page)).toBeVisible({ timeout: 15_000 });
  await expect(unplacedSection(page).getByText('Door D-114')).toBeVisible();
  await expect(unplacedSection(page).locator('.survey-unplaced-row')).toHaveCount(5);
  expect(await persistId(page), '390 must not stamp file.id').toBeNull();
  await dismissNamed(page, 'Door D-114').click();
  await expect(unplacedSection(page).getByText('Door D-114')).toHaveCount(0);
  await expect(unplacedSection(page).locator('.survey-unplaced-row')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /apply anyway/i })).toHaveCount(0);
  expect(await persistId(page)).toBeNull();
  expect(await annotationCount(page)).toBe(0);
  await assertNoErrorBoundary(page);
});
