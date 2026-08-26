import { test, expect } from '@playwright/test';

// Bookmarks desktop rows were clickable <div>s (no role / tabIndex).
// Mouse selected/jumped; Tab never reached a row. Now
// role="button" + tabIndex=0 so keyboard can jump/select.
// Distinct from leftover-18, Search result rows, Templates
// desktop template rows, Projects desktop project rows,
// Documents desktop rows, Search Previous/Next type, Search
// Clear, Search field name, Bookmarks Expand/Edit/Delete/grip
// name/type, Projects file rows (Open file), Activity File /
// Edited, MoveCopy Close/Cancel/Confirm, Create bookmark
// group / Add-to-group internals. Clicking a bookmark row to
// confirm it still jumps is OK. Do not click Add bookmark /
// Create bookmark group / Add bookmark to group / Expand /
// Edit / Delete / Open file / Upload / Share / Restore /
// Delete forever / Sign out / Delete account. Do not stamp
// file.id.

const OUTLINE_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const INVITE = '/invite/leftover-type-probe';
const RESET = '/reset-password';
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

function jumpRows(page) {
  return page.getByRole('button', { name: /^Jump to bookmark / });
}

function groupRows(page) {
  return page.getByRole('button', { name: /^Select bookmark group / });
}

function activatableRows(page) {
  return jumpRows(page).or(groupRows(page));
}

function previewRows(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^Preview / });
}

function projectRows(page) {
  return page.locator('.projects-desktop-layout').getByRole('button', { name: /^Open project / });
}

function templateRows(page) {
  return page.locator('.templates-editor-grid').getByRole('button', { name: /^Open template / });
}

function searchResultRows(page) {
  return page.getByRole('button', { name: /^Jump to match / });
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

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  const jump = page.getByRole('button', { name: 'Jump to page', exact: true });
  if (await jump.count()) {
    const raw = (await jump.innerText()).trim();
    return Number.parseInt(raw, 10);
  }
  return null;
}

async function selectedRowName(page) {
  const pressed = activatableRows(page).and(page.locator('[aria-pressed="true"]'));
  if (await pressed.count()) return pressed.first().getAttribute('aria-label');
  return null;
}

async function openDesktopBookmarks(page) {
  const tab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible({ timeout: 8_000 });
}

async function openMobileBookmarks(page) {
  const dock = page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  const hubClose = page.getByRole('button', { name: 'Close document hub' });
  if (!(await hubClose.isVisible().catch(() => false))) {
    await dock.click();
  }
  await expect(hubClose).toBeVisible({ timeout: 15_000 });
  const bookmarksTab = page.locator('.mobile-pdf-hub-tab').filter({ hasText: 'Bookmarks' })
    .or(page.getByRole('button', { name: 'Bookmarks', exact: true }));
  await expect(bookmarksTab.first()).toBeVisible({ timeout: 15_000 });
  await bookmarksTab.first().click();
  await expect(page.getByRole('button', { name: /Add bookmark|Cancel new bookmark/ })).toBeVisible({ timeout: 15_000 });
}

test('Bookmarks desktop rows are buttons; Tab reaches them; Enter jumps', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: OUTLINE_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await activatableRows(page).count()).toBe(0);

  await openDesktopBookmarks(page);
  await expect(activatableRows(page).first()).toBeVisible({ timeout: 20_000 });
  expect(await activatableRows(page).count()).toBeGreaterThan(1);
  await expect(activatableRows(page).first()).toHaveAttribute('role', 'button');

  const firstName = await activatableRows(page).nth(0).getAttribute('aria-label');
  const secondName = await activatableRows(page).nth(1).getAttribute('aria-label');
  expect(firstName).toMatch(/^(Jump to bookmark |Select bookmark group ).+/);
  expect(secondName).toMatch(/^(Jump to bookmark |Select bookmark group ).+/);
  expect(firstName.length).toBeGreaterThan(0);
  expect(secondName.length).toBeGreaterThan(0);
  expect(secondName).not.toBe(firstName);

  const inForm = await activatableRows(page).first().evaluate((node) => Boolean(node.closest('form')));
  expect(inForm).toBe(false);
  expect(await page.getByRole('button', { name: /^Delete (group|bookmark) / }).count()).toBe(0);

  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  await edit.focus();
  await page.keyboard.press('Tab');
  await expect(activatableRows(page).nth(0)).toBeFocused();

  const startPage = await currentPageNumber(page);
  const jumpCount = await jumpRows(page).count();
  if (jumpCount > 1) {
    await jumpRows(page).nth(1).click();
    await expect.poll(async () => currentPageNumber(page), {
      message: 'click second bookmark must jump',
    }).not.toBe(startPage);
    expect(await jumpRows(page).nth(1).getAttribute('aria-pressed')).toBe('true');
  } else {
    await activatableRows(page).nth(1).click();
    expect(await activatableRows(page).nth(1).getAttribute('aria-pressed')).toBe('true');
  }
  const afterClickName = await selectedRowName(page);
  expect(afterClickName).toBeTruthy();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();
  await expect(activatableRows(page).first()).toBeVisible();
  expect(await selectedRowName(page)).toBe(afterClickName);
  expect(await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count()).toBe(0);

  const firstJump = jumpCount ? jumpRows(page).nth(0) : activatableRows(page).nth(0);
  await firstJump.focus();
  await page.keyboard.press('Enter');
  if (jumpCount) {
    await expect.poll(async () => currentPageNumber(page), {
      message: 'Enter on first bookmark must jump',
    }).not.toBeNull();
  }
  expect(await firstJump.getAttribute('aria-pressed')).toBe('true');
  expect(await firstJump.getAttribute('aria-label')).toMatch(/^(Jump to bookmark |Select bookmark group ).+/);
  expect(await page.getByRole('button', { name: 'Add bookmark', exact: true }).count()).toBe(1);
  expect(await page.getByRole('button', { name: 'Edit', exact: true }).count()).toBe(1);
});

test('Bookmarks desktop rows break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: OUTLINE_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await jumpRows(page).count()).toBe(0);
  expect(await groupRows(page).count()).toBe(0);
  await openMobileBookmarks(page);
  expect(await jumpRows(page).count()).toBe(0);
  expect(await groupRows(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: /Add bookmark|Cancel new bookmark/ })).toBeVisible();
  const mobileOpen = page.getByRole('button', { name: /^Open bookmark / });
  const mobileToggle = page.getByRole('button', { name: /^Toggle / });
  await expect.poll(async () => (await mobileOpen.count()) + (await mobileToggle.count()), {
    timeout: 20_000,
  }).toBeGreaterThan(0);

  await openPage(page, { url: OUTLINE_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await openDesktopBookmarks(page);
  await expect(activatableRows(page).first()).toBeVisible({ timeout: 20_000 });
  await activatableRows(page).nth(1).click();
  const kept = await selectedRowName(page);
  await activatableRows(page).nth(1).focus();
  await page.keyboard.press('Escape');
  expect(await selectedRowName(page)).toBe(kept);
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: /^Delete (group|bookmark) / }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await openDesktopBookmarks(page);
  await expect(page.getByText(/No bookmarks yet/i)).toBeVisible({ timeout: 10_000 });
  expect(await activatableRows(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await activatableRows(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await activatableRows(page).count()).toBe(0);
  await expect(previewRows(page).first()).toBeVisible();
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await activatableRows(page).count()).toBe(0);
  await expect(projectRows(page).first()).toBeVisible();

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await activatableRows(page).count()).toBe(0);
  await expect(templateRows(page).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await activatableRows(page).count()).toBe(0);
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await activatableRows(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await activatableRows(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await activatableRows(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await activatableRows(page).count()).toBe(0);
  expect(await searchResultRows(page).count()).toBe(0);
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
