import { test, expect } from '@playwright/test';

// Projects desktop project rows were clickable <div>s (no role /
// tabIndex). Mouse opened the project; Tab never reached a row.
// Now role="button" + tabIndex=0 so keyboard can open a project.
// Distinct from leftover-18, Documents desktop rows, Documents
// desktop sort headers, Projects file rows (Open file), Activity
// File / Edited, MoveCopy Close/Cancel/Confirm. Opening a project
// row is OK. Do not click Open file / file rows / Manage team /
// New project apply / Create project / Upload / Share / Select /
// Restore / Delete forever / Sign out / Delete account. Do not
// stamp file.id.

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

function desktopLayout(page) {
  return page.locator('.projects-desktop-layout');
}

function selectToggle(page) {
  return desktopLayout(page).getByTestId('project-select-toggle');
}

function projectRows(page) {
  return desktopLayout(page).getByRole('button', { name: /^Open project / });
}

function renameField(page) {
  return desktopLayout(page).getByRole('textbox', { name: 'Click to rename' });
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

test('Projects desktop project rows are buttons; Tab reaches them; Escape does not apply', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(desktopLayout(page)).toBeVisible({ timeout: 15_000 });
  await expect(selectToggle(page)).toHaveAttribute('type', 'button');
  await expect(projectRows(page).first()).toBeVisible();
  expect(await projectRows(page).count()).toBeGreaterThan(1);

  const firstName = (await projectRows(page).nth(0).getAttribute('aria-label')).replace(/^Open project\s+/, '');
  const secondName = (await projectRows(page).nth(1).getAttribute('aria-label')).replace(/^Open project\s+/, '');
  expect(firstName.length).toBeGreaterThan(0);
  expect(secondName.length).toBeGreaterThan(0);
  expect(secondName).not.toBe(firstName);

  await selectToggle(page).focus();
  await page.keyboard.press('Tab');
  await expect(projectRows(page).nth(0)).toBeFocused();

  await projectRows(page).nth(1).click();
  await expect(renameField(page)).toHaveValue(secondName);
  expect(await page.getByRole('button', { name: 'Open file', exact: true }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(renameField(page)).toHaveValue(secondName);
  expect(await page.getByRole('dialog', { name: 'Move or copy documents' }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Open file', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Manage Team', exact: true }).count()).toBe(0);

  await projectRows(page).nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(renameField(page)).toHaveValue(firstName);
  expect(await page.getByRole('button', { name: 'New project', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'Manage team', exact: true }).count()).toBeGreaterThan(0);
});

test('Projects desktop project rows break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectRows(page).count()).toBe(0);
  await expect(page.locator('.projects-mobile-folder-row').first()).toBeVisible();

  await openPage(page, { url: HUB_EMPTY + '&tab=projects' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(selectToggle(page)).toBeVisible();
  expect(await projectRows(page).count()).toBe(0);
  expect(await desktopLayout(page).locator('[data-project-id]').count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(projectRows(page).first()).toBeVisible();
  const edgeSecond = (await projectRows(page).nth(1).getAttribute('aria-label')).replace(/^Open project\s+/, '');
  await projectRows(page).nth(1).click();
  await expect(renameField(page)).toHaveValue(edgeSecond);
  await page.keyboard.press('Escape');
  await expect(renameField(page)).toHaveValue(edgeSecond);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectRows(page).count()).toBe(0);
  await expect(previewRows(page).first()).toBeVisible();
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectRows(page).count()).toBe(0);
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await projectRows(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await projectRows(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await projectRows(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await projectRows(page).count()).toBe(0);
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
