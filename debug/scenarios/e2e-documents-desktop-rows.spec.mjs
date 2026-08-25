import { test, expect } from '@playwright/test';

// Documents desktop ledger rows were clickable <div>s (no role /
// tabIndex). Mouse opened preview; Tab never reached a row.
// Now role="button" + tabIndex=0 so keyboard can preview.
// Distinct from leftover-18, Documents desktop sort headers,
// Documents More, Archive desktop rows, 390 mobile-doc-card,
// Activity File / Edited, MoveCopy Close/Cancel/Confirm.
// Preview / Close preview is setup only. Do not click Open file /
// Upload / Share / Select / Restore / Delete forever / Sign out /
// Delete account. Do not stamp file.id.

const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const INVITE = '/invite/leftover-type-probe';
const RESET = '/reset-password';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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
      localStorage.removeItem('kal31_pending_invite_token');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function desktopCard(page) {
  return page.locator('.documents-desktop-card');
}

function fileHeader(page) {
  return desktopCard(page).getByRole('button', { name: /^File/i });
}

function sizeHeader(page) {
  return desktopCard(page).getByRole('button', { name: /^Size/i });
}

function desktopRows(page) {
  return desktopCard(page).getByRole('button', { name: /^Preview / });
}

function previewName(page) {
  return desktopCard(page).locator('aside').locator('div').nth(1);
}

function nameHeader(page) {
  return page.locator('.archive-desktop-card').getByRole('button', { name: /^Name/i });
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

test('Documents desktop rows are buttons; Tab reaches them; Escape does not apply', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(desktopCard(page)).toBeVisible({ timeout: 15_000 });
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');
  await expect(desktopRows(page).first()).toBeVisible();
  expect(await desktopRows(page).count()).toBeGreaterThan(1);

  const firstName = (await desktopRows(page).nth(0).getAttribute('aria-label')).replace(/^Preview\s+/, '');
  const secondName = (await desktopRows(page).nth(1).getAttribute('aria-label')).replace(/^Preview\s+/, '');
  expect(firstName).toMatch(/\.pdf/i);
  expect(secondName).toMatch(/\.pdf/i);
  expect(secondName).not.toBe(firstName);

  await sizeHeader(page).focus();
  await page.keyboard.press('Tab');
  await expect(desktopRows(page).nth(0)).toBeFocused();

  await desktopRows(page).nth(1).click();
  await expect(previewName(page)).toHaveText(secondName);
  expect(await page.getByRole('button', { name: 'Open file', exact: true }).count()).toBe(1);

  await page.keyboard.press('Escape');
  await expect(previewName(page)).toHaveText(secondName);
  expect(await page.getByRole('dialog', { name: 'Move or copy documents' }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Open file', exact: true }).count()).toBe(1);

  await desktopRows(page).nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(previewName(page)).toHaveText(firstName);
  expect(await page.getByRole('button', { name: 'Upload', exact: true }).count()).toBeGreaterThan(0);
});

test('Documents desktop rows break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopRows(page).count()).toBe(0);
  await expect(page.locator('.mobile-doc-card').first()).toBeVisible();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(fileHeader(page)).toBeVisible();
  expect(await desktopRows(page).count()).toBe(0);
  expect(await desktopCard(page).locator('[data-document-id]').count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(desktopRows(page).first()).toBeVisible();
  await desktopRows(page).nth(1).click();
  await expect(previewName(page)).not.toHaveText('');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopRows(page).count()).toBe(0);
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopRows(page).count()).toBe(0);
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopRows(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }
  if (await fileHeader(page).count()) {
    await expect(fileHeader(page)).toHaveAttribute('type', 'button');
  }

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await desktopRows(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await desktopRows(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await desktopRows(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const hidden = await hiddenCounts(page);
  for (const name of HIDDEN) {
    expect(hidden[name], name).toBe(0);
  }
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Eraser Type', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Selection mode', exact: true }).count()).toBe(1);
});
