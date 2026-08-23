import { test, expect } from '@playwright/test';

// Share / invite overlay (besides AccessManagement) had a visible
// Permission heading but the role <select> had no name —
// getByRole('combobox', { name: 'Permission' }) was 0 while Share
// project was open. Invite-by-email textarea also omitted a name.
// Overlay buttons omitted type="button". Projects More already
// proved Get link opens Share project + Escape; last hunt never
// opened Share. Do not change role. Do not click Copy link / Send.
// AccessManagement stay dedicated. Manage Team role picker / Activity
// stay A-06 adjacent — not taken. PromptModal lock stays leftover-18.
// Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const PROJECT = 'Tower 5 — Security';
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

function namedPermission(page) {
  return page.getByRole('combobox', { name: 'Permission', exact: true });
}

function shareProject(page) {
  return page.getByRole('dialog', { name: 'Share project', exact: true });
}

function shareTemplate(page) {
  return page.getByRole('dialog', { name: 'Share template', exact: true });
}

function desktopProjectRow(page, name) {
  return page.locator('.projects-desktop-layout [data-project-id]').filter({ hasText: name }).first();
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

async function openShareProject(page) {
  await desktopProjectRow(page, PROJECT).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: `${PROJECT} actions`, exact: true });
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(shareProject(page)).toBeVisible({ timeout: 10_000 });
}

test('desktop Share Permission is named; Escape dismisses; role apply not changed', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  expect(await namedPermission(page).count()).toBe(0);
  expect(await shareProject(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await namedPermission(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedPermission(page).count()).toBe(0);
  expect(await shareProject(page).count()).toBe(0);

  await openShareProject(page);
  const permission = namedPermission(page);
  await expect(permission).toBeVisible({ timeout: 8_000 });
  await expect(permission).toHaveAttribute('aria-label', 'Permission');
  await expect(permission).toHaveValue('Viewer');
  await expect(shareProject(page).getByRole('textbox', { name: 'Invite by email', exact: true })).toBeVisible();
  await expect(shareProject(page).getByRole('button', { name: 'Close', exact: true })).toHaveAttribute('type', 'button');
  await expect(shareProject(page).getByRole('button', { name: 'Copy link', exact: true })).toHaveAttribute('type', 'button');
  await expect(shareProject(page).getByRole('button', { name: 'Cancel', exact: true })).toHaveAttribute('type', 'button');
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(shareProject(page)).toHaveCount(0);
  await expect(namedPermission(page)).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + templates + documents + editor break/edge for Share Permission name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedPermission(page).count()).toBe(0);
  const mobileRow = page.locator('.projects-mobile-folder-row[data-project-id]').filter({ hasText: PROJECT }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menu', { name: `${PROJECT} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).click();
  await expect(shareProject(page)).toBeVisible({ timeout: 10_000 });
  await expect(namedPermission(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shareProject(page)).toHaveCount(0);
  await expect(namedPermission(page)).toHaveCount(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedPermission(page).count()).toBe(0);
  const tplMore = page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  }).locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE })
    .getByRole('button', { name: 'More', exact: true });
  await tplMore.click();
  await expect(page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(shareTemplate(page)).toBeVisible({ timeout: 10_000 });
  await expect(namedPermission(page)).toBeVisible();
  await expect(namedPermission(page)).toHaveValue('Viewer');
  await page.keyboard.press('Escape');
  await expect(shareTemplate(page)).toHaveCount(0);
  await expect(namedPermission(page)).toHaveCount(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedPermission(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Document Access', exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await namedPermission(page).count()).toBe(0);
  expect(await shareProject(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedPermission(page).count()).toBe(0);
  expect(await shareProject(page).count()).toBe(0);
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
  expect(await namedPermission(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
