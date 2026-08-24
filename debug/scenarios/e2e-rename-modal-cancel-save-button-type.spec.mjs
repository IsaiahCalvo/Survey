import { test, expect } from '@playwright/test';

// Documents Rename dialog Cancel / Save already have visible
// names but omitted type="button" (live type was null). Hosted
// on `?hubPreview=1&tab=documents` via Documents More → Rename
// (setup only). Same a11y type class as Settings Sign out /
// Projects More / Documents Close preview, new host
// (RenameModal Cancel / Save). Close name is exhausted — do
// not replay Rename Close name. Prove the type only: still
// named Cancel / Save, type=button does not empty accname or
// auto-submit. Escape / Cancel dismisses without applying
// Save. Do NOT click Save. Do not click Restore / Delete
// forever / Open file / Share / Upload / Sign out / Delete
// account / Select apply.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
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

function desktopOwnerMore(page) {
  return page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More', exact: true })
    .first();
}

function mobileOwnerMore(page) {
  return page.locator('.mobile-doc-card[data-document-id], .documents-mobile-layout [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More', exact: true })
    .first();
}

function ownerMenu(page) {
  return page.getByRole('menu', { name: `${OWNER} actions`, exact: true });
}

function renameDialog(page) {
  return page.getByRole('dialog', { name: 'Rename document', exact: true });
}

function renameCancel(page) {
  return renameDialog(page).getByRole('button', { name: 'Cancel', exact: true });
}

function renameSave(page) {
  return renameDialog(page).getByRole('button', { name: 'Save', exact: true });
}

async function expectTypedNamed(button, name) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe(name);
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
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

async function openRename(page, more) {
  await expect(more).toBeVisible({ timeout: 8_000 });
  await more.click();
  await expect(ownerMenu(page)).toBeVisible({ timeout: 8_000 });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await expect(renameDialog(page)).toBeVisible({ timeout: 8_000 });
}

test('Rename Cancel / Save are typed; Save apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 15_000 });

  expect(await renameDialog(page).count()).toBe(0);
  await openRename(page, desktopOwnerMore(page));
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(OWNER);

  await expectTypedNamed(renameCancel(page), 'Cancel');
  await expectTypedNamed(renameSave(page), 'Save');
  expect(await renameDialog(page).getByRole('button', { name: 'Close', exact: true }).count()).toBe(1);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  const implicit = await renameDialog(page).evaluate((dialog) => (
    [...dialog.querySelectorAll('button')]
      .filter((node) => !node.getAttribute('type'))
      .map((node) => (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Cancel')).toBe(false);
  expect(implicit.some((name) => name === 'Save')).toBe(false);

  await renameCancel(page).click();
  await expect(renameDialog(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for Rename Cancel/Save type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.mobile-doc-card').filter({ hasText: OWNER }).first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('.documents-desktop-card').filter({ visible: true }).count()).toBe(0);
  await openRename(page, mobileOwnerMore(page));
  await expectTypedNamed(renameCancel(page), 'Cancel');
  await expectTypedNamed(renameSave(page), 'Save');
  await page.keyboard.press('Escape');
  await expect(renameDialog(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await renameDialog(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Cancel', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Save', exact: true }).count()).toBe(0);
  await expect(page.getByText('No documents yet').first()).toBeVisible();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search documents...', exact: true }).count()).toBeGreaterThan(0);
  await openRename(page, desktopOwnerMore(page));
  await expectTypedNamed(renameCancel(page), 'Cancel');
  await expectTypedNamed(renameSave(page), 'Save');
  await page.keyboard.press('Escape');
  await expect(renameDialog(page)).toHaveCount(0, { timeout: 8_000 });

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await renameDialog(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await renameDialog(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await renameDialog(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await renameDialog(page).count()).toBe(0);
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
  expect(await renameDialog(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
