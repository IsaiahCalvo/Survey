import { test, expect } from '@playwright/test';

// Pen Width catalog — every discrete D-05 preset + unique Pen chrome.
// Distinct from D-05 mixed Width smoke, Eraser Size 1…100, Counter Size
// 5…64, Cloud bump 1–20, C-03 opacity continuum, and color every-swatch.
// Leftover-18 / X-01 parked. No file.id.

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

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
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

async function userInkSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      if (object.isPdfImported === true) return null;
      const group = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const path = group?.querySelector('path');
      const bbox = path?.getBBox?.();
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || '').toLowerCase(),
        sourceWidth: object.sourceWidth ?? null,
        strokeWidth: object.strokeWidth ?? null,
        paperInk: object.paperInkGeometry || null,
        bboxH: bbox?.height ?? null,
        bboxW: bbox?.width ?? null,
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function waitForNewInk(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userInkSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user ink path' }).not.toBeNull();
  return created;
}

async function drawInk(page, { yFraction = 0.28, x0 = 0.16, x1 = 0.42 } = {}) {
  const before = new Set((await userInkSnapshot(page)).map((row) => row.id));
  const box = await pageBox(page);
  const y = box.y + box.height * yFraction;
  await page.mouse.move(box.x + box.width * x0, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((x0 + x1) / 2), y - 2, { steps: 4 });
  await page.mouse.move(box.x + box.width * x1, y + 2, { steps: 4 });
  await page.mouse.up();
  return waitForNewInk(page, before, (row) => row.type === 'path');
}

test('Pen Width every preset + unique chrome intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await activateTool(page, 'Draw', 'Pen');
  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('textbox', { name: 'Size', exact: true })).toHaveCount(0);

  const chrome = await listWidthPresets(page);
  expect(chrome.values, 'live Width popover must list every D-05 preset').toEqual(WIDTH_PRESETS);
  expect(chrome.hasSlider, 'desktop Width chrome is a field + popover, not a slider').toBe(0);

  const proven = [];
  const metrics = [];
  for (let i = 0; i < WIDTH_PRESETS.length; i += 1) {
    const preset = WIDTH_PRESETS[i];
    await activateTool(page, 'Draw', 'Pen');
    await pickWidthPreset(page, preset);
    await expect(field).toHaveValue(String(preset));
    const row = await drawInk(page, {
      yFraction: 0.22 + (i * 0.045),
      x0: i % 2 === 0 ? 0.14 : 0.52,
      x1: i % 2 === 0 ? 0.44 : 0.82,
    });
    expect(row.tool, `preset ${preset} tool`).toBe('pen');
    expect(row.paperInk, `preset ${preset} paper ink`).toBe('v1');
    expect(row.sourceWidth, `preset ${preset} sourceWidth`).toBe(preset);
    expect(row.strokeWidth, `preset ${preset} baked outline uses strokeWidth 0`).toBe(0);
    expect(row.bboxH, `preset ${preset} filled outline has thickness`).toBeGreaterThan(0);
    proven.push(preset);
    metrics.push({
      preset,
      id: row.id,
      sourceWidth: row.sourceWidth,
      strokeWidth: row.strokeWidth,
      bboxH: Number((row.bboxH || 0).toFixed(3)),
    });
  }
  expect(proven).toEqual(WIDTH_PRESETS);
  const thin = metrics.find((row) => row.preset === 1);
  const thick = metrics.find((row) => row.preset === 50);
  expect(thick.bboxH, 'Width 50 outline must be thicker than Width 1').toBeGreaterThan(thin.bboxH * 8);

  await activateTool(page, 'Draw', 'Pen');
  await setWidthTyped(page, '7');
  await expect(field).toHaveValue('7');
  const custom = await drawInk(page, { yFraction: 0.78, x0: 0.16, x1: 0.40 });
  expect(custom.sourceWidth, 'custom 7 (not a preset) stamps sourceWidth').toBe(7);
  expect(custom.strokeWidth).toBe(0);

  const beforeBreak = await field.inputValue();
  await field.click();
  await field.fill('abc');
  expect(await field.inputValue(), 'letters must be rejected').toBe(beforeBreak);
  await field.press('Enter');
  await expect(field).toHaveValue(beforeBreak);

  await setWidthTyped(page, '0');
  await expect(field).toHaveValue('1');
  await setWidthTyped(page, '999');
  await expect(field).toHaveValue('50');
  await setWidthTyped(page, '');
  await expect(field).toHaveValue('1');

  await activateTool(page, 'Draw', 'Highlighter');
  await expect(field).toBeVisible();
  await setWidthTyped(page, '1');
  await expect(field).toHaveValue('1');
  const highlight = await drawInk(page, { yFraction: 0.84, x0: 0.16, x1: 0.40 });
  expect(highlight.tool).toBe('highlighter');
  expect(highlight.sourceWidth, 'highlighter stamps create width as-is').toBe(1);

  await activateTool(page, 'Draw', 'Pen');
  await setWidthTyped(page, '10');
  await expect(field).toHaveValue('10');
  await activateTool(page, 'Draw', 'Partial erase');
  const size = page.getByRole('textbox', { name: 'Size', exact: true }).first();
  await expect(size).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('textbox', { name: 'Width', exact: true })).toHaveCount(0);
  const eraserDefault = await size.inputValue();
  expect(eraserDefault, 'Eraser Size is not the Pen Width store').not.toBe('10');
  await size.click();
  await size.fill('24');
  await size.press('Enter');
  await expect(size).toHaveValue('24');
  await activateTool(page, 'Draw', 'Pen');
  await expect(field).toHaveValue('10');

  const isolation = await drawInk(page, { yFraction: 0.88, x0: 0.52, x1: 0.82 });
  expect(isolation.sourceWidth).toBe(10);
  expect(metrics[0].sourceWidth, 'later stroke must not rewrite first Width 1').toBe(1);
  const firstStill = (await userInkSnapshot(page)).find((row) => row.id === metrics[0].id);
  expect(firstStill.sourceWidth).toBe(1);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userInkSnapshot(page);
    return rows.some((row) => row.id === isolation.id);
  }).toBe(false);
  expect((await userInkSnapshot(page)).find((row) => row.id === metrics[0].id)?.sourceWidth).toBe(1);

  const beforeSelect = (await userInkSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await userInkSnapshot(page)).length).toBe(beforeSelect);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('PEN_WIDTH_DESKTOP_PROOF', JSON.stringify({
    proven,
    thinBBox: thin.bboxH,
    thickBBox: thick.bboxH,
    custom7: custom.id,
    highlighterFloor: highlight.sourceWidth,
    eraserDefault,
    isolationUndone: isolation.id,
    viewBox,
    fileId,
  }));
});

test('390 Pen Width field + clamp intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);
  await activateTool(page, 'Draw', 'Pen');

  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  const chrome = await listWidthPresets(page);
  expect(chrome.values).toEqual(WIDTH_PRESETS);

  await pickWidthPreset(page, 12);
  await expect(field).toHaveValue('12');
  const drawn = await drawInk(page, { yFraction: 0.36, x0: 0.18, x1: 0.62 });
  expect(drawn.tool).toBe('pen');
  expect(drawn.sourceWidth).toBe(12);
  expect(drawn.strokeWidth).toBe(0);

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

  console.log('PEN_WIDTH_390_PROOF', JSON.stringify({
    drawn: drawn.id,
    sourceWidth: drawn.sourceWidth,
    clamp: { typed999: 50, typed0: 1 },
    viewBox,
    fileId,
  }));
});
