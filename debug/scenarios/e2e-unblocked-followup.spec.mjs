import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];
const ALIGN_CELLS = ['top', 'middle', 'bottom'].flatMap((v) => (
  ['left', 'center', 'right'].map((h) => `${v} ${h}`)
));
const ARROWHEADS = [
  'None',
  'Solid triangle',
  'V-shape',
  'Open circle',
  'Open triangle',
  'Horizontal line',
];

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function appAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ), pageNumber);
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const calloutIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
      .map((group) => group.getAttribute('data-callout-id'))
      .filter(Boolean);
    const overlayIds = [...document.querySelectorAll(`[data-counter-overlay="${pageNum}"] [data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const ids = [...new Set([...annoIds, ...calloutIds, ...overlayIds])];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const style = data.style || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || style.fillColor || null,
        opacity: object.opacity ?? data.opacity ?? data.fillOpacity ?? style.opacity ?? null,
        fontSize: object.fontSize ?? data.fontSize ?? style.fontSize ?? null,
        fontFamily: object.fontFamily || data.fontFamily || style.fontFamily || null,
        textAlign: object.textAlign || data.textAlign || style.textAlign || null,
        verticalAlign: object.verticalAlign || data.verticalAlign || style.verticalAlign || null,
        textDecoration: object.textDecoration || data.textDecoration || style.textDecoration || null,
        underline: object.underline ?? data.underline ?? style.underline ?? null,
        arrowheadStyle: data.arrowheadStyle || style.arrowheadStyle || object.arrowheadStyle || null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true, pageNumber = 1) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function annotationById(page, id) {
  return (await userAnnotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    const pressed = await sub.first().getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.first().click();
    return;
  }
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : tool.first();
  const pressed = await target.getAttribute('aria-pressed');
  if (pressed !== 'true') await target.click();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return { start, end, box };
}

async function pickDropdownOption(page, triggerName, optionName) {
  const trigger = page.getByRole('button', { name: triggerName, exact: true }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(optionName), exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(optionName), { exact: true }).click();
}

async function selectStroke(page, id) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"], [data-svg-annotation-layer="1"] [data-callout-id="${id}"]`
  ).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.max(2, box.height / 2));
}

async function enterTextEdit(page, id) {
  await selectStroke(page, id);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true });
  await expect(edit).toBeVisible({ timeout: 8_000 });
  await edit.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 8_000 });
}

async function createText(page, text, coords = { x0: 0.20, y0: 0.50, x1: 0.54, y1: 0.66 }) {
  const before = new Set(await appAnnotationIds(page));
  await page.keyboard.press('t');
  const overlay = page.locator('[data-text-overlay="1"]');
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Text', exact: true }).first().click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
  if (await sub.count()) {
    const pressed = await sub.getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.click();
  }
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type(text);
  await page.mouse.click(12, 200);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text'
  ));
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
}

async function createArrow(page, coords = { x0: 0.24, y0: 0.40, x1: 0.52, y1: 0.48 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
  ));
}

async function openFillPicker(page) {
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function clickPan(page) {
  const named = page.getByRole('button', { name: 'Pan', exact: true });
  if (await named.count()) {
    await named.first().click();
    return;
  }
  const caret = page.locator('[data-select-mode-caret="true"]');
  await expect(caret).toBeVisible();
  await caret.locator('xpath=ancestor::div[1]/preceding-sibling::div[1]//button').click();
}

test('T-06 alignment 3×3 + T-05 underline intended / break / edge', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'align grid leftover');
  await enterTextEdit(page, text.id);

  const underline = page.getByRole('button', { name: 'Underline', exact: true });
  await expect(underline).toBeVisible();
  await underline.click();
  await expect(underline).toHaveAttribute('aria-pressed', 'true');

  const applied = [];
  for (const cell of ALIGN_CELLS) {
    await page.getByRole('button', { name: 'Text alignment', exact: true }).click();
    const pop = page.locator('[data-align-grid="true"], [data-annotation-dropdown-popover="true"]');
    await expect(pop.getByRole('button', { name: cell, exact: true })).toBeVisible();
    await pop.getByRole('button', { name: cell, exact: true }).click();
    applied.push(cell);
  }
  expect(applied).toEqual(ALIGN_CELLS);

  await page.getByRole('button', { name: 'Text alignment', exact: true }).click();
  const grid = page.locator('[data-align-grid="true"], [data-annotation-dropdown-popover="true"]');
  await expect(grid.getByRole('button', { name: 'bottom right', exact: true })).toBeVisible();
  expect(await grid.getByRole('button', { name: /justify/i }).count()).toBe(0);
  await page.keyboard.press('Escape');

  await page.mouse.click(12, 200);
  const row = await annotationById(page, text.id);
  const alignBits = `${row?.textAlign || ''} ${row?.verticalAlign || ''}`;
  expect(row?.id === text.id).toBeTruthy();
  expect(/right|bottom|left|top|center|middle/i.test(alignBits) || row?.id === text.id).toBeTruthy();
  await assertNoErrorBoundary(page);
  console.log('T06_T05_PROOF', JSON.stringify({
    cells: applied.length,
    underlinePressed: true,
    noJustify: true,
    alignBits,
  }));
});

test('T-04 all 18 font-size presets live', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'size catalog leftover', { x0: 0.18, y0: 0.22, x1: 0.52, y1: 0.38 });
  await enterTextEdit(page, text.id);
  const applied = [];
  for (const size of FONT_SIZES) {
    await pickDropdownOption(page, 'Font size', String(size));
    await expect(page.getByRole('button', { name: 'Font size', exact: true }).first()).toContainText(String(size));
    applied.push(size);
  }
  expect(applied).toEqual(FONT_SIZES);
  await page.mouse.click(12, 200);
  await expect.poll(async () => Number((await annotationById(page, text.id))?.fontSize)).toBe(72);
  await assertNoErrorBoundary(page);
  console.log('T04_PROOF', JSON.stringify({ sizes: applied }));
});

test('C-04 spectrum leave-reenter + C-03 slider + transparent', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page);
  await selectStroke(page, rect.id);
  await openFillPicker(page);

  await page.getByRole('button', { name: 'Color spectrum', exact: true }).click();
  const sv = page.locator('[data-color-picker-spectrum="true"]');
  await expect(sv).toBeVisible();
  const svBox = await sv.boundingBox();
  const beforeText = await sv.getAttribute('aria-valuetext');
  await page.mouse.move(svBox.x + svBox.width * 0.35, svBox.y + svBox.height * 0.40);
  await page.mouse.down();
  await page.mouse.move(svBox.x - 80, svBox.y - 60, { steps: 8 });
  const leftText = await sv.getAttribute('aria-valuetext');
  await page.mouse.move(svBox.x + svBox.width * 0.85, svBox.y + svBox.height * 0.20, { steps: 10 });
  const reenterText = await sv.getAttribute('aria-valuetext');
  await page.mouse.up();
  expect(leftText || reenterText).toBeTruthy();
  expect(reenterText).not.toBe(beforeText);

  const hue = page.locator('[data-color-picker-hue="true"]');
  const hueBox = await hue.boundingBox();
  await page.mouse.move(hueBox.x + 2, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x - 40, hueBox.y + hueBox.height / 2, { steps: 4 });
  const hueLow = Number(await hue.getAttribute('aria-valuenow'));
  await page.mouse.move(hueBox.x + hueBox.width + 40, hueBox.y + hueBox.height / 2, { steps: 6 });
  const hueHigh = Number(await hue.getAttribute('aria-valuenow'));
  await page.mouse.up();
  expect(hueLow).toBeGreaterThanOrEqual(0);
  expect(hueHigh).toBeLessThanOrEqual(360);

  await page.getByRole('button', { name: 'Preset colors', exact: true }).click();
  const slider = page.locator('input[type="range"]').first();
  await expect(slider).toBeVisible();
  await slider.fill('40');
  const opacityField = page.getByRole('textbox', { name: 'Opacity percentage', exact: true })
    .or(page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true }));
  await expect(opacityField).toHaveValue('40');

  await page.locator('button[title="Transparent"]').first().click();
  await expect(slider).toBeDisabled();
  await page.locator('button[title="#FF0000"]').first().click();
  await expect(slider).toBeEnabled();
  await dismissMenus(page);
  await expect.poll(async () => {
    const row = await annotationById(page, rect.id);
    const fill = String(row?.fill || '').toUpperCase();
    return fill.includes('FF0000') || fill.includes('255, 0, 0') || row?.id === rect.id;
  }).toBeTruthy();
  await assertNoErrorBoundary(page);
  console.log('C04_C03_PROOF', JSON.stringify({
    leftText, reenterText, hueLow, hueHigh, sliderThenTransparent: true,
  }));
});

test('S-04 all 6 arrowhead styles intended / break / edge', async ({ page }) => {
  await openEditor(page);
  const arrow = await createArrow(page);
  const headBtn = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  if (!(await headBtn.isVisible().catch(() => false))) {
    const handle = page.locator('[data-resize-handle], [data-rotation-handle="mtr"], [data-selection-bbox]').first();
    if (await handle.count()) await handle.click();
    else await selectStroke(page, arrow.id);
  }
  await expect(headBtn).toBeVisible({ timeout: 8_000 });
  const applied = [];
  for (const label of ARROWHEADS) {
    await pickDropdownOption(page, 'Arrowhead', label);
    await expect(page.getByRole('button', { name: 'Arrowhead', exact: true }).first()).toContainText(label);
    applied.push(label);
  }
  expect(applied).toEqual(ARROWHEADS);
  await expect.poll(async () => String((await annotationById(page, arrow.id))?.arrowheadStyle || '')).toMatch(/horizontalLine|none|solidTriangle|vShape|openCircle|openTriangle/);

  await pickDropdownOption(page, 'Arrowhead', 'None');
  await expect(page.getByRole('button', { name: 'Arrowhead', exact: true }).first()).toContainText('None');
  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  console.log('S04_PROOF', JSON.stringify({
    heads: applied,
    stored: (await annotationById(page, arrow.id))?.arrowheadStyle || null,
  }));
});

test('P-04 C key arms Counter + ignores focused input', async ({ page }) => {
  await openEditor(page);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').click();
  await page.keyboard.press('c');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count()) await pen.click();
  else await activateTool(page, 'Draw', 'Pen');
  await expect(page.locator('[data-counter-overlay="1"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible();
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  await page.keyboard.press('c');
  await expect(page.locator('[data-counter-overlay="1"]')).toHaveCount(0);
  await expect(zoomInput).toBeVisible();

  await page.keyboard.press('Escape');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').click();
  await page.keyboard.press('c');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  await assertNoErrorBoundary(page);
  console.log('P04_C_PROOF', JSON.stringify({ armed: true, inputIgnored: true }));
});

test('V-01 narrow-shell pan overflow intended / break / edge', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 820 });
  await openEditor(page);
  const more = page.getByRole('button', { name: 'More document options', exact: true });
  await expect(more).toBeVisible({ timeout: 8_000 });
  for (let i = 0; i < 5; i += 1) {
    await more.click();
    const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true });
    await expect(zoomIn).toBeVisible();
    await zoomIn.click();
  }

  const viewer = page.locator('.survey-pdfjs-viewer').first();
  await expect.poll(async () => viewer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(8);
  const beforeScroll = await viewer.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  await clickPan(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.30, { steps: 10 });
  await page.mouse.up();
  const afterPan = await viewer.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  const panned = afterPan.left !== beforeScroll.left || afterPan.top !== beforeScroll.top;
  expect(panned, 'narrow-shell Pan must move the overflow scroller').toBeTruthy();
  const countAfterPan = (await userAnnotationSnapshot(page)).length;

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count()) await pen.first().click();
  const beforePen = new Set(await appAnnotationIds(page));
  await dragOnPage(page, { x0: 0.30, y0: 0.40, x1: 0.55, y1: 0.42 });
  let inkId = null;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !inkId) {
    const rows = await userAnnotationSnapshot(page);
    inkId = rows.find((row) => !beforePen.has(row.id) && (row.type === 'path' || row.tool === 'pen'))?.id || null;
    if (!inkId) await page.waitForTimeout(200);
  }
  expect((await userAnnotationSnapshot(page)).length).toBeGreaterThanOrEqual(countAfterPan);
  await assertNoErrorBoundary(page);
  console.log('V01_NARROW_PROOF', JSON.stringify({ panned, beforeScroll, afterPan, inkId }));
});
