import { test, expect } from '@playwright/test';

// Eraser Size used to be session-only while Type persisted.
// After remount, first swipe used default diameter 20 until Size was
// touched. Distinct from leftover-18, D-04 every-preset catalog,
// remapped Size after page CW, and Cloud Bump persist.
// Do not click swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const LIVE_SIZE = 40;
const BOX = { x0: 0.18, y0: 0.62, x1: 0.46, y1: 0.64 };

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  wipe = true,
} = {}) {
  await page.addInitScript((shouldWipe) => {
    try {
      if (sessionStorage.getItem('e2e-keep-tool-prefs') === '1' || shouldWipe === false) return;
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
      localStorage.removeItem('lastReviewTool');
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
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  }, wipe);
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

async function remountKeepingPrefs(page) {
  await page.evaluate(() => {
    try { sessionStorage.setItem('e2e-keep-tool-prefs', '1'); } catch { /* ignore */ }
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
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

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
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

async function activateTool(page, categoryName, toolName) {
  const hostTool = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true }).first();
  if (!(await hostTool.isVisible().catch(() => false))) {
    const buttons = page.getByRole('button', { name: categoryName, exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      if (await buttons.nth(i).isVisible().catch(() => false)) {
        await buttons.nth(i).click();
        break;
      }
    }
  }
  if (await hostTool.isVisible().catch(() => false)) {
    if ((await hostTool.getAttribute('aria-pressed')) !== 'true') await hostTool.click();
    return;
  }
  const mobile = page.getByRole('button', { name: toolName, exact: true });
  const count = await mobile.count();
  for (let i = 0; i < count; i += 1) {
    const btn = mobile.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const pressed = await btn.getAttribute('aria-pressed');
    if (pressed === 'true') return;
    await btn.click();
    return;
  }
  await expect(hostTool, `tool ${toolName}`).toBeVisible();
}

function sizeField(page) {
  return page.getByRole('textbox', { name: 'Size', exact: true });
}

function widthField(page) {
  return page.getByRole('textbox', { name: 'Width', exact: true });
}

async function activateEraser(page) {
  await activateTool(page, 'Draw', 'Partial erase');
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
  await expect(sizeField(page)).toBeVisible({ timeout: 8_000 });
}

async function activatePen(page) {
  await activateTool(page, 'Draw', 'Pen');
  await expect(widthField(page)).toBeVisible({ timeout: 8_000 });
}

async function setSize(page, raw) {
  const field = sizeField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function containerAwareScale(page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const svg = document.querySelector('[data-svg-annotation-layer="1"] svg, [data-svg-annotation-layer="1"]');
    const viewBox = svg?.viewBox?.baseVal;
    const pageWidth = viewBox?.width || 0;
    const offsetWidth = pageEl?.offsetWidth || 0;
    return {
      offsetWidth,
      pageWidth,
      effectiveScale: pageWidth > 0 ? offsetWidth / pageWidth : 0,
    };
  });
}

async function measureCursor(page, expectedDiameter) {
  const wrapper = page.locator('[data-diag-eraser-wrapper="1"]');
  await expect(wrapper).toBeVisible();
  const box = await wrapper.boundingBox();
  expect(box, 'eraser wrapper geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.40);
  const scale = await containerAwareScale(page);
  let cursor = null;
  await expect.poll(async () => {
    cursor = await page.locator('[data-eraser-cursor="true"]').evaluateAll((nodes) => {
      const visible = nodes.find((node) => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && parseFloat(style.width) > 0;
      });
      if (!visible) return null;
      const style = getComputedStyle(visible);
      return { width: parseFloat(style.width), height: parseFloat(style.height) };
    });
    return cursor;
  }, { message: `eraser cursor must appear for diameter ${expectedDiameter}` }).not.toBeNull();
  return { ...cursor, ...scale, expected: expectedDiameter * scale.effectiveScale };
}

async function userInkIds(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
}

async function dragPen(page, boxSpec = BOX) {
  const before = new Set(await userInkIds(page));
  await dismissChrome(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * boxSpec.x0, box.y + box.height * boxSpec.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * boxSpec.x1, box.y + box.height * boxSpec.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const ids = await userInkIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: 'expected a new pen stroke' }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function persistSizeThenFirstSwipe(page) {
  await dismissChrome(page);
  await activateEraser(page);
  await setSize(page, LIVE_SIZE);
  await expect(sizeField(page)).toHaveValue(String(LIVE_SIZE));

  await activatePen(page);
  await expect(sizeField(page), 'Pen omits Eraser Size').toHaveCount(0);
  await expect(widthField(page)).toBeVisible();

  await activateEraser(page);
  await expect(sizeField(page), 'in-session Size must still be 40 after Pen').toHaveValue(String(LIVE_SIZE));

  await remountKeepingPrefs(page);
  await dismissChrome(page);
  await activateEraser(page);
  await expect(
    sizeField(page),
    'remount must restore Size 40 from prefs, not session default 20',
  ).toHaveValue(String(LIVE_SIZE));

  const cursor = await measureCursor(page, LIVE_SIZE);
  expect(cursor.width, 'first swipe cursor must use persisted Size 40').toBeGreaterThan(LIVE_SIZE * cursor.effectiveScale * 0.8);
  expect(Math.abs(cursor.width - cursor.expected), 'cursor diameter uses container-aware scale').toBeLessThan(3);

  await activatePen(page);
  const strokeId = await dragPen(page);
  await activateEraser(page);
  await expect(sizeField(page), 'first swipe after remount must keep Size 40 without touching Size').toHaveValue(String(LIVE_SIZE));
  return { strokeId, cursor };
}

test('desktop Eraser Size persist + first swipe intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const { strokeId, cursor } = await persistSizeThenFirstSwipe(page);
  expect(strokeId, 'pen stroke exists for first-swipe proof').toBeTruthy();
  expect(cursor.effectiveScale, 'scale is offsetWidth / pageWidth').toBeGreaterThan(0);

  await dismissChrome(page);
  const emptyBefore = (await userInkIds(page)).length;
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.80, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.22, { steps: 6 });
  await page.mouse.up();
  expect((await userInkIds(page)).length, 'empty swipe must not invent ink').toBe(emptyBefore);

  await page.evaluate(() => {
    try { sessionStorage.removeItem('e2e-keep-tool-prefs'); } catch { /* ignore */ }
  });
  await openEditor(page);
  await dismissChrome(page);
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await userInkIds(page)).length, 'empty export must not invent ink').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('textbox', { name: 'Size', exact: true }).count()).toBe(0);
});

test('390 Eraser Size persist edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await userInkIds(page)).length).toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('textbox', { name: 'Size', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Eraser type', exact: true }).count()).toBe(0);
});
