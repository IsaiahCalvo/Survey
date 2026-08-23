import { test, expect } from '@playwright/test';

// Add bookmarks to group overlay had a visible heading + Cancel / Add
// bookmarks actions but no role="dialog" / aria-labelledby. Escape was a
// no-op and handleOpenAddToGroup was never wired. Sibling Settings /
// Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules /
// Create bookmark group are already named. V-07 Create group *apply* and
// Add bookmarks *apply* stay dedicated — this leftover is the dialog
// name + Escape dismiss. Activity stays A-06. PromptModal lock /
// NewColumnsModal stay leftover-18. Do not click Create group apply.
// Do not click Add bookmarks apply. Do not stamp file.id.

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

function namedAddToGroup(page) {
  return page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true });
}

function namedCreateGroup(page) {
  return page.getByRole('dialog', { name: 'Create bookmark group', exact: true });
}

async function openBookmarks(page) {
  const tab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible({ timeout: 10_000 });
}

async function openAddToGroupDialog(page) {
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add bookmarks to group', exact: true });
  await expect(add).toBeVisible({ timeout: 8_000 });
  await add.click();
  await expect(namedAddToGroup(page)).toBeVisible({ timeout: 8_000 });
}

test('Add bookmarks to group is named; Escape / Cancel dismiss; Add bookmarks not applied', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedAddToGroup(page).count()).toBe(0);

  await openBookmarks(page);
  expect(await namedAddToGroup(page).count()).toBe(0);

  await openAddToGroupDialog(page);
  const dialog = namedAddToGroup(page);
  await expect(dialog).toHaveAttribute('aria-labelledby', 'add-bookmarks-to-group-title');
  await expect(page.locator('#add-bookmarks-to-group-title')).toHaveText('Add bookmarks to group');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add bookmarks', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  expect(await namedCreateGroup(page).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(namedAddToGroup(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();
  expect(await page.getByText('E2E-ADD-named').count()).toBe(0);

  await openAddToGroupDialog(page);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(namedAddToGroup(page)).toHaveCount(0);
  expect(await page.getByText('E2E-ADD-named').count()).toBe(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview + idle editor break/edge for Add bookmarks to group name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Open survey', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await namedAddToGroup(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Add bookmarks to group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'New bookmark group', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedAddToGroup(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Add bookmark', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  await openBookmarks(page);
  await openAddToGroupDialog(page);
  await expect(namedAddToGroup(page)).toBeVisible({ timeout: 8_000 });
  await namedAddToGroup(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(namedAddToGroup(page)).toHaveCount(0);
  expect(await namedCreateGroup(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
