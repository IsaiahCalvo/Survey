import { test, expect } from '@playwright/test';

// Projects desktop file Select in the open-project pane already has a
// visible name (`Select`) but omitted type="button" (live type was
// null). Hosted on `?hubPreview=1&tab=projects` at desktop viewport.
// Open-project pane is already hosted by hubPreview seed (first
// project open). Same a11y type class as Projects desktop / 390
// header / 390 file / Documents / Archive Select, new host
// (ProjectsFolderTree desktop file Select). Do not click Select
// apply. Do not click Upload / Open file / Share / Close preview
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

function projectsDesktopFileSelect(page) {
  return page.locator('.projects-desktop-layout button:not([data-testid="project-select-toggle"])').filter({ hasText: /^Select$/ });
}

function namedProjectsDesktopFileSelect(page) {
  return page.locator('.projects-desktop-layout').getByRole('button', { name: 'Select', exact: true }).and(
    page.locator('button:not([data-testid="project-select-toggle"])'),
  );
}

function projectsDesktopProjectSelect(page) {
  return page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]');
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

test('Projects desktop file Select is typed; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15_000 });
  const desktopTower = page.locator('.projects-desktop-layout [data-project-id]').filter({ hasText: TOWER }).first();
  await expect(desktopTower).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Click to rename', exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.projects-desktop-layout').getByText('Files', { exact: true })).toBeVisible();

  const select = projectsDesktopFileSelect(page);
  await expect(select).toBeVisible({ timeout: 8_000 });
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');
  await expect(namedProjectsDesktopFileSelect(page)).toBeVisible();
  await expect(projectsDesktopProjectSelect(page)).toHaveAttribute('type', 'button');
  await expect(projectsDesktopProjectSelect(page)).toHaveText('Select');

  await select.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Click to rename', exact: true })).toBeVisible();
  await expect(select).toBeVisible();
  await expect(select).toHaveAttribute('type', 'button');
  await expect(select).toHaveText('Select');
  await expect(namedProjectsDesktopFileSelect(page)).toBeVisible();

  expect(await page.getByRole('button', { name: 'All', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'None', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Duplicate', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Move/Copy', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + docs + editor break/edge for Projects desktop file Select type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await namedProjectsDesktopFileSelect(page).count()).toBe(0);
  const desktopHidden = projectsDesktopFileSelect(page);
  if (await desktopHidden.count() > 0) {
    await expect(desktopHidden).toHaveAttribute('type', 'button');
    expect(await desktopHidden.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.display === 'none' || style.visibility === 'hidden' || box.width <= 0 || box.height <= 0
        || Boolean(el.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]'));
    })).toBe(true);
  }
  expect(await page.locator('.projects-mobile-select-row [data-testid="project-select-toggle"]').count()).toBeGreaterThan(0);
  await expect(page.locator('.projects-mobile-select-row [data-testid="project-select-toggle"]')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.projects-desktop-layout').getByText('No projects yet').first()).toBeVisible();
  expect(await projectsDesktopFileSelect(page).count()).toBe(0);
  expect(await namedProjectsDesktopFileSelect(page).count()).toBe(0);
  await expect(projectsDesktopProjectSelect(page)).toHaveAttribute('type', 'button');
  await expect(projectsDesktopProjectSelect(page)).toHaveText('Select');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search projects...', exact: true }).count()).toBeGreaterThan(0);
  expect(await namedProjectsDesktopFileSelect(page).count()).toBe(0);
  await expect(projectsDesktopProjectSelect(page)).toHaveAttribute('type', 'button');
  await expect(projectsDesktopProjectSelect(page)).toBeVisible();

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectsDesktopFileSelect(page).count()).toBe(0);
  await expect(page.locator('.documents-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectsDesktopFileSelect(page).count()).toBe(0);
  await expect(page.locator('.archive-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectsDesktopFileSelect(page).count()).toBe(0);
  await expect(page.locator('.templates-mobile-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  const editorSelectCount = await projectsDesktopFileSelect(page).count();
  if (editorSelectCount > 0) {
    expect(await projectsDesktopFileSelect(page).evaluate((el) => Boolean(
      el.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]'),
    ))).toBe(true);
  }
  expect(await namedProjectsDesktopFileSelect(page).count()).toBe(0);
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
  if (await projectsDesktopFileSelect(page).count() > 0) {
    expect(await projectsDesktopFileSelect(page).evaluate((el) => Boolean(
      el.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]'),
    ))).toBe(true);
  }
  expect(await namedProjectsDesktopFileSelect(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
