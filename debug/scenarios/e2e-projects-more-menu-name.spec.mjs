import { test, expect } from '@playwright/test';

// Projects More *menu* exposes a name (items were already menuitems).
// Unique leftover after Templates More menu name (`90d34713` / `a17e05dc`).
// Live hubPreview Projects More opened role="menu" with no aria-label —
// getByRole('menu', { name: /actions$/ }) was 0 while Add member /
// Get link / Upload / Pin / Manage project were 1. Same a11y *name*
// class as Documents More / Archive Show and sort / Templates More,
// but a new compile-visible host (ProjectsFolderTree PopupMenu).
// Official annotationContextMenuitem leftover vs spec Enter is not
// stale vs live source (source already has Enter; spec-only). Distinct
// from leftover-18 / X-01 persist / nameless-menu hosts already proved
// / unnamed-dialog family / remapped-after-CW / dismiss / rail-toggle
// / Documents More name / Archive Show and sort / Templates More name
// / Documents mobile sort.
// Do not click Upload files. Do not apply Pin. Do not name Activity.
// Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const PROJECT = 'Tower 5 — Security';
const OTHER = 'Lab Reno — MEP';
const TEMPLATE = 'Security Walk-Through';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
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

function projectMenu(page) {
  return page.getByRole('menu', { name: `${PROJECT} actions`, exact: true });
}

function otherMenu(page) {
  return page.getByRole('menu', { name: `${OTHER} actions`, exact: true });
}

function desktopProjectRow(page, name) {
  return page.locator('.projects-desktop-layout [data-project-id]').filter({ hasText: name }).first();
}

function mobileProjectRow(page, name) {
  return page.locator('.projects-mobile-folder-row[data-project-id]').filter({ hasText: name }).first();
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

test('desktop Projects More menu is named + Get link; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.projects-desktop-layout').getByRole('button', { name: 'More' }).count()).toBe(0);
  expect(await projectMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Add member', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await projectMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  expect(await projectMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Add member', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);

  await desktopProjectRow(page, PROJECT).getByRole('button', { name: 'More' }).click();
  await expect(projectMenu(page)).toBeVisible();
  for (const name of ['Add member', 'Get link to project', 'Upload files', 'Pin project', 'Manage project']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(projectMenu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Share project' })).toHaveCount(0);

  await desktopProjectRow(page, PROJECT).getByRole('button', { name: 'More' }).click();
  await expect(projectMenu(page)).toBeVisible();
  await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).click();
  await expect(projectMenu(page)).toHaveCount(0);
  const share = page.getByRole('dialog', { name: 'Share project' });
  await expect(share).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);

  await desktopProjectRow(page, OTHER).getByRole('button', { name: 'More' }).click();
  await expect(otherMenu(page)).toBeVisible();
  for (const name of ['Add member', 'Get link to project', 'Upload files', 'Pin project']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: 'Manage project', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(otherMenu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Manage Team', exact: true })).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + editor break for Projects More menu name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = mobileProjectRow(page, PROJECT);
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  expect(await projectMenu(page).count()).toBe(0);
  await mobileRow.getByRole('button', { name: 'More', exact: true }).click();
  await expect(projectMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Get link to project', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(projectMenu(page)).toHaveCount(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectMenu(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  expect(await projectMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await projectMenu(page).count()).toBe(0);
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await expect(page.getByRole('menu', { name: 'Show and sort', exact: true })).toBeVisible();
  expect(await projectMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const tplMore = page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  }).locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE })
    .getByRole('button', { name: 'More', exact: true });
  await tplMore.click();
  await expect(page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true })).toBeVisible();
  expect(await projectMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
  await expect(team).toBeVisible({ timeout: 10_000 });
  await team.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  expect(await projectMenu(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await projectMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Add member', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
