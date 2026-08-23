import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Persist remapped form widgets AFTER page CW via annotated export →
// ?testPdf= re-import. Live leftover-portrait remap is already
// e2e-page-rotate-form-widgets (type-level). This pass is serialize/
// restore of the baked /Rotate + remapped fractions.
// Do not invent a Forms editor. Do not stamp file.id.
// Distinct from leftover-18 / X-01 / CW annotation catalog.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const REIMPORT_NAME = '_e2e-page-rotate-form-widgets-persist.pdf';
const LEFTOVER_NAME = { fracX: 0.363, fracY: 0.338 };

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
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
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
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
    if (await rail.first().isVisible().catch(() => false)) await rail.first().click();
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

async function waitForWidgets(page) {
  await expect.poll(async () => page.locator('.pdfjsFormLayer input, .pdfjsFormLayer textarea, .pdfjsFormLayer select').count(), {
    timeout: 20_000,
    message: 'form widgets must render',
  }).toBeGreaterThan(0);
}

async function widgetGeometry(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const layer = document.querySelector('.pdfjsFormLayer');
    if (!host || !layer) return { missing: true };
    const hostBox = host.getBoundingClientRect();
    const layerBox = layer.getBoundingClientRect();
    const sections = [...layer.querySelectorAll('section[data-annotation-id]')].map((el) => {
      const box = el.getBoundingClientRect();
      const input = el.querySelector('input, textarea, select');
      return {
        id: el.getAttribute('data-annotation-id') || '',
        type: input?.type || input?.tagName?.toLowerCase() || '',
        fracX: hostBox.width ? (box.x + box.width / 2 - hostBox.x) / hostBox.width : null,
        fracY: hostBox.height ? (box.y + box.height / 2 - hostBox.y) / hostBox.height : null,
        insideHost: (
          box.x >= hostBox.x - 4
          && box.y >= hostBox.y - 4
          && box.x + box.width <= hostBox.x + hostBox.width + 4
          && box.y + box.height <= hostBox.y + hostBox.height + 4
        ),
      };
    });
    const name = sections.find((row) => row.type === 'text') || null;
    return {
      viewBox: document.querySelector('[data-svg-annotation-layer="1"]')?.getAttribute('viewBox') || '',
      hostW: Math.round(hostBox.width),
      hostH: Math.round(hostBox.height),
      layerW: Math.round(layerBox.width),
      layerH: Math.round(layerBox.height),
      landscapeHost: hostBox.width > hostBox.height + 8,
      landscapeLayer: layerBox.width > layerBox.height + 8,
      leftoverPortraitLayer: layerBox.height > layerBox.width + 8 && hostBox.width > hostBox.height + 8,
      widgetCount: sections.length,
      name,
    };
  });
}

async function hitAtHostFraction(page, fracX, fracY) {
  return page.evaluate(({ fx, fy }) => {
    const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    if (!host) return { missing: true };
    const box = host.getBoundingClientRect();
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    const el = document.elementFromPoint(x, y);
    return {
      x,
      y,
      inFormLayer: Boolean(el?.closest?.('.pdfjsFormLayer')),
      isNameInput: el?.tagName === 'INPUT' && el?.type === 'text',
    };
  }, { fx: fracX, fy: fracY });
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
  return { dest, filename: download.suggestedFilename() };
}

function assertRemapped(geom, label) {
  expect(geom.viewBox, `${label} viewBox`).toBe('0 0 792 612');
  expect(geom.landscapeHost, `${label} host landscape`).toBe(true);
  expect(geom.landscapeLayer, `${label} layer landscape`).toBe(true);
  expect(geom.leftoverPortraitLayer, `${label} not leftover portrait layer`).toBe(false);
  expect(geom.name, `${label} name widget`).toBeTruthy();
  expect(geom.name.insideHost, `${label} name on-page`).toBe(true);
  expect(Math.abs(geom.name.fracX - LEFTOVER_NAME.fracX), `${label} left leftover fracX`).toBeGreaterThan(0.12);
  expect(geom.name.fracX, `${label} remapped fracX`).toBeGreaterThan(0.55);
}

test('desktop form widgets persist after CW export→reimport intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page);
  await dismissChrome(page);
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await userAnnotationIds(page), 'fresh editor invents 0').toEqual([]);

  await rotatePage(page, 1, 'cw');
  await dismissChrome(page);
  await expect.poll(async () => pageViewBox(page), {
    timeout: 20_000,
    message: 'CW must swap viewBox',
  }).toBe('0 0 792 612');
  expect(await userAnnotationIds(page), 'empty CW invents 0').toEqual([]);

  await waitForWidgets(page);
  let live = null;
  await expect.poll(async () => {
    live = await widgetGeometry(page);
    return !!(live.landscapeHost && live.name && Math.abs((live.name.fracX ?? 0) - LEFTOVER_NAME.fracX) > 0.12);
  }, { timeout: 30_000, message: 'live widgets must leave leftover portrait fractions' }).toBeTruthy();
  assertRemapped(live, 'live after CW');

  const { dest } = await exportAndSave(page, REIMPORT_NAME);
  await openEditor(page, { url: `/?testPdf=${REIMPORT_NAME}` });
  await dismissChrome(page);
  expect(await fileId(page), 're-import must not stamp file.id').toBeNull();
  await expect.poll(async () => pageViewBox(page), {
    timeout: 20_000,
    message: 're-import must keep swapped viewBox',
  }).toBe('0 0 792 612');

  await waitForWidgets(page);
  let imported = null;
  await expect.poll(async () => {
    imported = await widgetGeometry(page);
    return !!(imported.landscapeHost && imported.name && Math.abs((imported.name.fracX ?? 0) - LEFTOVER_NAME.fracX) > 0.12);
  }, { timeout: 30_000, message: 're-import widgets must stay remapped' }).toBeTruthy();
  assertRemapped(imported, 're-import');
  expect(Math.abs(imported.name.fracX - live.name.fracX), 'persist keeps remapped fracX').toBeLessThan(0.08);
  expect(Math.abs(imported.name.fracY - live.name.fracY)).toBeLessThan(0.08);

  const leftoverHit = await hitAtHostFraction(page, LEFTOVER_NAME.fracX, LEFTOVER_NAME.fracY);
  expect(leftoverHit.isNameInput, 'leftover portrait fraction must miss').toBe(false);
  const remappedHit = await hitAtHostFraction(page, imported.name.fracX, imported.name.fracY);
  expect(remappedHit.isNameInput, 'remapped field stays hittable after re-import').toBe(true);
  await page.mouse.click(remappedHit.x, remappedHit.y);
  await expect(page.locator('.pdfjsFormLayer input[type="text"]').first()).toBeFocused();
  expect(await userAnnotationIds(page), 'widgets invent 0 Survey marks').toEqual([]);
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }

  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);

  console.log('PAGE_ROTATE_FORM_WIDGET_PERSIST', JSON.stringify({
    live: { fracX: live.name.fracX, fracY: live.name.fracY, hostW: live.hostW, hostH: live.hostH },
    imported: { fracX: imported.name.fracX, fracY: imported.name.fracY, viewBox: imported.viewBox },
    fileId: null,
  }));
});

test('390 form-widget persist edge: viewBox, file.id, no invent; hubPreview 0', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);
  expect(await userAnnotationIds(page), '390 fresh editor invents 0').toEqual([]);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  console.log('PAGE_ROTATE_FORM_WIDGET_PERSIST_390', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
  }));

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('.pdfjsFormLayer input').count()).toBe(0);
});
