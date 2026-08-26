import { test, expect } from '@playwright/test';

// AFTER_DESKTOP_CALLOUT_SIBLING_FIRST_CREATE_HUNT
// Genuine hunt of desktop Callout first-create after sibling Line/Arrow
// leftovers after tip 842674c6 / product 162aa1f5. Distinct from leftover-18
// and the eleven exhausted classes (export/AP, Select chrome, remaining
// audit IDs, local save/reload, import after callout /AP fill, 390
// first-create, remaining E2E-UNLISTED, remaining unopened audit IDs after
// P1-39, P1-46 guest LS, overlay live web chords, desktop Rect/Line/Arrow
// first-create + view-clamp + remount). Do not invent Font family chrome,
// richTextEditor, Line /AP, callout Rotation, user-settable callout
// verticalAlign, leftover-18 hosts, or stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
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
        strokeWidth: Number(object.strokeWidth) || 0,
        dash: object.strokeDashArray || null,
        arrowhead: data.arrowheadStyle || null,
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true);
  });
}

async function calloutSnapshot(page) {
  return page.evaluate(() => {
    const ids = [...new Set(
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = object.style || data.style || legacy.style || {};
      const box = document.querySelector(
        `[data-svg-annotation-layer="1"] [data-callout-id="${id}"] [data-callout-part="textBox"]`,
      );
      return {
        id,
        text: String(object.text || legacy.text || data.text || ''),
        fillOpacity: style.fillOpacity ?? null,
        lineThickness: Number(style.lineThickness ?? object.strokeWidth) || 0,
        lineStyle: style.lineStyle || null,
        arrowhead: data.arrowheadStyle || style.arrowheadStyle || null,
        visualBoxDash: box?.getAttribute('stroke-dasharray') || '',
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
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

async function pageBox(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  return box;
}

async function dragShape(page, coords = { x0: 0.20, y0: 0.50, x1: 0.42, y1: 0.62 }) {
  const before = new Set((await userShapes(page)).map((row) => row.id));
  const box = await pageBox(page);
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

async function createCallout(page, text, coords = { x0: 0.22, y0: 0.22, x1: 0.48, y1: 0.40 }) {
  const before = new Set((await calloutSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Text', 'Callout');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  let created = null;
  await expect.poll(async () => {
    const rows = (await calloutSnapshot(page)).filter((row) => !before.has(row.id));
    created = rows[0] || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  await dismissChrome(page);
  return created;
}

test('desktop Callout first-create after sibling Line/Arrow already aligned intended + break', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');

  await activateTool(page, 'Shapes', 'Line');
  await setWidth(page, 5);
  await setStyle(page, 'Dashed');
  await dismissChrome(page);
  const line = await dragShape(page, { x0: 0.18, y0: 0.50, x1: 0.40, y1: 0.62 });
  expect(line.strokeWidth, 'sibling Line Width 5').toBe(5);
  expect(line.dash, 'sibling Line Dashed').toEqual([6, 4]);

  await activateTool(page, 'Shapes', 'Arrow');
  await setWidth(page, 6);
  await setStyle(page, 'Dotted');
  await setArrowhead(page, 'Open circle');
  await dismissChrome(page);
  const arrow = await dragShape(page, { x0: 0.48, y0: 0.50, x1: 0.70, y1: 0.62 });
  expect(arrow.strokeWidth, 'sibling Arrow Width 6').toBe(6);
  expect(String(arrow.arrowhead || ''), 'sibling Open circle').toMatch(/openCircle/i);

  await activateTool(page, 'Text', 'Callout');
  await setWidth(page, 8);
  await setFillOpacity(page, 40);
  await page.keyboard.press('Escape');
  await setStyle(page, 'Dashed');
  await setArrowhead(page, 'Open triangle');
  await dismissChrome(page);
  const callout = await createCallout(page, 'Yo', { x0: 0.22, y0: 0.18, x1: 0.48, y1: 0.36 });
  expect(callout.lineThickness, 'desktop Callout first-create Width 8 after sibling Line/Arrow').toBe(8);
  expect(Number(callout.fillOpacity), 'desktop Callout first-create Fill 40 after sibling').toBeCloseTo(0.4, 2);
  expect(String(callout.lineStyle || ''), 'desktop Callout first-create Dashed after sibling').toMatch(/dashed/i);
  expect(String(callout.arrowhead || ''), 'desktop Callout first-create Open triangle after sibling').toMatch(/openTriangle/i);
  expect(callout.visualBoxDash, 'desktop Callout box must paint Dashed').not.toBe('');

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});

test('390 Callout-after-sibling edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect((await userShapes(page)).length, '390 first load invents 0').toBe(0);
  expect((await calloutSnapshot(page)).length, '390 first load invents 0 callouts').toBe(0);
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count(), 'must not invent 390 hex chrome').toBe(0);
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count(), 'must not invent Font family chrome').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Width', exact: true }).count()).toBe(0);
});
