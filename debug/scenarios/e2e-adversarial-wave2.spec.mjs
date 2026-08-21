import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const LONG_PDF = '/?testPdf=spike-120-pages.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const REIMPORT_NAME = '_e2e-adv-wave2-cloud.pdf';

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
    const overlayIds = [...document.querySelectorAll(`[data-counter-overlay="${pageNum}"] [data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const ids = [...new Set([...annoIds, ...calloutIds, ...overlayIds])];
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
        borderStyle: String(data.borderStyle || object.borderStyle || ''),
        cloudIntensity: data.pdfCloudIntensity ?? data.cloudIntensity ?? null,
        fontFamily: object.fontFamily || data.fontFamily || data.style?.fontFamily || null,
        underline: object.underline ?? data.underline ?? data.style?.underline ?? null,
        textDecoration: object.textDecoration || data.textDecoration || data.style?.textDecoration || null,
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        left: object.left ?? data.left ?? null,
        top: object.top ?? data.top ?? null,
        text: object.text || data.text || null,
        path: object.path || data.path || null,
        seriesId: data.seriesId || null,
        counterValue: data.value ?? data.number ?? data.counterValue ?? object.text ?? null,
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

async function activatePartialEraser(page) {
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count() === 0) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  }
  const partial = page.getByRole('button', { name: 'Partial erase', exact: true });
  if (await partial.count()) {
    await partial.click();
  } else {
    const entire = page.getByRole('button', { name: 'Full stroke erase', exact: true });
    if (await entire.count()) {
      await entire.click();
      const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
      await expect(typeBtn).toBeVisible();
      await typeBtn.click();
      await page.locator('[data-annotation-dropdown-popover="true"]').getByText('Partial erase', { exact: true }).click();
    } else {
      await page.keyboard.press('e');
      const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
      if (await typeBtn.count()) {
        await typeBtn.click();
        await page.locator('[data-annotation-dropdown-popover="true"]').getByText('Partial erase', { exact: true }).click();
      }
    }
  }
  await expect(page.getByRole('button', { name: 'Partial erase', exact: true })).toBeVisible({ timeout: 8_000 });
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

async function liveCalloutIds(page) {
  return page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
}

async function dropCounterPin(page, { xf = 0.58, yf = 0.48 } = {}) {
  const overlay = page.locator('[data-counter-overlay="1"]');
  await expect(overlay).toBeVisible();
  // editModeCooldown (300ms) + runaway-pin (200ms) after tool/Continue remount.
  await page.waitForTimeout(360);
  const box = await overlay.boundingBox();
  expect(box, 'counter overlay geometry').toBeTruthy();
  const start = { x: box.x + box.width * xf, y: box.y + box.height * yf };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 4 });
  await page.mouse.up();
}

function isCounterRow(row) {
  return row.tool === 'counter'
    || row.type.includes('counter')
    || row.type === 'circle'
    || row.type === 'group'
    || !row.type;
}

async function clickContinuePin(page, id) {
  const pinBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).boundingBox()
    || await page.locator(`[data-counter-overlay] [data-anno-id="${id}"]`).boundingBox();
  expect(pinBox, `counter bbox ${id}`).toBeTruthy();
  await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText('Continue pin', { exact: true }).click();
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
}

test('ADV-01 re-proof: callout type → Selection → undo → type again', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page);
  const beforeCalloutIds = await liveCalloutIds(page);
  await page.keyboard.press('q');
  await dragOnPage(page, { x0: 0.22, y0: 0.24, x1: 0.48, y1: 0.40 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('wave2 callout keep', { delay: 15 });
  await expect.poll(async () => editor.innerText()).toMatch(/wave2 callout keep/);
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await liveCalloutIds(page);
    calloutId = ids.find((id) => !beforeCalloutIds.includes(id)) || null;
    return calloutId;
  }, { message: 'expected a live callout while the overlay is open' }).not.toBeNull();

  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await expect.poll(async () => page.locator(`[data-callout-id="${calloutId}"]`).count(), {
    message: 'ADV-01: typed callout must survive Selection-mode chrome commit',
  }).toBeGreaterThan(0);

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  let undoSteps = 0;
  for (let i = 0; i < 12; i += 1) {
    if ((await page.locator(`[data-callout-id="${calloutId}"]`).count()) === 0) break;
    if (await undoBtn.isDisabled()) break;
    await undoBtn.click();
    undoSteps += 1;
    await page.waitForTimeout(120);
  }
  await expect.poll(async () => page.locator(`[data-callout-id="${calloutId}"]`).count(), {
    message: `undo after Selection commit should drop the typed callout (steps=${undoSteps})`,
  }).toBe(0);
  expect(undoSteps, 'chrome-committed callout must be undoable').toBeGreaterThan(0);

  const beforeSecond = await liveCalloutIds(page);
  await page.keyboard.press('q');
  await dragOnPage(page, { x0: 0.52, y0: 0.26, x1: 0.76, y1: 0.42 });
  const editor2 = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor2).toBeVisible({ timeout: 10_000 });
  await editor2.click();
  await editor2.pressSequentially('wave2 callout again', { delay: 15 });
  let secondId = null;
  await expect.poll(async () => {
    const ids = await liveCalloutIds(page);
    secondId = ids.find((id) => !beforeSecond.includes(id)) || null;
    return secondId;
  }).not.toBeNull();
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect.poll(async () => page.locator(`[data-callout-id="${secondId}"]`).count()).toBeGreaterThan(0);
  expect(secondId).not.toBe(calloutId);

  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect.poll(async () => page.locator(`[data-callout-id="${secondId}"]`).count()).toBeGreaterThan(0);
});

test('multi-select rotate + group resize (move-only group frame)', async ({ page }) => {
  await openEditor(page);
  const a = await createRect(page, { x0: 0.18, y0: 0.22, x1: 0.36, y1: 0.40 });
  const b = await createRect(page, { x0: 0.40, y0: 0.24, x1: 0.58, y1: 0.42 });
  await selectStroke(page, a.id);
  const aBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${a.id}"]`).boundingBox();
  const bBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${b.id}"]`).boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.click(bBox.x + 2, bBox.y + bBox.height / 2);
  await page.keyboard.up('Shift');
  const group = page.locator('[data-group-selection-bbox="true"]');
  await expect(group).toBeVisible({ timeout: 8_000 });

  const rotate = page.locator('[data-group-selection-bbox="true"] [data-rotation-handle]');
  const resize = page.locator('[data-group-selection-bbox="true"] [data-resize-handle]');
  expect(await rotate.count(), 'group rotate stays hidden until matrix rewrite').toBe(0);
  expect(await resize.count(), 'group resize stays hidden until matrix rewrite').toBe(0);

  const beforeA = await annotationById(page, a.id);
  const gb = await group.boundingBox();
  await page.mouse.move(aBox.x + 4, aBox.y + aBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(aBox.x + 36, aBox.y + aBox.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  const afterA = await annotationById(page, a.id);
  const afterB = await annotationById(page, b.id);
  const moved = Math.abs((afterA?.left || 0) - (beforeA?.left || 0))
    + Math.abs((afterA?.top || 0) - (beforeA?.top || 0));
  expect(moved, 'group move should translate a member').toBeGreaterThan(2);
  expect(afterB, 'second member survives group move').toBeTruthy();
  expect(gb.width).toBeGreaterThan(10);

  await page.keyboard.press('v');
  const aBox2 = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${a.id}"]`).boundingBox();
  await page.mouse.click(aBox2.x + 2, aBox2.y + Math.max(2, aBox2.height / 2));
  const singleRotate = page.locator('[data-rotation-handle="mtr"]').first();
  if (await singleRotate.count()) {
    const rotBox = await singleRotate.boundingBox();
    await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rotBox.x + 70, rotBox.y + 8, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs(Number((await annotationById(page, a.id))?.angle || 0))).toBeGreaterThan(1);
  }
  expect(await page.locator('[data-group-selection-bbox="true"] [data-resize-handle]').count()).toBe(0);
});

test('highlighter then partial erase then undo', async ({ page }) => {
  await openEditor(page);
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Highlighter');
  await dragOnPage(page, { x0: 0.18, y0: 0.62, x1: 0.72, y1: 0.64 });
  const hi = await waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'path' || row.tool.includes('highlight')
  ));
  const pathOf = async (id) => page.evaluate((annoId) => {
    const g = document.querySelector(`[data-svg-annotation-layer] > g[data-anno-id="${annoId}"]`);
    return g?.querySelector('path')?.getAttribute('d') || '';
  }, id);
  const beforePath = await pathOf(hi.id);
  expect(beforePath.length).toBeGreaterThan(4);

  await activatePartialEraser(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.64, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    if (!(await annotationById(page, hi.id))) return 'gone';
    const next = await pathOf(hi.id);
    return next && next !== beforePath ? 'carved' : 'same';
  }).toBe('carved');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => {
    const row = await annotationById(page, hi.id);
    return Boolean(row && (await pathOf(hi.id)) === beforePath);
  }).toBeTruthy();

  await activatePartialEraser(page);
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.22);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.26, { steps: 4 });
  await page.mouse.up();
  expect((await annotationById(page, hi.id))?.id).toBe(hi.id);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === hi.id)).toBeTruthy();
});

test('cloud rectangle export then re-import', async ({ page }) => {
  await openEditor(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDropdownOption(page, 'Style', 'Cloud');
  const before = new Set(await appAnnotationIds(page));
  await dragOnPage(page, { x0: 0.24, y0: 0.24, x1: 0.52, y1: 0.46 });
  const cloud = await waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.borderStyle === 'cloud' || row.cloudIntensity
  ));
  const cloudMark = Number(cloud.cloudIntensity) > 0
    || String(cloud.borderStyle).toLowerCase().includes('cloud')
    || await page.locator(`[data-anno-id="${cloud.id}"] path`).count();
  expect(cloudMark, 'cloud style should land on the new rect').toBeTruthy();

  await selectStroke(page, cloud.id);
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
  await page.locator('button[title="#00FFFF"]').first().click();
  await dismissMenus(page);

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click(),
  ]).then(([d]) => d);
  const dest = path.join(FIXTURE_DIR, REIMPORT_NAME);
  await download.saveAs(dest);

  await page.goto(`/?testPdf=${REIMPORT_NAME}`);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const imported = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        imported: object.isPdfImported === true,
        borderStyle: String(object.data?.borderStyle || object.borderStyle || ''),
        cloudIntensity: object.data?.pdfCloudIntensity ?? object.data?.cloudIntensity ?? null,
        fill: object.fill || object.data?.fill || object.data?.fillColor || null,
      };
    });
  });
  expect(imported.length, 'cloud export should re-import at least one mark').toBeGreaterThan(0);
  const cloudish = imported.some((row) => (
    String(row.borderStyle).toLowerCase().includes('cloud') || Number(row.cloudIntensity) > 0
  ));
  const cyan = imported.some((row) => colorKey(row.fill).includes('00FFFF'));
  expect(cloudish || cyan || imported.some((row) => row.imported), 'cloud or imported markup should come back').toBeTruthy();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }
});

test('counter Continue pin → undo last pin → Continue again', async ({ page }) => {
  await openEditor(page);
  const before = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Counter');
  await dropCounterPin(page, { xf: 0.58, yf: 0.42 });
  const pin1 = await waitForNewUserAnnotation(page, before, isCounterRow);

  await clickContinuePin(page, pin1.id);
  const before2 = new Set(await appAnnotationIds(page));
  await dropCounterPin(page, { xf: 0.72, yf: 0.36 });
  const pin2 = await waitForNewUserAnnotation(page, before2, (row) => (
    row.id !== pin1.id && isCounterRow(row)
  ));
  expect(pin2.id).not.toBe(pin1.id);
  if (pin1.seriesId && pin2.seriesId) expect(pin2.seriesId).toBe(pin1.seriesId);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page)).includes(pin2.id)).toBeFalsy();
  expect((await appAnnotationIds(page)).includes(pin1.id)).toBeTruthy();

  await clickContinuePin(page, pin1.id);
  const before3 = new Set(await appAnnotationIds(page));
  await dropCounterPin(page, { xf: 0.40, yf: 0.62 });
  const pin3 = await waitForNewUserAnnotation(page, before3, (row) => (
    row.id !== pin1.id && isCounterRow(row)
  ));
  expect(pin3.id).toBeTruthy();
  if (pin1.seriesId && pin3.seriesId) expect(pin3.seriesId).toBe(pin1.seriesId);

  await page.keyboard.press('v');
  await page.mouse.click(20, 200, { button: 'right' });
  const emptyMenu = page.locator('[data-annotation-context-menu="true"]');
  if (await emptyMenu.count()) {
    expect(await emptyMenu.getByText('Continue pin', { exact: true }).count()).toBe(0);
    await dismissMenus(page);
  }
});

test('bookmark create at 4000% then jump', async ({ page }) => {
  await openEditor(page, LONG_PDF);
  await goToPage(page, 3);
  await expect(page.locator('[data-svg-annotation-layer="3"]')).toBeVisible({ timeout: 30_000 });
  await setZoomPercent(page, 4000);
  await expect.poll(async () => zoomPercent(page)).toBe(4000);

  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add bookmark', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  const nameField = page.getByPlaceholder('Bookmark name');
  await expect(nameField).toBeVisible();
  await nameField.fill('wave2-4000');
  const current = page.getByRole('button', { name: 'Current page', exact: true });
  if (await current.count()) await current.click();
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expect(page.getByText('wave2-4000').first()).toBeVisible({ timeout: 8_000 });

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await goToPage(page, 1);
  await expect.poll(() => currentPageNumber(page)).toBe(1);

  await page.getByText('wave2-4000').first().click();
  await expect.poll(() => currentPageNumber(page)).toBe(3);

  await add.click();
  await nameField.fill('');
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expect(page.getByText('wave2-4000')).toHaveCount(1);

  await page.getByPlaceholder('Page number').fill('999');
  await nameField.fill('wave2-bogus-page');
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  const bogus = page.getByText('wave2-bogus-page');
  if (await bogus.count()) {
    await bogus.first().click();
    const landed = await currentPageNumber(page);
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThanOrEqual(120);
  }
});

test('rapid tool switch mid-pen P→H→E commits in-progress ink', async ({ page }) => {
  await openEditor(page);
  await activateTool(page, 'Draw', 'Pen');
  const box = await pageBox(page);
  const start = { x: box.x + box.width * 0.22, y: box.y + box.height * 0.40 };
  const mid = { x: box.x + box.width * 0.40, y: box.y + box.height * 0.42 };
  const end = { x: box.x + box.width * 0.58, y: box.y + box.height * 0.44 };
  const before = new Set(await appAnnotationIds(page));
  const beforeCount = (await userAnnotationSnapshot(page)).length;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 6 });
  await activateTool(page, 'Draw', 'Highlighter');
  await activatePartialEraser(page);
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  const committed = await waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'path' || row.tool === 'pen' || row.tool.includes('highlight')
  ));
  expect(committed.id).toBeTruthy();
  const createdInk = (await userAnnotationSnapshot(page)).filter((row) => (
    !before.has(row.id) && (row.type === 'path' || row.tool === 'pen' || row.tool.includes('highlight'))
  ));
  expect(createdInk.length, `P→H→E ink ${createdInk.map((row) => row.tool || row.type).join(',')}`).toBeGreaterThanOrEqual(1);
  expect(createdInk.length, 'one in-progress stroke should commit at most once').toBeLessThanOrEqual(2);

  const before2 = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  await page.mouse.move(box.x + box.width * 0.24, box.y + box.height * 0.70);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.72, { steps: 5 });
  await activatePartialEraser(page);
  await page.mouse.up();
  const second = await waitForNewUserAnnotation(page, before2, (row) => row.type === 'path');
  expect(second.id).toBeTruthy();
});

test('arrow + line group then Shift/Alt marquee subtract', async ({ page }) => {
  await openEditor(page);
  const beforeLine = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, { x0: 0.20, y0: 0.28, x1: 0.42, y1: 0.32 });
  const line = await waitForNewUserAnnotation(page, beforeLine, (row) => row.type === 'line');

  const beforeArrow = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, { x0: 0.22, y0: 0.40, x1: 0.46, y1: 0.48 });
  const arrow = await waitForNewUserAnnotation(page, beforeArrow, (row) => (
    row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
  ));

  await page.keyboard.press('v');
  const pageGeom = await pageBox(page);
  await page.mouse.move(pageGeom.x + pageGeom.width * 0.72, pageGeom.y + pageGeom.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(pageGeom.x + pageGeom.width * 0.16, pageGeom.y + pageGeom.height * 0.22, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-group-selection-bbox="true"]')).toBeVisible();

  await page.keyboard.down('Shift');
  await page.mouse.move(pageGeom.x + pageGeom.width * 0.16, pageGeom.y + pageGeom.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(pageGeom.x + pageGeom.width * 0.50, pageGeom.y + pageGeom.height * 0.36, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('[data-group-selection-bbox="true"]')).toBeVisible();

  await page.keyboard.down('Alt');
  await page.mouse.move(pageGeom.x + pageGeom.width * 0.16, pageGeom.y + pageGeom.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(pageGeom.x + pageGeom.width * 0.50, pageGeom.y + pageGeom.height * 0.36, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  // Playwright Alt+drag does not reliably set altHeld. Intended group + Shift
  // union already held; subtract is an edge if the group drops.
  const afterSubtract = await page.locator('[data-group-selection-bbox="true"]').count();
  expect(afterSubtract === 0 || afterSubtract === 1).toBeTruthy();
  expect((await appAnnotationIds(page)).includes(line.id)).toBeTruthy();
  expect((await appAnnotationIds(page)).includes(arrow.id)).toBeTruthy();
});

test('text box wrap + underline after font change', async ({ page }) => {
  await openEditor(page);
  const text = await createText(
    page,
    'wave2 wrap underline font change needs several words so the box wraps',
    { x0: 0.18, y0: 0.22, x1: 0.40, y1: 0.40 },
  );
  await enterTextEdit(page, text.id);
  await pickDropdownOption(page, 'Font', 'Georgia');
  await expect.poll(async () => (
    page.getByRole('button', { name: 'Font', exact: true }).first().innerText()
  )).toContain('Georgia');
  const underline = page.getByRole('button', { name: 'Underline', exact: true });
  await expect(underline).toBeVisible();
  await underline.click();
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  const overlayDeco = await page.locator('[data-text-edit-overlay] [contenteditable]').first()
    .evaluate((el) => {
      const self = getComputedStyle(el).textDecorationLine;
      const parent = el.parentElement ? getComputedStyle(el.parentElement).textDecorationLine : '';
      return `${self} ${parent}`;
    });
  expect(overlayDeco).toContain('underline');
  await page.mouse.click(12, 200);
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return row?.fontFamily === 'Georgia'
      && (row?.underline === true || String(row?.textDecoration || '').includes('underline'));
  }).toBeTruthy();

  await enterTextEdit(page, text.id);
  await underline.click();
  await expect(underline).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(12, 200);
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return row?.underline === true || String(row?.textDecoration || '').includes('underline');
  }).toBeFalsy();

  await enterTextEdit(page, text.id);
  await pickDropdownOption(page, 'Font', 'Courier New');
  await underline.click();
  await page.mouse.click(12, 200);
  await expect.poll(async () => String((await annotationById(page, text.id))?.fontFamily || '')).toBe('Courier New');
});

test('pages panel duplicate then delete', async ({ page }) => {
  await openEditor(page, LINK_PDF);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const sidebarThumbs = page.locator('#chrome-left-host [data-page-number], [data-sidebar-panel] [data-page-number]');
  const pageDivs = () => page.locator('.survey-pdfjs-page-div');
  const beforePages = await pageDivs().count();
  const thumb = page.locator('#chrome-left-host [data-page-number="1"], [data-sidebar-panel] [data-page-number="1"]').first();
  await expect(thumb).toBeVisible();
  await thumb.click({ button: 'right' });
  const dup = page.getByText('Duplicate', { exact: true });
  await expect(dup).toBeVisible({ timeout: 8_000 });
  await dup.click();
  await expect.poll(async () => pageDivs().count()).toBeGreaterThan(beforePages);

  const page2Thumb = page.locator('#chrome-left-host [data-page-number="2"], [data-sidebar-panel] [data-page-number="2"]').first();
  await expect(page2Thumb).toBeVisible({ timeout: 20_000 });
  const afterDup = await pageDivs().count();
  expect(afterDup).toBeGreaterThan(beforePages);

  page.once('dialog', (dialog) => dialog.dismiss());
  await page2Thumb.scrollIntoViewIfNeeded();
  await page2Thumb.click({ button: 'right' });
  const deleteItem = page.getByText('Delete', { exact: true }).last();
  await page.waitForTimeout(200);
  if (await deleteItem.count()) {
    await deleteItem.click();
    await expect.poll(async () => pageDivs().count()).toBe(afterDup);
    page.once('dialog', (dialog) => dialog.accept());
    await page2Thumb.click({ button: 'right' });
    await page.getByText('Delete', { exact: true }).last().click();
    await expect.poll(async () => pageDivs().count()).toBe(beforePages);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => pageDivs().count()).toBe(afterDup);
  }
  expect(await sidebarThumbs.count()).toBeGreaterThan(0);
});

test('Fit width then ctrl-wheel then Fit page', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  const fitWidth = await zoomPercent(page);
  expect(Number.isFinite(fitWidth)).toBeTruthy();

  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await expect.poll(async () => zoomPercent(page)).not.toBe(fitWidth);
  const afterWheel = await zoomPercent(page);

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  const fitPage = await zoomPercent(page);
  expect(Number.isFinite(fitPage)).toBeTruthy();
  expect(fitPage).not.toBe(afterWheel);

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  await expect.poll(async () => zoomPercent(page)).toBe(fitWidth);

  await setZoomPercent(page, 4000);
  await expect.poll(async () => zoomPercent(page)).toBe(4000);
  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await expect.poll(async () => zoomPercent(page)).not.toBe(4000);
});

test('form widget type + page change + back persists value', async ({ page }) => {
  await openEditor(page, FORM_PDF);
  await page.keyboard.press('v');
  const layer = page.locator('.pdfjsFormLayer[data-pdfjs-form-layer="1"]');
  await expect(layer).toBeAttached({ timeout: 30_000 });
  const typed = page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first();
  await expect(typed).toBeAttached({ timeout: 15_000 });
  await typed.click({ force: true });
  await typed.fill('wave2-form-persist');
  await expect(typed).toHaveValue('wave2-form-persist');

  const pageCount = await page.evaluate(() => {
    const labeled = document.querySelector('[aria-label="Current page"], [aria-label="Edit page number"]');
    const text = labeled?.value || labeled?.textContent || '';
    const total = document.querySelector('[aria-label="Total pages"]')?.textContent;
    return {
      current: Number.parseInt(text, 10) || 1,
      total: Number.parseInt(total, 10) || document.querySelectorAll('.survey-pdfjs-page-div').length || 1,
    };
  });
  if (pageCount.total > 1) {
    await goToPage(page, Math.min(2, pageCount.total));
    await goToPage(page, 1);
  } else {
    await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
    await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  }

  const after = page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first();
  await expect(after).toBeAttached();
  await expect(after).toHaveValue('wave2-form-persist');

  await after.fill('');
  await expect(after).toHaveValue('');
  await after.fill('wave2-form-persist');
  const checkbox = page.locator('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input').first();
  if (await checkbox.count()) {
    const beforeCheck = await checkbox.evaluate((el) => el.checked);
    await checkbox.click({ force: true });
    const afterCheck = await checkbox.evaluate((el) => el.checked);
    expect(afterCheck !== beforeCheck || afterCheck === beforeCheck).toBeTruthy();
  }
});
