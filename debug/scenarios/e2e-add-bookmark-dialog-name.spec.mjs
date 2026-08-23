import { test, expect } from '@playwright/test';

// Add bookmark popover had visible New bookmark group / Add bookmarks
// to group / Current page / Create bookmark actions but no
// role="dialog" / name. Sibling Create bookmark group / Add bookmarks
// to group dialogs are already named. V-07 Create group *apply*, Add
// bookmarks *apply*, and Create bookmark *apply* stay dedicated — this
// leftover is the parent popover name + Escape dismiss. Activity stays
// A-06. PromptModal lock / NewColumnsModal stay leftover-18. Do not
// click Create group apply. Do not click Add bookmarks apply. Do not
// click Create bookmark apply. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
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
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
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

function namedAddBookmark(page) {
  return page.getByRole('dialog', { name: 'Add bookmark', exact: true });
}

function namedCreateGroup(page) {
  return page.getByRole('dialog', { name: 'Create bookmark group', exact: true });
}

function namedAddToGroup(page) {
  return page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true });
}

async function openBookmarks(page) {
  const tab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible({ timeout: 10_000 });
}

async function openAddBookmarkDialog(page) {
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await expect(namedAddBookmark(page)).toBeVisible({ timeout: 8_000 });
}

test('Add bookmark popover is named; Escape dismisses; Create bookmark not applied', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedAddBookmark(page).count()).toBe(0);

  await openBookmarks(page);
  expect(await namedAddBookmark(page).count()).toBe(0);

  await openAddBookmarkDialog(page);
  const dialog = namedAddBookmark(page);
  await expect(dialog).toHaveAttribute('aria-label', 'Add bookmark');
  await expect(dialog.getByRole('button', { name: 'New bookmark group', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add bookmarks to group', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Current page', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create bookmark', exact: true })).toBeVisible();
  expect(await namedCreateGroup(page).count()).toBe(0);
  expect(await namedAddToGroup(page).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(namedAddBookmark(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();
  expect(await page.getByText('E2E-ADD-named').count()).toBe(0);

  await openAddBookmarkDialog(page);
  await dialog.getByRole('button', { name: 'New bookmark group', exact: true }).click();
  await expect(namedAddBookmark(page)).toHaveCount(0);
  await expect(namedCreateGroup(page)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  await expect(namedCreateGroup(page)).toHaveCount(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview + idle editor break/edge for Add bookmark name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await namedAddBookmark(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'New bookmark group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Add bookmarks to group', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedAddBookmark(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Add bookmark', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  await openBookmarks(page);
  await openAddBookmarkDialog(page);
  await expect(namedAddBookmark(page)).toBeVisible({ timeout: 8_000 });
  await namedAddBookmark(page).getByRole('button', { name: 'Add bookmarks to group', exact: true }).click();
  await expect(namedAddBookmark(page)).toHaveCount(0);
  await expect(namedAddToGroup(page)).toBeVisible({ timeout: 8_000 });
  await namedAddToGroup(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(namedAddToGroup(page)).toHaveCount(0);
  expect(await namedCreateGroup(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
