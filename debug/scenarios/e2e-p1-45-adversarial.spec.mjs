import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page) {
  await page.goto(LINK_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function appAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    const pressed = await sub.first().getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.first().click();
    return;
  }
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : tool.first();
  const pressed = await target.getAttribute('aria-pressed');
  if (pressed !== 'true') await target.click();
}

async function dragOnPage(page, { x0 = 0.22, y0 = 0.28, x1 = 0.42, y1 = 0.46 } = {}) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
}

async function openBookmarks(page) {
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible();
}

async function bookmarkVisible(page, name) {
  const input = await page.locator(`input[value="${name}"]`).count();
  const text = await page.getByText(name, { exact: true }).count();
  return input + text;
}

async function expectBookmarkPresent(page, name) {
  await expect.poll(async () => bookmarkVisible(page, name), {
    message: `expected bookmark "${name}" present`,
  }).toBeGreaterThan(0);
}

async function expectBookmarkAbsent(page, name) {
  await expect.poll(async () => bookmarkVisible(page, name), {
    message: `expected bookmark "${name}" absent`,
  }).toBe(0);
}

async function enterBookmarkEditMode(page) {
  const done = page.getByRole('button', { name: 'Done', exact: true });
  if (await done.count()) return;
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
}

async function deleteNamedBookmark(page, name, { accept = true } = {}) {
  await enterBookmarkEditMode(page);
  const row = page.locator('[data-bookmark-row-id]').filter({
    has: page.locator(`input[value="${name}"], :text("${name}")`),
  }).first();
  await expect(row).toBeVisible({ timeout: 8_000 });
  const del = row.getByRole('button', { name: 'Delete', exact: true });
  await expect(del).toBeVisible();
  let confirmText = '';
  page.once('dialog', (dialog) => {
    confirmText = dialog.message();
    if (accept) dialog.accept();
    else dialog.dismiss();
  });
  await del.click();
  await expect.poll(() => confirmText).not.toBe('');
  return confirmText;
}

async function createNestedGroup(page, folderName, nestedName) {
  await openBookmarks(page);
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await page.getByText('New bookmark group', { exact: true }).click();
  await expect(page.getByText('Create bookmark group').first()).toBeVisible({ timeout: 8_000 });
  await page.getByPlaceholder('Enter bookmark group name').fill(folderName);
  await page.getByRole('button', { name: 'New bookmark', exact: true }).click();
  await expect(page.getByPlaceholder('Bookmark name')).toBeVisible();
  await page.getByPlaceholder('Bookmark name').fill(nestedName);
  await page.getByPlaceholder('Page number').fill('1');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expectBookmarkPresent(page, folderName);
  const folderRow = page.locator('[data-bookmark-row-id]').filter({ hasText: folderName }).first();
  const expand = folderRow.getByRole('button').nth(1);
  if (await expand.count()) await expand.click().catch(() => {});
  await expectBookmarkPresent(page, nestedName);
}

async function createLoneBookmark(page, name) {
  await openBookmarks(page);
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  const nameField = page.getByPlaceholder('Bookmark name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  await page.getByPlaceholder('Page number').fill('1');
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expectBookmarkPresent(page, name);
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

test('P1-45 nested group delete: dismiss no-op, undo restores both, redo deletes both', async ({ page }) => {
  await openEditor(page);
  await createNestedGroup(page, 'p145-zone', 'p145-nested');

  const dismissed = await deleteNamedBookmark(page, 'p145-zone', { accept: false });
  expect(dismissed).toMatch(/p145-zone/);
  expect(dismissed).toMatch(/nested/i);
  expect(dismissed).not.toMatch(/cannot be undone/i);
  await expectBookmarkPresent(page, 'p145-zone');
  await expectBookmarkPresent(page, 'p145-nested');

  const accepted = await deleteNamedBookmark(page, 'p145-zone', { accept: true });
  expect(accepted).toMatch(/p145-zone/);
  await expectBookmarkAbsent(page, 'p145-zone');
  await expectBookmarkAbsent(page, 'p145-nested');

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeEnabled();
  await undoBtn.click();
  await expectBookmarkPresent(page, 'p145-zone');
  await expectBookmarkPresent(page, 'p145-nested');

  const redoBtn = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(redoBtn).toBeEnabled();
  await redoBtn.click();
  await expectBookmarkAbsent(page, 'p145-zone');
  await expectBookmarkAbsent(page, 'p145-nested');
  await assertNoErrorBoundary(page);
});

test('P1-45 delete while annotation exists: undo/redo must not wipe the shape', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.38, y1: 0.40 });
  await createNestedGroup(page, 'p145-anno-zone', 'p145-anno-nested');

  await deleteNamedBookmark(page, 'p145-anno-zone', { accept: true });
  await expectBookmarkAbsent(page, 'p145-anno-zone');
  expect((await appAnnotationIds(page)).includes(rect.id), 'delete must not wipe the live rect').toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectBookmarkPresent(page, 'p145-anno-zone');
  await expectBookmarkPresent(page, 'p145-anno-nested');
  expect((await appAnnotationIds(page)).includes(rect.id), 'undo must not wipe the live rect').toBeTruthy();
  expect((await appAnnotationIds(page)).filter((id) => id === rect.id).length, 'undo must not duplicate the rect').toBe(1);

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectBookmarkAbsent(page, 'p145-anno-zone');
  await expectBookmarkAbsent(page, 'p145-anno-nested');
  expect((await appAnnotationIds(page)).includes(rect.id), 'redo must not wipe the live rect').toBeTruthy();
  expect((await appAnnotationIds(page)).filter((id) => id === rect.id).length).toBe(1);

  // Extra: a later annotation undo must not resurrect the deleted subtree.
  const later = await createRect(page, { x0: 0.58, y0: 0.50, x1: 0.76, y1: 0.66 });
  expect((await appAnnotationIds(page)).includes(later.id)).toBeTruthy();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page)).includes(later.id)).toBeFalsy();
  expect((await appAnnotationIds(page)).includes(rect.id)).toBeTruthy();
  await expectBookmarkAbsent(page, 'p145-anno-zone');
  await expectBookmarkAbsent(page, 'p145-anno-nested');
  await assertNoErrorBoundary(page);
});

test('P1-45 rapid undo/redo keeps the subtree and the live annotation', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.48, y0: 0.24, x1: 0.66, y1: 0.40 });
  await createNestedGroup(page, 'p145-rapid-zone', 'p145-rapid-nested');
  await deleteNamedBookmark(page, 'p145-rapid-zone', { accept: true });
  await expectBookmarkAbsent(page, 'p145-rapid-zone');

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  const redoBtn = page.getByRole('button', { name: 'Redo', exact: true });
  for (let i = 0; i < 4; i += 1) {
    await undoBtn.click();
    await redoBtn.click();
  }
  await expectBookmarkAbsent(page, 'p145-rapid-zone');
  expect((await appAnnotationIds(page)).includes(rect.id)).toBeTruthy();

  await undoBtn.click();
  await expectBookmarkPresent(page, 'p145-rapid-zone');
  await expectBookmarkPresent(page, 'p145-rapid-nested');
  expect((await appAnnotationIds(page)).includes(rect.id)).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('P1-45 undo at stack bottom is a no-op for bookmarks', async ({ page }) => {
  await openEditor(page);
  await createLoneBookmark(page, 'p145-bottom');
  await deleteNamedBookmark(page, 'p145-bottom', { accept: true });
  await expectBookmarkAbsent(page, 'p145-bottom');

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeEnabled();
  await undoBtn.click();
  await expectBookmarkPresent(page, 'p145-bottom');

  if (await undoBtn.isEnabled()) {
    await undoBtn.click();
  } else {
    await undoBtn.click({ force: true }).catch(() => {});
  }
  await expectBookmarkPresent(page, 'p145-bottom');
  await assertNoErrorBoundary(page);
});

test('P1-45 single bookmark delete undo/redo', async ({ page }) => {
  await openEditor(page);
  await createLoneBookmark(page, 'p145-lone');
  const dismissed = await deleteNamedBookmark(page, 'p145-lone', { accept: false });
  expect(dismissed).toMatch(/p145-lone/);
  expect(dismissed).not.toMatch(/cannot be undone/i);
  await expectBookmarkPresent(page, 'p145-lone');

  await deleteNamedBookmark(page, 'p145-lone', { accept: true });
  await expectBookmarkAbsent(page, 'p145-lone');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectBookmarkPresent(page, 'p145-lone');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expectBookmarkAbsent(page, 'p145-lone');
  await assertNoErrorBoundary(page);
});

test('P1-45 History panel has no 30-day trash row after bookmark delete', async ({ page }) => {
  await openEditor(page);
  await createLoneBookmark(page, 'p145-trash-probe');
  await deleteNamedBookmark(page, 'p145-trash-probe', { accept: true });
  await expectBookmarkAbsent(page, 'p145-trash-probe');

  const history = page.getByRole('button', { name: 'Version history', exact: true });
  await expect(history).toBeVisible();
  await history.click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText('Restorable deleted item', { exact: true })).toHaveCount(0);
  const trashRestore = page.locator('button[aria-label="Restore"]').filter({ hasText: /p145-trash-probe|bookmark/i });
  await expect(trashRestore).toHaveCount(0);
  const namedTrash = page.locator('[data-testid^="document-history-event-"]').filter({ hasText: /p145-trash-probe/ });
  await expect(namedTrash).toHaveCount(0);
  await assertNoErrorBoundary(page);
});
