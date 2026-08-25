import { test, expect } from '@playwright/test';

// Bookmarks edit-mode Delete bookmark / Delete group already has a
// visible name but omitted type="button" (live type was null). Hosted
// on `?testPdf=Package 2 - Rev 4 -- IC.pdf` where the PDF outline
// already seeds groups — do NOT create a bookmark group and do NOT
// apply Add bookmark / Add bookmark to group / a bookmark rename/save.
// Opening Edit is setup only so the Delete buttons become visible.
// Do NOT click Delete bookmark / Delete group (do not apply).
// Dismiss with Escape, then Done. Same a11y type class as Bookmarks
// Edit / Done / Expand group, new host (BookmarkTreeRow trash).
// Create bookmark group / Add bookmarks to group / Add bookmark
// dialogs are exhausted — do not open them. Do not replay Bookmarks
// Edit/Done type, Bookmarks group chrome type, CreateCategoryModal
// type, Draw/Shapes/Text sub-toolbar types, Edit text type, category
// chrome types, Zoom/page-nav type, Undo/Redo type.

const OUTLINE_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SE011_PDF = '/?testPdf=se011.pdf';
const HUB = '/?hubPreview=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
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

async function openBookmarks(page) {
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

function panelEdit(page) {
  return page.getByRole('button', { name: 'Edit', exact: true });
}

function panelDone(page) {
  return page.getByRole('button', { name: 'Done', exact: true });
}

function deleteButtons(page) {
  return page.getByRole('button', { name: /^Delete (group|bookmark) / });
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

async function implicitNamed(page, names) {
  return page.evaluate((wanted) => (
    [...document.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => wanted.includes(name) || wanted.some((item) => name.startsWith(item)))
  ), names);
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

async function visibleBookmarkLabels(page) {
  return page.locator('span').filter({ hasText: /.+/ }).evaluateAll((nodes) => (
    nodes
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.length > 1 && text !== 'Bookmarks' && text !== 'Edit' && text !== 'Done' && !/^P \d+$/.test(text))
  ));
}

test('outline Bookmarks Delete is typed; delete is not applied', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: OUTLINE_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);

  await openBookmarks(page);
  expect(await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Add bookmark', exact: true }).count()).toBe(0);
  expect(await deleteButtons(page).count()).toBe(0);

  const beforeNames = await visibleBookmarkLabels(page);
  expect(beforeNames.length).toBeGreaterThan(0);

  const liveChevron = page.locator('button[aria-label="Expand group"]:not([disabled]), button[aria-label="Collapse group"]:not([disabled])').first();
  await expect(liveChevron).toBeVisible({ timeout: 8_000 });
  if ((await liveChevron.getAttribute('aria-label')) === 'Expand group') {
    await liveChevron.click();
  }

  await expectTypedNamed(panelEdit(page), 'Edit');
  await panelEdit(page).click();
  await expectTypedNamed(panelDone(page), 'Done');

  const deletes = deleteButtons(page);
  const deleteCount = await deletes.count();
  expect(deleteCount).toBeGreaterThan(1);
  expect(deleteCount).toBeGreaterThanOrEqual(4);

  const firstName = await deletes.first().getAttribute('aria-label');
  expect(firstName).toMatch(/^Delete (group|bookmark) /);
  await expectTypedNamed(deletes.first(), firstName);

  const siblingName = await deletes.nth(1).getAttribute('aria-label');
  expect(siblingName).toMatch(/^Delete (group|bookmark) /);
  expect(siblingName).not.toBe(firstName);
  await expectTypedNamed(deletes.nth(1), siblingName);

  const allNames = [];
  for (let i = 0; i < deleteCount; i += 1) {
    const name = await deletes.nth(i).getAttribute('aria-label');
    expect(name).toMatch(/^Delete (group|bookmark) /);
    await expect(deletes.nth(i)).toHaveAttribute('type', 'button');
    allNames.push(name);
  }
  expect(allNames.some((name) => /Door Schedule/.test(name))).toBe(true);
  expect(await implicitNamed(page, allNames.concat(['Delete group', 'Delete bookmark']))).toEqual([]);

  const renameInputs = page.getByRole('textbox', { name: /^Rename (group|bookmark) / });
  await expect(renameInputs.first()).toBeVisible({ timeout: 8_000 });
  const firstOriginal = (await renameInputs.first().getAttribute('aria-label')).replace(/^Rename (group|bookmark) /, '');
  await renameInputs.first().focus();
  await page.keyboard.press('Escape');
  await expect(renameInputs.first()).toHaveValue(firstOriginal);
  await expectTypedNamed(deletes.first(), firstName);
  expect(await deleteButtons(page).count()).toBe(deleteCount);

  await panelDone(page).click();
  await expectTypedNamed(panelEdit(page), 'Edit');
  expect(await deleteButtons(page).count()).toBe(0);
  expect(await renameInputs.count()).toBe(0);
  await expect(page.getByText(firstOriginal, { exact: true }).first()).toBeVisible();
  const afterNames = await visibleBookmarkLabels(page);
  expect(afterNames).toEqual(expect.arrayContaining(beforeNames.filter((name) => !/^Rename /.test(name)).slice(0, 4)));

  expect(await page.getByRole('dialog', { name: /Delete (group|bookmark)/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count()).toBe(0);
  expect(await page.getByText('New bookmark').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', viewBox);
});

test('390 + empty outline + hubPreview + guest break/edge for Delete type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await openMobileBookmarks(page);
  expect(await panelEdit(page).count()).toBe(0);
  expect(await panelDone(page).count()).toBe(0);
  expect(await page.locator('button.mobile-bookmark-delete').count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await openBookmarks(page);
  await expectTypedNamed(panelEdit(page), 'Edit');
  await panelEdit(page).click();
  await expectTypedNamed(panelDone(page), 'Done');
  expect(await deleteButtons(page).count()).toBe(0);
  await panelDone(page).click();
  await expectTypedNamed(panelEdit(page), 'Edit');
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');

  await openPage(page, { url: SE011_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await openBookmarks(page);
  const se011Before = await visibleBookmarkLabels(page);
  await expectTypedNamed(panelEdit(page), 'Edit');
  await panelEdit(page).click();
  await expectTypedNamed(panelDone(page), 'Done');
  const se011Deletes = deleteButtons(page);
  expect(await se011Deletes.count()).toBeGreaterThan(0);
  const se011First = await se011Deletes.first().getAttribute('aria-label');
  expect(se011First).toMatch(/^Delete (group|bookmark) /);
  await expectTypedNamed(se011Deletes.first(), se011First);
  if ((await se011Deletes.count()) > 1) {
    const se011Sibling = await se011Deletes.nth(1).getAttribute('aria-label');
    await expectTypedNamed(se011Deletes.nth(1), se011Sibling);
  }
  const se011Rename = page.getByRole('textbox', { name: /^Rename (group|bookmark) / }).first();
  await expect(se011Rename).toBeVisible({ timeout: 8_000 });
  const se011Original = await se011Rename.inputValue();
  await se011Rename.focus();
  await page.keyboard.press('Escape');
  await expect(se011Rename).toHaveValue(se011Original);
  await expectTypedNamed(se011Deletes.first(), se011First);
  await panelDone(page).click();
  await expectTypedNamed(panelEdit(page), 'Edit');
  expect(await deleteButtons(page).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: /^Rename (group|bookmark) / }).count()).toBe(0);
  const se011After = await visibleBookmarkLabels(page);
  expect(se011After.length).toBeGreaterThan(0);
  expect(se011Before.length).toBeGreaterThan(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await deleteButtons(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await deleteButtons(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await deleteButtons(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await deleteButtons(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await deleteButtons(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('button', { name: 'Font color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Bold', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
