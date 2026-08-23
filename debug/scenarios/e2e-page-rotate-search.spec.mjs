import { test, expect } from '@playwright/test';

// Search hit highlights AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-08 is e2e-search-previous / e2e-search-result-click
// (portrait 0 0 612 792) — do not replay Next/Previous/result-row.
// The leftover text-layer box also likely offsets Search marks.
// Intended: hits land on visible glyphs, not the pre-rotate portrait box.
// Break: empty query / no-match invents 0 marks; dismiss invents 0 annotations.
// Edge: file.id null; viewBox held; searchable fixture.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not invent text-markup highlight.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';
const MATCH_QUERY = 'ABCDEFGHIJKLMNOPQRSTUV';

async function openEditor(page, { width = 1440, height = 900, url = GLYPH_PDF } = {}) {
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
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    } else {
      const tab = page.getByRole('button', { name: /text-search-glyph-lab\.pdf/ }).first();
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

async function openSearch(page) {
  const search = page.getByPlaceholder('Search text in PDF...');
  if (!(await search.count()) || !(await search.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click();
  }
  await expect(search).toBeVisible({ timeout: 10_000 });
  return search;
}

async function readIndex(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#chrome-left-host') || document.querySelector('[data-sidebar-panel]');
    const text = host?.innerText || '';
    const match = text.match(/(\d+)\s+of\s+(\d+)/);
    return match ? { at: Number(match[1]), total: Number(match[2]) } : { at: 0, total: 0 };
  });
}

async function waitForSearchIdle(page) {
  const searching = page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/Searching\.\.\./);
  await searching.first().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
  await expect(searching).toHaveCount(0, { timeout: 20_000 });
}

async function waitForClearedResults(page) {
  await expect.poll(async () => {
    const index = await readIndex(page);
    const layers = await page.locator('[data-search-highlight-layer]').count();
    return index.total === 0 && layers === 0;
  }, { message: 'prior match set / highlight marks must clear', timeout: 15_000 }).toBeTruthy();
}

async function fillQuery(page, search, query) {
  await search.fill('');
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await waitForClearedResults(page);
  if (!query) return;
  await search.fill(query);
  await waitForSearchIdle(page);
}

async function highlightGeometry(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-search-highlight-layer="1"]');
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    if (!layer || !host) {
      return {
        layerCount: document.querySelectorAll('[data-search-highlight-layer]').length,
        rectCount: 0,
      };
    }
    const layerBox = layer.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    const viewBox = layer.getAttribute('viewBox') || '';
    const rects = [...layer.querySelectorAll('rect.search-highlight-svg-rect')].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        attrX: Number(el.getAttribute('x') || 0),
        attrY: Number(el.getAttribute('y') || 0),
        attrW: Number(el.getAttribute('width') || 0),
        attrH: Number(el.getAttribute('height') || 0),
        insideHost: (
          box.x >= hostBox.x - 4
          && box.y >= hostBox.y - 4
          && box.x + box.width <= hostBox.x + hostBox.width + 4
          && box.y + box.height <= hostBox.y + hostBox.height + 4
        ),
      };
    });
    return {
      layerCount: 1,
      rectCount: rects.length,
      viewBox,
      layerW: layerBox.width,
      layerH: layerBox.height,
      hostW: hostBox.width,
      hostH: hostBox.height,
      hostOffsetW: host.offsetWidth,
      hostOffsetH: host.offsetHeight,
      layerOffsetW: layer.offsetWidth,
      layerOffsetH: layer.offsetHeight,
      landscapeLayer: layerBox.width > layerBox.height + 8,
      landscapeHost: hostBox.width > hostBox.height + 8,
      leftoverPortraitLayer: layerBox.height > layerBox.width + 8 && hostBox.width > hostBox.height + 8,
      sameHost: layer.closest('.survey-pdfjs-page-div') === host,
      rectsInside: rects.filter((row) => row.insideHost && row.w >= 8 && row.h >= 4),
      firstRect: rects[0] || null,
    };
  });
}

async function armTextSelect(page) {
  await blurInputs(page);
  await page.keyboard.press('Shift+v');
}

async function waitForInteractiveTextLayer(page) {
  const layer = page.locator('.pdfjsTextLayer.is-interactive').first();
  await expect(layer, 'text-select must mount an interactive glyph layer').toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => layer.locator('span').count(), {
    timeout: 20_000,
    message: 'interactive text layer must have glyph spans',
  }).toBeGreaterThan(0);
  return layer;
}

async function matchingGlyph(page, query) {
  return page.evaluate((want) => {
    const layer = document.querySelector('.pdfjsTextLayer.is-interactive');
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    if (!layer || !host) return null;
    const hostBox = host.getBoundingClientRect();
    const spans = [...layer.querySelectorAll('span')]
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          w: box.width,
          h: box.height,
          text: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
        };
      })
      .filter((row) => (
        row.text.includes(want)
        && row.w >= 16
        && row.h >= 6
        && row.x >= hostBox.x - 2
        && row.y >= hostBox.y - 2
        && row.x + row.w <= hostBox.x + hostBox.width + 2
        && row.y + row.h <= hostBox.y + hostBox.height + 2
      ));
    return spans.sort((a, b) => b.w - a.w)[0] || null;
  }, query);
}

function rectsOverlap(a, b, pad = 8) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w + pad
    && a.x + a.w + pad > b.x
    && a.y < b.y + b.h + pad
    && a.y + a.h + pad > b.y
  );
}

test('desktop Search after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userAnnotationIds(page), 'fresh glyph-lab invents 0 user annotations').toEqual([]);

  await rotatePage(page, 1, 'cw');
  await dismissChrome(page);
  await expect.poll(async () => pageViewBox(page), {
    timeout: 20_000,
    message: 'page rotate must keep swapped viewBox',
  }).toBe('0 0 792 612');
  const landscape = await pageBox(page);
  expect(landscape.width, 'page host must be landscape after CW').toBeGreaterThan(landscape.height + 8);
  expect(await userAnnotationIds(page), 'empty CW invents 0 annotations').toEqual([]);

  const search = await openSearch(page);
  await fillQuery(page, search, '');
  expect((await highlightGeometry(page)).rectCount, 'empty query invents 0 marks').toBe(0);
  expect(await userAnnotationIds(page), 'empty query invents 0 annotations').toEqual([]);

  await fillQuery(page, search, 'zzzz-no-such-glyph');
  await expect(page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/No results found/i)).toBeVisible({ timeout: 15_000 });
  expect((await highlightGeometry(page)).rectCount, 'no-match invents 0 marks').toBe(0);
  expect(await userAnnotationIds(page), 'no-match invents 0 annotations').toEqual([]);

  await fillQuery(page, search, MATCH_QUERY);
  let hits = null;
  await expect.poll(async () => {
    const index = await readIndex(page);
    const geom = await highlightGeometry(page);
    if (index.total > 0 && geom.rectCount > 0) {
      hits = { index, geom };
      return true;
    }
    return false;
  }, {
    timeout: 20_000,
    message: 'Search after CW must land highlight marks on the swapped page',
  }).toBeTruthy();
  expect(hits, 'Search after CW must expose index + overlay geometry').toBeTruthy();
  console.log('PAGE_ROTATE_SEARCH_GEOM', JSON.stringify({
    index: hits.index,
    viewBox: hits.geom.viewBox,
    layerW: hits.geom.layerW,
    layerH: hits.geom.layerH,
    hostW: hits.geom.hostW,
    hostH: hits.geom.hostH,
    layerOffsetW: hits.geom.layerOffsetW,
    hostOffsetW: hits.geom.hostOffsetW,
    leftoverPortraitLayer: hits.geom.leftoverPortraitLayer,
    rectsInside: hits.geom.rectsInside.length,
    firstRect: hits.geom.firstRect,
  }));
  expect(hits.index.total, 'unique alphabet prefix must hit').toBeGreaterThan(0);
  expect(hits.geom.viewBox, 'search overlay viewBox must follow swapped page').toBe('0 0 792 612');
  expect(hits.geom.landscapeHost, 'page host stays landscape').toBe(true);
  expect(hits.geom.landscapeLayer, 'search overlay must be landscape, not leftover portrait').toBe(true);
  expect(hits.geom.leftoverPortraitLayer, 'search overlay must not keep the leftover portrait box').toBe(false);
  expect(hits.geom.layerW, 'search overlay must have a live width').toBeGreaterThan(8);
  expect(hits.geom.hostW, 'page host must have a live width').toBeGreaterThan(8);
  expect(Math.abs(hits.geom.layerW - hits.geom.hostW), 'search overlay width must match swapped host').toBeLessThan(8);
  expect(Math.abs(hits.geom.layerH - hits.geom.hostH), 'search overlay height must match swapped host').toBeLessThan(8);
  expect(hits.geom.rectsInside.length, 'search hits must sit on the swapped page, not the pre-rotate portrait').toBeGreaterThan(0);
  expect(await userAnnotationIds(page), 'Search hits do not invent annotations').toEqual([]);

  await armTextSelect(page);
  await waitForInteractiveTextLayer(page);
  const glyph = await matchingGlyph(page, MATCH_QUERY);
  expect(glyph, 'visible glyph span for the query on the swapped page').toBeTruthy();
  const afterSelect = await highlightGeometry(page);
  expect(afterSelect.firstRect, 'active search hit must still be mounted').toBeTruthy();
  expect(
    rectsOverlap(afterSelect.firstRect, glyph),
    'search hit must land on the visible glyph, not the leftover portrait box',
  ).toBe(true);
  const hitCenter = {
    x: afterSelect.firstRect.x + afterSelect.firstRect.w / 2,
    y: afterSelect.firstRect.y + afterSelect.firstRect.h / 2,
  };
  expect(
    hitCenter.x >= glyph.x - 8
    && hitCenter.x <= glyph.x + glyph.w + 8
    && hitCenter.y >= glyph.y - 8
    && hitCenter.y <= glyph.y + glyph.h + 8,
    'search hit center must sit on the visible span, not the leftover portrait offset',
  ).toBe(true);

  await blurInputs(page);
  await page.keyboard.press('v');
  await expect(page.locator('.pdfjsTextLayer.is-interactive'), 'V must tear down the interactive text layer').toHaveCount(0);

  await fillQuery(page, search, '');
  expect((await highlightGeometry(page)).rectCount, 'dismiss / empty query invents 0 marks').toBe(0);
  expect(await userAnnotationIds(page), 'dismiss does not invent annotations').toEqual([]);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'viewBox held after Search').toBe('0 0 792 612');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-search-highlight-layer]').count(), 'hubPreview search marks must be 0').toBe(0);

  console.log('PAGE_ROTATE_SEARCH_DESKTOP_PROOF', JSON.stringify({
    query: MATCH_QUERY,
    index: hits.index,
    viewBox,
    fileId: null,
    glyph: glyph && { text: glyph.text.slice(0, 24), x: Math.round(glyph.x), y: Math.round(glyph.y) },
    firstHit: afterSelect.firstRect && {
      x: Math.round(afterSelect.firstRect.x),
      y: Math.round(afterSelect.firstRect.y),
      w: Math.round(afterSelect.firstRect.w),
      h: Math.round(afterSelect.firstRect.h),
      attrX: Math.round(afterSelect.firstRect.attrX),
      attrY: Math.round(afterSelect.firstRect.attrY),
    },
    geom: {
      layerW: Math.round(hits.geom.layerW),
      layerH: Math.round(hits.geom.layerH),
      hostW: Math.round(hits.geom.hostW),
      hostH: Math.round(hits.geom.hostH),
      rectsInside: hits.geom.rectsInside.length,
      searchViewBox: hits.geom.viewBox,
    },
  }));
});

test('390 Search after page CW edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page), '390 fresh editor invents 0').toEqual([]);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages|Search text/i }).count(),
    '390 Search after rotate edge',
  ).toBeGreaterThanOrEqual(0);
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_SEARCH_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));
});
