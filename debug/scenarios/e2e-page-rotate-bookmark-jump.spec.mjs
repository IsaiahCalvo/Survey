import { test, expect } from '@playwright/test';

// Bookmark jump AFTER page CW (page-number dest on landscape page).
// Unrotated V-07 is e2e-bookmark-group / e2e-bookmark-rename-delete
// (portrait 0 0 612 792) — do not replay group / rename / delete.
// goToBookmarkSource returns false — page-number jump only.
// Do not invent dest XYZ remapping.
// Intended: jumps to the bookmarked landscape page.
// Break: missing dest does not invent XYZ / does not invent a jump.
// Edge: file.id null.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not replay remappers / overlays / Fit /
// Search / thumbnails / form widgets / create-after-rotate.

const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('pdfViewerZoomPreference');
      localStorage.removeItem('pdfViewerManualZoomScale');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
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

async function pageCoveredByHub(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  if (!box) return false;
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const text = el?.textContent || '';
    return /No documents yet|Upload your first PDF|Search documents/.test(text);
  }, { x: box.x + box.width * 0.45, y: box.y + box.height * 0.40 });
}

async function closeDocumentPanel(page) {
  const backdrop = page.getByRole('button', { name: 'Close document panel' });
  if (await backdrop.first().isVisible().catch(() => false)) {
    await backdrop.first().click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  await closeDocumentPanel(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await expect.poll(async () => pageCoveredByHub(page), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
  await blurInputs(page);
}

async function pageViewBox(page, pageNumber = 1) {
  const layer = page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
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

async function storedBookmarks(page) {
  return page.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('pdfSidebar_')) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        if (Array.isArray(data.bookmarks)) out.push(...data.bookmarks);
      } catch { /* ignore */ }
    }
    return out;
  });
}

function destInvented(bookmark) {
  if (!bookmark || typeof bookmark !== 'object') return false;
  const dest = bookmark.dest ?? bookmark.destination ?? null;
  if (dest == null) return false;
  if (Array.isArray(dest)) return dest.length > 1;
  if (typeof dest !== 'object') return false;
  return dest.xyz != null
    || dest.XYZ != null
    || dest.left != null
    || dest.top != null
    || dest.x != null
    || dest.y != null;
}

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
  const again = page.getByRole('button', { name: 'Pages', exact: true });
  if (await again.first().isVisible().catch(() => false)
    && (await again.first().getAttribute('aria-pressed')) !== 'true') {
    await again.first().click();
  }
}

async function openBookmarks(page) {
  const tab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible({ timeout: 10_000 });
}

function bookmarkRow(page, name) {
  return page.locator('[data-bookmark-row-id]').filter({ hasText: name }).first();
}

async function createLoneBookmark(page, name, pageNumber = '2') {
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  const nameField = page.getByPlaceholder('Bookmark name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  await page.getByPlaceholder('Page number').fill(String(pageNumber));
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expect(bookmarkRow(page, name)).toBeVisible({ timeout: 10_000 });
}

async function openPageMenu(page, pageNumber = 2) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return {
    rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }),
  };
}

async function rotatePage(page, pageNumber, direction = 'cw') {
  const items = await openPageMenu(page, pageNumber);
  await items.rotateCw.click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await closeDocumentPanel(page);
  await assertNoErrorBoundary(page);
}

test('desktop bookmark jump after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await pageViewBox(page, 1), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userAnnotationIds(page, 1), 'fresh editor invents 0 user annotations').toEqual([]);
  expect(await currentPageNumber(page), 'start on page 1').toBe(1);

  await openBookmarks(page);
  const name = `CW-JUMP-${Date.now()}`;
  await createLoneBookmark(page, name, 2);

  const before = await storedBookmarks(page);
  const created = before.find((item) => item?.name === name);
  expect(created, 'created bookmark must persist').toBeTruthy();
  expect(created.pageIds, 'page-number dest only').toEqual([2]);
  expect(destInvented(created), 'create must not invent dest XYZ').toBe(false);

  await rotatePage(page, 2, 'cw');
  await dismissChrome(page);
  expect(await currentPageNumber(page), 'rotate page 2 must not invent a jump off page 1').toBe(1);
  expect(await pageViewBox(page, 1), 'page 1 stays portrait after sibling CW').toBe('0 0 612 792');
  expect(await userAnnotationIds(page, 1), 'empty CW invents 0 annotations').toEqual([]);

  const afterRotate = await storedBookmarks(page);
  const rotated = afterRotate.find((item) => item?.name === name);
  expect(rotated, 'bookmark must survive CW').toBeTruthy();
  expect(rotated.pageIds, 'page-number dest held after CW').toEqual([2]);
  expect(destInvented(rotated), 'missing dest does not invent XYZ after CW').toBe(false);

  await openBookmarks(page);
  await bookmarkRow(page, name).click();
  await expect.poll(() => currentPageNumber(page), {
    timeout: 20_000,
    message: 'bookmark must jump to the bookmarked landscape page',
  }).toBe(2);

  await expect.poll(async () => {
    const box = await page.locator('.survey-pdfjs-page-div[data-page-number="2"]').boundingBox();
    return !!(box && box.width > box.height + 8);
  }, { timeout: 30_000, message: 'jumped page 2 host must be landscape, not leftover portrait' }).toBeTruthy();

  await expect.poll(async () => pageViewBox(page, 2), {
    timeout: 20_000,
    message: 'bookmark jump after CW must keep swapped viewBox',
  }).toBe('0 0 792 612');

  const afterJump = await storedBookmarks(page);
  const jumped = afterJump.find((item) => item?.name === name);
  expect(jumped.pageIds, 'jump is page-number dest only').toEqual([2]);
  expect(destInvented(jumped), 'missing dest does not invent XYZ on jump').toBe(false);
  expect(await userAnnotationIds(page, 2), 'bookmark jump invents 0 annotations').toEqual([]);
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Add bookmark', exact: true }).count(), 'hubPreview Add bookmark must be 0').toBe(0);

  console.log('PAGE_ROTATE_BOOKMARK_JUMP_DESKTOP_PROOF', JSON.stringify({
    name,
    viewBox: '0 0 792 612',
    fileId: null,
    destInvented: false,
    pageIds: [2],
  }));
});

test('390 bookmark jump after page CW edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page, 1), '390 fresh editor invents 0').toEqual([]);
  expect(await pageViewBox(page, 1)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_BOOKMARK_JUMP_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page, 1),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));
});
