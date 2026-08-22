import { test, expect } from '@playwright/test';

// Line / Arrow / shape stroke Width — every discrete D-05 preset + unique
// selected-patch / create chrome. Distinct from Pen Width (sourceWidth +
// baked outline 0), Eraser Size 1…100, Counter Size 5…64, Cloud bump 1–20,
// C-03 opacity, and color every-swatch. Leftover-18 / X-01 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const WIDTH_PRESETS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50];

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
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  let covered = null;
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = String(await button.getAttribute('class') || '');
    if (cls.includes('mobile-header-select-button')) {
      covered = button;
      continue;
    }
    await button.click();
    return button;
  }
  if (name === 'Select') {
    const mode = page.getByRole('button', { name: 'Selection mode', exact: true }).first();
    if (await mode.isVisible().catch(() => false)) {
      await mode.click();
      return mode;
    }
    await page.keyboard.press('v');
    return mode;
  }
  if (covered) {
    await covered.click({ force: true });
    return covered;
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click({ force: true });
  return buttons.first();
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.getByRole('button', { name: toolName, exact: true });
  const visibleSub = async () => {
    const count = await sub.count();
    for (let i = 0; i < count; i += 1) {
      if (await sub.nth(i).isVisible().catch(() => false)) return sub.nth(i);
    }
    return null;
  };
  if (!(await visibleSub())) {
    await clickVisible(page, categoryName);
  }
  const target = (await visibleSub()) || sub.first();
  await expect(target).toBeVisible();
  const pressed = await target.getAttribute('aria-pressed');
  const active = String(await target.getAttribute('class') || '').includes('is-active')
    || String(await target.getAttribute('class') || '').includes('btn-active');
  if (pressed !== 'true' && !active) await target.click();
}

async function closePagesOverlay(page) {
  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await pagesToggle.isVisible().catch(() => false)) {
    await pagesToggle.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }
}

async function ensurePageDrawTarget(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pageEl).toBeVisible();
  const overlay = page.locator('main').getByText('No documents yet').first();
  const toggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i }).first();
  const box = await pageEl.boundingBox();
  const covering = box && await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return /No documents yet|Upload your first PDF/.test(el?.textContent || '');
  }, { x: box.x + box.width * 0.4, y: box.y + box.height * 0.35 });
  const emptyVisible = await overlay.isVisible().catch(() => false);
  if (!covering && !emptyVisible) return;
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await page.waitForTimeout(300);
}

async function dismissChrome(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await closePagesOverlay(page);
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  });
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  const selectBtn = page.getByRole('button', { name: 'Selection mode', exact: true }).first();
  if (await selectBtn.isVisible().catch(() => false)) {
    await selectBtn.click();
  } else {
    await page.keyboard.press('v');
  }
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function widthField(page) {
  return page.getByRole('textbox', { name: 'Width', exact: true }).first();
}

async function setWidthTyped(page, raw) {
  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
}

async function pickWidthPreset(page, preset) {
  const trigger = page.getByRole('button', { name: 'Width presets', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-size-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(preset), exact: true });
  if (await option.count()) {
    await option.click();
  } else {
    await popover.getByText(String(preset), { exact: true }).click();
  }
  await expect(popover).toHaveCount(0);
}

async function listWidthPresets(page) {
  const trigger = page.getByRole('button', { name: 'Width presets', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-size-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const values = await popover.getByRole('option').evaluateAll((nodes) => (
    nodes.map((node) => Number(node.querySelector('.annotation-size-control__preset-value')?.textContent?.trim()))
      .filter((n) => Number.isFinite(n))
  ));
  const hasSlider = await popover.locator('input[type="range"]').count();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  return { values, hasSlider };
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const style = data.style || data.legacyCallout?.style || {};
      if (object.isPdfImported === true) return null;
      const group = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const visual = document.querySelector(`[data-shape-id="${id}"]`);
      const strokeEl = visual || group?.querySelector('line, path, rect, ellipse, polyline');
      const bbox = strokeEl?.getBBox?.();
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        strokeWidth: object.strokeWidth ?? data.strokeWidth ?? null,
        sourceWidth: object.sourceWidth ?? null,
        lineThickness: style.lineThickness ?? object.lineThickness ?? null,
        visualStrokeWidth: strokeEl ? Number(strokeEl.getAttribute('stroke-width') || 0) : null,
        bboxH: bbox?.height ?? null,
        bboxW: bbox?.width ?? null,
        clientH: strokeEl?.getBoundingClientRect?.()?.height ?? null,
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function calloutSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || object.style || {};
      const line = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"] [data-callout-part="leader"], [data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"] line, [data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"] path`,
      );
      return {
        id,
        type: 'callout',
        tool: 'callout',
        callout: true,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        lineThickness: style.lineThickness ?? object.lineThickness ?? null,
        visualStrokeWidth: line ? Number(line.getAttribute('stroke-width') || 0) : null,
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

async function annotationById(page, id) {
  return (await userAnnotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function calloutById(page, id) {
  return (await calloutSnapshot(page)).find((row) => row.id === id) || null;
}

function isLineRow(row) {
  return row.tool === 'line' || (row.type === 'line' && row.tool !== 'arrow');
}

function isArrowRow(row) {
  return row.tool === 'arrow' || row.type === 'arrow';
}

function isRectRow(row) {
  return row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect';
}

async function createLine(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isLineRow);
}

async function createArrow(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isArrowRow);
}

async function createRect(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRectRow);
}

async function createCallout(page, text, coords = { x0: 0.16, y0: 0.72, x1: 0.40, y1: 0.86 }) {
  const before = new Set((await calloutSnapshot(page)).map((row) => row.id));
  await blurInputs(page);
  await activateTool(page, 'Text', 'Callout');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  let created = null;
  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    created = rows.find((row) => !before.has(row.id)) || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
  await selectMode(page);
  return created;
}

async function selectStroke(page, id) {
  await selectMode(page);
  const target = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(8, Math.max(2, box.width / 2)), y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + box.width - 4, y: box.y + Math.max(2, box.height / 2) },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    const selected = await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count();
    const chrome = await page.getByRole('textbox', { name: 'Width', exact: true }).count();
    if (selected > 0 || chrome > 0) return;
  }
  await expect(page.getByRole('textbox', { name: 'Width', exact: true }).first()).toBeVisible({ timeout: 8_000 });
}

async function selectCallout(page, id) {
  await selectMode(page);
  const scoped = page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${id}"]`);
  const candidates = [
    scoped.locator('[data-callout-part="textBox"]').first(),
    scoped.locator('[data-callout-part="knee"]').last(),
    scoped.first(),
  ];
  for (const target of candidates) {
    if (!(await target.count())) continue;
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const box = await target.boundingBox();
    if (!box || box.width < 1 || box.height < 1) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (await page.getByRole('textbox', { name: 'Width', exact: true }).first().isVisible().catch(() => false)) return;
  }
  await expect(page.getByRole('textbox', { name: 'Width', exact: true }).first()).toBeVisible({ timeout: 8_000 });
}

async function patchWidthPresets(page, id, { kind = 'shape' } = {}) {
  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  const proof = [];
  for (const preset of WIDTH_PRESETS) {
    await pickWidthPreset(page, preset);
    await expect(field).toHaveValue(String(preset));
    if (kind === 'callout') {
      await expect.poll(async () => (await calloutById(page, id))?.lineThickness).toBe(preset);
      proof.push({ preset, lineThickness: preset });
    } else {
      await expect.poll(async () => (await annotationById(page, id))?.strokeWidth).toBe(preset);
      proof.push({ preset, strokeWidth: preset });
    }
  }
  return proof;
}

test('Line/Arrow/shape Width every preset + selected-patch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await activateTool(page, 'Shapes', 'Line');
  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('textbox', { name: 'Size', exact: true })).toHaveCount(0);

  const chrome = await listWidthPresets(page);
  expect(chrome.values, 'live Width popover must list every D-05 preset').toEqual(WIDTH_PRESETS);
  expect(chrome.hasSlider, 'desktop Width chrome is a field + popover, not a slider').toBe(0);

  const lineMetrics = [];
  for (let i = 0; i < WIDTH_PRESETS.length; i += 1) {
    const preset = WIDTH_PRESETS[i];
    await activateTool(page, 'Shapes', 'Line');
    await pickWidthPreset(page, preset);
    await expect(field).toHaveValue(String(preset));
    const row = await createLine(page, {
      x0: i % 2 === 0 ? 0.12 : 0.52,
      x1: i % 2 === 0 ? 0.44 : 0.84,
      y0: 0.16 + (Math.floor(i / 2) * 0.055),
      y1: 0.175 + (Math.floor(i / 2) * 0.055),
    });
    expect(row.tool, `line preset ${preset} tool`).toBe('line');
    expect(row.strokeWidth, `line preset ${preset} strokeWidth`).toBe(preset);
    expect(row.sourceWidth, `line preset ${preset} is not Pen sourceWidth`).toBeNull();
    expect(row.visualStrokeWidth, `line preset ${preset} visual stroke`).toBe(preset);
    lineMetrics.push({
      preset,
      id: row.id,
      strokeWidth: row.strokeWidth,
      visualStrokeWidth: row.visualStrokeWidth,
      clientH: Number((row.clientH || 0).toFixed(3)),
    });
  }
  expect(lineMetrics.map((row) => row.preset)).toEqual(WIDTH_PRESETS);
  const thin = lineMetrics.find((row) => row.preset === 1);
  const thick = lineMetrics.find((row) => row.preset === 50);
  expect(thick.visualStrokeWidth, 'Line Width 50 visual stroke').toBe(50);
  expect(thin.visualStrokeWidth, 'Line Width 1 visual stroke').toBe(1);
  expect(thick.clientH, 'Line Width 50 screen stroke must be thicker than Width 1').toBeGreaterThan(thin.clientH * 8);

  const patchLine = lineMetrics.find((row) => row.preset === 12);
  await selectStroke(page, patchLine.id);
  const linePatch = await patchWidthPresets(page, patchLine.id);
  expect(linePatch.map((row) => row.preset)).toEqual(WIDTH_PRESETS);
  expect((await annotationById(page, thin.id))?.strokeWidth, 'later patch must not rewrite Width 1 line').toBe(1);

  const arrowMetrics = [];
  for (let i = 0; i < WIDTH_PRESETS.length; i += 1) {
    const preset = WIDTH_PRESETS[i];
    await activateTool(page, 'Shapes', 'Arrow');
    await pickWidthPreset(page, preset);
    await expect(field).toHaveValue(String(preset));
    const row = await createArrow(page, {
      x0: i % 2 === 0 ? 0.12 : 0.52,
      x1: i % 2 === 0 ? 0.40 : 0.80,
      y0: 0.52 + (Math.floor(i / 2) * 0.028),
      y1: 0.535 + (Math.floor(i / 2) * 0.028),
    });
    expect(row.tool, `arrow preset ${preset} tool`).toBe('arrow');
    expect(row.strokeWidth, `arrow preset ${preset} strokeWidth`).toBe(preset);
    expect(row.sourceWidth).toBeNull();
    arrowMetrics.push({ preset, id: row.id, strokeWidth: row.strokeWidth });
  }
  expect(arrowMetrics.map((row) => row.preset)).toEqual(WIDTH_PRESETS);

  await activateTool(page, 'Shapes', 'Rectangle');
  await pickWidthPreset(page, 6);
  await expect(field).toHaveValue('6');
  const rect = await createRect(page, { x0: 0.58, y0: 0.70, x1: 0.82, y1: 0.86 });
  expect(rect.strokeWidth, 'rect next-draw Width 6').toBe(6);
  await selectStroke(page, rect.id);
  const rectPatch = await patchWidthPresets(page, rect.id);
  expect(rectPatch.map((row) => row.preset)).toEqual(WIDTH_PRESETS);
  const rectThick = await annotationById(page, rect.id);
  expect(rectThick.strokeWidth).toBe(50);
  expect(rectThick.visualStrokeWidth).toBe(50);

  const callout = await createCallout(page, 'w1', { x0: 0.14, y0: 0.70, x1: 0.38, y1: 0.84 });
  await selectCallout(page, callout.id);
  const calloutPatch = [];
  for (const preset of [1, 16, 50]) {
    await pickWidthPreset(page, preset);
    await expect(field).toHaveValue(String(preset));
    await expect.poll(async () => (await calloutById(page, callout.id))?.lineThickness).toBe(preset);
    calloutPatch.push(preset);
  }
  expect(calloutPatch).toEqual([1, 16, 50]);
  expect((await annotationById(page, thin.id))?.strokeWidth, 'callout patch must not rewrite first Line').toBe(1);
  expect((await annotationById(page, rect.id))?.strokeWidth, 'callout patch must not rewrite Rect').toBe(50);

  await activateTool(page, 'Shapes', 'Line');
  const beforeLetters = await field.inputValue();
  await field.click();
  await field.fill('abc');
  expect(await field.inputValue(), 'letters must be rejected').toBe(beforeLetters);
  await field.press('Enter');
  await expect(field).toHaveValue(beforeLetters);

  await setWidthTyped(page, '0');
  await expect(field).toHaveValue('1');
  await setWidthTyped(page, '999');
  await expect(field).toHaveValue('50');
  await setWidthTyped(page, '');
  await expect(field).toHaveValue('1');

  await setWidthTyped(page, '10');
  await expect(field).toHaveValue('10');
  await activateTool(page, 'Draw', 'Partial erase');
  const size = page.getByRole('textbox', { name: 'Size', exact: true }).first();
  await expect(size).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toHaveCount(0);
  const eraserDefault = await size.inputValue();
  expect(eraserDefault, 'Eraser Size is not the Line Width store').not.toBe('10');
  await size.click();
  await size.fill('24');
  await size.press('Enter');
  await expect(size).toHaveValue('24');
  await activateTool(page, 'Shapes', 'Line');
  await expect(field).toHaveValue('10');

  await setWidthTyped(page, '7');
  await expect(field).toHaveValue('7');
  const custom = await createLine(page, { x0: 0.16, y0: 0.90, x1: 0.40, y1: 0.92 });
  expect(custom.strokeWidth, 'custom 7 (not a preset) stamps strokeWidth').toBe(7);
  expect((await annotationById(page, thin.id))?.strokeWidth).toBe(1);

  const isolation = await createLine(page, { x0: 0.52, y0: 0.90, x1: 0.78, y1: 0.92 });
  expect(isolation.strokeWidth).toBe(7);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === isolation.id);
  }).toBe(false);
  expect((await annotationById(page, thin.id))?.strokeWidth).toBe(1);
  expect((await annotationById(page, custom.id))?.strokeWidth).toBe(7);

  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('SHAPE_STROKE_WIDTH_DESKTOP_PROOF', JSON.stringify({
    linePresets: lineMetrics.map((row) => row.preset),
    thinBBox: thin.bboxH,
    thickBBox: thick.bboxH,
    linePatch: linePatch.map((row) => row.preset),
    arrowPresets: arrowMetrics.map((row) => row.preset),
    rectPatch: rectPatch.map((row) => row.preset),
    calloutPatch,
    custom7: custom.id,
    eraserDefault,
    isolationUndone: isolation.id,
    viewBox,
    fileId,
  }));
});

test('390 Line Width field + clamp intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);
  await activateTool(page, 'Shapes', 'Line');

  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  const chrome = await listWidthPresets(page);
  expect(chrome.values).toEqual(WIDTH_PRESETS);

  await pickWidthPreset(page, 12);
  await expect(field).toHaveValue('12');
  const drawn = await createLine(page, { x0: 0.18, y0: 0.36, x1: 0.72, y1: 0.40 });
  expect(drawn.tool).toBe('line');
  expect(drawn.strokeWidth).toBe(12);
  expect(drawn.sourceWidth).toBeNull();

  await setWidthTyped(page, '999');
  await expect(field).toHaveValue('50');
  await setWidthTyped(page, '0');
  await expect(field).toHaveValue('1');
  const beforeLetters = await field.inputValue();
  await field.click();
  await field.fill('abc');
  expect(await field.inputValue()).toBe(beforeLetters);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).count()).toBe(0);

  console.log('SHAPE_STROKE_WIDTH_390_PROOF', JSON.stringify({
    drawn: drawn.id,
    strokeWidth: drawn.strokeWidth,
    clamp: { typed999: 50, typed0: 1 },
    viewBox,
    fileId,
  }));
});
