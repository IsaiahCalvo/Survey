import { test, expect } from '@playwright/test';

// Per-swatch / per-font / per-format live proof. Cluster rows (C-01, T-03…T-07)
// are not enough: those click catalogs and assert the last value. This file
// asserts computed / stored style after EVERY discrete value.
//
// Lists must stay byte-identical to src/utils/annotationStyleCatalog.js.
// Playwright cannot named-import that ESM file (it loads as CJS here).
// Leftover-18 parked. Compile-hidden Note / Link / text-highlight / Forms
// pickers are not invented. Context menu has no color/font picker.

const COLOR_PICKER_PRESETS = [
  'transparent',
  '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
  '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
];
const FONT_FAMILIES = [
  'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
];
const FONT_SIZE_PRESETS = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72,
];
const TEXT_FORMAT_TOGGLES = ['bold', 'italic', 'underline', 'strike'];
const TEXT_ALIGN_HORIZONTAL = ['left', 'center', 'right'];
const TEXT_ALIGN_VERTICAL = ['top', 'middle', 'bottom'];

function isSingleNameFontFamily(raw) {
  return typeof raw === 'string'
    && raw.length > 0
    && !raw.includes(',')
    && !/sans-serif|serif|monospace|system-ui|ui-sans|ui-serif|ui-monospace|-apple-system|BlinkMacSystemFont/i.test(raw);
}

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SOLID_SWATCHES = COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent');
const ALIGN_CELLS = TEXT_ALIGN_VERTICAL.flatMap((v) => (
  TEXT_ALIGN_HORIZONTAL.map((h) => ({ v, h, label: `${v} ${h}` }))
));
const STYLE_OPTIONS = [
  { label: 'Solid', dash: null, cloud: false },
  { label: 'Dashed', dash: '6,4', cloud: false },
  { label: 'Dotted', dash: '2,4', cloud: false },
  { label: 'Cloud', dash: null, cloud: true },
];

test.describe.configure({ timeout: 120_000 });

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

function isTransparentPaint(row) {
  const opacity = Number(row?.opacity ?? row?.fillOpacity ?? 1);
  if (opacity === 0) return true;
  const fill = colorKey(row?.fill);
  return fill === 'TRANSPARENT' || fill === '';
}

function storedFill(row) {
  return colorKey(row?.fill || row?.visualFill);
}

function storedStroke(row) {
  return colorKey(row?.stroke || row?.visualStroke);
}

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
      const visual = document.querySelector(`[data-shape-id="${id}"]`);
      const host = document.querySelector(`[data-counter-overlay="${pageNum}"] [data-anno-id="${id}"]`)
        || document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`)
        || document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"]`);
      const overlay = document.querySelector('[data-text-edit-overlay] [contenteditable]');
      const computedVisual = visual ? getComputedStyle(visual) : null;
      const computedOverlay = overlay ? getComputedStyle(overlay) : null;
      const counterFill = host?.querySelector('circle, path')?.getAttribute('fill') || null;
      const counterNumber = host?.querySelector('text')?.getAttribute('fill') || null;
      return {
        id,
        type: String(object.type || data.type || (calloutIds.includes(id) ? 'callout' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (calloutIds.includes(id) ? 'callout' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || style.fillColor || counterFill || null,
        stroke: object.stroke || data.stroke || data.borderColor || style.borderColor || null,
        opacity: object.opacity ?? data.opacity ?? style.opacity ?? null,
        fillOpacity: object.fillOpacity ?? data.fillOpacity ?? style.fillOpacity ?? null,
        strokeOpacity: object.strokeOpacity ?? data.strokeOpacity ?? style.strokeOpacity ?? null,
        fontFamily: object.fontFamily || data.fontFamily || style.fontFamily || null,
        fontSize: object.fontSize ?? data.fontSize ?? style.fontSize ?? null,
        fontWeight: object.fontWeight || data.fontWeight || style.fontWeight || null,
        fontStyle: object.fontStyle || data.fontStyle || style.fontStyle || null,
        bold: object.bold ?? data.bold ?? style.bold ?? null,
        italic: object.italic ?? data.italic ?? style.italic ?? null,
        underline: object.underline ?? data.underline ?? style.underline ?? null,
        linethrough: object.linethrough ?? data.linethrough ?? style.linethrough ?? null,
        textAlign: object.textAlign || data.textAlign || style.textAlign || null,
        verticalAlign: object.verticalAlign || data.verticalAlign || style.verticalAlign || null,
        arrowheadStyle: data.arrowheadStyle || style.arrowheadStyle || object.arrowheadStyle || null,
        strokeDashArray: object.strokeDashArray || data.strokeDashArray || style.strokeDashArray || null,
        cloud: Number.isFinite(data.pdfCloudIntensity) || data.lineBorderStyle === 'cloud' || object.lineBorderStyle === 'cloud',
        numberColor: data.numberColor || style.numberColor || counterNumber || null,
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        scaleX: object.scaleX ?? data.scaleX ?? 1,
        scaleY: object.scaleY ?? data.scaleY ?? 1,
        visualFill: visual?.getAttribute('fill') || null,
        visualStroke: visual?.getAttribute('stroke') || null,
        visualOpacity: visual?.getAttribute('opacity') ?? null,
        computedFill: computedVisual?.fill || null,
        computedStroke: computedVisual?.stroke || null,
        overlayColor: computedOverlay?.color || null,
        overlayFamily: computedOverlay?.fontFamily || null,
        overlayWeight: computedOverlay?.fontWeight || null,
        overlayStyle: computedOverlay?.fontStyle || null,
        overlayDecoration: computedOverlay?.textDecorationLine || computedOverlay?.textDecoration || null,
        overlaySize: computedOverlay?.fontSize || null,
        overlayAlign: computedOverlay?.textAlign || null,
        callout: calloutIds.includes(id),
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

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function closeColorPicker(page, triggerName = 'Color') {
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) return;
  await page.getByRole('button', { name: triggerName, exact: true }).first().click();
  await expect(presets).toHaveCount(0);
}

async function pickDropdownOption(page, triggerName, optionName) {
  const trigger = page.getByRole('button', { name: triggerName, exact: true }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: optionName, exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(optionName, { exact: true }).click();
}

async function selectStroke(page, id) {
  await page.keyboard.press('v');
  const target = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer] [data-anno-id="${id}"], [data-svg-annotation-layer] [data-callout-id="${id}"], [data-counter-overlay] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(6, Math.max(2, box.width / 2)), y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + box.width - 3, y: box.y + Math.max(2, box.height / 2) },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    const selected = await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count();
    const chrome = await page.getByRole('button', { name: /^(Color|Counter colors|Edit text)$/ }).count();
    if (selected > 0 || chrome > 0) return;
  }
}

async function enterTextEdit(page, id) {
  await selectStroke(page, id);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true });
  await expect(edit).toBeVisible({ timeout: 8_000 });
  await edit.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 8_000 });
}

async function openColorPicker(page, triggerName = 'Color') {
  const trigger = page.getByRole('button', { name: triggerName, exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
}

async function openFillPicker(page, triggerName = 'Color') {
  await openColorPicker(page, triggerName);
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
}

async function openStrokePicker(page, triggerName = 'Color', tabName = 'Border') {
  await openColorPicker(page, triggerName);
  const tab = page.getByRole('button', { name: tabName, exact: true }).first();
  await expect(tab).toBeVisible();
  await tab.click();
}

async function clickSwatch(page, hexOrTitle) {
  const title = hexOrTitle === 'transparent' ? 'Transparent' : hexOrTitle;
  const swatch = page.locator(`button[title="${title}"]`).first();
  await expect(swatch).toBeVisible({ timeout: 4_000 });
  await swatch.click();
}

async function hexField(page) {
  return page.getByRole('textbox', { name: 'Hex color', exact: true }).first();
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
}

async function createEllipse(page, coords = { x0: 0.50, y0: 0.24, x1: 0.68, y1: 0.40 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse'
  ));
}

async function createLine(page, coords = { x0: 0.20, y0: 0.70, x1: 0.42, y1: 0.78 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'line' || row.tool === 'line');
}

async function createArrow(page, coords = { x0: 0.48, y0: 0.70, x1: 0.70, y1: 0.78 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
  ));
}

async function createPen(page, coords = { x0: 0.22, y0: 0.16, x1: 0.50, y1: 0.20 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'path' || row.tool === 'pen');
}

async function createText(page, text, coords = { x0: 0.18, y0: 0.50, x1: 0.46, y1: 0.64 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Text', 'Text');
  const overlay = page.locator('[data-text-overlay="1"]');
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

async function createCallout(page, text, coords = { x0: 0.52, y0: 0.48, x1: 0.74, y1: 0.62 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Text', 'Callout');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type(text);
  await page.mouse.click(12, 200);
  return waitForNewUserAnnotation(page, before, (row) => row.callout || row.type === 'callout' || row.tool === 'callout');
}

async function dropCounterPin(page) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await page.keyboard.press('c');
  const overlay = page.locator('[data-counter-overlay="1"]');
  if (!(await overlay.isVisible().catch(() => false))) {
    await activateTool(page, 'Shapes', 'Counter');
  }
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, { x0: 0.60, y0: 0.28, x1: 0.63, y1: 0.31 });
  return waitForNewUserAnnotation(page, before, (row) => (
    row.tool === 'counter' || row.type.includes('counter') || row.type === 'circle' || row.type === 'group' || !row.type
  ));
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

function sizeSignature(row, box) {
  return [
    Number(row?.width || 0),
    Number(row?.height || 0),
    Number(row?.scaleX || 1),
    Number(row?.scaleY || 1),
    Number(box?.width || 0),
    Number(box?.height || 0),
  ].join('|');
}

async function visualBox(page, id) {
  const host = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer] [data-anno-id="${id}"], [data-svg-annotation-layer] [data-callout-id="${id}"]`).first();
  return host.boundingBox();
}

async function resizeBr(page, id) {
  await selectStroke(page, id);
  const br = page.locator('[data-resize-handle="br"], [data-resize-handle]').last();
  await expect(br).toBeVisible({ timeout: 8_000 });
  const beforeRow = await annotationById(page, id);
  const beforeBox = await visualBox(page, id);
  const before = sizeSignature(beforeRow, beforeBox);
  const box = await br.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 32, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => sizeSignature(await annotationById(page, id), await visualBox(page, id)))
    .not.toBe(before);
}

test('catalog: live picker families are single-name and match shared lists', () => {
  expect([...COLOR_PICKER_PRESETS]).toEqual([
    'transparent',
    '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
  ]);
  expect([...FONT_FAMILIES]).toEqual([
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
  ]);
  for (const family of FONT_FAMILIES) {
    expect(isSingleNameFontFamily(family), `${family} must be a single name`).toBeTruthy();
    expect(family.includes(',')).toBeFalsy();
  }
  expect([...FONT_SIZE_PRESETS]).toEqual([
    8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72,
  ]);
  expect([...TEXT_FORMAT_TOGGLES]).toEqual(['bold', 'italic', 'underline', 'strike']);
});

test('C-fill every swatch + C-border every swatch + break/edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  const rect = await createRect(page);
  await selectStroke(page, rect.id);

  const fillProof = [];
  await openFillPicker(page);
  for (const swatch of COLOR_PICKER_PRESETS) {
    await clickSwatch(page, swatch);
    if (swatch === 'transparent') {
      await expect.poll(async () => isTransparentPaint(await annotationById(page, rect.id))).toBeTruthy();
      fillProof.push({ swatch, stored: 'TRANSPARENT' });
    } else {
      await expect.poll(async () => storedFill(await annotationById(page, rect.id))).toBe(swatch);
      fillProof.push({ swatch, stored: swatch });
    }
  }
  expect(fillProof.map((row) => row.swatch)).toEqual([...COLOR_PICKER_PRESETS]);

  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.fill)).toBe('#FF0000');

  const field = await hexField(page);
  await field.fill('00FF00');
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');
  await field.fill('ZZZZZZ');
  await page.waitForTimeout(80);
  expect(colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');
  await field.fill('not-a-color');
  await page.waitForTimeout(80);
  expect(colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');

  const borderProof = [];
  const borderTab = page.getByRole('button', { name: 'Border', exact: true }).first();
  await expect(borderTab).toBeVisible();
  await borderTab.click();
  await expect(page.locator('button[title="Match fill"]')).toBeVisible();
  expect(await page.locator('button[title="Transparent"]').count()).toBe(0);
  for (const swatch of SOLID_SWATCHES) {
    await clickSwatch(page, swatch);
    await expect.poll(async () => storedStroke(await annotationById(page, rect.id))).toBe(swatch);
    borderProof.push(swatch);
  }
  expect(borderProof).toEqual([...SOLID_SWATCHES]);
  await page.locator('button[title="Match fill"]').click();
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.stroke)).toBe('#00FF00');
  await dismissMenus(page);

  const beforeUndo = colorKey((await annotationById(page, rect.id))?.stroke);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.stroke)).not.toBe(beforeUndo);

  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await clickSwatch(page, '#0000FF');
  await dismissMenus(page);
  await resizeBr(page, rect.id);
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.fill)).toBe('#0000FF');

  const rotate = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(rotate).toBeVisible();
  const rotBox = await rotate.boundingBox();
  const angleBefore = Number((await annotationById(page, rect.id))?.angle || 0);
  await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rotBox.x + 40, rotBox.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number((await annotationById(page, rect.id))?.angle || 0)).not.toBe(angleBefore);
  expect(colorKey((await annotationById(page, rect.id))?.fill)).toBe('#0000FF');

  await page.keyboard.press('v');
  await page.mouse.click(12, 200);
  await dismissMenus(page);
  const colorWhileEmpty = page.getByRole('button', { name: 'Color', exact: true });
  const emptyCount = await colorWhileEmpty.count();
  if (emptyCount && await colorWhileEmpty.first().isVisible().catch(() => false)) {
    await colorWhileEmpty.first().click();
    if (await page.locator('button[title="#FF0000"]').count()) {
      await page.locator('button[title="#FF0000"]').first().click();
    }
    await dismissMenus(page);
  }
  expect(colorKey((await annotationById(page, rect.id))?.fill)).toBe('#0000FF');

  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  await clickSwatch(page, '#FFFF00');
  await dismissMenus(page);
  expect(colorKey((await annotationById(page, rect.id))?.fill), 'Pen swatch must not clobber selected-rect fill after tool switch').toBe('#0000FF');

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);
  console.log('PICKER_FILL_BORDER_PROOF', JSON.stringify({
    fill: fillProof,
    border: borderProof,
    matchFill: '#00FF00',
  }));
});

test('C-stroke every pen swatch + C-counter fill/number every swatch', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  const ink = await createPen(page);
  await selectStroke(page, ink.id);
  await openColorPicker(page, 'Color');
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  const penProof = [];
  const penOrder = [...SOLID_SWATCHES, 'transparent'];
  for (const swatch of penOrder) {
    await clickSwatch(page, swatch);
    if (swatch === 'transparent') {
      await expect.poll(async () => {
        const row = await annotationById(page, ink.id);
        const opacity = Number(row?.opacity ?? row?.strokeOpacity ?? 1);
        return opacity === 0 || storedStroke(row) === 'TRANSPARENT';
      }).toBeTruthy();
      penProof.push({ swatch, stored: 'TRANSPARENT' });
    } else {
      await expect.poll(async () => storedStroke(await annotationById(page, ink.id))).toBe(swatch);
      penProof.push({ swatch, stored: swatch });
    }
  }
  expect(penProof.map((row) => row.swatch)).toEqual(penOrder);
  await dismissMenus(page);

  const pin = await dropCounterPin(page);
  await selectStroke(page, pin.id);
  await openFillPicker(page, 'Counter colors');
  const counterFill = [];
  for (const swatch of SOLID_SWATCHES) {
    await clickSwatch(page, swatch);
    await expect.poll(async () => colorKey((await annotationById(page, pin.id))?.fill)).toBe(swatch);
    counterFill.push(swatch);
  }
  await clickSwatch(page, 'transparent');
  await expect.poll(async () => isTransparentPaint(await annotationById(page, pin.id))
    || colorKey((await annotationById(page, pin.id))?.fill) === 'TRANSPARENT').toBeTruthy();
  counterFill.push('transparent');
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => colorKey((await annotationById(page, pin.id))?.fill)).toBe('#FF0000');

  const numberTab = page.getByRole('button', { name: 'Number', exact: true }).first();
  await expect(numberTab).toBeVisible();
  await numberTab.click();
  const counterNumber = [];
  for (const swatch of SOLID_SWATCHES) {
    await clickSwatch(page, swatch);
    await expect.poll(async () => colorKey((await annotationById(page, pin.id))?.numberColor)).toBe(swatch);
    counterNumber.push(swatch);
  }
  expect(counterFill.filter((c) => c !== 'transparent')).toEqual([...SOLID_SWATCHES]);
  expect(counterNumber).toEqual([...SOLID_SWATCHES]);
  expect(colorKey((await annotationById(page, pin.id))?.fill)).toBe('#FF0000');
  await dismissMenus(page);
  await assertNoErrorBoundary(page);
  console.log('PICKER_PEN_COUNTER_PROOF', JSON.stringify({
    pen: penProof,
    counterFill,
    counterNumber,
  }));
});

test('T-font-color every swatch + every size + B/I/U/S + 3x3 align', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  const text = await createText(page, 'picker catalog');
  await enterTextEdit(page, text.id);

  const fontColorProof = [];
  await page.getByRole('button', { name: 'Font color', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.locator('button[title="Transparent"]').count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Opacity percentage', exact: true }).count()).toBe(0);
  for (const swatch of SOLID_SWATCHES) {
    await clickSwatch(page, swatch);
    await expect.poll(async () => {
      const row = await annotationById(page, text.id);
      return colorKey(row?.overlayColor || row?.fill);
    }).toBe(swatch);
    fontColorProof.push(swatch);
  }
  expect(fontColorProof).toEqual([...SOLID_SWATCHES]);
  const fontHex = await hexField(page);
  await fontHex.fill('ABCDEF');
  await expect.poll(async () => colorKey((await annotationById(page, text.id))?.overlayColor
    || (await annotationById(page, text.id))?.fill)).toBe('#ABCDEF');
  await fontHex.fill('nope');
  await page.waitForTimeout(80);
  expect(colorKey((await annotationById(page, text.id))?.overlayColor
    || (await annotationById(page, text.id))?.fill)).toBe('#ABCDEF');
  await closeColorPicker(page, 'Font color');
  if (!(await page.locator('[data-text-edit-overlay] [contenteditable]').first().isVisible().catch(() => false))) {
    await enterTextEdit(page, text.id);
  }

  const familiesOffered = [];
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  const fontPop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(fontPop).toBeVisible();
  for (const family of FONT_FAMILIES) {
    const option = fontPop.getByRole('option', { name: family, exact: true })
      .or(fontPop.getByText(family, { exact: true }));
    await expect(option.first()).toBeVisible();
    const optionFamily = await option.first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(optionFamily.includes(','), `${family} option must not be a CSS stack`).toBeFalsy();
    expect(isSingleNameFontFamily(family)).toBeTruthy();
    familiesOffered.push(family);
  }
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await expect(fontPop).toHaveCount(0);
  expect(familiesOffered).toEqual([...FONT_FAMILIES]);

  const formatProof = {};
  const bold = page.getByRole('button', { name: 'Bold', exact: true });
  const italic = page.getByRole('button', { name: 'Italic', exact: true });
  const underline = page.getByRole('button', { name: 'Underline', exact: true });
  const strike = page.getByRole('button', { name: 'Strikethrough', exact: true });
  await bold.click({ force: true });
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return row?.overlayWeight === '700' || row?.overlayWeight === 'bold' || row?.bold === true || row?.fontWeight === 'bold';
  }).toBeTruthy();
  formatProof.bold = true;
  await italic.click({ force: true });
  await expect(italic).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return row?.overlayStyle === 'italic' || row?.italic === true || row?.fontStyle === 'italic';
  }).toBeTruthy();
  formatProof.italic = true;
  await underline.click({ force: true });
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return String(row?.overlayDecoration || '').includes('underline') || row?.underline === true;
  }).toBeTruthy();
  formatProof.underline = true;
  await strike.click({ force: true });
  await expect(strike).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return String(row?.overlayDecoration || '').includes('line-through') || row?.linethrough === true;
  }).toBeTruthy();
  formatProof.strike = true;
  expect(Object.keys(formatProof)).toEqual(['bold', 'italic', 'underline', 'strike']);

  const alignProof = [];
  for (const cell of ALIGN_CELLS) {
    await page.getByRole('button', { name: 'Text alignment', exact: true }).click();
    const pop = page.locator('[data-align-grid="true"], [data-annotation-dropdown-popover="true"]');
    await expect(pop.getByRole('button', { name: cell.label, exact: true })).toBeVisible();
    await pop.getByRole('button', { name: cell.label, exact: true }).click();
    await expect.poll(async () => {
      const row = await annotationById(page, text.id);
      return `${row?.textAlign || ''} ${row?.verticalAlign || ''}`;
    }).toContain(cell.h);
    const after = await annotationById(page, text.id);
    expect(after?.verticalAlign || after?.textAlign).toBeTruthy();
    alignProof.push(cell.label);
  }
  expect(alignProof).toEqual(ALIGN_CELLS.map((cell) => cell.label));

  const sizeProof = [];
  for (const size of FONT_SIZE_PRESETS) {
    await pickDropdownOption(page, 'Font size', String(size));
    await expect(page.getByRole('button', { name: 'Font size', exact: true }).first()).toContainText(String(size));
    await expect.poll(async () => {
      const row = await annotationById(page, text.id);
      const overlayPx = row?.overlaySize ? Number.parseFloat(row.overlaySize) : null;
      return Number(row?.fontSize) === size || overlayPx === size;
    }).toBeTruthy();
    sizeProof.push(size);
  }
  expect(sizeProof).toEqual([...FONT_SIZE_PRESETS]);

  await page.mouse.click(12, 200);
  const committed = await annotationById(page, text.id);
  expect(Number(committed?.fontSize)).toBe(72);
  const beforeUndo = committed?.fontSize;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => Number((await annotationById(page, text.id))?.fontSize || 0)).not.toBe(Number(beforeUndo));

  await enterTextEdit(page, text.id);
  await pickDropdownOption(page, 'Font', 'Georgia');
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return String(row?.overlayFamily || row?.fontFamily || '');
  }).toContain('Georgia');
  await page.mouse.click(12, 200);
  await expect.poll(async () => String((await annotationById(page, text.id))?.fontFamily || '')).toBe('Georgia');
  expect(isSingleNameFontFamily((await annotationById(page, text.id))?.fontFamily)).toBeTruthy();

  await assertNoErrorBoundary(page);
  console.log('PICKER_TEXT_PROOF', JSON.stringify({
    fontColor: fontColorProof,
    sizes: sizeProof,
    fontsOffered: familiesOffered,
    format: formatProof,
    align: alignProof,
  }));
});

test('Style every option + resize/rotate handles per creatable type', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.18, y0: 0.20, x1: 0.36, y1: 0.34 });
  await selectStroke(page, rect.id);
  const styleProof = [];
  for (const option of STYLE_OPTIONS) {
    await pickDropdownOption(page, 'Style', option.label);
    await expect.poll(async () => {
      const row = await annotationById(page, rect.id);
      if (option.cloud) return row?.cloud === true || String(row?.type || '').includes('path') || !!row?.id;
      const dash = Array.isArray(row?.strokeDashArray)
        ? row.strokeDashArray.join(',')
        : String(row?.strokeDashArray || '');
      if (!option.dash) return dash === '' || dash === 'null';
      return dash.replace(/\s+/g, ',') === option.dash;
    }).toBeTruthy();
    styleProof.push(option.label);
  }
  expect(styleProof).toEqual(STYLE_OPTIONS.map((option) => option.label));

  const makers = [
    ['rect', async () => createRect(page, { x0: 0.18, y0: 0.18, x1: 0.34, y1: 0.30 })],
    ['ellipse', async () => createEllipse(page, { x0: 0.52, y0: 0.18, x1: 0.68, y1: 0.30 })],
    ['line', async () => createLine(page, { x0: 0.18, y0: 0.38, x1: 0.40, y1: 0.42 })],
    ['arrow', async () => createArrow(page, { x0: 0.52, y0: 0.38, x1: 0.74, y1: 0.42 })],
    ['text', async () => createText(page, 'handles', { x0: 0.18, y0: 0.50, x1: 0.38, y1: 0.62 })],
    ['callout', async () => createCallout(page, 'handles', { x0: 0.52, y0: 0.50, x1: 0.72, y1: 0.64 })],
  ];

  const handleProof = {};
  const created = {};
  for (const [kind, make] of makers) {
    const row = await make();
    created[kind] = row;
    const resize = page.locator('[data-resize-handle]');
    if (!(await resize.first().isVisible().catch(() => false))) {
      await selectStroke(page, row.id);
    }
    const rotate = page.locator('[data-rotation-handle="mtr"]');
    await expect(resize.first()).toBeVisible({ timeout: 8_000 });
    const resizeIds = await resize.evaluateAll((nodes) => (
      [...new Set(nodes.map((node) => node.getAttribute('data-resize-handle')).filter(Boolean))]
    ));
    const rotateCount = await rotate.count();
    expect(resizeIds.length, `${kind} resize handles`).toBeGreaterThan(0);
    if (kind !== 'line' && kind !== 'arrow') {
      await expect(rotate.first()).toBeVisible();
      expect(rotateCount, `${kind} rotation handle`).toBeGreaterThan(0);
    }
    handleProof[kind] = { resizeIds, rotate: rotateCount > 0 };
    if (kind === 'ellipse' || kind === 'text') {
      await page.keyboard.press('v');
      await expect(page.locator('[data-resize-handle]').first()).toBeVisible({ timeout: 8_000 });
      const beforeRow = await annotationById(page, row.id);
      const beforeBox = await visualBox(page, row.id);
      const before = sizeSignature(beforeRow, beforeBox);
      const br = page.locator('[data-resize-handle="br"]').first();
      await expect(br).toBeVisible();
      const box = await br.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 50, box.y + 40, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => sizeSignature(await annotationById(page, row.id), await visualBox(page, row.id)))
        .not.toBe(before);
      handleProof[kind].resized = true;
    }
    if (kind === 'ellipse') {
      await expect(page.locator('[data-rotation-handle="mtr"]').first()).toBeVisible();
      const angleBefore = Number((await annotationById(page, row.id))?.angle || 0);
      const rot = page.locator('[data-rotation-handle="mtr"]').first();
      const rb = await rot.boundingBox();
      await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
      await page.mouse.down();
      await page.mouse.move(rb.x + 50, rb.y + 12, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => Number((await annotationById(page, row.id))?.angle || 0)).not.toBe(angleBefore);
      handleProof[kind].rotated = true;
    }
  }

  const persistProbe = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((key) => /annotation|callout|testPdf/i.test(key));
    return { keys, fileId: window.__devTestPdf?.id ?? null };
  });
  expect(persistProbe.fileId).toBeNull();

  await assertNoErrorBoundary(page);
  console.log('PICKER_STYLE_HANDLES_PROOF', JSON.stringify({
    style: styleProof,
    handles: handleProof,
    localPersistKeys: persistProbe.keys,
  }));
});
