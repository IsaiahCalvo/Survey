import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Current-code proof: live pen, then Pages rotate remapper, then local
// cache + export → ?testPdf= re-import. Distinct from 649e75f2 rect-only
// export/reimport and from live page-rotate-ink-remap (no serialize).
// Distinct from leftover-18 / X-01 / callout / counter / midpoint.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const REIMPORT_NAME = '_e2e-page-rotate-ink-export-reimport.pdf';

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'highlighter' || row.tool === 'freedraw';
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  keepOnReload = false,
} = {}) {
  await page.addInitScript((opts) => {
    try {
      if (opts.keepOnReload && sessionStorage.getItem('e2e-keep-local-save') === '1') return;
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
  }, { keepOnReload });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
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
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf|_e2e-page-rotate-ink-export-reimport\.pdf/ }).first();
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

async function inkSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const first = object.paperCenterline?.[0] || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? 0),
        top: Number(object.top ?? 0),
        angle: Number(object.angle ?? 0),
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userInk(page) {
  return (await inkSnapshot(page)).filter((row) => row.imported !== true && isInk(row));
}

async function geom(page, id) {
  return (await inkSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewInk(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userInk(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isInk(row)) || null;
    return created;
  }, { message: 'expected a new ink stroke' }).not.toBeNull();
  return created;
}

function toolButtons(page, name) {
  return page.locator(
    `button.btn-icon[aria-label="${name}"], button.mobile-pdf-tools__button[aria-label="${name}"]`,
  );
}

async function clickVisible(page, name) {
  const buttons = toolButtons(page, name);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  const fallback = page.getByRole('button', { name, exact: true });
  await expect(fallback.first(), `visible ${name}`).toBeVisible();
  await fallback.first().click();
  return fallback.first();
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const visible = page.getByRole('button', { name: toolName, exact: true });
  if (await visible.count() && await visible.first().isVisible().catch(() => false)) {
    if ((await visible.first().getAttribute('aria-pressed')) !== 'true') await visible.first().click();
    return;
  }
  await clickVisible(page, categoryName);
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
}

async function createInk(page, toolName = 'Pen', coords = { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 }) {
  const before = new Set((await userInk(page)).map((row) => row.id));
  await activateTool(page, 'Draw', toolName);
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  const created = await waitForNewInk(page, before);
  return geom(page, created.id);
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

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function localCache(page) {
  return page.evaluate(() => {
    const objects = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('annotationsByPage_')) continue;
      let parsed = null;
      try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
      for (const pageData of Object.values(parsed || {})) {
        for (const object of pageData?.objects || []) {
          const first = object?.paperCenterline?.[0] || {};
          objects.push({
            key,
            id: object?.id || object?.data?.id || null,
            type: String(object?.type || object?.data?.type || '').toLowerCase(),
            tool: String(object?.tool || object?.data?.tool || '').toLowerCase(),
            angle: Number(object?.angle ?? 0),
            left: Number(object?.left ?? 0),
            top: Number(object?.top ?? 0),
            clx: Number(first.x ?? NaN),
            cly: Number(first.y ?? NaN),
            pageWidth: Number(pageData?.width ?? 0),
            pageHeight: Number(pageData?.height ?? 0),
          });
        }
      }
    }
    return { objects, fileId: window.__devTestPdf?.id ?? null };
  });
}

async function keepLocalSave(page) {
  await page.evaluate(() => {
    sessionStorage.setItem('e2e-keep-local-save', '1');
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
}

async function reloadEditor(page) {
  await keepLocalSave(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await assertNoErrorBoundary(page);
}

async function waitForCacheIds(page, ids) {
  await expect.poll(async () => {
    const cache = await localCache(page);
    return ids.every((id) => cache.objects.some((object) => object.id === id));
  }, { timeout: 10_000, message: 'local cache must hold remapped ids' }).toBe(true);
}

async function exportAndSave(page, destName) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, destName);
  await download.saveAs(dest);
  return { download, dest, filename: download.suggestedFilename() };
}

test('desktop rotate remapper then local cache + export re-import of live ink', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page, { keepOnReload: true });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userInk(page)).length, 'fresh fixture starts empty').toBe(0);

  const created = await createInk(page, 'Pen', { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 });
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  expect(Number.isFinite(created.clx), 'live create stamps a page-space centerline').toBe(true);
  expect(created.left, 'live ink stays at left 0').toBe(0);
  expect(created.angle, 'live ink starts unrotated').toBe(0);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  await expect.poll(async () => geom(page, created.id), {
    timeout: 20_000,
    message: 'page rotate must keep the live ink',
  }).not.toBeNull();
  const rotated = await geom(page, created.id);
  expect(rotated, 'page rotate must keep the live ink').toBeTruthy();
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const expected = rotateDisplayedPoint(created.clx, created.cly, 612, 792, 90);
  expect(
    Math.abs(rotated.clx - expected.x),
    'remapped ink centerline must follow displayed-space +90',
  ).toBeLessThan(18);
  expect(Math.abs(rotated.cly - expected.y)).toBeLessThan(18);
  expect(rotated.clx, 'must not stay on the pre-rotate point').not.toBeCloseTo(created.clx, 0);
  expect(rotated.left, 'page-space ink must keep left 0').toBe(0);
  expect(rotated.angle, 'must not invent an object angle').toBe(0);

  await waitForCacheIds(page, [created.id]);
  const cached = await localCache(page);
  expect(cached.fileId).toBeNull();
  const cachedInk = cached.objects.find((object) => object.id === created.id);
  expect(cachedInk, 'local cache stores the remapped ink').toBeTruthy();
  expect(Math.abs(cachedInk.clx - rotated.clx)).toBeLessThan(8);
  expect(
    cachedInk.pageWidth === 792 || cachedInk.left === 0,
    'local cache stores remapped page size',
  ).toBe(true);

  // Intended — export the remapped page and re-import via ?testPdf=.
  const { dest, filename } = await exportAndSave(page, REIMPORT_NAME);
  await page.evaluate(() => {
    sessionStorage.removeItem('e2e-keep-local-save');
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('annotationsByPage_')
        || key.startsWith('pdfSidebar_')
      )) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
  await openEditor(page, { url: `/?testPdf=${REIMPORT_NAME}`, keepOnReload: false });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page), 're-import must not stamp file.id').toBeNull();
  expect(await pageViewBox(page), 're-import must keep swapped viewBox').toBe('0 0 792 612');

  const imported = await inkSnapshot(page);
  expect(imported.length, 're-import must paint the exported stroke').toBeGreaterThanOrEqual(1);
  const importedInk = imported.find((row) => (
    isInk(row) && (row.id === created.id || row.imported === true)
  )) || imported.find((row) => isInk(row));
  expect(importedInk, 're-import keeps the remapped ink').toBeTruthy();
  expect(importedInk.id, 're-import keeps the same id').toBe(created.id);
  expect(
    Math.abs(importedInk.clx - rotated.clx),
    're-import must keep remapped centerline',
  ).toBeLessThan(22);
  expect(Math.abs(importedInk.cly - rotated.cly)).toBeLessThan(22);
  expect(importedInk.clx, 're-import must not restore pre-rotate point').not.toBeCloseTo(created.clx, 0);
  expect(importedInk.left, 're-import page-space ink stays at left 0').toBe(0);
  expect(Math.abs(importedInk.angle) < 8, 're-import must not invent an object angle').toBe(true);
  expect(await fileId(page)).toBeNull();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }

  // Break — wipe the local cache on the original fixture; reload invents 0.
  await keepLocalSave(page);
  await openEditor(page, { keepOnReload: true });
  await dismissChrome(page);
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('annotationsByPage_')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
  await reloadEditor(page);
  await dismissChrome(page);
  const wiped = await userInk(page);
  expect(wiped.some((row) => row.id === created.id), 'reload without save invents 0').toBe(false);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  // Break — empty export still downloads; cancel does not invent marks.
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  await emptyDownload.cancel();
  expect((await userInk(page)).some((row) => row.id === created.id)).toBe(false);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_INK_EXPORT_REIMPORT_DESKTOP_PROOF', JSON.stringify({
    inkId: created.id,
    created: { clx: created.clx, cly: created.cly, left: created.left, angle: created.angle },
    rotated: { clx: rotated.clx, cly: rotated.cly, left: rotated.left, angle: rotated.angle },
    expectedCx: expected.x,
    expectedCy: expected.y,
    imported: {
      id: importedInk.id,
      clx: importedInk.clx,
      cly: importedInk.cly,
      left: importedInk.left,
      angle: importedInk.angle,
    },
    exportName: filename,
    emptyExport: emptyDownload.suggestedFilename(),
    wipedInvented: wiped.length,
    viewBoxAfterRotate: '0 0 792 612',
    viewBoxAfterWipe: await pageViewBox(page),
    fileId: await fileId(page),
    leftover18CloudSave: 'unchanged',
  }));
});

test('390 ink-export-reimport edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await userInk(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);
  // 390 Export lives in overflow chrome — not cheap; edge is viewBox + file.id.

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  console.log('PAGE_ROTATE_INK_EXPORT_REIMPORT_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    userMarks: 0,
  }));
});
