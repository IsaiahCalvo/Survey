import { test, expect } from '@playwright/test';

// Fidelity gap: pickers-every-swatch wrote annotationsByPage_* / callouts_*
// on ?testPdf= but never reloaded. Cloud save stays leftover-18 X-01.
// This is the reachable local fixture save path (no file.id).

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const OTHER_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1';

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
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/ERR_ABORTED|interrupted|destroyed/i.test(message) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(400);
    }
  }
  if (lastError) throw lastError;
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function activateTool(page, categoryName, toolName) {
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.getByRole('button', { name: toolName, exact: true }).first();
  await expect(again).toBeVisible();
  if ((await again.getAttribute('aria-pressed')) !== 'true') await again.click();
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: object.left ?? data.left ?? null,
        top: object.top ?? data.top ?? null,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function localCache(page) {
  return page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('annotationsByPage_') || key.startsWith('callouts_'))) {
        keys.push(key);
      }
    }
    const pageKeys = keys.filter((key) => key.startsWith('annotationsByPage_'));
    const objects = [];
    for (const key of pageKeys) {
      let parsed = null;
      try { parsed = JSON.parse(localStorage.getItem(key) || '{}'); } catch { parsed = null; }
      for (const page of Object.values(parsed || {})) {
        for (const object of page?.objects || []) {
          objects.push({
            key,
            id: object?.id || object?.data?.id || null,
            type: String(object?.type || object?.data?.type || '').toLowerCase(),
          });
        }
      }
    }
    return {
      keys,
      pageKeys,
      objects,
      fileId: window.__devTestPdf?.id ?? null,
    };
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
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await assertNoErrorBoundary(page);
}

async function drawRect(page, box = { x0: 0.22, y0: 0.28, x1: 0.40, y1: 0.46 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, box);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
}

test('?testPdf= local fixture save / reload-restore intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await openEditor(page, { keepOnReload: true });
  await assertNoErrorBoundary(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');

  const emptyBefore = await userAnnotationSnapshot(page);
  const emptyCache = await localCache(page);
  expect(emptyBefore.filter((row) => row.type === 'rect' || row.type === 'rectangle').length).toBe(0);

  // Intended: draw a rect; localStorage writes the local cache (not leftover-18).
  const rect = await drawRect(page);
  expect(rect?.id).toBeTruthy();
  await expect.poll(async () => {
    const cache = await localCache(page);
    return cache.objects.some((object) => object.id === rect.id);
  }, { timeout: 10_000 }).toBe(true);
  const saved = await localCache(page);
  expect(saved.fileId, 'must not stamp file.id on ?testPdf=').toBeNull();
  expect(saved.pageKeys.some((key) => key.startsWith('annotationsByPage_clickable-link-test.pdf-'))).toBe(true);

  // Intended: reload restores the same live id + geometry. file.id stays null.
  await reloadEditor(page);
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === rect.id);
  }, { timeout: 20_000 }).toBe(true);
  const restored = (await userAnnotationSnapshot(page)).find((row) => row.id === rect.id);
  expect(restored, 'reload must restore the drawn rect').toBeTruthy();
  expect(Math.abs((restored.left ?? 0) - (rect.left ?? 0))).toBeLessThan(2);
  expect(Math.abs((restored.top ?? 0) - (rect.top ?? 0))).toBeLessThan(2);
  expect(Math.abs((restored.width ?? 0) - (rect.width ?? 0))).toBeLessThan(4);
  expect(Math.abs((restored.height ?? 0) - (rect.height ?? 0))).toBeLessThan(4);
  const afterReload = await localCache(page);
  expect(afterReload.fileId).toBeNull();

  // Break: Pen-armed reload still restores (Pen does not clobber local cache).
  await activateTool(page, 'Draw', 'Pen');
  await reloadEditor(page);
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === rect.id);
  }, { timeout: 20_000 }).toBe(true);

  // Edge: zoom viewBox is SVG-owned; reload keeps the restored rect.
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true });
  if (await zoomIn.isVisible().catch(() => false)) {
    await zoomIn.click();
  }
  await reloadEditor(page);
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === rect.id);
  }, { timeout: 20_000 }).toBe(true);
  const viewBoxAfter = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBoxAfter).toBe('0 0 612 792');

  // Edge: second rect after reload does not drop the first.
  const second = await drawRect(page, { x0: 0.50, y0: 0.30, x1: 0.68, y1: 0.48 });
  expect(second?.id).toBeTruthy();
  expect(second.id).not.toBe(rect.id);
  await reloadEditor(page);
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.filter((row) => row.id === rect.id || row.id === second.id).length;
  }, { timeout: 20_000 }).toBe(2);

  // Edge: a different fixture does not import the clickable-link local cache.
  await keepLocalSave(page);
  await openEditor(page, { url: OTHER_PDF, keepOnReload: true, width: 1440, height: 900 });
  const otherRows = await userAnnotationSnapshot(page);
  expect(otherRows.some((row) => row.id === rect.id || row.id === second.id)).toBe(false);
  const otherCache = await localCache(page);
  expect(otherCache.fileId).toBeNull();
  expect(otherCache.keys.some((key) => key.includes('clickable-link-test.pdf'))).toBe(true);

  // Break: missing cache key restores empty (no invented marks).
  await keepLocalSave(page);
  await openEditor(page, { url: LINK_PDF, keepOnReload: true });
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('annotationsByPage_')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  });
  await reloadEditor(page);
  const missingRows = await userAnnotationSnapshot(page);
  expect(missingRows.filter((row) => row.id === rect.id || row.id === second.id).length).toBe(0);

  // Intended again after wipe: a fresh rect persists.
  const third = await drawRect(page, { x0: 0.24, y0: 0.52, x1: 0.42, y1: 0.68 });
  expect(third?.id).toBeTruthy();
  await reloadEditor(page);
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === third.id);
  }, { timeout: 20_000 }).toBe(true);

  // Break: corrupt JSON does not crash the editor and invents no marks.
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('annotationsByPage_')) keys.push(key);
    }
    keys.forEach((key) => localStorage.setItem(key, '{not-json'));
  });
  await reloadEditor(page);
  await assertNoErrorBoundary(page);
  const corruptRows = await userAnnotationSnapshot(page);
  expect(corruptRows.some((row) => row.id === third.id)).toBe(false);
  const corruptFileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(corruptFileId).toBeNull();

  // Edge: 390 restores the same local path after a clean draw.
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('annotationsByPage_') || key.startsWith('callouts_'))) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem('e2e-keep-local-save');
  });
  await openEditor(page, { width: 390, height: 844, keepOnReload: true });
  const mobileRect = await drawRect(page, { x0: 0.20, y0: 0.32, x1: 0.55, y1: 0.50 });
  expect(mobileRect?.id).toBeTruthy();
  await reloadEditor(page);
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === mobileRect.id);
  }, { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();

  // Contrast: hubPreview is not the local annotation cache (no Draw / no file.id).
  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();

  console.log('TESTPDF_LOCAL_SAVE_RELOAD', JSON.stringify({
    emptyUserRects: emptyBefore.length,
    emptyPageKeys: emptyCache.pageKeys,
    rectId: rect.id,
    secondId: second.id,
    thirdId: third.id,
    mobileId: mobileRect.id,
    savedKeys: saved.pageKeys,
    fileId: afterReload.fileId,
    viewBox,
    viewBoxAfter,
    leftover18CloudSave: 'unchanged',
  }));
});
