import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Export → ?testPdf= re-import AFTER page CW for ellipse / cloud-rect /
// highlighter. Distinct from 649e75f2 rect, a3e9bcff ink, ed08b9ed callout,
// 1f534deb remaining types. Distinct from leftover-18 / X-01 / save-reload.
// Watch native setAnnotationsByPage strip-on-import. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

const ELLIPSE_BOX = { x0: 0.18, y0: 0.22, x1: 0.42, y1: 0.40 };
const CLOUD_BOX = { x0: 0.48, y0: 0.24, x1: 0.72, y1: 0.42 };
const HIGHLIGHT_BOX = { x0: 0.22, y0: 0.50, x1: 0.44, y1: 0.62 };

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
}

function isEllipse(row) {
  return row.type === 'ellipse' || row.tool === 'ellipse';
}

function isCloudRect(row) {
  return row.kind === 'cloud-rect' || Number.isFinite(row.intensity);
}

function isHighlighter(row) {
  return row.tool === 'highlighter' || row.multiply === 'multiply';
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
        )) keys.push(key);
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

async function annotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const rx = Number(object.rx ?? data.rx ?? 0);
      const ry = Number(object.ry ?? data.ry ?? 0);
      const radius = Number(object.radius ?? data.radius ?? 0);
      const scaleX = Number(object.scaleX ?? data.scaleX ?? 1) || 1;
      const scaleY = Number(object.scaleY ?? data.scaleY ?? 1) || 1;
      const rawW = rx > 0 ? rx * 2 : (radius > 0 ? radius * 2 : Number(object.width ?? data.width ?? 0));
      const rawH = ry > 0 ? ry * 2 : (radius > 0 ? radius * 2 : Number(object.height ?? data.height ?? 0));
      const left = Number(object.left ?? data.left ?? 0);
      const top = Number(object.top ?? data.top ?? 0);
      const first = object.paperCenterline?.[0] || {};
      const intensity = data.pdfCloudIntensity;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        kind: intensity != null ? 'cloud-rect' : String(data.type || object.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        rx,
        ry,
        intensity: intensity != null ? Number(intensity) : null,
        multiply: String(object.globalCompositeOperation || data.globalCompositeOperation || ''),
        vw: rawW * Math.abs(scaleX),
        vh: rawH * Math.abs(scaleY),
        cx: left + (rawW * Math.abs(scaleX)) / 2,
        cy: top + (rawH * Math.abs(scaleY)) / 2,
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
        angle: Number(object.angle ?? data.angle ?? 0),
      };
    }).filter((row) => !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
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

async function pickDesktopStyle(page, label) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(label), exact: true });
  if (await option.count()) await option.click();
  else await popover.getByText(String(label), { exact: true }).click();
  await expect(popover).toHaveCount(0);
}

async function dragOnPage(page, box) {
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * box.x0, geom.y + geom.height * box.y0);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * box.x1, geom.y + geom.height * box.y1, { steps: 10 });
  await page.mouse.up();
}

async function waitCreated(page, pred, before) {
  let created = null;
  await expect.poll(async () => {
    const rows = (await annotationSnapshot(page)).filter((row) => row.imported !== true && pred(row));
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function createEllipse(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isEllipse).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Ellipse');
  await blurInputs(page);
  await dragOnPage(page, ELLIPSE_BOX);
  return waitCreated(page, isEllipse, before);
}

async function createCloudRect(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isCloudRect).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDesktopStyle(page, 'Cloud');
  await blurInputs(page);
  await dragOnPage(page, CLOUD_BOX);
  return waitCreated(page, isCloudRect, before);
}

async function createHighlighter(page) {
  const before = new Set((await annotationSnapshot(page)).filter(isHighlighter).map((row) => row.id));
  await activateTool(page, 'Draw', 'Highlighter');
  await blurInputs(page);
  await dragOnPage(page, HIGHLIGHT_BOX);
  return waitCreated(page, isHighlighter, before);
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
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') await pages.first().click();
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) await rail.first().click();
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
          objects.push({
            id: object?.id || object?.data?.id || null,
            type: String(object?.type || object?.data?.type || '').toLowerCase(),
            intensity: object?.data?.pdfCloudIntensity ?? null,
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

async function wipeAnnotationKeys(page) {
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('annotationsByPage_')
        || key.startsWith('callouts_')
        || key.startsWith('pdfSidebar_')
      )) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
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

function centerOf(row, kind) {
  if (kind === 'highlighter') return { x: row.clx, y: row.cly };
  return { x: row.cx, y: row.cy };
}

async function proveType(page, kind, createFn, pred) {
  const destName = `_e2e-page-rotate-${kind}-export-reimport.pdf`;
  await openEditor(page, { keepOnReload: true });
  await dismissChrome(page);
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createFn(page);
  await dismissChrome(page);
  expect(created?.id).toBeTruthy();
  if (kind === 'cloud-rect') expect(Number.isFinite(created.intensity)).toBe(true);
  if (kind === 'highlighter') {
    expect(created.multiply).toBe('multiply');
    expect(Number.isFinite(created.clx)).toBe(true);
  }

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await expect.poll(async () => (await annotationSnapshot(page)).find((row) => row.id === created.id), {
    timeout: 20_000,
    message: `page rotate must keep the live ${kind}`,
  }).not.toBeNull();
  const remapped = (await annotationSnapshot(page)).find((row) => row.id === created.id);
  const beforeCenter = centerOf(created, kind);
  const remappedCenter = centerOf(remapped, kind);
  const expected = rotateDisplayedPoint(beforeCenter.x, beforeCenter.y, 612, 792, 90);
  expect(Math.abs(remappedCenter.x - expected.x), `remapped ${kind} follows +90`).toBeLessThan(28);
  expect(Math.abs(remappedCenter.y - expected.y)).toBeLessThan(28);
  expect(remappedCenter.x, 'must not stay on the pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);
  if (kind === 'highlighter') expect(remapped.left, 'highlighter left stays 0 after remap').toBe(0);
  if (kind === 'cloud-rect') expect(remapped.intensity).toBe(created.intensity);

  await expect.poll(async () => {
    const cache = await localCache(page);
    return cache.objects.some((object) => object.id === created.id);
  }, { timeout: 10_000, message: 'local cache must hold remapped id' }).toBe(true);
  expect((await localCache(page)).fileId).toBeNull();

  const { dest, filename } = await exportAndSave(page, destName);
  await page.evaluate(() => { sessionStorage.removeItem('e2e-keep-local-save'); });
  await wipeAnnotationKeys(page);
  await openEditor(page, { url: `/?testPdf=${destName}`, keepOnReload: false });
  await dismissChrome(page);
  expect(await fileId(page), 're-import must not stamp file.id').toBeNull();
  expect(await pageViewBox(page), 're-import must keep swapped viewBox').toBe('0 0 792 612');

  let imported = null;
  await expect.poll(async () => {
    imported = (await annotationSnapshot(page)).find((row) => pred(row) && row.id === created.id)
      || (await annotationSnapshot(page)).find((row) => pred(row) && row.imported === true)
      || (await annotationSnapshot(page)).find((row) => pred(row));
    return imported;
  }, { timeout: 20_000, message: `re-import must paint the exported ${kind}` }).not.toBeNull();
  expect(imported.id, `re-import keeps the same ${kind} id`).toBe(created.id);
  const importedCenter = centerOf(imported, kind);
  expect(Math.abs(importedCenter.x - remappedCenter.x), `re-import must keep remapped ${kind}`).toBeLessThan(28);
  expect(Math.abs(importedCenter.y - remappedCenter.y)).toBeLessThan(28);
  expect(importedCenter.x, 're-import must not restore pre-rotate center').not.toBeCloseTo(beforeCenter.x, 0);
  if (kind === 'cloud-rect') expect(Number.isFinite(imported.intensity)).toBe(true);
  if (kind === 'highlighter') expect(imported.multiply === 'multiply' || imported.tool === 'highlighter').toBe(true);
  expect(await fileId(page)).toBeNull();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }

  await keepLocalSave(page);
  await openEditor(page, { keepOnReload: true });
  await dismissChrome(page);
  await wipeAnnotationKeys(page);
  await reloadEditor(page);
  await dismissChrome(page);
  expect(
    (await annotationSnapshot(page)).filter((row) => row.imported !== true).some((row) => row.id === created.id),
    'reload without save invents 0',
  ).toBe(false);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  await emptyDownload.cancel();
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  return {
    kind,
    id: created.id,
    before: beforeCenter,
    remapped: remappedCenter,
    imported: importedCenter,
    expected,
    exportName: filename,
    viewBoxAfterRotate: '0 0 792 612',
    fileId: null,
  };
}

for (const [kind, createFn, pred] of [
  ['ellipse', createEllipse, isEllipse],
  ['cloud-rect', createCloudRect, isCloudRect],
  ['highlighter', createHighlighter, isHighlighter],
]) {
  test(`desktop rotate remapper then export re-import of ${kind}`, async ({ page }) => {
    test.setTimeout(180_000);
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    const proof = await proveType(page, kind, createFn, pred);
    console.log(`PAGE_ROTATE_${kind.toUpperCase().replace('-', '_')}_EXPORT_REIMPORT`, JSON.stringify(proof));
  });
}

test('390 shape-export-reimport edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect((await annotationSnapshot(page)).filter((row) => row.imported !== true).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('PAGE_ROTATE_SHAPE_EXPORT_REIMPORT_390_EDGE', JSON.stringify({
    viewBox: '0 0 612 792',
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));
});
