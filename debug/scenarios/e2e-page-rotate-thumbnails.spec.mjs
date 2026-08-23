import { test, expect } from '@playwright/test';

// Page thumbnails AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-06 is e2e-thumbnail-click (portrait 0 0 612 792) —
// do not replay left-click navigate / page input.
// After CW the page host is landscape while the Pages-panel preview
// kept leftover 612×792 (306×396 at crisp 0.5).
// Intended: preview + raster follow the live host, not leftover portrait.
// Break: empty CW invents 0 annotations.
// Edge: file.id null; viewBox held.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not replay remappers / Search / Select-text.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('survey-thumbnail-cache-v1');
    } catch { /* ignore */ }
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
    } else {
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf/ }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click({ position: { x: 24, y: 8 } }).catch(() => {});
      }
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await expect.poll(async () => pageCoveredByHub(page), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
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

async function openPageMenu(page, pageNumber = 1) {
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
    rotateCcw: pagesMenu(page).getByText('Rotate counter-clockwise', { exact: true }),
  };
}

async function rotatePage(page, pageNumber, direction = 'cw') {
  const beforeBox = await pageBox(page, pageNumber);
  const items = await openPageMenu(page, pageNumber);
  await (direction === 'cw' ? items.rotateCw : items.rotateCcw).click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => {
    const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
    if (!box) return false;
    const wasPortrait = beforeBox.height > beforeBox.width + 8;
    const nowLandscape = box.width > box.height + 8;
    const nowPortrait = box.height > box.width + 8;
    return wasPortrait ? nowLandscape : nowPortrait;
  }, { timeout: 45_000, message: `page ${pageNumber} should flip aspect after ${direction} rotate` }).toBeTruthy();
  await closeDocumentPanel(page);
  await assertNoErrorBoundary(page);
}

async function thumbGeometry(page, pageNumber = 1) {
  return page.evaluate((n) => {
    const host = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${n}"]`);
    const card = document.querySelector(`#chrome-left-host [data-page-number="${n}"]`);
    const img = card?.querySelector('img');
    const preview = img?.parentElement;
    if (!host || !card) {
      return { missing: true };
    }
    const hostBox = host.getBoundingClientRect();
    const previewBox = preview ? preview.getBoundingClientRect() : null;
    return {
      viewBox: document.querySelector('[data-svg-annotation-layer="1"]')?.getAttribute('viewBox') || '',
      hostW: Math.round(hostBox.width),
      hostH: Math.round(hostBox.height),
      landscapeHost: hostBox.width > hostBox.height + 8,
      previewW: previewBox ? Math.round(previewBox.width) : 0,
      previewH: previewBox ? Math.round(previewBox.height) : 0,
      landscapePreview: !!(previewBox && previewBox.width > previewBox.height + 4),
      leftoverPortraitPreview: !!(previewBox && previewBox.height > previewBox.width + 4 && hostBox.width > hostBox.height + 8),
      imgW: img?.naturalWidth || 0,
      imgH: img?.naturalHeight || 0,
      landscapeImg: !!(img && img.naturalWidth > img.naturalHeight + 2),
      leftoverPortraitImg: !!(img && img.naturalHeight > img.naturalWidth + 2 && hostBox.width > hostBox.height + 8),
    };
  }, pageNumber);
}

test('desktop thumbnails after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userAnnotationIds(page), 'fresh editor invents 0 user annotations').toEqual([]);

  await openPagesPanel(page);
  await expect(pageThumb(page, 1)).toBeVisible({ timeout: 15_000 });
  const before = await thumbGeometry(page);
  expect(before.landscapeHost, 'before CW host is portrait').toBe(false);

  await rotatePage(page, 1, 'cw');
  await dismissChrome(page);
  await expect.poll(async () => pageViewBox(page), {
    timeout: 20_000,
    message: 'page rotate must keep swapped viewBox',
  }).toBe('0 0 792 612');
  expect(await userAnnotationIds(page), 'empty CW invents 0 annotations').toEqual([]);

  await openPagesPanel(page);
  await expect(pageThumb(page, 1)).toBeVisible({ timeout: 15_000 });
  let after = null;
  await expect.poll(async () => {
    const geom = await thumbGeometry(page);
    after = geom;
    return geom.landscapeHost && geom.imgW > 0 && geom.landscapeImg && geom.landscapePreview;
  }, {
    timeout: 30_000,
    message: 'thumbnail preview must follow the swapped landscape host',
  }).toBeTruthy();

  console.log('PAGE_ROTATE_THUMB_GEOM', JSON.stringify({ before, after }));
  expect(after.viewBox, 'thumb overlay viewBox must follow swapped page').toBe('0 0 792 612');
  expect(after.landscapeHost, 'page host stays landscape').toBe(true);
  expect(after.landscapePreview, 'thumbnail preview must be landscape, not leftover portrait').toBe(true);
  expect(after.leftoverPortraitPreview, 'thumbnail preview must not keep the leftover portrait box').toBe(false);
  expect(after.landscapeImg, 'thumbnail image must be landscape, not leftover 612×792').toBe(true);
  expect(after.leftoverPortraitImg, 'thumbnail raster must not stay leftover portrait').toBe(false);
  expect(after.imgW, 'thumbnail raster must have a live width').toBeGreaterThan(after.imgH);
  expect(await userAnnotationIds(page), 'thumbnail refresh does not invent annotations').toEqual([]);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'viewBox held after thumbnails').toBe('0 0 792 612');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('#chrome-left-host [data-page-number]').count(), 'hubPreview thumbs must be 0').toBe(0);

  console.log('PAGE_ROTATE_THUMB_DESKTOP_PROOF', JSON.stringify({
    viewBox,
    fileId: null,
    host: { w: after.hostW, h: after.hostH },
    preview: { w: after.previewW, h: after.previewH },
    img: { w: after.imgW, h: after.imgH },
  }));
});

test('390 thumbnails after page CW edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page), '390 fresh editor invents 0').toEqual([]);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_THUMB_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));
});
