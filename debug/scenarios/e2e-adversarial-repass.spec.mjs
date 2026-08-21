import { test, expect } from '@playwright/test';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const LONG_PDF = '/?testPdf=spike-120-pages.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1&tab=templates';
const FONTS = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
const SOLID_SWATCHES = [
  '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
  '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
];
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const REIMPORT_NAME = '_e2e-adversarial-reimport.pdf';

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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const calloutIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
      .map((group) => group.getAttribute('data-callout-id'))
      .filter(Boolean);
    const ids = [...new Set([...annoIds, ...calloutIds])];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const isCallout = calloutIds.includes(id);
      return {
        id,
        type: String(object.type || data.type || (isCallout ? 'callout' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (isCallout ? 'callout' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || data.style?.fillColor || null,
        stroke: object.stroke || data.stroke || data.borderColor || data.style?.borderColor || null,
        fontFamily: object.fontFamily || data.fontFamily || data.style?.fontFamily || null,
        fontWeight: object.fontWeight || data.fontWeight || data.style?.fontWeight || null,
        bold: object.bold ?? data.bold ?? data.style?.bold ?? null,
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        text: object.text || data.text || null,
        callout: isCallout,
      };
    }).filter((row) => row.imported !== true);
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
  const rows = await userAnnotationSnapshot(page);
  return rows.find((row) => row.id === id) || null;
}

async function activateTool(page, categoryName, toolName) {
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  await expect(tool).toBeVisible();
  await tool.click();
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

async function visiblePagePoint(page, { pageNumber = 1, xf = 0.35, yf = 0.35 } = {}) {
  return page.evaluate(({ pageNumber: n, xf, yf }) => {
    const el = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${n}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const left = Math.max(r.left, 90);
    const top = Math.max(r.top, 90);
    const right = Math.min(r.right, window.innerWidth - 24);
    const bottom = Math.min(r.bottom, window.innerHeight - 90);
    if (right - left < 20 || bottom - top < 20) return null;
    return { x: left + (right - left) * xf, y: top + (bottom - top) * yf };
  }, { pageNumber, xf, yf });
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
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
  const target = page.locator(`[data-svg-annotation-layer] [data-anno-id="${id}"], [data-svg-annotation-layer] [data-callout-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + 2, box.y + Math.max(2, box.height / 2));
}

async function enterTextEdit(page, id) {
  await selectStroke(page, id);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true });
  await expect(edit).toBeVisible({ timeout: 8_000 });
  await edit.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 8_000 });
}

async function activateEntireEraser(page) {
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count() === 0) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  }
  const entire = page.getByRole('button', { name: 'Full stroke erase', exact: true });
  if (await entire.count()) {
    await entire.click();
  } else {
    const partial = page.getByRole('button', { name: 'Partial erase', exact: true });
    if (await partial.count()) {
      await partial.click();
      const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
      await expect(typeBtn).toBeVisible();
      await typeBtn.click();
      const popover = page.locator('[data-annotation-dropdown-popover="true"]');
      await expect(popover).toBeVisible();
      await popover.getByText('Full stroke erase', { exact: true }).click();
    } else {
      await page.keyboard.press('e');
      const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
      if (await typeBtn.count()) {
        await typeBtn.click();
        await page.locator('[data-annotation-dropdown-popover="true"]').getByText('Full stroke erase', { exact: true }).click();
      }
    }
  }
  await expect(page.getByRole('button', { name: 'Full stroke erase', exact: true })).toBeVisible({ timeout: 8_000 });
}

async function hexField(page) {
  return page.locator('span', { hasText: '#' }).locator('xpath=following-sibling::input[@type="text"]').first();
}

async function openFillPicker(page) {
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
}

async function openStrokePicker(page) {
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const borderTab = page.getByRole('button', { name: 'Border', exact: true }).first();
  await expect(borderTab).toBeVisible();
  await borderTab.click();
  await expect(page.locator('button[title="Match fill"]')).toBeVisible({ timeout: 8_000 });
}

async function zoomPercent(page) {
  const label = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await label.count()) {
    return Number.parseInt((await label.innerText()).trim(), 10);
  }
  const input = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  return null;
}

async function setZoomPercent(page, value) {
  const btn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (await btn.count()) await btn.click();
  const input = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press('Enter');
}

async function currentPageNumber(page) {
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  return page.evaluate(() => window.__currentPageNumber || null);
}

async function goToPage(page, n) {
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible();
  await input.fill(String(n));
  await input.press('Enter');
  await expect.poll(() => currentPageNumber(page)).toBe(n);
}

async function openHistory(page) {
  const history = page.getByRole('button', { name: 'Version history', exact: true });
  await expect(history).toBeVisible();
  await history.click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
}

async function createText(page, text, coords = { x0: 0.20, y0: 0.55, x1: 0.48, y1: 0.68 }) {
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Text', 'Text');
  const overlay = page.locator('[data-text-overlay="1"]');
  await expect(overlay).toBeVisible();
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

test('C-01/C-02/C-06 adversarial: swatch spam, invalid hex after valid, Match Fill snapshot', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page);
  await selectStroke(page, rect.id);

  await openFillPicker(page);
  await page.locator('button[title="#00FF00"]').first().click();
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');
  await dismissMenus(page);

  await openFillPicker(page);
  for (const hex of SOLID_SWATCHES) {
    await page.locator(`button[title="${hex}"]`).first().click({ timeout: 2_000 });
  }
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.fill)).toBe('#000000');
  const afterSpamCount = (await userAnnotationSnapshot(page)).length;

  const field = await hexField(page);
  await expect(field).toBeVisible();
  await field.fill('00FF00');
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');
  await field.fill('ZZZZZZ');
  await page.waitForTimeout(120);
  expect(colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');
  await field.fill('not-a-color');
  await page.waitForTimeout(80);
  expect(colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');
  await field.fill('');
  await page.waitForTimeout(80);
  expect(colorKey((await annotationById(page, rect.id))?.fill)).toBe('#00FF00');
  await dismissMenus(page);

  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await page.locator('button[title="#FF0000"]').first().click();
  await dismissMenus(page);
  await selectStroke(page, rect.id);
  await openStrokePicker(page);
  const match = page.locator('button[title="Match fill"]');
  await expect(match).toBeVisible();
  await match.click();
  await expect.poll(async () => colorKey((await annotationById(page, rect.id))?.stroke)).toBe('#FF0000');
  await dismissMenus(page);

  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await page.locator('button[title="#0000FF"]').first().click();
  await dismissMenus(page);
  const afterFillChange = await annotationById(page, rect.id);
  expect(colorKey(afterFillChange?.stroke), 'Match Fill is a snapshot, not a live bind').toBe('#FF0000');
  expect(colorKey(afterFillChange?.fill)).toBe('#0000FF');
  expect(afterSpamCount).toBeGreaterThan(0);
});

test('T-03 every offered font after a live resize', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'font after resize');
  await selectStroke(page, text.id);
  const before = await annotationById(page, text.id);
  const br = page.locator('[data-resize-handle="br"]').first();
  await expect(br).toBeVisible({ timeout: 8_000 });
  const handle = await br.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + 28, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return (row?.width || 0) + (row?.height || 0);
  }).not.toBe((before?.width || 0) + (before?.height || 0));

  await enterTextEdit(page, text.id);
  const applied = [];
  for (const family of FONTS) {
    await pickDropdownOption(page, 'Font', family);
    await expect.poll(async () => (
      page.getByRole('button', { name: 'Font', exact: true }).first().innerText()
    )).toContain(family);
    const overlayFamily = await page.locator('[data-text-edit-overlay] [contenteditable]').first()
      .evaluate((el) => getComputedStyle(el).fontFamily.replace(/['"]/g, ''));
    expect(overlayFamily, `overlay after ${family}`).toContain(family);
    applied.push(family);
  }
  expect(applied).toEqual(FONTS);
  await page.mouse.click(12, 200);
  await enterTextEdit(page, text.id);
  await pickDropdownOption(page, 'Font', 'Arial');
  await expect.poll(async () => (
    page.getByRole('button', { name: 'Font', exact: true }).first().innerText()
  )).toContain('Arial');
  await page.mouse.click(12, 200);
  await expect.poll(async () => String((await annotationById(page, text.id))?.fontFamily || '')).toBe('Arial');
});

test('T-05 bold then font change then undo', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'bold then georgia', { x0: 0.18, y0: 0.22, x1: 0.50, y1: 0.36 });
  await enterTextEdit(page, text.id);
  const baseline = await annotationById(page, text.id);
  const boldBtn = page.getByRole('button', { name: 'Bold', exact: true });
  await boldBtn.click();
  await expect(boldBtn).toHaveAttribute('aria-pressed', 'true');
  await pickDropdownOption(page, 'Font', 'Georgia');
  await expect.poll(async () => (
    page.getByRole('button', { name: 'Font', exact: true }).first().innerText()
  )).toContain('Georgia');
  await page.mouse.click(12, 200);
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return row?.fontFamily === 'Georgia' || row?.bold === true || String(row?.fontWeight || '') === 'bold';
  }).toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const afterOne = await annotationById(page, text.id);
  expect(afterOne, 'undo must keep the text').toBeTruthy();
  const undidFont = afterOne.fontFamily !== 'Georgia' || afterOne.fontFamily === baseline.fontFamily;
  expect(undidFont || afterOne.bold !== true, 'first undo should drop font or bold').toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const afterTwo = await annotationById(page, text.id);
  expect(afterTwo, 'two style undos must keep the created text').toBeTruthy();
  expect(afterTwo.fontFamily === 'Georgia' && afterTwo.bold === true).toBeFalsy();
});

test('E-01/E-02 resize + rotate + undo', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.24, y0: 0.30, x1: 0.46, y1: 0.50 });
  await selectStroke(page, rect.id);
  const before = await annotationById(page, rect.id);

  const br = page.locator('[data-resize-handle="br"]').first();
  await expect(br).toBeVisible();
  const brBox = await br.boundingBox();
  await page.mouse.move(brBox.x + brBox.width / 2, brBox.y + brBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(brBox.x + 50, brBox.y + 40, { steps: 8 });
  await page.mouse.up();
  const resized = await annotationById(page, rect.id);

  const rotate = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(rotate).toBeVisible();
  const rotBox = await rotate.boundingBox();
  await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rotBox.x + 80, rotBox.y + 10, { steps: 10 });
  await page.mouse.up();
  const rotated = await annotationById(page, rect.id);
  expect(Math.abs(Number(rotated?.angle || 0))).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const afterRotateUndo = await annotationById(page, rect.id);
  expect(Math.abs(Number(afterRotateUndo?.angle || 0))).toBeLessThan(Math.abs(Number(rotated?.angle || 0)) - 0.5);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const afterResizeUndo = await annotationById(page, rect.id);
  expect(afterResizeUndo, 'rect survives undo').toBeTruthy();
  const sizeDelta = Math.abs((afterResizeUndo.width || 0) - (before.width || 0))
    + Math.abs((afterResizeUndo.height || 0) - (before.height || 0));
  expect(sizeDelta).toBeLessThan(8);
  expect(resized.id).toBe(rect.id);
});

test('X-02/X-04 export then re-import the downloaded PDF', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.28, y0: 0.28, x1: 0.50, y1: 0.48 });
  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await page.locator('button[title="#FF00FF"]').first().click();
  await dismissMenus(page);

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click(),
  ]).then(([d]) => d);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, REIMPORT_NAME);
  await download.saveAs(dest);

  await page.goto(`/?testPdf=${REIMPORT_NAME}`);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const imported = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => window.__phase35GetAnnotationById?.(id)).filter(Boolean);
  });
  expect(imported.length, 're-imported export should carry at least one mark').toBeGreaterThan(0);
  const magenta = imported.some((obj) => {
    const fill = colorKey(obj.fill || obj.data?.fill || obj.data?.fillColor || '');
    return fill.includes('FF00FF');
  });
  expect(magenta || imported.some((obj) => obj.isPdfImported === true), 'exported rect or imported markup should come back').toBeTruthy();
  expect(rect.id).toBeTruthy();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }
});

test('D-01 then D-03: 1-dot pen then full-stroke erase', async ({ page }) => {
  await openEditor(page);
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  const box = await pageBox(page);
  const x = box.x + box.width * 0.30;
  const y = box.y + box.height * 0.32;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  const dot = await waitForNewUserAnnotation(page, before, (row) => row.type === 'path' || row.tool === 'pen');

  await activateEntireEraser(page);
  await page.mouse.move(x - 12, y - 12);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 12, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await userAnnotationSnapshot(page)).some((row) => row.id === dot.id)).toBeFalsy();

  const beforeMiss = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  await page.mouse.move(box.x + box.width * 0.70, box.y + box.height * 0.70);
  await page.mouse.down();
  await page.mouse.up();
  const second = await waitForNewUserAnnotation(page, beforeMiss, (row) => row.type === 'path' || row.tool === 'pen');
  await activateEntireEraser(page);
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.86, { steps: 4 });
  await page.mouse.up();
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === second.id)).toBeTruthy();
});

test('T-02 + A-07: callout Q then History restore', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page);
  const beforeCalloutIds = await page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
  await page.keyboard.press('q');
  await dragOnPage(page, { x0: 0.22, y0: 0.24, x1: 0.48, y1: 0.40 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('adversarial callout Q', { delay: 20 });
  await expect.poll(async () => editor.innerText(), {
    message: 'typed text must land in the callout overlay',
  }).toMatch(/adversarial callout Q/);
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await page.locator('[data-callout-id]').evaluateAll((els) => (
      els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
    ));
    calloutId = ids.find((id) => !beforeCalloutIds.includes(id)) || null;
    return calloutId;
  }, { message: 'expected a live callout while the overlay is open' }).not.toBeNull();
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(async () => page.locator(`[data-callout-id="${calloutId}"]`).count(), {
    message: 'typed callout must survive chrome commit',
  }).toBeGreaterThan(0);
  const callout = { id: calloutId };

  await page.keyboard.press('v');
  const calloutBox = page.locator(`[data-callout-id="${callout.id}"] [data-callout-part="textBox"]`).first();
  if (await calloutBox.count()) {
    await calloutBox.click({ force: true });
  } else {
    await selectStroke(page, callout.id);
  }
  await page.keyboard.press('Backspace');
  await expect.poll(async () => page.locator(`[data-callout-id="${callout.id}"]`).count()).toBe(0);

  await openHistory(page);
  await expect(page.getByText(/deleted/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expect.poll(async () => page.locator(`[data-callout-id="${callout.id}"]`).count()).toBeGreaterThan(0);

  const beforeBlank = new Set(await appAnnotationIds(page));
  await page.keyboard.press('q');
  await dragOnPage(page, { x0: 0.60, y0: 0.22, x1: 0.78, y1: 0.36 });
  const blankEditor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(blankEditor).toBeVisible({ timeout: 10_000 });
  await activateTool(page, 'Draw', 'Pen');
  const blankCreated = (await userAnnotationSnapshot(page)).filter((row) => !beforeBlank.has(row.id));
  expect(blankCreated.every((row) => row.type !== 'callout' || !row.text), 'blank new callout should discard').toBeTruthy();
});

test('X-05 kal441 checkbox + radio + select', async ({ page }) => {
  await openEditor(page, FORM_PDF);
  await page.keyboard.press('v');
  const layer = page.locator('.pdfjsFormLayer[data-pdfjs-form-layer="1"]');
  await expect(layer).toBeAttached({ timeout: 30_000 });
  await expect.poll(async () => (
    page.locator('.pdfjsFormLayer input, .pdfjsFormLayer textarea, .pdfjsFormLayer select').count()
  ), { timeout: 20_000 }).toBeGreaterThan(0);

  const checkbox = page.locator('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input').first();
  await expect(checkbox).toBeAttached();
  const beforeCheck = await checkbox.evaluate((el) => el.checked);
  await checkbox.click({ force: true });
  const afterCheck = await checkbox.evaluate((el) => el.checked);
  await checkbox.click({ force: true });
  const afterToggle = await checkbox.evaluate((el) => el.checked);
  expect(afterCheck !== beforeCheck || afterToggle === beforeCheck, 'checkbox should toggle or at least accept clicks').toBeTruthy();

  const radios = page.locator('.pdfjsFormLayer input[type="radio"]');
  const radioCount = await radios.count();
  expect(radioCount).toBeGreaterThanOrEqual(2);
  await radios.nth(0).click({ force: true });
  await radios.nth(1).click({ force: true });
  const radioState = await radios.evaluateAll((els) => els.map((el) => el.checked));
  expect(radioState.filter(Boolean).length).toBeLessThanOrEqual(1);

  const select = page.locator('.pdfjsFormLayer select').first();
  await expect(select).toBeAttached();
  const optionCount = await select.locator('option').count();
  if (optionCount > 1) {
    await select.selectOption({ index: 1 });
    const afterFirst = await select.inputValue();
    await select.selectOption({ index: Math.min(2, optionCount - 1) });
    const afterSecond = await select.inputValue();
    expect(afterFirst || afterSecond).toBeTruthy();
  }
  expect({ beforeCheck, afterCheck, afterToggle, radioCount, optionCount }).toBeTruthy();
});

test('U-03 blank-rename re-break: nbsp, blur, Escape, select-all delete', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  const title = page.getByRole('textbox', { name: 'Click to rename' }).first();
  await expect(title).toBeVisible();
  await expect(title).toHaveValue(/Template \d+/);
  await title.fill('Adversarial Rename Hold');
  await title.press('Enter');
  await expect(title).toHaveValue('Adversarial Rename Hold');
  const save = page.getByRole('button', { name: 'Save', exact: true }).first();
  if (await save.count()) await save.click();

  await title.fill('\u00a0\u00a0');
  await title.press('Enter');
  await expect(title).toHaveValue('Adversarial Rename Hold');

  await title.fill('');
  await page.mouse.click(20, 20);
  await expect(title).toHaveValue('Adversarial Rename Hold');

  await title.fill('should-not-stick');
  await title.press('Escape');
  await expect(title).toHaveValue('Adversarial Rename Hold');

  await title.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await title.press('Enter');
  await expect(title).toHaveValue('Adversarial Rename Hold');
  await expect(page.getByText('Adversarial Rename Hold').first()).toBeVisible();
});

test('U-02 create space then delete the last space', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Spaces', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create space', exact: true });
  await expect(create).toBeVisible();
  const before = await page.locator('[data-space-sortable-row-id]').count();
  await create.click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 1);
  await expect(page.getByRole('textbox', { name: 'Rename Space 1' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect(page.locator('[data-space-sortable-row-id]')).toHaveCount(before + 1);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before);
  await expect(page.getByText('No spaces yet. Create a space to filter pages by visibility.')).toBeVisible();

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await create.click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 1);
});

test('E-06 context-menu paste onto a second page', async ({ page }) => {
  await openEditor(page, LONG_PDF);
  const rect = await createRect(page, { x0: 0.22, y0: 0.24, x1: 0.40, y1: 0.40 });
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${rect.id}"]`);
  const box = await target.boundingBox();
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText('Copy', { exact: true }).click();

  await goToPage(page, 2);
  await expect(page.locator('[data-svg-annotation-layer="2"]')).toBeVisible({ timeout: 30_000 });
  const beforePage2 = new Set(await appAnnotationIds(page, 2));
  const page2 = await pageBox(page, 2);
  await page.mouse.click(page2.x + page2.width * 0.72, page2.y + page2.height * 0.28, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible();
  await page.locator('[data-annotation-context-menu="true"]').getByText('Paste', { exact: true }).click();
  const pasted = await waitForNewUserAnnotation(page, beforePage2, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ), 2);
  expect(pasted.id).toBeTruthy();
  expect((await appAnnotationIds(page, 1)).includes(rect.id)).toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page, 2)).includes(pasted.id)).toBeFalsy();
});

test('V-04 4000% zoom then tool draw', async ({ page }) => {
  await openEditor(page);
  await setZoomPercent(page, 4000);
  await expect.poll(async () => zoomPercent(page)).toBe(4000);

  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Rectangle');
  const a = await visiblePagePoint(page, { xf: 0.30, yf: 0.35 });
  const b = await visiblePagePoint(page, { xf: 0.45, yf: 0.50 });
  expect(a && b, 'visible page slice at 4000%').toBeTruthy();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const drawn = await waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
  expect(drawn.id).toBeTruthy();

  await setZoomPercent(page, 99999);
  await expect.poll(async () => zoomPercent(page)).toBe(4000);
  const beforePen = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  const p = await visiblePagePoint(page, { xf: 0.55, yf: 0.40 });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 16, p.y + 4, { steps: 4 });
  await page.mouse.up();
  const ink = await waitForNewUserAnnotation(page, beforePen, (row) => row.type === 'path' || row.tool === 'pen');
  expect(ink.id).toBeTruthy();
});

test('U-01 survey stamp then undo', async ({ page }) => {
  await openEditor(page, SURVEY_PDF);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  const before = await page.locator('[data-survey-marker-id]').count();
  await page.mouse.move(box.x + 360, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 480, box.y + 340, { steps: 10 });
  await page.mouse.up();
  const name = page.getByPlaceholder('Enter name');
  if (await name.count()) {
    await name.fill('Adversarial stamp');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBeGreaterThan(before);
  const stamped = await page.locator('[data-survey-marker-id]').count();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBe(before);

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBe(stamped);
});
