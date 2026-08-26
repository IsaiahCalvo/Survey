import { test, expect } from '@playwright/test';

// Selected paper-ink Color / Opacity / Width used leftover stroke /
// strokeWidth (transparent / 0) so Select after a sibling tool dropped
// the live fill / sourceWidth until the picker was re-touched, and Color
// patches wrote leftover stroke so the screen stayed the old fill.
// Distinct from leftover-18, selected-shape Fill Opacity 0 sync, Pen /
// Highlighter first-stroke persist, and C-01 swatch / hex / Transparent
// apply. Do not click swatch / hex / Transparent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const LIVE_OPACITY = 40;
const LIVE_WIDTH = 4;
const PATCH_OPACITY = 20;

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
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
  });
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

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return rgba[1] != null ? Number(rgba[1]) : 1;
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function penSnapshot(page, pageNumber = 1, { includeImported = false } = {}) {
  return page.evaluate(({ pageNum, includeImported: keepImported }) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const group = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id="${id}"]`,
      );
      const shape = group?.querySelector('path');
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        fill: object.fill ?? data.fill ?? null,
        stroke: object.stroke ?? null,
        strokeWidth: object.strokeWidth ?? null,
        sourceWidth: object.sourceWidth ?? null,
        visualFill: shape?.getAttribute('fill') || '',
        imported: object.isPdfImported === true,
      };
    }).filter((row) => {
      const isPen = row.tool === 'pen' || (row.type === 'path' && row.tool !== 'highlighter' && row.tool !== 'rect');
      if (!isPen) return false;
      return keepImported || row.imported !== true;
    });
  }, { pageNum: pageNumber, includeImported });
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

async function applyColorOpacity(page, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
  await page.keyboard.press('Escape');
  await expect(presets).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
  await dismissChrome(page);
}

async function openColorOpacity(page) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  return page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
}

async function setWidthTyped(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
  return field;
}

async function createPenAfterStyle(page) {
  const before = new Set((await penSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(250);
  await activateTool(page, 'Draw', 'Pen');
  expect((await penSnapshot(page)).length, 'next-draw style must run before any stroke').toBe(0);
  const widthField = await setWidthTyped(page, LIVE_WIDTH);
  await expect(widthField).toHaveValue(String(LIVE_WIDTH));
  await applyColorOpacity(page, LIVE_OPACITY);
  expect((await penSnapshot(page)).length, 'Color / Width before first stroke must not invent ink').toBe(0);
  await activateTool(page, 'Draw', 'Pen');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.38, { steps: 12 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await penSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created
      && created.sourceWidth === LIVE_WIDTH
      && Math.abs(parseAlpha(created.fill || created.visualFill) - 0.4) < 0.02
      ? created
      : null;
  }, { message: 'first stroke must stamp fill 0.4 + sourceWidth 4' }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

async function handlesBelongTo(page, id) {
  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  const handles = page.locator('[data-resize-handle]');
  if (!(await handles.count()) || !(await group.count())) return false;
  const box = await group.boundingBox();
  if (!box) return false;
  const points = await handles.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }));
  return points.some((point) => (
    point.x >= box.x - 28 && point.x <= box.x + box.width + 28
    && point.y >= box.y - 28 && point.y <= box.y + box.height + 28
  ));
}

async function selectShape(page, id) {
  await selectMode(page);
  if (await handlesBelongTo(page, id)) return;
  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(group).toBeVisible({ timeout: 8_000 });
  const box = await group.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(8, Math.max(3, box.width / 2)), y: box.y + Math.max(3, box.height / 2) },
    { x: box.x + 4, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 4 },
    { x: box.x + box.width - 4, y: box.y + box.height / 2 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await handlesBelongTo(page, id)) return;
  }
  await page.locator(`[data-shape-id="${id}"]`).first().click({ force: true, position: { x: 3, y: 3 } }).catch(() => {});
  await expect.poll(async () => handlesBelongTo(page, id), {
    message: `expected selection handles on ${id}`,
  }).toBeTruthy();
}

test('desktop selected paper-ink Color / Opacity / Width as-is after Select intended + break', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(page.url()).toContain('testPdf=clickable-link-test.pdf');
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const created = await createPenAfterStyle(page);
  expect(created.sourceWidth).toBe(LIVE_WIDTH);
  expect(created.strokeWidth, 'paper-ink leftover strokeWidth stays 0').toBe(0);
  expect(created.stroke === 'transparent' || created.stroke === 'none' || !created.stroke).toBeTruthy();
  expect(parseAlpha(created.fill || created.visualFill)).toBeCloseTo(0.4, 2);

  await activateTool(page, 'Shapes', 'Rectangle');
  const siblingWidth = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(siblingWidth).toBeVisible({ timeout: 8_000 });
  await expect(siblingWidth).toHaveValue('2');

  await selectShape(page, created.id);
  await expect(page.getByRole('textbox', { name: 'Width', exact: true }).first())
    .toHaveValue(String(LIVE_WIDTH), { timeout: 8_000 });
  const opacityField = await openColorOpacity(page);
  await expect(opacityField, 'Select must keep paper-ink Opacity 40 (not leftover Rect 100)')
    .toHaveValue(String(LIVE_OPACITY));
  await opacityField.click();
  await opacityField.fill(String(PATCH_OPACITY));
  await opacityField.press('Enter');
  await expect(opacityField).toHaveValue(String(PATCH_OPACITY));
  await page.keyboard.press('Escape');
  await dismissChrome(page);

  await expect.poll(async () => {
    const row = (await penSnapshot(page)).find((item) => item.id === created.id);
    return row && Math.abs(parseAlpha(row.fill || row.visualFill) - 0.2) < 0.02
      ? row
      : null;
  }, { message: 'Select Color Opacity must patch fill 0.2 (not leftover stroke)' }).not.toBeNull();
  const patched = (await penSnapshot(page)).find((item) => item.id === created.id);
  expect(patched.stroke === 'transparent' || patched.stroke === 'none' || !patched.stroke).toBeTruthy();
  expect(patched.sourceWidth).toBe(LIVE_WIDTH);

  await openEditor(page);
  await dismissChrome(page);
  const emptyExport = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(emptyExport).toBeVisible();
  const [emptyDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    emptyExport.click(),
  ]);
  expect(emptyDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await penSnapshot(page)).length, 'empty export must not invent a pen stroke').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 selected paper-ink chrome edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect((await penSnapshot(page)).length).toBe(0);

  const mobilePen = page.getByRole('button', { name: 'Pen', exact: true }).first();
  if (await mobilePen.isVisible().catch(() => false)) {
    const created = await createPenAfterStyle(page);
    expect(created.sourceWidth).toBe(LIVE_WIDTH);
    expect(parseAlpha(created.fill || created.visualFill)).toBeCloseTo(0.4, 2);
    await activateTool(page, 'Shapes', 'Rectangle');
    await selectShape(page, created.id);
    const widthField = page.getByRole('textbox', { name: 'Width', exact: true }).first();
    if (await widthField.isVisible().catch(() => false)) {
      await expect(widthField).toHaveValue(String(LIVE_WIDTH));
    }
    expect(await fileId(page)).toBeNull();
    expect(await pageViewBox(page)).toBe('0 0 612 792');
  } else {
    expect(await page.getByRole('button', { name: 'Pen', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});
