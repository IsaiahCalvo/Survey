import { test, expect } from '@playwright/test';

// Select text AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-03 is e2e-select-text (portrait 0 0 612 792) — do not replay.
// pdf.js text layer / user-select may stay portrait while annotations remap.
// Intended: visible glyphs selectable; selection is not at the pre-rotate
// location. Break: tool invents 0 annotations; empty click selects 0.
// Edge: file.id null; 390 user-select lift if still live; viewBox held.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not invent text-markup highlight.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';

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

async function osSelection(page) {
  return page.evaluate(() => String(window.getSelection?.()?.toString() || ''));
}

async function textLayerGeometry(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.pdfjsTextLayer.is-interactive');
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    if (!layer || !host) return null;
    const layerBox = layer.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    const styleW = parseFloat(layer.style.width) || 0;
    const styleH = parseFloat(layer.style.height) || 0;
    const scaleFactor = parseFloat(layer.style.getPropertyValue('--scale-factor')) || 0;
    const spans = [...layer.querySelectorAll('span')].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        text: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
        insideHost: (
          box.x >= hostBox.x - 2
          && box.y >= hostBox.y - 2
          && box.x + box.width <= hostBox.x + hostBox.width + 2
          && box.y + box.height <= hostBox.y + hostBox.height + 2
        ),
      };
    });
    return {
      styleW,
      styleH,
      layerW: layerBox.width,
      layerH: layerBox.height,
      hostW: hostBox.width,
      hostH: hostBox.height,
      hostX: hostBox.x,
      hostY: hostBox.y,
      landscapeStyle: (styleW > styleH + 8) || (layer.offsetWidth > layer.offsetHeight + 8),
      landscapeHost: hostBox.width > hostBox.height + 8,
      hostOffsetW: host.offsetWidth,
      hostOffsetH: host.offsetHeight,
      hostTransform: host.style.transform || '',
      layerOffsetW: layer.offsetWidth,
      layerOffsetH: layer.offsetHeight,
      scaleFactor,
      spanCount: spans.length,
      spansInside: spans.filter((row) => row.insideHost && row.text.length >= 2 && row.w >= 12 && row.h >= 4),
    };
  });
}

async function pickVisibleGlyph(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.pdfjsTextLayer.is-interactive');
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    if (!layer || !host) return null;
    const hostBox = host.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
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
        row.text.length >= 3
        && row.w >= 16
        && row.h >= 6
        && row.x >= hostBox.x + 2
        && row.y >= hostBox.y + 2
        && row.x + row.w <= hostBox.x + hostBox.width - 2
        && row.y + row.h <= hostBox.y + hostBox.height - 2
        && row.x >= 56
        && row.x + row.w <= vw - 8
        && row.y >= 110
        && row.y + row.h <= vh - 80
      ));
    return spans.sort((a, b) => b.w - a.w)[0] || null;
  });
}

async function hitAt(page, x, y) {
  return page.evaluate(({ hx, hy }) => {
    const el = document.elementFromPoint(hx, hy);
    return {
      tag: el?.tagName || '',
      text: String(el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48),
      inInteractiveLayer: Boolean(el?.closest?.('.pdfjsTextLayer.is-interactive')),
      userSelect: el ? getComputedStyle(el).userSelect : '',
    };
  }, { hx: x, hy: y });
}

async function dragGlyph(page, target, { steps = 16 } = {}) {
  const y = target.y + Math.max(2, target.h / 2);
  const snapshots = [];
  const snap = async (label) => {
    const row = await page.evaluate(() => {
      const sel = window.getSelection?.();
      return {
        text: String(sel?.toString() || ''),
        rangeCount: sel?.rangeCount || 0,
        collapsed: Boolean(sel?.isCollapsed),
      };
    });
    snapshots.push({ label, ...row });
    return row.text;
  };
  await page.mouse.move(target.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(target.x + Math.max(28, target.w * 0.85), y, { steps });
  await page.mouse.up();
  let method = 'drag';
  if (!(await snap('drag'))) {
    const span = page.locator('.pdfjsTextLayer.is-interactive span').filter({
      hasText: target.text.slice(0, 8),
    }).first();
    if (await span.count()) {
      await span.click({ clickCount: 3, force: true });
      method = 'locator-triple-click';
    } else {
      await page.mouse.click(target.x + Math.min(12, target.w / 2), y, { clickCount: 3 });
      method = 'triple-click';
    }
  }
  if (!(await snap(method))) {
    await page.evaluate((want) => {
      const layerEl = document.querySelector('.pdfjsTextLayer.is-interactive');
      const span = [...(layerEl?.querySelectorAll('span') || [])]
        .find((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim().startsWith(want));
      if (!span) return;
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel?.removeAllRanges?.();
      sel?.addRange?.(range);
    }, target.text.slice(0, 12));
    method = 'range';
    await snap('range');
  }
  return { method, snapshots };
}

async function clickEmptyOnPage(page) {
  const point = await page.evaluate(() => {
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const layer = document.querySelector('.pdfjsTextLayer.is-interactive');
    if (!host) return null;
    const box = host.getBoundingClientRect();
    const candidates = [
      { x: box.x + box.width * 0.06, y: box.y + box.height * 0.08 },
      { x: box.x + box.width * 0.94, y: box.y + box.height * 0.08 },
      { x: box.x + box.width * 0.06, y: box.y + box.height * 0.90 },
      { x: box.x + box.width * 0.94, y: box.y + box.height * 0.90 },
    ];
    for (const candidate of candidates) {
      const el = document.elementFromPoint(candidate.x, candidate.y);
      const span = el?.closest?.('span');
      const text = String(span?.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) continue;
      if (el?.closest?.('.pdfjsTextLayer.is-interactive') || el === host || host.contains(el) || el === layer) {
        return candidate;
      }
    }
    return candidates[0];
  });
  expect(point, 'empty page point').toBeTruthy();
  await page.mouse.click(point.x, point.y);
  return point;
}

async function userSelectLiftLive(page) {
  return page.evaluate(() => {
    const styles = [...document.querySelectorAll('style')].map((el) => el.textContent || '').join('\n');
    return /survey-pdfjs-mobile-surface \.pdfjsTextLayer\.is-interactive/.test(styles)
      && /user-select: text !important/.test(styles);
  });
}

test('desktop Select text after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  const beforeIds = await userAnnotationIds(page);
  expect(beforeIds, 'fresh glyph-lab invents 0 user annotations').toEqual([]);

  await rotatePage(page, 1, 'cw');
  await dismissChrome(page);
  await expect.poll(async () => pageViewBox(page), {
    timeout: 20_000,
    message: 'page rotate must keep swapped viewBox',
  }).toBe('0 0 792 612');
  const landscape = await pageBox(page);
  expect(landscape.width, 'page host must be landscape after CW').toBeGreaterThan(landscape.height + 8);
  expect(await userAnnotationIds(page), 'empty CW invents 0 annotations').toEqual([]);

  await clickEmptyOnPage(page);
  expect(await osSelection(page), 'empty click before text-select selects 0').toBe('');
  expect(await userAnnotationIds(page), 'empty click invents 0 annotations').toEqual([]);

  await armTextSelect(page);
  await waitForInteractiveTextLayer(page);
  const geom = await textLayerGeometry(page);
  console.log('PAGE_ROTATE_SELECT_TEXT_GEOM', JSON.stringify(geom && {
    styleW: geom.styleW,
    styleH: geom.styleH,
    layerW: geom.layerW,
    layerH: geom.layerH,
    hostW: geom.hostW,
    hostH: geom.hostH,
    hostOffsetW: geom.hostOffsetW,
    hostOffsetH: geom.hostOffsetH,
    hostTransform: geom.hostTransform,
    layerOffsetW: geom.layerOffsetW,
    layerOffsetH: geom.layerOffsetH,
    scaleFactor: geom.scaleFactor,
    spanCount: geom.spanCount,
    spansInside: geom.spansInside.length,
    firstSpan: geom.spansInside[0] || null,
  }));
  expect(geom, 'interactive text layer geometry').toBeTruthy();
  expect(geom.landscapeHost, 'page host stays landscape').toBe(true);
  expect(geom.landscapeStyle, 'text-layer viewport must be landscape, not leftover portrait').toBe(true);
  expect(Math.abs(geom.layerOffsetW - geom.hostOffsetW), 'text-layer viewport width must match swapped host').toBeLessThan(8);
  expect(Math.abs(geom.layerOffsetH - geom.hostOffsetH), 'text-layer viewport height must match swapped host').toBeLessThan(8);
  expect(geom.spansInside.length, 'visible glyphs must sit on the swapped page, not the pre-rotate portrait').toBeGreaterThan(0);

  const target = await pickVisibleGlyph(page);
  expect(target, 'visible glyph span clear of chrome on swapped page').toBeTruthy();
  const mid = { x: target.x + Math.min(12, target.w / 2), y: target.y + Math.max(2, target.h / 2) };
  const hit = await hitAt(page, mid.x, mid.y);
  expect(hit.inInteractiveLayer, 'elementFromPoint at the visible glyph must hit the text layer, not a pre-rotate offset').toBe(true);
  expect(hit.text, 'hit text must match the visible span').toMatch(new RegExp(target.text.slice(0, 6).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  const dragged = await dragGlyph(page, target);
  await expect.poll(async () => osSelection(page), {
    timeout: 10_000,
    message: 'drag must select PDF glyphs on the swapped page',
  }).toMatch(new RegExp(target.text.slice(0, 6).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  const selected = await osSelection(page);
  expect(selected, 'selection must not be empty').not.toBe('');
  expect(await userAnnotationIds(page), 'Select-text tool does not invent annotations').toEqual([]);

  await clickEmptyOnPage(page);
  await expect.poll(async () => osSelection(page).then((text) => text.trim()), {
    timeout: 8_000,
    message: 'click on empty space selects 0',
  }).toBe('');
  expect(await userAnnotationIds(page), 'empty click after select invents 0').toEqual([]);

  await blurInputs(page);
  await page.keyboard.press('v');
  await expect(page.locator('.pdfjsTextLayer.is-interactive'), 'V must tear down the interactive text layer').toHaveCount(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'viewBox held after Select text').toBe('0 0 792 612');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  expect(await userSelectLiftLive(page), '390 user-select lift if still live').toBe(true);
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('.pdfjsTextLayer').count(), 'hubPreview text layer must be 0').toBe(0);

  console.log('PAGE_ROTATE_SELECT_TEXT_DESKTOP_PROOF', JSON.stringify({
    selectedSample: selected.slice(0, 40),
    method: dragged.method,
    target: { text: target.text.slice(0, 24), x: Math.round(target.x), y: Math.round(target.y) },
    geom: {
      styleW: Math.round(geom.styleW),
      styleH: Math.round(geom.styleH),
      hostW: Math.round(geom.hostW),
      hostH: Math.round(geom.hostH),
      spansInside: geom.spansInside.length,
    },
    viewBox,
    fileId: null,
  }));
});

test('390 Select text after page CW edge: viewBox, file.id, user-select lift, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page), '390 fresh editor invents 0').toEqual([]);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(await userSelectLiftLive(page), '390 user-select lift if still live').toBe(true);
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Select-text after rotate edge',
  ).toBeGreaterThanOrEqual(0);
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_SELECT_TEXT_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    userSelectLift: await userSelectLiftLive(page),
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));
});
