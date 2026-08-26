import { test, expect } from '@playwright/test';

// AFTER_OVERLAY_CATALOG_DESKTOP_CREATE_VIEWCLAMP_HUNT
// Genuine hunt of desktop first-create / view-clamp / tool-pref remount
// leftovers after tip a9c0fd3f / product 162aa1f5. Distinct from leftover-18
// and the ten exhausted classes (export/AP, Select chrome, remaining audit
// IDs, local save/reload selected-style, import after callout /AP fill, 390
// first-create, remaining E2E-UNLISTED, remaining unopened audit IDs after
// P1-39, P1-46 guest LS, overlay live web chords). Do not invent Font family
// chrome, richTextEditor, Line /AP, callout Rotation, user-settable callout
// verticalAlign, eraser-cut Width restroke, imported-outline Width restroke,
// clipboard overlay rows, Open file / UL-03, Duplicate overlay rows, or
// Electron-only Export. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  clearToolPrefs = true,
} = {}) {
  await page.addInitScript((shouldClearPrefs) => {
    try {
      if (sessionStorage.getItem('e2e-keep-tool-prefs') === '1') return;
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('pdfSidebar_')
          || (shouldClearPrefs && key.startsWith('toolPrefs_'))
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  }, clearToolPrefs);
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

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return rgba[1] != null ? Number(rgba[1]) : 1;
  if (!text || text === 'transparent' || text === 'none') return 0;
  return 1;
}

async function userShapes(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        fill: object.fill ?? data.fill ?? null,
        strokeWidth: Number(object.strokeWidth) || 0,
        dash: object.strokeDashArray || null,
        intensity: Number(data.pdfCloudIntensity) || 0,
        arrowhead: data.arrowheadStyle || null,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  });
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

async function setWidth(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function setFillOpacity(page, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await color.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.isVisible().catch(() => false)) await fillTab.click();
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
}

async function setStyle(page, label) {
  const style = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(style).toBeVisible({ timeout: 8_000 });
  await style.click();
  const option = page.getByRole('option', { name: label, exact: true }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return;
  }
  const menuitem = page.getByRole('menuitem', { name: label, exact: true }).first();
  if (await menuitem.isVisible().catch(() => false)) {
    await menuitem.click();
    return;
  }
  await page.getByText(label, { exact: true }).first().click();
}

async function setBump(page, raw) {
  const field = page.getByRole('textbox', { name: 'Cloud bump size', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
}

async function setArrowhead(page, label) {
  const trigger = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const option = page.getByRole('option', { name: label, exact: true }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return;
  }
  await page.getByText(label, { exact: true }).first().click();
}

async function dragShape(page, coords = { x0: 0.22, y0: 0.22, x1: 0.48, y1: 0.40 }) {
  const before = new Set((await userShapes(page)).map((row) => row.id));
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = (await userShapes(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }).not.toBeNull();
  return created;
}

async function zoomPercent(page) {
  const label = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await label.count()) {
    return Number.parseInt((await label.innerText()).trim(), 10);
  }
  const input = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  if (await input.count()) {
    return Number.parseInt(await input.inputValue(), 10);
  }
  return null;
}

async function commitZoomPercent(page, value) {
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await expect(zoomBtn).toBeVisible({ timeout: 8_000 });
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  await zoomInput.press('Control+A');
  await zoomInput.press('Backspace');
  await zoomInput.pressSequentially(String(value), { delay: 20 });
  await zoomInput.press('Enter');
  await blurInputs(page);
}

async function selectDesktopFit(page, name) {
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('desktop first-create / view-clamp / tool-pref remount already aligned intended + break', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');

  await activateTool(page, 'Shapes', 'Rectangle');
  await setWidth(page, 8);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const dashed = await dragShape(page);
  expect(dashed.strokeWidth, 'desktop first-create Width 8').toBe(8);
  expect(parseAlpha(dashed.fill), 'desktop first-create Fill 40').toBeCloseTo(0.4, 2);
  expect(dashed.dash, 'desktop first-create Dashed').toEqual([6, 4]);

  await activateTool(page, 'Shapes', 'Rectangle');
  await setStyle(page, 'Cloud');
  await setBump(page, 8);
  await dismissChrome(page);
  const cloud = await dragShape(page, { x0: 0.52, y0: 0.22, x1: 0.74, y1: 0.40 });
  expect(cloud.intensity, 'desktop first-create Cloud Bump 8').toBe(8);

  await activateTool(page, 'Shapes', 'Line');
  await setWidth(page, 5);
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const line = await dragShape(page, { x0: 0.20, y0: 0.50, x1: 0.42, y1: 0.62 });
  expect(line.strokeWidth, 'desktop first-create Line Width 5').toBe(5);
  expect(line.dash, 'desktop first-create Line Dashed').toEqual([6, 4]);
  expect(line.arrowhead, 'Line must not invent an arrowhead').toBeFalsy();

  await activateTool(page, 'Shapes', 'Arrow');
  await setWidth(page, 6);
  await setStyle(page, 'Dotted');
  await setArrowhead(page, 'Open circle');
  await dismissChrome(page);
  const arrow = await dragShape(page, { x0: 0.50, y0: 0.50, x1: 0.72, y1: 0.62 });
  expect(arrow.strokeWidth, 'desktop first-create Arrow Width 6 after sibling Line').toBe(6);
  expect(arrow.dash, 'desktop first-create Arrow Dotted').toEqual([2, 4]);
  expect(String(arrow.arrowhead || ''), 'desktop first-create Open circle').toMatch(/openCircle/i);

  await dismissChrome(page);
  await selectDesktopFit(page, 'Fit page');
  await commitZoomPercent(page, 200);
  await expect.poll(async () => zoomPercent(page)).toBe(200);
  await page.getByRole('button', { name: 'Fit options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveAttribute('data-active', 'false');
  await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute('data-active', 'false');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    try { sessionStorage.setItem('e2e-keep-tool-prefs', '1'); } catch { /* ignore */ }
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  const remounted = await dragShape(page, { x0: 0.24, y0: 0.68, x1: 0.44, y1: 0.82 });
  expect(remounted.intensity, 'tool-pref remount must keep Cloud Bump 8').toBe(8);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 desktop-create / view-clamp edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect((await userShapes(page)).length, '390 first load invents 0').toBe(0);
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'must not invent Font family chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
});
