import { test, expect } from '@playwright/test';

// Templates desktop template rows were clickable <div>s (no role /
// tabIndex). Mouse opened the template; Tab never reached a row.
// Now role="button" + tabIndex=0 so keyboard can open a template.
// Distinct from leftover-18, Projects desktop project rows,
// Documents desktop rows, Documents desktop sort headers,
// Templates More, 390 Templates category title name, desktop
// Templates Click to rename, Projects file rows (Open file),
// Activity File / Edited, MoveCopy Close/Cancel/Confirm.
// Opening a template row stays on the hub. Do not click New
// template apply / Share / Select apply / Duplicate / All /
// None / Open file / Upload / Restore / Delete forever / Sign
// out / Delete account. Do not stamp file.id.

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

function desktopGrid(page) {
  return page.locator('.templates-editor-grid');
}

function selectToggle(page) {
  return desktopGrid(page).getByRole('button', { name: 'Select', exact: true });
}

function templateRows(page) {
  return desktopGrid(page).getByRole('button', { name: /^Open template / });
}

function templateTitle(page) {
  return desktopGrid(page).locator('input[data-template-title]');
}

function projectRows(page) {
  return page.locator('.projects-desktop-layout').getByRole('button', { name: /^Open project / });
}

function previewRows(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^Preview / });
}

function fileHeader(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^File/i });
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

test('Templates desktop template rows are buttons; Tab reaches them; Escape does not apply', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(desktopGrid(page)).toBeVisible({ timeout: 15_000 });
  await expect(selectToggle(page)).toHaveAttribute('type', 'button');
  await expect(templateRows(page).first()).toBeVisible();
  expect(await templateRows(page).count()).toBeGreaterThan(1);

  const firstName = (await templateRows(page).nth(0).getAttribute('aria-label')).replace(/^Open template\s+/, '');
  const secondName = (await templateRows(page).nth(1).getAttribute('aria-label')).replace(/^Open template\s+/, '');
  expect(firstName.length).toBeGreaterThan(0);
  expect(secondName.length).toBeGreaterThan(0);
  expect(secondName).not.toBe(firstName);

  await selectToggle(page).focus();
  await page.keyboard.press('Tab');
  await expect(templateRows(page).nth(0)).toBeFocused();

  await templateRows(page).nth(1).click();
  await expect(templateTitle(page)).toHaveValue(secondName);
  expect(await page.getByRole('button', { name: 'Open file', exact: true }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(templateTitle(page)).toHaveValue(secondName);
  expect(await page.getByRole('dialog', { name: 'Move or copy documents' }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Open file', exact: true }).count()).toBe(0);

  await templateRows(page).nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(templateTitle(page)).toHaveValue(firstName);
  expect(await desktopGrid(page).getByRole('button', { name: 'New template', exact: true }).count()).toBeGreaterThan(0);
  expect(await desktopGrid(page).getByRole('button', { name: 'Select', exact: true }).count()).toBeGreaterThan(0);
});

test('Templates desktop template rows break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templateRows(page).count()).toBe(0);
  await expect(page.locator('.templates-mobile-row').first()).toBeVisible();

  await openPage(page, { url: HUB_EMPTY + '&tab=templates' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(selectToggle(page)).toBeVisible();
  expect(await templateRows(page).count()).toBe(0);
  expect(await desktopGrid(page).locator('[data-template-id]').count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(templateRows(page).first()).toBeVisible();
  const edgeSecond = (await templateRows(page).nth(1).getAttribute('aria-label')).replace(/^Open template\s+/, '');
  await templateRows(page).nth(1).click();
  await expect(templateTitle(page)).toHaveValue(edgeSecond);
  await page.keyboard.press('Escape');
  await expect(templateTitle(page)).toHaveValue(edgeSecond);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templateRows(page).count()).toBe(0);
  await expect(previewRows(page).first()).toBeVisible();
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templateRows(page).count()).toBe(0);
  await expect(projectRows(page).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templateRows(page).count()).toBe(0);
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await templateRows(page).count()).toBe(0);
  await expect(previewRows(page).first()).toBeVisible();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await templateRows(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await templateRows(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await templateRows(page).count()).toBe(0);
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
