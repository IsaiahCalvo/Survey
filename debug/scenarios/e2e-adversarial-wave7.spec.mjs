import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const HUB = '/?hubPreview=1&tab=documents';

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
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

function isPdfObjectId(id) {
  return /^\d+R$/i.test(String(id || ''));
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const ids = [...new Set(annoIds)];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        fontFamily: object.fontFamily || data.fontFamily || data.style?.fontFamily || null,
        path: object.path || data.path || null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userAnnotationIds(page, pageNumber = 1) {
  const rows = await userAnnotationSnapshot(page, pageNumber);
  return rows.map((row) => row.id).filter((id) => !isPdfObjectId(id));
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true, pageNumber = 1) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
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

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return { start, end, box };
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set(await userAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

async function bookmarkVisible(page, name) {
  const input = await page.locator(`input[value="${name}"]`).count();
  const text = await page.getByText(name, { exact: true }).count();
  return input + text;
}

async function createBookmark(page, name) {
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add bookmark', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  const nameField = page.getByPlaceholder('Bookmark name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  const pageField = page.getByPlaceholder('Page number');
  if (await pageField.count()) await pageField.fill('1');
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expect.poll(async () => bookmarkVisible(page, name)).toBeGreaterThan(0);
}

test('ReSignInModal Forgot password on ?testPdf= fails closed', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.re-signin-modal')).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => typeof window.__test_emitTransportState)).toBe('function');
  await page.evaluate(() => window.__test_emitTransportState({
    code: 'login_expiry_failure',
    detail: 'wave7-resignin',
  }));

  const modal = page.locator('.re-signin-modal');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();

  await modal.locator('#re-signin-email').fill('');
  await modal.getByText('Forgot password?').click();
  await expect(modal.locator('.re-signin-modal__error')).toContainText(/Enter your email first/i);
  await expect(modal.locator('.re-signin-modal__notice')).toHaveCount(0);

  await modal.locator('#re-signin-email').fill('dev-test-user@example.invalid');
  await modal.getByText('Forgot password?').click();
  await expect(modal.locator('.re-signin-modal__notice')).toHaveCount(0);
  await expect(modal.locator('.re-signin-modal__error')).toContainText(
    /Test PDF cannot send password reset emails|I'm human|human|Could not send a reset link/i,
  );
  await expect(page).toHaveURL(/testPdf=/);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();
  await assertNoErrorBoundary(page);
});

test('HubPreview delete-account wrong confirm then DELETE stays fail-closed', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings' }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByRole('button', { name: 'Delete account' }).click();
  const confirm = dialog.locator('#deleteAccountConfirm');
  const wipe = dialog.getByRole('button', { name: 'Delete account permanently' });
  await confirm.fill('delete');
  await expect(wipe).toBeDisabled();

  await confirm.fill('DELETE');
  await expect(wipe).toBeEnabled();
  await wipe.click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot delete accounts/i);
  await expect(dialog.locator('.account-message')).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  await dialog.locator('#firstName').fill('Wave7');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(page.locator('.survey-hub')).toBeVisible();
});

test('form widget value survives annotation undo', async ({ page }) => {
  await openEditor(page, FORM_PDF);
  await page.keyboard.press('v');
  const typed = page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first();
  await expect(typed).toBeAttached({ timeout: 15_000 });
  await typed.click({ force: true });
  await typed.fill('wave7-form-keep');
  await expect(typed).toHaveValue('wave7-form-keep');

  const rect = await createRect(page, { x0: 0.58, y0: 0.22, x1: 0.78, y1: 0.40 });
  expect(rect.id).toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(rect.id)).toBeFalsy();
  await expect(page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first())
    .toHaveValue('wave7-form-keep');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.isEnabled()) await undo.click();
  await expect(page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first())
    .toHaveValue('wave7-form-keep');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
});

test('context menu stays isolated from bookmark delete undo', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.18, y0: 0.20, x1: 0.38, y1: 0.36 });
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${rect.id}"]`);
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${rect.id}`).toBeTruthy();
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await expect(menu.getByText('Bring to front', { exact: true })).toBeVisible();

  await createBookmark(page, 'wave7-bm-keep');
  expect((await userAnnotationIds(page)).includes(rect.id)).toBeTruthy();

  const done = page.getByRole('button', { name: 'Done', exact: true });
  if (!(await done.count())) {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  }
  const row = page.locator('[data-bookmark-row-id]').filter({
    has: page.locator('input[value="wave7-bm-keep"], :text("wave7-bm-keep")'),
  }).first();
  const deleteBtn = row.getByRole('button', { name: 'Delete', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await deleteBtn.click();
  await expect.poll(async () => bookmarkVisible(page, 'wave7-bm-keep')).toBeGreaterThan(0);
  expect((await userAnnotationIds(page)).includes(rect.id)).toBeTruthy();

  page.once('dialog', (dialog) => dialog.accept());
  await deleteBtn.click();
  await expect.poll(async () => bookmarkVisible(page, 'wave7-bm-keep'), { timeout: 8_000 }).toBe(0);
  expect((await userAnnotationIds(page)).includes(rect.id)).toBeTruthy();

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.isEnabled()) {
    await undo.click();
    await expect.poll(async () => bookmarkVisible(page, 'wave7-bm-keep')).toBeGreaterThan(0);
  }
  expect((await userAnnotationIds(page)).includes(rect.id)).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('zoomGeneration mid-pen-stroke commits instead of dropping ink', async ({ page }) => {
  await openEditor(page);
  const beforeZoom = new Set(await userAnnotationIds(page));
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((btn) => {
      if ((btn.getAttribute('aria-label') || btn.textContent || '').trim() === 'Zoom in') {
        btn.click();
      }
    });
  });
  await page.waitForTimeout(200);
  const afterBareZoom = await userAnnotationIds(page);
  expect(afterBareZoom.filter((id) => !beforeZoom.has(id))).toHaveLength(0);

  await activateTool(page, 'Draw', 'Pen');
  const before = new Set(await userAnnotationIds(page));
  const box = await pageBox(page);
  const start = { x: box.x + box.width * 0.24, y: box.y + box.height * 0.30 };
  const mid = { x: box.x + box.width * 0.48, y: box.y + box.height * 0.36 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 10 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((el) => (
      (el.getAttribute('aria-label') || el.textContent || '').trim() === 'Zoom in'
    ));
    btn?.click();
  });
  await page.mouse.up();
  const created = await waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'path' || row.tool === 'pen' || !!row.path
  ));
  expect(created.id).toBeTruthy();

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  expect((await userAnnotationIds(page)).includes(created.id)).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('Font menu offers single-name families after mobile FONT_FAMILIES restore', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('t');
  const overlay = page.locator('[data-text-overlay="1"]');
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Text', exact: true }).first().click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
  if (await sub.count()) {
    const pressed = await sub.getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.click();
  }
  const fontBtn = page.getByRole('button', { name: 'Font', exact: true }).first();
  await expect(fontBtn).toBeVisible({ timeout: 8_000 });
  await fontBtn.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible();
  const names = (await popover.getByRole('option').allTextContents())
    .map((name) => name.trim())
    .filter(Boolean);
  expect(names.length).toBeGreaterThanOrEqual(6);
  for (const name of names) {
    expect(name.includes(',')).toBeFalsy();
    expect(name.toLowerCase()).not.toMatch(/apple-system|blinkmac|sans-serif/);
  }
  expect(names).toEqual(expect.arrayContaining([
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
  ]));
  await popover.getByRole('option', { name: 'Verdana', exact: true }).click();
  await expect(fontBtn).toContainText('Verdana');
  await popover.getByRole('option', { name: 'Georgia', exact: true }).click().catch(async () => {
    await fontBtn.click();
    await page.locator('[data-annotation-dropdown-popover="true"]').getByRole('option', { name: 'Georgia', exact: true }).click();
  });
  await expect(fontBtn).toContainText('Georgia');
  const mobileSrc = await page.evaluate(async () => {
    const res = await fetch('/src/mobile/MobilePdfViewerChrome.jsx');
    return res.ok ? await res.text() : '';
  });
  if (mobileSrc) {
    expect(mobileSrc).toMatch(/import \{ FONT_FAMILIES \}/);
    expect(mobileSrc).toMatch(/FONT_FAMILIES\.map/);
    expect(mobileSrc).not.toMatch(/-apple-system/);
  }
  await assertNoErrorBoundary(page);
});

test('Hub document More menu dismiss consumes the first outside click', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const testRow = page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: 'test.pdf' }).first();
  await expect(testRow).toBeVisible();
  await testRow.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();

  const other = page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: 'Package 2' }).first();
  const otherBox = await other.boundingBox();
  expect(otherBox).toBeTruthy();
  await page.mouse.click(otherBox.x + 24, otherBox.y + otherBox.height / 2);
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.survey-hub')).toBeVisible();
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  await testRow.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await other.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});
