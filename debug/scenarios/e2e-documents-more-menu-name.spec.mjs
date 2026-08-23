import { test, expect } from '@playwright/test';

// Documents More *menu* exposes a name (items were already menuitems).
// Unique leftover after Eraser Type menuitem (`be960376` / `6e509ced`).
// Live hubPreview Documents More opened role="menu" with no aria-label —
// getByRole('menu', { name: /actions$/ }) was 0 while Share menuitem
// was 1. Same a11y *name* class as Pages / Manage Team menus, but a new
// compile-visible host. Official annotationContextMenuitem leftover vs
// spec Enter is not stale vs live source (source already has Enter;
// spec-only). Distinct from leftover-18 / X-01 persist / nameless-menu
// item-role hosts already proved / unnamed-dialog family / remapped-after-CW
// / dismiss / rail-toggle / Documents Share Access apply.
// Do not click Lock. Do not invent leftover-18 mint / roster / Stripe.
// Do not name Activity. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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

function ownerMenu(page) {
  return page.getByRole('menu', { name: `${OWNER} actions`, exact: true });
}

function desktopRow(page, name) {
  return page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: name }).first();
}

function mobileRow(page, name) {
  return page.locator('.documents-mobile-list [data-document-id], .documents-mobile-list').filter({ hasText: name }).first();
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

test('desktop Documents More menu is named + Share; Escape dismisses', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.getByRole('button', { name: 'More' }).count()).toBe(0);
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count()).toBe(0);

  await desktopRow(page, OWNER).getByRole('button', { name: 'More' }).click();
  await expect(ownerMenu(page)).toBeVisible();
  for (const name of ['Preview & details', 'Rename', 'Copy', 'Paste', 'Delete', 'Share']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('menuitem', { name: /Lock document|Unlock document/ })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Copy email', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(ownerMenu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Document Access', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Lock this document/ })).toHaveCount(0);

  await desktopRow(page, OWNER).getByRole('button', { name: 'More' }).click();
  await expect(ownerMenu(page)).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(ownerMenu(page)).toHaveCount(0);
  const access = page.getByRole('dialog', { name: 'Document Access', exact: true });
  await expect(access).toBeVisible({ timeout: 10_000 });
  await expect(access).toHaveAttribute('aria-labelledby', 'access-management-modal-title');
  await page.keyboard.press('Escape');
  await expect(access).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + editor break for Documents More menu name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  expect(await ownerMenu(page).count()).toBe(0);
  const more = mobileRow(page, OWNER).getByRole('button', { name: 'More' }).first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(ownerMenu(page)).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Partial erase', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(ownerMenu(page)).toHaveCount(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await ownerMenu(page).count()).toBe(0);
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
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(0);
  expect(await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});
