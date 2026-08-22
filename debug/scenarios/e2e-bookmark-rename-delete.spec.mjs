import { test, expect } from '@playwright/test';

// Desktop V-07 leftover: Edit-mode rename + delete for groups and
// leaves. Distinct from V-07 item create + dnd-kit, desktop New
// bookmark group / Create group / Add to group, 390 up/down, leftover-18.
// Do not stamp file.id. Do not replay the 96 proved IDs.
// Product: group rename clash is type-aware; desktop Delete / Rename
// controls are named; 390 can delete a group (no folder rename chrome).

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

async function createNamedGroup(page, groupName, childName, pageNumber) {
  await openGroupModal(page);
  await page.getByPlaceholder('Enter bookmark group name').fill(groupName);
  await fillNewGroupChild(page, childName, pageNumber);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create bookmark group' })).toHaveCount(0, { timeout: 8_000 });
  await expect(bookmarkRow(page, groupName)).toBeVisible({ timeout: 10_000 });
  await expect(bookmarkRow(page, childName)).toBeVisible({ timeout: 10_000 });
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

function renameGroup(page, name) {
  return page.getByRole('textbox', { name: `Rename group ${name}`, exact: true });
}

function renameBookmark(page, name) {
  return page.getByRole('textbox', { name: `Rename bookmark ${name}`, exact: true });
}

function deleteGroup(page, name) {
  return page.getByRole('button', { name: `Delete group ${name}`, exact: true });
}

function deleteBookmark(page, name) {
  return page.getByRole('button', { name: `Delete bookmark ${name}`, exact: true });
}

function waitForConfirm(page) {
  return new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      const message = dialog.message();
      resolve({
        message,
        type: dialog.type(),
        accept: () => dialog.accept(),
        dismiss: () => dialog.dismiss(),
      });
    });
  });
}

async function openMobileBookmarks(page) {
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
}

test('desktop bookmark rename + delete intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);
  await openBookmarks(page);

  await expect(page.getByText('No bookmarks yet. Create one to get started.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: /^Delete (group|bookmark) / }).count()).toBe(0);

  const groupA = `E2E-REN-A-${Date.now()}`;
  const childA = `E2E-REN-CA-${Date.now()}`;
  const groupB = `E2E-REN-B-${Date.now()}`;
  const childB = `E2E-REN-CB-${Date.now()}`;
  const solo = `E2E-REN-SOLO-${Date.now()}`;
  await createNamedGroup(page, groupA, childA, 3);
  await createNamedGroup(page, groupB, childB, 5);
  await createLoneBookmark(page, solo, 2);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(renameGroup(page, groupA)).toBeVisible();
  await expect(renameBookmark(page, childA)).toBeVisible();
  await expect(deleteGroup(page, groupA)).toBeVisible();
  await expect(deleteBookmark(page, solo)).toBeVisible();

  // Break — empty group name reverts (no toast, no persist).
  await renameGroup(page, groupA).fill('   ');
  await renameGroup(page, groupA).press('Enter');
  await expect(renameGroup(page, groupA)).toHaveValue(groupA);
  await expect(page.getByRole('status').filter({ hasText: /already exists|enter a .*name/i })).toHaveCount(0);

  // Break — Escape restores the typed-over name.
  await renameGroup(page, groupA).fill('E2E-REN-ESCAPED');
  await renameGroup(page, groupA).press('Escape');
  await expect(renameGroup(page, groupA)).toHaveValue(groupA);

  // Break — same-name no-op.
  await renameGroup(page, groupA).fill(groupA);
  await renameGroup(page, groupA).press('Enter');
  await expect(renameGroup(page, groupA)).toHaveValue(groupA);
  await expect(page.getByRole('status').filter({ hasText: /already exists/i })).toHaveCount(0);

  // Break — group rename clash is type-aware and reverts the field.
  await renameGroup(page, groupA).fill(groupB);
  await renameGroup(page, groupA).press('Enter');
  await expect(page.getByRole('status').filter({
    hasText: /A bookmark group with this name already exists/i,
  })).toBeVisible();
  await expect(renameGroup(page, groupA)).toHaveValue(groupA);

  // Break — leaf rename clash.
  await renameBookmark(page, childA).fill(childB);
  await renameBookmark(page, childA).press('Enter');
  await expect(page.getByRole('status').filter({
    hasText: /A bookmark with this name already exists/i,
  })).toBeVisible();
  await expect(renameBookmark(page, childA)).toHaveValue(childA);

  // Intended — rename group + leaf + page.
  const groupA2 = `${groupA}-REN`;
  const childA2 = `${childA}-REN`;
  await renameGroup(page, groupA).fill(groupA2);
  await renameGroup(page, groupA).press('Enter');
  await expect(renameGroup(page, groupA2)).toBeVisible();
  await expect(renameGroup(page, groupA2)).toHaveValue(groupA2);

  await renameBookmark(page, childA).fill(childA2);
  await renameBookmark(page, childA).press('Enter');
  await expect(renameBookmark(page, childA2)).toHaveValue(childA2);

  const pageField = page.getByRole('textbox', { name: `Bookmark page ${childA2}`, exact: true });
  await expect(pageField).toHaveValue('3');
  await pageField.fill('7');
  await pageField.press('Enter');
  await expect(pageField).toHaveValue('7');

  // Break — page 0 restores the saved page. 999 clamps to 120.
  await pageField.fill('0');
  await pageField.blur();
  await expect(pageField).toHaveValue('7');
  await pageField.fill('999');
  await expect(pageField).toHaveValue('120');
  await pageField.press('Enter');
  await expect(pageField).toHaveValue('120');

  // Edge — a bookmark may share a group name (same-type conflict only).
  await renameBookmark(page, childA2).fill(groupA2);
  await renameBookmark(page, childA2).press('Enter');
  await expect(renameBookmark(page, groupA2)).toHaveValue(groupA2);
  await expect(renameGroup(page, groupA2)).toHaveValue(groupA2);
  await expect(page.getByRole('status').filter({ hasText: /already exists/i })).toHaveCount(0);

  // Break — Cancel confirm invents 0 deletes.
  const cancelPending = waitForConfirm(page);
  await deleteGroup(page, groupA2).click();
  const cancelDialog = await cancelPending;
  expect(cancelDialog.type).toBe('confirm');
  expect(cancelDialog.message).toBe(`Delete group "${groupA2}" and 1 nested item?`);
  await cancelDialog.dismiss();
  await expect(renameGroup(page, groupA2)).toBeVisible();
  await expect(renameBookmark(page, groupA2)).toBeVisible();
  await expect(renameGroup(page, groupB)).toBeVisible();

  // Intended — leaf delete confirm.
  const leafPending = waitForConfirm(page);
  await deleteBookmark(page, solo).click();
  const leafDialog = await leafPending;
  expect(leafDialog.message).toBe(`Delete bookmark "${solo}"?`);
  await leafDialog.accept();
  await expect(renameBookmark(page, solo)).toHaveCount(0);
  await expect(renameGroup(page, groupB)).toBeVisible();

  // Intended — group delete removes the nested child; isolation holds.
  const groupPending = waitForConfirm(page);
  await deleteGroup(page, groupA2).click();
  const groupDialog = await groupPending;
  expect(groupDialog.message).toBe(`Delete group "${groupA2}" and 1 nested item?`);
  await groupDialog.accept();
  await expect(renameGroup(page, groupA2)).toHaveCount(0);
  await expect(renameBookmark(page, groupA2)).toHaveCount(0);
  await expect(renameGroup(page, groupB)).toBeVisible();
  await expect(renameBookmark(page, childB)).toBeVisible();

  // Edge — Ctrl+Z restores the scoped bookmark:delete snapshot.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await blurInputs(page);
  await page.keyboard.press('Control+z');
  await expect(bookmarkRow(page, groupA2)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(renameGroup(page, groupA2)).toBeVisible();
  await expect(renameBookmark(page, groupA2)).toBeVisible();
  await expect(renameGroup(page, groupB)).toBeVisible();

  // Edge — empty group confirm has no nested count.
  const emptyChildPending = waitForConfirm(page);
  await deleteBookmark(page, childB).click();
  const emptyChildDialog = await emptyChildPending;
  expect(emptyChildDialog.message).toBe(`Delete bookmark "${childB}"?`);
  await emptyChildDialog.accept();
  const emptyGroupPending = waitForConfirm(page);
  await deleteGroup(page, groupB).click();
  const emptyGroupDialog = await emptyGroupPending;
  expect(emptyGroupDialog.message).toBe(`Delete group "${groupB}"?`);
  await emptyGroupDialog.accept();
  await expect(renameGroup(page, groupB)).toHaveCount(0);
  await expect(renameGroup(page, groupA2)).toBeVisible();

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByText(groupA2)).toBeVisible();
  await expect(bookmarkRow(page, groupA2).locator('span', { hasText: 'P 120' })).toHaveCount(0);
  await expect(page.locator('[data-bookmark-row-id]').filter({ hasText: groupA2 }).getByText('P 120')).toBeVisible();

  // Break — Pen-armed delete still works; invents 0 marks.
  await blurInputs(page);
  const draw = page.getByRole('button', { name: 'Draw', exact: true }).first();
  if (await draw.isVisible().catch(() => false)) await draw.click();
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  if (await pen.isVisible().catch(() => false)) await pen.click();
  const beforeMarks = await userAnnotationIds(page);
  await openBookmarks(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const penPending = waitForConfirm(page);
  await deleteGroup(page, groupA2).click();
  const penDialog = await penPending;
  expect(penDialog.message).toBe(`Delete group "${groupA2}" and 1 nested item?`);
  await penDialog.accept();
  await expect(renameGroup(page, groupA2)).toHaveCount(0);
  expect(await userAnnotationIds(page)).toEqual(beforeMarks);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Edit', exact: true }).count(), 'hubPreview Edit must be 0').toBe(0);
  expect(await page.getByRole('button', { name: /^Delete (group|bookmark) / }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: /^Rename (group|bookmark) / }).count()).toBe(0);

  console.log('BOOKMARK_RENAME_DELETE_DESKTOP_PROOF', JSON.stringify({
    groupA2,
    childA2,
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 bookmark group rename is absent; group delete is live', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);
  await openBookmarks(page);

  const groupA = `E2E-390-A-${Date.now()}`;
  const childA = `E2E-390-CA-${Date.now()}`;
  const groupB = `E2E-390-B-${Date.now()}`;
  const childB = `E2E-390-CB-${Date.now()}`;
  await createNamedGroup(page, groupA, childA, 3);
  await createNamedGroup(page, groupB, childB, 5);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 20_000 });
  await openMobileBookmarks(page);

  expect(await page.getByRole('button', { name: 'Edit', exact: true }).count(), '390 desktop Edit must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Done', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: `Rename group ${groupA}` }).count(), '390 folder rename must be 0').toBe(0);
  expect(await page.getByRole('button', { name: `Edit bookmark ${groupA}` }).count()).toBe(0);
  await expect(page.getByRole('button', { name: `Delete group ${groupA}`, exact: true })).toBeVisible();
  const childTitle = page.locator('.mobile-bookmark-title').filter({ hasText: childA });
  if (!(await childTitle.count())) {
    const toggle = page.getByRole('button', { name: `Toggle ${groupA}` });
    if (await toggle.count()) await toggle.click();
  }
  await expect(childTitle).toBeVisible();

  const cancelPending = waitForConfirm(page);
  await page.getByRole('button', { name: `Delete group ${groupA}`, exact: true }).click();
  const cancelDialog = await cancelPending;
  expect(cancelDialog.message).toBe(`Delete group "${groupA}" and 1 nested item?`);
  await cancelDialog.dismiss();
  await expect(page.locator('.mobile-bookmark-title').filter({ hasText: groupA })).toBeVisible();
  await expect(page.locator('.mobile-bookmark-title').filter({ hasText: childA })).toBeVisible();
  await expect(page.locator('.mobile-bookmark-title').filter({ hasText: groupB })).toBeVisible();

  const acceptPending = waitForConfirm(page);
  await page.getByRole('button', { name: `Delete group ${groupA}`, exact: true }).click();
  const acceptDialog = await acceptPending;
  expect(acceptDialog.message).toBe(`Delete group "${groupA}" and 1 nested item?`);
  await acceptDialog.accept();
  await expect(page.locator('.mobile-bookmark-title').filter({ hasText: groupA })).toHaveCount(0);
  await expect(page.locator('.mobile-bookmark-title').filter({ hasText: childA })).toHaveCount(0);
  await expect(page.locator('.mobile-bookmark-title').filter({ hasText: groupB })).toBeVisible();
  await expect(page.locator('.mobile-bookmark-title').filter({ hasText: childB })).toBeVisible();

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('BOOKMARK_RENAME_DELETE_390_PROOF', JSON.stringify({
    groupA,
    groupB,
    folderRename: 0,
    viewBox,
    fileId: null,
  }));
});
