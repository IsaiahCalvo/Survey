import { test, expect } from '@playwright/test';

// AFTER_P146_GUEST_LS_HUNT
// Genuine hunt of P1-46 guest localStorage (leak / persist / wipe) after
// tip c6f1c1dd / product 6c1ab2cd. Do not invent leftover-18, Line /AP,
// callout Rotation, user-settable callout verticalAlign, a richTextEditor,
// or stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function installSidebarWriteSpy(page) {
  await page.addInitScript(() => {
    try {
      if (window.__sidebarWriteSpyInstalled) return;
      window.__sidebarWriteSpyInstalled = true;
      window.__sidebarWrites = [];
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItemWrapped(key, value) {
        if (String(key).startsWith('pdfSidebar_')) {
          window.__sidebarWrites.push({ key: String(key), value: String(value) });
        }
        return orig.call(this, key, value);
      };
    } catch { /* ignore */ }
  });
}

async function clearLocalPdfCaches(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  clearSidebar = true,
} = {}) {
  await installSidebarWriteSpy(page);
  await page.setViewportSize({ width, height });
  if (clearSidebar) {
    await page.goto('about:blank');
    await clearLocalPdfCaches(page);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function userShapeCount(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-anno-id]')]
      .map((el) => el.getAttribute('data-anno-id'))
      .filter(Boolean);
    return [...new Set(ids)].filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true;
    }).length;
  });
}

async function sidebarSnapshot(page) {
  return page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('pdfSidebar_')) keys.push(key);
    }
    const rows = keys.map((key) => {
      let parsed = {};
      try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = {}; }
      return {
        key,
        bookmarkNames: (parsed.bookmarks || []).map((b) => b?.name).filter(Boolean),
        pageNameKeys: Object.keys(parsed.pageNames || {}),
      };
    });
    return {
      keys,
      rows,
      writes: window.__sidebarWrites || [],
    };
  });
}

async function createNamedBookmark(page, name) {
  const bookmarksTab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(bookmarksTab).toBeVisible({ timeout: 8_000 });
  await bookmarksTab.click();
  const add = page.getByRole('button', { name: 'Add bookmark', exact: true }).first();
  await expect(add).toBeVisible({ timeout: 8_000 });
  await add.click();
  const nameField = page.getByPlaceholder('Bookmark name').first();
  await expect(nameField).toBeVisible({ timeout: 8_000 });
  await nameField.fill(name);
  await page.getByRole('button', { name: 'Current page', exact: true }).first().click();
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).first().click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 8_000 });
}

test('desktop P1-46 guest localStorage persist is accepted intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await userShapeCount(page), 'empty first load must invent 0').toBe(0);

  await createNamedBookmark(page, 'KeepMe');
  await expect.poll(async () => {
    const snap = await sidebarSnapshot(page);
    return snap.rows.some((row) => row.bookmarkNames.includes('KeepMe'));
  }, { timeout: 8_000, message: 'bookmark must persist to pdfSidebar_*' }).toBe(true);

  const afterCreate = await sidebarSnapshot(page);
  expect(afterCreate.keys.length, 'sidebar keys stay per-pdfId').toBe(1);
  expect(afterCreate.rows[0].bookmarkNames).toContain('KeepMe');

  await openEditor(page, { clearSidebar: false });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).first().click();
  await expect(page.getByText('KeepMe', { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  const afterReload = await sidebarSnapshot(page);
  expect(afterReload.rows.some((row) => row.bookmarkNames.includes('KeepMe')), 'reload must not wipe guest/no-Y.Doc sidebar').toBe(true);
  expect(afterReload.keys.length, 'reload must not leak a second pdfSidebar key').toBe(1);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count()).toBe(0);
});

test('390 P1-46 guest localStorage already accepted edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Match fill', exact: true }).count()).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
});
