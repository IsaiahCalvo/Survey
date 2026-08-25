import { test, expect } from '@playwright/test';

// Eraser Type caret was a nameless <div> nested inside Partial erase.
// Mouse opened the menu; Tab never reached the caret.
// Now a sibling type="button" so keyboard can open Eraser Type.
// Distinct from leftover-18, Eraser Type menuitem, Selection mode
// caret, Highlighter caret (0), Counter caret (0), Manage Team /
// Archive / Documents desktop sort headers.
// Arm Draw → Partial erase is setup only. Opening the Eraser Type
// menu is OK; do not click Partial erase / Full stroke erase
// menuitem names. Do not apply Eraser create / Pen / Highlighter.
// Do NOT click Select annotations / Select text apply, View
// activity, Restore / Delete forever / Permanently delete / Sign
// in / Invite / Send / All / None / Duplicate / Move/Copy / Open
// file / Upload / Share / Sign out / Delete account. Do not stamp
// file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const INVITE = '/invite/leftover-type-probe';
const RESET = '/reset-password';
const PROJECT = 'Tower 5 — Security';
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
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
      localStorage.removeItem('eraserMode');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function eraserCaret(page) {
  return page.locator('[data-eraser-caret-button="true"]');
}

function namedCaret(page) {
  return page.getByRole('button', { name: 'Eraser Type', exact: true });
}

function eraserMenu(page) {
  return page.getByRole('menu', { name: 'Eraser Type', exact: true });
}

function drawTool(page) {
  return page.getByRole('button', { name: 'Draw', exact: true }).first();
}

function partialEraseTool(page) {
  return page.getByRole('button', { name: 'Partial erase', exact: true });
}

function fileHeader(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^File/i });
}

function nameHeader(page) {
  return page.locator('.archive-desktop-card').getByRole('button', { name: /^Name/i });
}

function namedTeam(page) {
  return page.getByRole('dialog', { name: 'Manage Team', exact: true });
}

function usersHeader(root) {
  return root.getByRole('button', { name: /^Users/i });
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

async function armDraw(page) {
  await expect(drawTool(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await drawTool(page).click();
  await expect(partialEraseTool(page)).toBeVisible({ timeout: 15_000 });
  await expect(namedCaret(page)).toBeVisible();
}

test('Eraser Type caret is a button; Tab reaches it; Escape does not apply', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await eraserCaret(page).count()).toBe(0);
  expect(await namedCaret(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await armDraw(page);
  await expect(namedCaret(page)).toHaveAttribute('type', 'button');
  expect(await eraserMenu(page).count()).toBe(0);

  await partialEraseTool(page).focus();
  await expect(partialEraseTool(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(namedCaret(page)).toBeFocused();

  await namedCaret(page).click();
  await expect(eraserMenu(page)).toBeVisible();
  expect(await page.getByRole('menuitem', { name: /^Partial erase/ }).count()).toBe(1);
  expect(await page.getByRole('menuitem', { name: /^Full stroke erase/ }).count()).toBe(1);
  expect(await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count()).toBe(0);

  await namedCaret(page).focus();
  await expect(namedCaret(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(eraserMenu(page)).toHaveCount(0);
  await expect(partialEraseTool(page)).toBeVisible();
  await expect(drawTool(page)).toBeVisible();

  await namedCaret(page).focus();
  await page.keyboard.press('Enter');
  await expect(eraserMenu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(eraserMenu(page)).toHaveCount(0);
  await expect(partialEraseTool(page)).toBeVisible();
  await expect(drawTool(page)).toBeVisible();
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Change role', exact: true }).count()).toBe(0);

  expect(await fileId(page)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox')).toBe('0 0 612 792');
});

test('Eraser Type caret break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await namedCaret(page).count()).toBe(0);
  expect(await eraserMenu(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
  expect(await eraserCaret(page).count()).toBe(0);
  expect(await namedCaret(page).count()).toBe(0);
  expect(await eraserMenu(page).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCaret(page).count()).toBe(0);
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.projects-desktop-layout').getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = namedTeam(page);
  await expect(team).toBeVisible({ timeout: 10_000 });
  await expect(usersHeader(team)).toHaveAttribute('type', 'button');
  expect(await team.getByRole('button', { name: 'Change role', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(fileHeader(page)).toBeVisible();
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');
  expect(await namedCaret(page).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(nameHeader(page)).toBeVisible();
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  expect(await namedCaret(page).count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedCaret(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }
  expect(await namedCaret(page).count()).toBe(0);

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await namedCaret(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await namedCaret(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await armDraw(page);
  const acc = await namedCaret(page).evaluate((node) => (
    node.getAttribute('aria-label')
    || node.getAttribute('title')
    || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
  ));
  expect(acc).toBe('Eraser Type');
  expect(acc).not.toBe('');
  await expect(namedCaret(page)).toHaveAttribute('type', 'button');
  expect(await page.locator('[data-highlighter-caret-button="true"]').count()).toBe(0);
  expect(await page.locator('[data-counter-caret], [data-counter-caret-button="true"]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Selection mode', exact: true }).count()).toBe(1);
  expect(await fileId(page)).toBeNull();
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const hidden = await hiddenCounts(page);
  for (const name of HIDDEN) {
    expect(hidden[name], name).toBe(0);
  }
});
