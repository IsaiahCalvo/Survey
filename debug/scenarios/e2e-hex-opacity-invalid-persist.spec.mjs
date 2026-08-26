import { test, expect } from '@playwright/test';

// P1-39 leftover sibling: Hex already skipped applyHex('zzzzzz'), but
// Opacity still onChange(localHex) so first-create leftover-stamped
// `#zzzzzz`. Distinct from leftover-18, C-01 swatch apply, C-02 hex
// lengths (field-only), and 390 Color chrome invent. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function colorKey(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s || s === 'NONE' || s === 'TRANSPARENT') return 'TRANSPARENT';
  const rgba = s.match(/RGBA?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?/);
  if (rgba) {
    const alpha = rgba[4] == null ? 1 : Number(rgba[4]);
    if (alpha === 0) return 'TRANSPARENT';
    return `#${[rgba[1], rgba[2], rgba[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  if (s.startsWith('#')) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
  return s;
}

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return rgba[1] != null ? Number(rgba[1]) : 1;
  if (/zzzzzz/i.test(text)) return NaN;
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('lastShapeTool');
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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
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

async function closePagesOverlay(page) {
  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await pagesToggle.isVisible().catch(() => false)) {
    await pagesToggle.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  await closePagesOverlay(page);
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
  }
}

async function shapeSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        fill: object.fill ?? object.data?.fill ?? null,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  });
}

async function openNextDrawFill(page) {
  await activateTool(page, 'Shapes', 'Rectangle');
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await color.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.isVisible().catch(() => false)) await fillTab.click();
}

async function typeInvalidHexThenOpacity(page, pct) {
  await page.locator('button[title="#000000"]').first().click();
  const hex = page.getByRole('textbox', { name: 'Hex color', exact: true }).first();
  await expect(hex).toBeVisible();
  await hex.click();
  await hex.press('Control+A');
  await hex.pressSequentially('zzzzzz', { delay: 15 });
  expect(await hex.inputValue()).toMatch(/zzzzzz/i);
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
}

async function drawRect(page, coords = { x0: 0.22, y0: 0.22, x1: 0.48, y1: 0.40 }) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await shapeSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }).not.toBeNull();
  return created;
}

test('desktop P1-39 hex+Opacity does not persist zzzzzz intended + break', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');

  await openNextDrawFill(page);
  await typeInvalidHexThenOpacity(page, 40);
  await page.keyboard.press('Escape');
  await dismissChrome(page);

  const created = await drawRect(page);
  expect(String(created.fill), 'must not leftover-persist #zzzzzz').not.toMatch(/zzzzzz/i);
  expect(colorKey(created.fill), 'Opacity must keep last valid black').toBe('#000000');
  expect(parseAlpha(created.fill), 'Opacity 40 must stamp 0.4 on last valid hex').toBeCloseTo(0.4, 2);

  await openNextDrawFill(page);
  const hex = page.getByRole('textbox', { name: 'Hex color', exact: true }).first();
  await hex.click();
  await hex.press('Control+A');
  await hex.pressSequentially('f00', { delay: 15 });
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await field.click();
  await field.fill('20');
  await field.press('Enter');
  await page.keyboard.press('Escape');
  await dismissChrome(page);
  const red = await drawRect(page, { x0: 0.52, y0: 0.22, x1: 0.74, y1: 0.40 });
  expect(colorKey(red.fill)).toBe('#FF0000');
  expect(parseAlpha(red.fill)).toBeCloseTo(0.2, 2);

  await openEditor(page);
  await dismissChrome(page);
  expect((await shapeSnapshot(page)).length, 'empty reload must invent 0').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count()).toBe(0);
});

test('390 P1-39 hex+Opacity edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toMatch(/^0 0 /);
  expect((await shapeSnapshot(page)).length).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
});
