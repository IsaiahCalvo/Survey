import { test, expect } from '@playwright/test';

// Projects 390 file Select after drill already has a visible name (`Select`)
// but omitted type="button" (live type was null). Hosted on
// `?hubPreview=1&tab=projects` at 390. Drill into a hubPreview seed
// project only to host the file-pane Select. Same a11y type class as
// Projects desktop / 390 header / Documents / Archive Select, new host
// (ProjectsFolderTree mobile file Select after drill). Do not click
// Select apply. Do not click Upload / Open file / Share / Close preview
// apply. Guest 390 drill can hit auth modal — do not drill as guest.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TOWER = 'Tower 5 — Security';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function projects390FileSelect(page) {
  return page.locator('.projects-mobile-select-row button.mobile-header-select-button:not([data-testid="project-select-toggle"])');
}

function namedProjects390FileSelect(page) {
  return page.locator('.projects-mobile-select-row').getByRole('button', { name: 'Select', exact: true }).and(
    page.locator('button.mobile-header-select-button:not([data-testid="project-select-toggle"])'),
  );
}

function projects390HeaderSelect(page) {
  return page.locator('.projects-mobile-select-row [data-testid="project-select-toggle"]');
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

test('Projects 390 file Select after drill is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15_000 });
  const mobileTower = page.locator('.projects-mobile-layout [data-project-id]').filter({ hasText: TOWER }).first();
  await expect(mobileTower).toBeVisible({ timeout: 15_000 });

  expect(await projects390FileSelect(page).count()).toBe(0);
  await expect(projects390HeaderSelect(page)).toBeVisible();
  await expect(projects390HeaderSelect(page)).toHaveAttribute('type', 'button');
  await expect(projects390HeaderSelect(page)).toHaveText('Select');

  await mobileTower.click();
  await expect(page.getByRole('textbox', { name: 'Search files...', exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('textbox', { name: 'Tap to rename', exact: true })).toBeVisible({ timeout: 8_000 });

  const select = projects390FileSelect(page);
  await expect(select).toBeVisible({ timeout: 8_000 });
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');
  await expect(namedProjects390FileSelect(page)).toBeVisible();
  expect(await projects390HeaderSelect(page).count()).toBe(0);

  await select.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Tap to rename', exact: true })).toBeVisible();
  await expect(select).toBeVisible();
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');
  await expect(namedProjects390FileSelect(page)).toBeVisible();

  expect(await page.getByRole('button', { name: 'All', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'None', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Duplicate', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Move/Copy', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('desktop + empty + guest + docs + editor break/edge for Projects 390 file Select type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await projects390FileSelect(page).count()).toBe(0);
  expect(await namedProjects390FileSelect(page).count()).toBe(0);
  expect(await page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]').count()).toBeGreaterThan(0);
  await expect(page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]')).toHaveAttribute('type', 'button');

  await openPage(page, { width: 390, height: 844, url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.projects-mobile-layout').getByText('No projects yet').first()).toBeVisible();
  expect(await projects390FileSelect(page).count()).toBe(0);
  await expect(projects390HeaderSelect(page)).toHaveAttribute('type', 'button');
  await expect(projects390HeaderSelect(page)).toHaveText('Select');

  await openPage(page, { width: 390, height: 844, url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search projects...', exact: true }).count()).toBeGreaterThan(0);
  expect(await projects390FileSelect(page).count()).toBe(0);
  await expect(projects390HeaderSelect(page)).toHaveAttribute('type', 'button');
  await expect(projects390HeaderSelect(page)).toBeVisible();

  await openPage(page, { width: 390, height: 844, url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projects390FileSelect(page).count()).toBe(0);
  await expect(page.locator('.documents-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projects390FileSelect(page).count()).toBe(0);
  await expect(page.locator('.archive-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { width: 390, height: 844, url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projects390FileSelect(page).count()).toBe(0);
  await expect(page.locator('.templates-mobile-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  const editorSelectCount = await projects390FileSelect(page).count();
  if (editorSelectCount > 0) {
    expect(await projects390FileSelect(page).evaluate((el) => Boolean(
      el.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]'),
    ))).toBe(true);
  }
  expect(await namedProjects390FileSelect(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  if (await projects390FileSelect(page).count() > 0) {
    expect(await projects390FileSelect(page).evaluate((el) => Boolean(
      el.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]'),
    ))).toBe(true);
  }
  expect(await namedProjects390FileSelect(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
