import { test, expect } from '@playwright/test';

// Desktop V-07 leftover: New bookmark group / Create group /
// Add bookmark to group. Distinct from V-07 item create + dnd-kit,
// mobile up/down, leftover-18. Do not stamp file.id.
// Product: Create group / Add-to-group expand the folder so children
// are visible (same expandFolderOnly path as the + child button).

const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
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

async function openBookmarks(page) {
  const tab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible({ timeout: 10_000 });
}

async function openGroupModal(page) {
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  const group = page.getByRole('button', { name: 'New bookmark group', exact: true });
  await expect(group, 'desktop Add menu must list New bookmark group').toBeVisible();
  await group.click();
  await expect(page.getByRole('heading', { name: 'Create bookmark group' })).toBeVisible({ timeout: 8_000 });
}

function bookmarkRow(page, name) {
  return page.locator('[data-bookmark-row-id]').filter({ hasText: name }).first();
}

async function bookmarkNames(page) {
  return page.locator('[data-bookmark-row-id]').evaluateAll((rows) => (
    rows.map((row) => {
      const input = row.querySelector('input');
      const span = row.querySelector('span');
      return (input?.value || span?.textContent || row.textContent || '').trim();
    }).filter(Boolean)
  ));
}

async function createLoneBookmark(page, name, pageNumber = '1') {
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  const nameField = page.getByPlaceholder('Bookmark name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  await page.getByPlaceholder('Page number').fill(String(pageNumber));
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expect(bookmarkRow(page, name)).toBeVisible({ timeout: 10_000 });
}

async function fillNewGroupChild(page, name, pageNumber) {
  await page.getByRole('button', { name: 'New bookmark', exact: true }).click();
  const nameField = page.getByPlaceholder('Bookmark name').last();
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  const pageField = page.getByPlaceholder('Page number').last();
  await pageField.fill(String(pageNumber));
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

test('desktop bookmark group intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);
  await openBookmarks(page);

  await expect(page.getByText('No bookmarks yet. Create one to get started.')).toBeVisible();
  expect(await bookmarkNames(page)).toEqual([]);
  expect(await page.getByRole('button', { name: 'Add bookmark to group', exact: true }).count()).toBe(0);

  // Break — empty group name.
  await openGroupModal(page);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Please enter a name for the bookmark group/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create bookmark group' })).toBeVisible();
  expect(await bookmarkNames(page)).toEqual([]);

  // Break — named group with 0 children.
  await page.getByPlaceholder('Enter bookmark group name').fill('E2E-GRP-empty');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Please add at least one bookmark to the group/i })).toBeVisible();
  expect(await page.getByText('E2E-GRP-empty').count()).toBe(0);

  // Break — new child missing a name.
  await fillNewGroupChild(page, '', 3);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('status').filter({
    hasText: /Please ensure all new bookmarks have both a name and a valid page number/i,
  })).toBeVisible();
  expect(await page.getByText('E2E-GRP-empty').count()).toBe(0);

  // Break — Cancel invents 0.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create bookmark group' })).toHaveCount(0);
  expect(await bookmarkNames(page)).toEqual([]);

  // Intended — name + child page 3 + Create group. Folder expands so the child is visible.
  const groupA = `E2E-GRP-A-${Date.now()}`;
  const childA = `E2E-CHILD-A-${Date.now()}`;
  await openGroupModal(page);
  await page.getByPlaceholder('Enter bookmark group name').fill(groupA);
  await fillNewGroupChild(page, childA, 3);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create bookmark group' })).toHaveCount(0, { timeout: 8_000 });
  await expect(bookmarkRow(page, groupA), 'created group must appear').toBeVisible({ timeout: 10_000 });
  await expect(bookmarkRow(page, childA), 'create must expand so the child is visible').toBeVisible({ timeout: 10_000 });
  await expect(bookmarkRow(page, groupA).getByRole('button', { name: 'Add bookmark to group', exact: true })).toBeVisible();
  await expect(bookmarkRow(page, groupA).getByRole('button', { name: 'Collapse group', exact: true })).toBeVisible();

  // Intended — child click jumps to page 3.
  await bookmarkRow(page, childA).click();
  await expect.poll(() => currentPageNumber(page), {
    timeout: 20_000,
    message: 'child bookmark must jump to page 3',
  }).toBe(3);

  // Intended — Add bookmark to group mints a visible child.
  const beforeAdd = await bookmarkNames(page);
  await bookmarkRow(page, groupA).getByRole('button', { name: 'Add bookmark to group', exact: true }).click();
  await expect.poll(async () => (await bookmarkNames(page)).length).toBe(beforeAdd.length + 1);
  await expect(page.locator('[data-bookmark-row-id]').filter({ hasText: 'New bookmark' })).toBeVisible();

  // Isolation — second group does not rewrite the first.
  const groupB = `E2E-GRP-B-${Date.now()}`;
  const childB = `E2E-CHILD-B-${Date.now()}`;
  await openGroupModal(page);
  await page.getByPlaceholder('Enter bookmark group name').fill(groupB);
  await fillNewGroupChild(page, childB, 5);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(bookmarkRow(page, groupB)).toBeVisible({ timeout: 10_000 });
  await expect(bookmarkRow(page, childB)).toBeVisible();
  await expect(bookmarkRow(page, groupA)).toBeVisible();
  await expect(bookmarkRow(page, childA)).toBeVisible();

  // Intended — existing lone bookmark can join a new group.
  const solo = `E2E-SOLO-${Date.now()}`;
  await createLoneBookmark(page, solo, 2);
  const groupC = `E2E-GRP-C-${Date.now()}`;
  await openGroupModal(page);
  await page.getByPlaceholder('Enter bookmark group name').fill(groupC);
  // Existing-list accessible name is `${name} Page N`.
  await page.getByRole('button', { name: new RegExp(`^${solo}\\b`) }).click();
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(bookmarkRow(page, groupC)).toBeVisible({ timeout: 10_000 });
  await expect(bookmarkRow(page, solo)).toBeVisible();

  // Break — Pen-armed Create group still works; invents 0 marks.
  await blurInputs(page);
  const draw = page.getByRole('button', { name: 'Draw', exact: true }).first();
  if (await draw.isVisible().catch(() => false)) await draw.click();
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  if (await pen.isVisible().catch(() => false)) await pen.click();
  const beforeMarks = await userAnnotationIds(page);
  const groupD = `E2E-GRP-D-${Date.now()}`;
  const childD = `E2E-CHILD-D-${Date.now()}`;
  await openBookmarks(page);
  await openGroupModal(page);
  await page.getByPlaceholder('Enter bookmark group name').fill(groupD);
  await fillNewGroupChild(page, childD, 1);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(bookmarkRow(page, groupD)).toBeVisible({ timeout: 10_000 });
  await expect(bookmarkRow(page, childD)).toBeVisible();
  expect(await userAnnotationIds(page)).toEqual(beforeMarks);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'New bookmark group', exact: true }).count(), 'hubPreview New bookmark group must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Create group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Add bookmark to group', exact: true }).count()).toBe(0);

  console.log('BOOKMARK_GROUP_DESKTOP_PROOF', JSON.stringify({
    groupA,
    childA,
    groupB,
    groupC,
    groupD,
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 bookmark group chrome is absent', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  const hubClose = page.getByRole('button', { name: 'Close document hub' });
  const dock = page.getByRole('button', { name: 'Open pages, search, and bookmarks' });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  if (!(await hubClose.isVisible().catch(() => false))) await dock.click();
  await expect(hubClose).toBeVisible({ timeout: 15_000 });
  const bookmarksTab = page.locator('.mobile-pdf-hub-tab').filter({ hasText: 'Bookmarks' })
    .or(page.getByRole('button', { name: 'Bookmarks', exact: true }));
  await expect(bookmarksTab.first()).toBeVisible({ timeout: 15_000 });
  await bookmarksTab.first().click();
  await expect(page.getByRole('button', { name: /Add bookmark|Cancel new bookmark/ })).toBeVisible({ timeout: 15_000 });

  expect(await page.getByRole('button', { name: 'New bookmark group', exact: true }).count(), '390 New bookmark group must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Create group', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Add bookmark to group', exact: true }).count()).toBe(0);
  await expect(page.getByRole('heading', { name: 'Create bookmark group' })).toHaveCount(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('BOOKMARK_GROUP_390_PROOF', JSON.stringify({
    newGroup: 0,
    viewBox,
    fileId: null,
  }));
});
