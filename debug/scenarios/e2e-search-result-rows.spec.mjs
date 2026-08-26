import { test, expect } from '@playwright/test';

// Search result rows were clickable <div>s (no role / tabIndex).
// Mouse jumped the match; Tab never reached a row. Now
// role="button" + tabIndex=0 so keyboard can jump a match.
// Distinct from leftover-18, Templates desktop template rows,
// Projects desktop project rows, Documents desktop rows,
// Search Previous/Next type, Search Clear, Search field name,
// Bookmarks desktop rows, Projects file rows (Open file),
// Activity File / Edited, MoveCopy Close/Cancel/Confirm.
// Filling a query is setup only. Clicking a result to confirm
// it still jumps is OK. Do not click Previous / Next / Export /
// save / Add bookmark / Create bookmark group / Open file /
// Upload / Share / Restore / Delete forever / Sign out /
// Delete account. Do not stamp file.id.

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

function namedField(page) {
  return page.getByRole('textbox', { name: 'Search text in PDF', exact: true });
}

function resultRows(page) {
  return page.getByRole('button', { name: /^Jump to match / });
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

async function openDesktopSearch(page) {
  const tab = page.getByRole('button', { name: 'Search text', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  const field = namedField(page);
  await expect(field).toBeVisible({ timeout: 10_000 });
  return field;
}

async function waitForSearchIdle(page) {
  const searching = page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/Searching\.\.\./);
  await searching.first().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
  await expect(searching).toHaveCount(0, { timeout: 20_000 });
}

async function fillQuery(page, field, query) {
  await field.fill(query);
  if (!query) {
    await expect(resultRows(page)).toHaveCount(0);
    return;
  }
  await waitForSearchIdle(page);
  await expect(resultRows(page).first()).toBeVisible({ timeout: 15_000 });
}

async function readIndex(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#chrome-left-host') || document.querySelector('[data-sidebar-panel]');
    const text = host?.innerText || '';
    const match = text.match(/(\d+)\s+of\s+(\d+)/);
    return match ? { at: Number(match[1]), total: Number(match[2]) } : { at: 0, total: 0 };
  });
}

test('Search result rows are buttons; Tab reaches them; Enter jumps', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  expect(await resultRows(page).count()).toBe(0);

  const field = await openDesktopSearch(page);
  await fillQuery(page, field, 'the');
  expect(await resultRows(page).count()).toBeGreaterThan(1);
  await expect(resultRows(page).first()).toHaveAttribute('role', 'button');
  const firstName = await resultRows(page).nth(0).getAttribute('aria-label');
  const secondName = await resultRows(page).nth(1).getAttribute('aria-label');
  expect(firstName).toMatch(/^Jump to match 1 on page \d+$/);
  expect(secondName).toMatch(/^Jump to match 2 on page \d+$/);
  expect(firstName.length).toBeGreaterThan(0);
  expect(secondName).not.toBe(firstName);

  const inForm = await resultRows(page).first().evaluate((node) => Boolean(node.closest('form')));
  expect(inForm).toBe(false);

  const clear = page.getByRole('button', { name: 'Clear search', exact: true });
  await expect(clear).toBeVisible();
  await clear.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(resultRows(page).nth(0)).toBeFocused();

  await resultRows(page).nth(1).click();
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'click second result must jump to 2 of N',
  }).toBe(2);
  const afterClick = await readIndex(page);
  expect(afterClick.total).toBeGreaterThan(1);

  await page.keyboard.press('Escape');
  await expect(namedField(page)).toBeVisible();
  await expect(resultRows(page).first()).toBeVisible();
  expect((await readIndex(page)).at).toBe(2);
  expect(await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count()).toBeGreaterThan(0);

  await resultRows(page).nth(0).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readIndex(page)).at, {
    message: 'Enter on first result must jump to 1 of N',
  }).toBe(1);
  expect(await namedField(page).inputValue()).toBe('the');
  expect(await page.getByRole('button', { name: 'Previous match (Shift+Enter)', exact: true }).count()).toBe(1);
  expect(await page.getByRole('button', { name: 'Next match (Enter)', exact: true }).count()).toBe(1);
});

test('Search result rows break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  expect(await resultRows(page).count()).toBe(0);
  const dock = page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  const hubClose = page.getByRole('button', { name: 'Close document hub' });
  if (!(await hubClose.isVisible().catch(() => false))) {
    await dock.click();
  }
  await expect(hubClose).toBeVisible({ timeout: 15_000 });
  const searchTab = page.locator('.mobile-pdf-hub-tab').filter({ hasText: 'Search' })
    .or(page.getByRole('button', { name: 'Search text', exact: true }));
  await searchTab.first().click();
  const mobileField = namedField(page);
  await expect(mobileField).toBeVisible({ timeout: 10_000 });
  await fillQuery(page, mobileField, 'the');
  await expect(resultRows(page).first()).toHaveAttribute('role', 'button');
  expect((await resultRows(page).first().getAttribute('aria-label'))).toMatch(/^Jump to match /);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const field = await openDesktopSearch(page);
  await fillQuery(page, field, 'the');
  await resultRows(page).nth(1).click();
  await expect.poll(async () => (await readIndex(page)).at).toBe(2);
  await resultRows(page).nth(1).focus();
  await page.keyboard.press('Escape');
  expect((await readIndex(page)).at).toBe(2);
  await expect(namedField(page)).toHaveValue('the');

  await field.fill('');
  await waitForSearchIdle(page);
  await expect(resultRows(page)).toHaveCount(0);
  await expect(namedField(page)).toBeVisible();

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await resultRows(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await resultRows(page).count()).toBe(0);
  await expect(previewRows(page).first()).toBeVisible();
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await resultRows(page).count()).toBe(0);
  await expect(projectRows(page).first()).toBeVisible();

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await resultRows(page).count()).toBe(0);
  await expect(templateRows(page).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await resultRows(page).count()).toBe(0);
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await resultRows(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await resultRows(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await resultRows(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await resultRows(page).count()).toBe(0);
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
