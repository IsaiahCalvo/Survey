import { test, expect } from '@playwright/test';

// Projects file-row More *menu* exposes a name (items were already menuitems).
// Unique leftover after Documents mobile sort menu name (`b7a14111` / `77fca41a`).
// Live hubPreview file-row More opened role="menu" with no aria-label —
// getByRole('menu', { name: /actions$/ }) was 0 while Copy / Paste /
// Delete / Share / Lock document were 1. Same a11y *name* class as
// Documents More / Archive Show and sort / Templates More / Projects
// More / Documents mobile Sort, but a new compile-visible host
// (ProjectsFolderTree file-row PopupMenu). Official
// annotationContextMenuitem leftover vs spec Enter is not stale vs
// live source (source already has Enter; spec-only). Distinct from
// leftover-18 / X-01 persist / nameless-menu hosts already proved
// / unnamed-dialog family / remapped-after-CW / dismiss / rail-toggle
// / Documents More name / Archive Show and sort / Templates More
// / Projects More / Documents mobile Sort.
// Do not click Lock. Do not click Delete. Do not click Upload files.
// Do not apply Pin. Do not name Activity. Do not stamp file.id.

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
const RFI = 'RFI-014 Lobby Camera Coverage.pdf';
const DOOR = 'Door Hardware Schedule — A.601.pdf';
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

function ownerMenu(page) {
  return page.getByRole('menu', { name: `${OWNER} actions`, exact: true });
}

function rfiMenu(page) {
  return page.getByRole('menu', { name: `${RFI} actions`, exact: true });
}

function doorMenu(page) {
  return page.getByRole('menu', { name: `${DOOR} actions`, exact: true });
}

function desktopFileRow(page, name) {
  return page.locator('.projects-desktop-layout [data-document-id]').filter({ hasText: name }).first();
}

function desktopProjectRow(page, name) {
  return page.locator('.projects-desktop-layout [data-project-id]').filter({ hasText: name }).first();
}

function mobileProjectRow(page, name) {
  return page.locator('.projects-mobile-folder-row[data-project-id]').filter({ hasText: name }).first();
}

function mobileFileRow(page, name) {
  return page.locator('.projects-mobile-file-row').filter({ hasText: name }).first();
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

test('desktop Projects file-row More menu is named + Share; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.projects-desktop-layout').getByRole('button', { name: 'More' }).count()).toBe(0);
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Lock document', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Lock document', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Lock document', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);

  await desktopFileRow(page, OWNER).getByRole('button', { name: 'More' }).click();
  await expect(ownerMenu(page)).toBeVisible();
  for (const name of ['Copy', 'Paste', 'Delete', 'Share', 'Lock document']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Add member', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(ownerMenu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Document Access', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Lock this document/ })).toHaveCount(0);

  await desktopFileRow(page, OWNER).getByRole('button', { name: 'More' }).click();
  await expect(ownerMenu(page)).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(ownerMenu(page)).toHaveCount(0);
  const access = page.getByRole('dialog', { name: 'Document Access', exact: true });
  await expect(access).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(access).toHaveCount(0);

  await desktopFileRow(page, RFI).getByRole('button', { name: 'More' }).click();
  await expect(rfiMenu(page)).toBeVisible();
  for (const name of ['Copy', 'Paste', 'Delete', 'Share', 'Lock document']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(rfiMenu(page)).toHaveCount(0);

  await desktopProjectRow(page, OTHER).click();
  await expect(page.getByText(DOOR).first()).toBeVisible({ timeout: 10_000 });
  await desktopFileRow(page, DOOR).getByRole('button', { name: 'More' }).click();
  await expect(doorMenu(page)).toBeVisible();
  for (const name of ['Copy', 'Paste', 'Delete', 'Share', 'Lock document']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(ownerMenu(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(doorMenu(page)).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + editor break for Projects file-row More menu name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = mobileProjectRow(page, PROJECT);
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  await mobileRow.click();
  const fileRow = mobileFileRow(page, OWNER);
  await expect(fileRow).toBeVisible({ timeout: 10_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  await fileRow.getByRole('button', { name: 'More', exact: true }).click();
  await expect(ownerMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Lock document', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(ownerMenu(page)).toHaveCount(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  expect(await page.getByRole('menuitem', { name: 'Lock document', exact: true }).count()).toBeGreaterThan(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  await page.locator('.archive-desktop-search .archive-filter-button').click();
  await expect(page.getByRole('menu', { name: 'Show and sort', exact: true })).toBeVisible();
  expect(await ownerMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const tplMore = page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  }).locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE })
    .getByRole('button', { name: 'More', exact: true });
  await tplMore.click();
  await expect(page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true })).toBeVisible();
  expect(await ownerMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await desktopProjectRow(page, PROJECT).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu', { name: `${PROJECT} actions`, exact: true })).toBeVisible();
  expect(await ownerMenu(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
  await expect(team).toBeVisible({ timeout: 10_000 });
  await team.getByRole('button', { name: 'More', exact: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(1);
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Lock document', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
