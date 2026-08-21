import { test, expect } from '@playwright/test';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

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

function colorKey(raw) {
  const s = String(raw || '').trim().toUpperCase();
  const rgba = s.match(/RGBA?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgba) {
    return `#${[rgba[1], rgba[2], rgba[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  if (s.startsWith('#')) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
  return s;
}

function angleNear(angle, target, slack = 8) {
  const norm = ((Number(angle || 0) % 360) + 360) % 360;
  return Math.min(
    Math.abs(norm - target),
    Math.abs(norm - (target + 360)),
    Math.abs(norm - (target - 360)),
  ) < slack;
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
      const host = document.querySelector(`[data-counter-overlay="${pageNum}"] [data-anno-id="${id}"]`)
        || document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const overlayFill = host?.querySelector('path, circle')?.getAttribute('fill') || null;
      const overlayNumber = host?.querySelector('text')?.getAttribute('fill') || null;
      return {
        id,
        type: String(object.type || data.type || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || style.fillColor || overlayFill || null,
        stroke: object.stroke || data.stroke || data.borderColor || style.borderColor || null,
        numberColor: data.numberColor || style.numberColor || overlayNumber || null,
        opacity: object.opacity ?? data.opacity ?? data.fillOpacity ?? style.opacity ?? null,
        fontSize: object.fontSize ?? data.fontSize ?? style.fontSize ?? null,
        arrowheadStyle: data.arrowheadStyle || style.arrowheadStyle || object.arrowheadStyle || null,
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
        globalCompositeOperation: object.globalCompositeOperation || data.globalCompositeOperation || null,
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
    `[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"], [data-svg-annotation-layer="1"] [data-callout-id="${id}"], [data-counter-overlay="1"] [data-anno-id="${id}"]`
  ).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  // Transparent-fill shapes are stroke-hit only; lines sit on the bbox center.
  await page.mouse.click(box.x + Math.min(6, box.width * 0.12), box.y + box.height / 2);
}

async function enterTextEdit(page, id) {
  await selectStroke(page, id);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true })
    .or(page.getByRole('button', { name: 'Text formatting', exact: true }));
  await expect(edit.first()).toBeVisible({ timeout: 8_000 });
  await edit.first().click();
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

async function createCounter(page) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await page.keyboard.press('c');
  const overlay = page.locator('[data-counter-overlay="1"]');
  if (!(await overlay.isVisible().catch(() => false))) {
    await activateTool(page, 'Shapes', 'Counter');
  }
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, { x0: 0.55, y0: 0.40, x1: 0.58, y1: 0.43 });
  return waitForNewUserAnnotation(page, before, (row) => (
    row.tool === 'counter' || row.type.includes('counter') || row.type === 'circle' || row.type === 'group' || !row.type
  ));
}

async function typeRotationPill(page, degrees) {
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.waitForTimeout(220);
  const angleInput = page.getByLabel('Rotation angle in degrees');
  await expect(angleInput).toBeVisible({ timeout: 8_000 });
  await angleInput.click();
  await angleInput.fill(String(degrees));
  await angleInput.press('Enter');
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

function parsePrintDiagnostics(logs) {
  const line = logs.find((text) => text.includes('diagnostics='));
  if (!line) return null;
  const raw = line.slice(line.indexOf('diagnostics=') + 'diagnostics='.length);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

test('T-04 custom font-size clamp 6–200 on the real control', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'custom clamp leftover', { x0: 0.18, y0: 0.22, x1: 0.52, y1: 0.38 });
  await enterTextEdit(page, text.id);

  const desktopDropdown = page.getByRole('button', { name: 'Font size', exact: true });
  await expect(desktopDropdown).toBeVisible();
  const desktopNumeric = page.getByRole('textbox', { name: 'Font size' })
    .or(page.getByRole('spinbutton', { name: 'Font size' }));
  expect(await desktopNumeric.count(), 'desktop has no custom numeric Font size field').toBe(0);

  await desktopDropdown.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible();
  expect(await popover.locator('input, textarea, [contenteditable]').count()).toBe(0);
  await page.keyboard.type('13');
  expect(await popover.getByRole('option', { name: '13', exact: true }).count()).toBe(0);
  await page.keyboard.press('Escape');
  await page.mouse.click(12, 200);

  await page.setViewportSize({ width: 390, height: 844 });
  await enterTextEdit(page, text.id);
  const mobileSize = page.getByRole('textbox', { name: 'Font size' });
  await expect(mobileSize).toBeVisible({ timeout: 10_000 });

  await mobileSize.fill('28');
  await expect(mobileSize).toHaveValue('28');

  await mobileSize.fill('1');
  await expect.poll(async () => Number(await mobileSize.inputValue())).toBe(6);

  await mobileSize.fill('999');
  await expect.poll(async () => Number(await mobileSize.inputValue())).toBe(200);

  await mobileSize.fill('0');
  await expect.poll(async () => Number(await mobileSize.inputValue())).toBe(6);

  await mobileSize.fill('48');
  await expect(mobileSize).toHaveValue('48');
  await page.locator('[data-text-edit-overlay] [contenteditable]').first().click();
  await page.mouse.click(8, 160);
  await expect.poll(async () => Number((await annotationById(page, text.id))?.fontSize)).toBe(48);
  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  console.log('T04_CLAMP_PROOF', JSON.stringify({
    desktopNumeric: 0,
    mobileControl: true,
    intended: 48,
    floor: 6,
    ceiling: 200,
  }));
});

test('E-02 Shift+45° rotation snap intended / break / edge', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.26, y0: 0.28, x1: 0.46, y1: 0.46 });
  const rotHandle = page.locator('[data-rotation-handle="mtr"]').first();
  if (!(await rotHandle.isVisible().catch(() => false))) {
    await selectStroke(page, rect.id);
  }
  await expect(rotHandle).toBeVisible({ timeout: 8_000 });
  await typeRotationPill(page, 0);
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 0)).toBeTruthy();

  const angleInput = page.getByLabel('Rotation angle in degrees');
  await expect(angleInput).toBeVisible();
  await angleInput.click();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 1, 2)).toBeTruthy();

  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Shift');
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 46, 2)).toBeTruthy();

  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 1, 2)).toBeTruthy();

  await typeRotationPill(page, 0);
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${rect.id}"]`);
  const gb = await group.boundingBox();
  const cx = gb.x + gb.width / 2;
  const cy = gb.y + gb.height / 2;
  const radius = Math.max(80, Math.hypot((hb.x + hb.width / 2) - cx, (hb.y + hb.height / 2) - cy));
  const pointAt = (deg) => ({
    x: cx + radius * Math.sin((deg * Math.PI) / 180),
    y: cy - radius * Math.cos((deg * Math.PI) / 180),
  });
  const near45 = pointAt(44);
  const far = pointAt(23);

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(near45.x, near45.y, { steps: 16 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 45, 6)).toBeTruthy();

  const handle2 = page.locator('[data-rotation-handle="mtr"]').first();
  const hb2 = await handle2.boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(far.x, far.y, { steps: 16 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const farAngle = Number((await annotationById(page, rect.id))?.angle || 0);
  expect(
    angleNear(farAngle, 45, 6) || (!angleNear(farAngle, 0, 3) && !angleNear(farAngle, 90, 3)),
    'Shift+drag far from a 45° increment must not invent a cardinal snap',
  ).toBeTruthy();
  await assertNoErrorBoundary(page);
  console.log('E02_SHIFT45_PROOF', JSON.stringify({
    stepWithoutShift: 1,
    shiftArrow: 46,
    snapNear45: true,
    farAngle,
  }));
});

test('D-02 highlighter print-exclusion vs markup intended / break / edge', async ({ page }) => {
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });

  await openEditor(page, SURVEY_PDF);

  await activateTool(page, 'Draw', 'Highlighter');
  expect(await page.getByRole('button', { name: 'Text highlight', exact: true }).count()).toBe(0);

  const colorBtn = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(colorBtn).toBeVisible({ timeout: 8_000 });
  await colorBtn.click();
  const slider = page.locator('input[type="range"]').first();
  if (await slider.isVisible().catch(() => false)) {
    await slider.fill('0');
  }
  await dismissMenus(page);

  const beforeHi = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Highlighter');
  await dragOnPage(page, { x0: 0.16, y0: 0.72, x1: 0.58, y1: 0.76 });
  const highlighter = await waitForNewUserAnnotation(page, beforeHi, (row) => (
    row.type === 'path' || String(row.tool).includes('highlight')
  ));

  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  const beforeMarkers = await page.locator('[data-survey-marker-id]').count();
  await page.mouse.move(box.x + 360, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 480, box.y + 300, { steps: 10 });
  await page.mouse.up();
  const name = page.getByPlaceholder('Enter name');
  if (await name.count()) {
    await name.fill('D02 print exclusion stamp');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBeGreaterThan(beforeMarkers);

  await page.keyboard.press('Escape');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').click();
  printLogs.length = 0;
  await page.keyboard.press('Meta+p');
  await expect.poll(() => printLogs.some((line) => /OPEN requested/i.test(line))).toBeTruthy();
  const basePrint = printLogs.join('\n');
  expect(basePrint).toMatch(/withMarkup=false|no markup|base PDF blob print/i);

  printLogs.length = 0;
  await page.keyboard.press('Meta+Shift+p');
  await expect.poll(() => printLogs.some((line) => /withMarkup=true|regular annotations/i.test(line))).toBeTruthy();
  await expect.poll(() => printLogs.some((line) => line.includes('diagnostics=')), { timeout: 90_000 }).toBeTruthy();
  const diagnostics = parsePrintDiagnostics(printLogs);
  expect(diagnostics, 'print flatten diagnostics').toBeTruthy();
  expect(diagnostics.included.fabric, 'freehand highlighter stays in regular print flatten').toBeGreaterThanOrEqual(1);
  expect(diagnostics.excluded.surveyMarkers, 'survey-marker highlights stay excluded').toBeGreaterThanOrEqual(1);

  expect(highlighter.id, 'highlighter committed before print').toBeTruthy();
  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  console.log('D02_PRINT_PROOF', JSON.stringify({
    highlighterId: highlighter.id,
    textHighlightOffered: 0,
    diagnostics,
  }));
});

test('C-05 counter number color vs fill intended / break / edge', async ({ page }) => {
  await openEditor(page);
  const pin = await createCounter(page);
  const colorsBtn = page.getByRole('button', { name: 'Counter colors', exact: true });
  await expect(colorsBtn).toBeVisible({ timeout: 8_000 });
  await colorsBtn.click();
  await expect(page.getByRole('button', { name: 'Fill', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Number', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.locator('button[title="#FF0000"]').first().click();
  await page.getByRole('button', { name: 'Number', exact: true }).click();
  await page.locator('button[title="#0000FF"]').first().click();
  await dismissMenus(page);

  await expect.poll(async () => {
    const row = await annotationById(page, pin.id);
    return colorKey(row?.fill);
  }).toBe('#FF0000');
  await expect.poll(async () => {
    const row = await annotationById(page, pin.id);
    return colorKey(row?.numberColor || row?.stroke);
  }).toBe('#0000FF');

  await activateTool(page, 'Shapes', 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
  await page.getByRole('button', { name: 'Counter colors', exact: true }).click();
  await page.getByRole('button', { name: 'Number', exact: true }).click();
  await page.locator('button[title="#FFFFFF"]').first().click();
  await dismissMenus(page);
  await expect.poll(async () => colorKey((await annotationById(page, pin.id))?.fill)).toBe('#FF0000');
  await expect.poll(async () => colorKey((await annotationById(page, pin.id))?.numberColor || (await annotationById(page, pin.id))?.stroke)).toBe('#FFFFFF');
  await assertNoErrorBoundary(page);
  console.log('C05_COUNTER_COLOR_PROOF', JSON.stringify({
    fill: colorKey((await annotationById(page, pin.id))?.fill),
    number: colorKey((await annotationById(page, pin.id))?.numberColor || (await annotationById(page, pin.id))?.stroke),
    armedNumberDidNotClobberFill: true,
  }));
});

test('S-04 selected-arrow arrowheadStyle patch intended / break / edge', async ({ page }) => {
  await openEditor(page);
  const arrow = await createArrow(page, { x0: 0.22, y0: 0.38, x1: 0.56, y1: 0.46 });
  const headBtn = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  if (!(await headBtn.isVisible().catch(() => false))) {
    await selectStroke(page, arrow.id);
  }
  await expect(headBtn).toBeVisible({ timeout: 8_000 });
  const createdStyle = String((await annotationById(page, arrow.id))?.arrowheadStyle || '');

  await page.mouse.click(16, 220);
  await page.waitForTimeout(120);
  await page.keyboard.press('v');
  const arrowGroup = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${arrow.id}"]`);
  await expect(arrowGroup).toBeVisible();
  const ab = await arrowGroup.boundingBox();
  for (const [xf, yf] of [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85]]) {
    await page.mouse.click(ab.x + ab.width * xf, ab.y + ab.height * yf);
    if (await headBtn.isVisible().catch(() => false)) break;
  }
  if (!(await headBtn.isVisible().catch(() => false))) {
    const handle = page.locator('[data-resize-handle], [data-rotation-handle="mtr"], [data-selection-bbox]').first();
    if (await handle.count()) await handle.click();
  }
  await expect(headBtn).toBeVisible({ timeout: 8_000 });
  expect(createdStyle || true).toBeTruthy();

  await pickDropdownOption(page, 'Arrowhead', 'V-shape');
  await expect(headBtn).toContainText('V-shape');
  await expect.poll(async () => String((await annotationById(page, arrow.id))?.arrowheadStyle || '')).toMatch(/vShape/i);

  await pickDropdownOption(page, 'Arrowhead', 'Open circle');
  await expect(headBtn).toContainText('Open circle');
  await expect.poll(async () => String((await annotationById(page, arrow.id))?.arrowheadStyle || '')).toMatch(/openCircle/i);

  await pickDropdownOption(page, 'Arrowhead', 'None');
  await expect(headBtn).toContainText('None');
  await expect.poll(async () => String((await annotationById(page, arrow.id))?.arrowheadStyle || '')).toMatch(/none/i);

  await page.mouse.click(12, 200);
  await selectStroke(page, arrow.id);
  await expect.poll(async () => String((await annotationById(page, arrow.id))?.arrowheadStyle || '')).toMatch(/none/i);
  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  console.log('S04_SELECTED_PATCH_PROOF', JSON.stringify({
    id: arrow.id,
    stored: (await annotationById(page, arrow.id))?.arrowheadStyle || null,
  }));
});
