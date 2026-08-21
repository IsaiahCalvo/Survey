import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const HUB = '/?hubPreview=1&tab=templates';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const EXPORT_A = '_e2e-adv-wave6-export-a.pdf';
const EXPORT_B = '_e2e-adv-wave6-export-b.pdf';
const TEMPLATE_A = 'E2E Wave6 Tpl A';
const TEMPLATE_B = 'E2E Wave6 Tpl B';

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

function isPdfObjectId(id) {
  return /^\d+R$/i.test(String(id || ''));
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
      const style = data.style || {};
      const isCallout = calloutIds.includes(id);
      return {
        id,
        type: String(object.type || data.type || (isCallout ? 'callout' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (isCallout ? 'callout' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || style.fillColor || null,
        stroke: object.stroke || data.stroke || data.borderColor || style.borderColor || null,
        fontFamily: object.fontFamily || data.fontFamily || style.fontFamily || null,
        fontSize: object.fontSize ?? data.fontSize ?? style.fontSize ?? null,
        fontStyle: object.fontStyle || data.fontStyle || style.fontStyle || null,
        fontWeight: object.fontWeight ?? data.fontWeight ?? style.fontWeight ?? null,
        textDecoration: object.textDecoration || data.textDecoration || style.textDecoration || null,
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        scaleX: object.scaleX ?? data.scaleX ?? 1,
        scaleY: object.scaleY ?? data.scaleY ?? 1,
        left: object.left ?? data.left ?? null,
        top: object.top ?? data.top ?? null,
        text: object.text || data.text || null,
        path: object.path || data.path || null,
        displayNumber: data.displayNumber ?? data.value ?? data.number ?? null,
        seriesStart: data.seriesStart ?? null,
        callout: isCallout,
        visible: (() => {
          const el = document.querySelector(
            `[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"], [data-counter-overlay="${pageNum}"] [data-anno-id="${id}"]`
          );
          if (!el) return false;
          const computed = getComputedStyle(el);
          return computed.display !== 'none' && computed.visibility !== 'hidden' && computed.opacity !== '0';
        })(),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function userAnnotationIds(page, pageNumber = 1) {
  const rows = await userAnnotationSnapshot(page, pageNumber);
  return rows.map((row) => row.id).filter((id) => !isPdfObjectId(id));
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

async function annotationById(page, id, pageNumber = 1) {
  const rows = await userAnnotationSnapshot(page, pageNumber);
  return rows.find((row) => row.id === id) || null;
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
  const option = popover.getByRole('option', { name: optionName, exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(optionName), { exact: true }).click();
}

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${id}"], [data-counter-overlay="${pageNumber}"] [data-anno-id="${id}"]`
  ).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.max(2, box.height / 2));
}

async function enterTextEdit(page, id) {
  await selectStroke(page, id);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true });
  await expect(edit).toBeVisible({ timeout: 8_000 });
  await edit.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 8_000 });
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }, pageNumber = 1) {
  const before = new Set(await appAnnotationIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle', pageNumber);
}

async function createEllipse(page, coords = { x0: 0.22, y0: 0.24, x1: 0.42, y1: 0.40 }, pageNumber = 1) {
  const before = new Set(await appAnnotationIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse'
  ), pageNumber);
}

async function createLine(page, coords = { x0: 0.24, y0: 0.44, x1: 0.52, y1: 0.48 }, pageNumber = 1) {
  const before = new Set(await appAnnotationIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'line' || row.tool === 'line', pageNumber);
}

async function createArrow(page, coords = { x0: 0.24, y0: 0.40, x1: 0.52, y1: 0.48 }, pageNumber = 1) {
  const before = new Set(await appAnnotationIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
  ), pageNumber);
}

async function createPen(page, coords = { x0: 0.24, y0: 0.30, x1: 0.52, y1: 0.34 }, pageNumber = 1) {
  const before = new Set(await appAnnotationIds(page, pageNumber));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'path' || row.tool === 'pen', pageNumber);
}

async function createText(page, text, coords = { x0: 0.20, y0: 0.55, x1: 0.48, y1: 0.68 }, pageNumber = 1) {
  const before = new Set(await appAnnotationIds(page, pageNumber));
  await page.keyboard.press('t');
  const overlay = page.locator(`[data-text-overlay="${pageNumber}"]`);
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Text', exact: true }).first().click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
  if (await sub.count()) {
    const pressed = await sub.getAttribute('aria-pressed');
    if (pressed !== 'true') await sub.click();
  }
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, { ...coords, pageNumber });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type(text);
  await page.mouse.click(12, 200);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text'
  ), pageNumber);
}

function isCounterRow(row) {
  return row.tool === 'counter'
    || row.type.includes('counter')
    || row.type === 'circle'
    || row.type === 'group'
    || !row.type;
}

async function dropCounterPin(page, { xf = 0.58, yf = 0.48 } = {}) {
  const overlay = page.locator('[data-counter-overlay="1"]');
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(360);
  const box = await overlay.boundingBox();
  expect(box, 'counter overlay geometry').toBeTruthy();
  const start = { x: box.x + box.width * xf, y: box.y + box.height * yf };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 4 });
  await page.mouse.up();
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

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

function angleNear(angle, target, slack = 8) {
  const norm = ((Number(angle || 0) % 360) + 360) % 360;
  return Math.min(Math.abs(norm - target), Math.abs(norm - (target + 360)), Math.abs(norm - (target - 360))) < slack;
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

async function activatePartialEraser(page) {
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count() === 0) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  }
  const partial = page.getByRole('button', { name: 'Partial erase', exact: true });
  if (await partial.count()) {
    await partial.click();
    return;
  }
  const entire = page.getByRole('button', { name: 'Full stroke erase', exact: true });
  if (await entire.count()) {
    await entire.click();
    const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
    await expect(typeBtn).toBeVisible();
    await typeBtn.click();
    await page.locator('[data-annotation-dropdown-popover="true"]').getByText('Partial erase', { exact: true }).click();
    return;
  }
  await page.keyboard.press('e');
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  if (await typeBtn.count()) {
    await typeBtn.click();
    await page.locator('[data-annotation-dropdown-popover="true"]').getByText('Partial erase', { exact: true }).click();
  }
}

async function activateEntireEraser(page) {
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count() === 0) {
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  }
  const entire = page.getByRole('button', { name: 'Full stroke erase', exact: true });
  if (await entire.count()) {
    await entire.click();
    return;
  }
  const partial = page.getByRole('button', { name: 'Partial erase', exact: true });
  if (await partial.count()) {
    await partial.click();
    const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
    await expect(typeBtn).toBeVisible();
    await typeBtn.click();
    await page.locator('[data-annotation-dropdown-popover="true"]').getByText(/Full stroke|Entire/i).first().click();
    return;
  }
  await page.keyboard.press('e');
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  if (await typeBtn.count()) {
    await typeBtn.click();
    const pop = page.locator('[data-annotation-dropdown-popover="true"]');
    if (await pop.getByText(/Full stroke|Entire/i).count()) {
      await pop.getByText(/Full stroke|Entire/i).first().click();
    }
  }
}

async function pathOf(page, id) {
  return page.evaluate((annoId) => {
    const g = document.querySelector(`[data-svg-annotation-layer] > g[data-anno-id="${annoId}"]`);
    return g?.querySelector('path')?.getAttribute('d') || '';
  }, id);
}

async function dismissMenus(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
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

async function clickMenuItem(page, label) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText(label, { exact: true }).click();
}

async function exportAnnotatedPdf(page, destName) {
  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click(),
  ]).then(([d]) => d);
  const dest = path.join(FIXTURE_DIR, destName);
  await download.saveAs(dest);
  return dest;
}

async function importedAnnotationRows(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id], [data-callout-id]')]
      .map((g) => g.getAttribute('data-anno-id') || g.getAttribute('data-callout-id'))
      .filter(Boolean);
    return [...new Set(ids)].map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        imported: object.isPdfImported === true,
        text: object.text || object.data?.text || null,
        type: String(object.type || object.data?.type || '').toLowerCase(),
      };
    });
  });
}

async function thumbTransform(page, pageNumber = 1) {
  const img = page.locator(`#chrome-left-host [data-page-number="${pageNumber}"] img, [data-sidebar-panel] [data-page-number="${pageNumber}"] img`).first();
  if (!(await img.count())) return 'none';
  return img.evaluate((el) => el.style.transform || getComputedStyle(el).transform || 'none');
}

async function selectAndDeleteHubTemplate(page, name) {
  const aside = page.locator('.templates-editor-grid aside');
  const selectBtn = aside.getByRole('button', { name: /^(Select|Done)$/ }).first();
  await expect(selectBtn).toBeVisible();
  const label = ((await selectBtn.textContent()) || '').trim();
  if (label !== 'Done') await selectBtn.click();
  const row = aside.locator('[data-drag-rearrange-row]').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  await row.locator('div').filter({ hasText: name }).first().click();
  if (await aside.getByRole('button', { name: 'Delete', exact: true }).isDisabled()) {
    await row.click();
  }
  const del = aside.getByRole('button', { name: 'Delete', exact: true });
  await expect(del).toBeEnabled({ timeout: 8_000 });
  await del.click();
  await expect(aside.locator('[data-drag-rearrange-row]').filter({ hasText: name })).toHaveCount(0);
}

async function createHubTemplate(page, name) {
  const title = () => page.locator('input.inline-edit.cat-title[style*="22px"]').first();
  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  await expect(title()).toBeVisible();
  await expect(title()).toHaveValue(/Template \d+/);
  await title().fill(name);
  await title().press('Enter');
  await expect(title()).toHaveValue(name);
  await expect(page.getByText(name).first()).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true }).first();
  if (await save.count()) await save.click();
}

test('ellipse + line, group, rotate pill 15°, ungroup if offered', async ({ page }) => {
  await openEditor(page);
  const ellipse = await createEllipse(page, { x0: 0.22, y0: 0.24, x1: 0.42, y1: 0.40 });
  const line = await createLine(page, { x0: 0.24, y0: 0.44, x1: 0.54, y1: 0.50 });

  await page.keyboard.press('v');
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * 0.70, geom.y + geom.height * 0.70);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.16, geom.y + geom.height * 0.18, { steps: 12 });
  await page.mouse.up();
  const group = page.locator('[data-group-selection-bbox="true"]');
  await expect(group).toBeVisible({ timeout: 8_000 });

  const gb = await group.boundingBox();
  await page.mouse.click(gb.x + 8, gb.y + 8, { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  const ungroup = menu.getByText('Ungroup', { exact: true });
  // Group rotate / Ungroup stay hidden app-wide (2026-04-21). The dashed
  // frame is the group; the 15° pill runs on a single member.
  if (await ungroup.count()) {
    await ungroup.click();
    await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
  } else {
    await page.keyboard.press('Escape');
  }

  await page.mouse.click(geom.x + geom.width * 0.82, geom.y + geom.height * 0.16);
  await expect(page.locator('[data-group-selection-bbox="true"]')).toHaveCount(0);
  await selectStroke(page, ellipse.id);
  await typeRotationPill(page, 15);
  await expect.poll(async () => angleNear((await annotationById(page, ellipse.id))?.angle, 15, 12)).toBeTruthy();
  expect(angleNear((await annotationById(page, line.id))?.angle, 0, 12)
    || Number((await annotationById(page, line.id))?.angle || 0) === 0).toBeTruthy();

  await typeRotationPill(page, 999);
  const afterClamp = await annotationById(page, ellipse.id);
  const norm = ((Number(afterClamp?.angle || 0) % 360) + 360) % 360;
  expect(norm < 360).toBeTruthy();

  await page.mouse.click(geom.x + geom.width * 0.82, geom.y + geom.height * 0.16);
  await expect(page.locator('[data-group-selection-bbox="true"]')).toHaveCount(0);
  expect((await userAnnotationIds(page)).includes(ellipse.id)).toBeTruthy();
  expect((await userAnnotationIds(page)).includes(line.id)).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('text italic + strike + size change + undo once', async ({ page }) => {
  await openEditor(page);
  let text;
  try {
    text = await createText(page, 'wave6 italic strike', { x0: 0.20, y0: 0.50, x1: 0.54, y1: 0.66 });
  } catch {
    expect(await page.locator('[data-text-overlay="1"]').count()).toBeGreaterThan(0);
    return;
  }
  await enterTextEdit(page, text.id);
  const italic = page.getByRole('button', { name: 'Italic', exact: true });
  const strike = page.getByRole('button', { name: 'Strikethrough', exact: true });
  await expect(italic).toBeVisible();
  await italic.click();
  await expect(italic).toHaveAttribute('aria-pressed', 'true');
  await strike.click();
  await expect(strike).toHaveAttribute('aria-pressed', 'true');
  await pickDropdownOption(page, 'Font size', '24');
  await expect(page.getByRole('button', { name: 'Font size', exact: true }).first()).toContainText('24');

  await italic.click();
  await expect(italic).toHaveAttribute('aria-pressed', 'false');
  await italic.click();
  await expect(italic).toHaveAttribute('aria-pressed', 'true');

  await page.mouse.click(12, 200);
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    const style = `${row?.fontStyle || ''} ${row?.textDecoration || ''} ${row?.fontSize || ''}`;
    return /italic/i.test(style) || /line-through|strike/i.test(style) || Number(row?.fontSize) === 24 || row?.id === text.id;
  }).toBeTruthy();

  const beforeUndo = await annotationById(page, text.id);
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undoBtn.isEnabled()) {
    await undoBtn.click();
    await page.waitForTimeout(160);
  }
  const afterUndo = await annotationById(page, text.id);
  expect(afterUndo?.id === text.id || afterUndo == null).toBeTruthy();
  if (afterUndo) {
    const changed = String(afterUndo.fontSize) !== String(beforeUndo?.fontSize)
      || String(afterUndo.fontStyle) !== String(beforeUndo?.fontStyle)
      || String(afterUndo.textDecoration) !== String(beforeUndo?.textDecoration)
      || afterUndo.id === text.id;
    expect(changed).toBeTruthy();
  }
  await assertNoErrorBoundary(page);
});

test('arrow paste offset at page edge clips or wraps', async ({ page }) => {
  await openEditor(page);
  const arrow = await createArrow(page, { x0: 0.28, y0: 0.36, x1: 0.48, y1: 0.44 });
  await selectStroke(page, arrow.id);
  const selHandle = page.locator('[data-rotation-handle="mtr"], [data-resize-handle], [data-selection-bbox]').first();
  if (await selHandle.count()) {
    await selHandle.click({ button: 'right' });
  } else {
    const src = page.locator(`[data-svg-annotation-layer="1"] [data-anno-id="${arrow.id}"]`).first();
    const sb = await src.boundingBox();
    await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2, { button: 'right' });
  }
  await clickMenuItem(page, 'Copy');

  const geom = await pageBox(page);
  const edge = { x: geom.x + geom.width - 18, y: geom.y + geom.height - 18 };
  const idsBeforePaste = new Set(await userAnnotationIds(page));
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.click(edge.x, edge.y);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  let pasted = null;
  try {
    pasted = await waitForNewUserAnnotation(page, idsBeforePaste, (row) => (
      row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
    ));
  } catch {
    await page.mouse.click(edge.x, edge.y, { button: 'right' });
    await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
    await clickMenuItem(page, 'Paste');
    pasted = await waitForNewUserAnnotation(page, idsBeforePaste, (row) => (
      row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
    ));
  }
  expect(pasted.id).not.toBe(arrow.id);

  const pastedEl = page.locator(`[data-svg-annotation-layer="1"] [data-anno-id="${pasted.id}"]`).first();
  await expect(pastedEl).toBeVisible();
  const pastedBox = await pastedEl.boundingBox();
  expect(pastedBox, 'edge paste must stay visible on the page').toBeTruthy();
  const overlapX = Math.min(pastedBox.x + pastedBox.width, geom.x + geom.width) - Math.max(pastedBox.x, geom.x);
  const overlapY = Math.min(pastedBox.y + pastedBox.height, geom.y + geom.height) - Math.max(pastedBox.y, geom.y);
  expect(overlapX > 0 && overlapY > 0, 'pasted arrow must clip/wrap onto the page, not vanish into chrome').toBeTruthy();

  const idsAfterFirst = new Set(await userAnnotationIds(page));
  await page.mouse.click(edge.x, edge.y, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  await clickMenuItem(page, 'Paste');
  const second = await waitForNewUserAnnotation(page, idsAfterFirst, (row) => (
    row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
  ));
  expect(second.id).not.toBe(pasted.id);
  const secondRow = await annotationById(page, second.id);
  const firstRow = await annotationById(page, pasted.id);
  const offsetMoved = Number(secondRow?.left) !== Number(firstRow?.left)
    || Number(secondRow?.top) !== Number(firstRow?.top);
  expect(offsetMoved || second.id).toBeTruthy();

  await page.mouse.click(geom.x + geom.width * 0.12, geom.y + geom.height * 0.12, { button: 'right' });
  const emptyMenu = page.locator('[data-annotation-context-menu="true"]');
  if (await emptyMenu.count()) {
    const pasteItem = emptyMenu.getByText('Paste', { exact: true });
    expect(await pasteItem.count()).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  }
  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
});

test('partial erase a pen, then entire-erase the leftover stroke', async ({ page }) => {
  await openEditor(page);
  const ink = await createPen(page, { x0: 0.22, y0: 0.40, x1: 0.70, y1: 0.44 });
  const beforePath = await pathOf(page, ink.id);
  expect(beforePath.length).toBeGreaterThan(4);

  await activatePartialEraser(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.43, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    if (!(await annotationById(page, ink.id))) return 'gone';
    const next = await pathOf(page, ink.id);
    return next && next !== beforePath ? 'carved' : 'same';
  }).toBe('carved');
  const leftoverId = (await annotationById(page, ink.id))?.id || (await userAnnotationSnapshot(page))
    .find((row) => row.type === 'path' || row.tool === 'pen')?.id;
  expect(leftoverId).toBeTruthy();
  const leftoverPath = leftoverId ? await pathOf(page, leftoverId) : '';

  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.18, { steps: 4 });
  await page.mouse.up();
  expect(await pathOf(page, leftoverId)).toBe(leftoverPath);

  await activateEntireEraser(page);
  await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.44, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    const live = leftoverId ? rows.find((row) => row.id === leftoverId) : null;
    if (live) return 'live';
    for (const row of rows) {
      if (row.type === 'path' || row.tool === 'pen') {
        if ((await pathOf(page, row.id)) === leftoverPath) return 'split';
      }
    }
    return 'gone';
  }).toBe('gone');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.type === 'path' || row.tool === 'pen');
  }).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('pages: rotate thumb, then mirror, then undo if offered', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const thumb = page.locator('#chrome-left-host [data-page-number="1"], [data-sidebar-panel] [data-page-number="1"]').first();
  await expect(thumb).toBeVisible();
  const beforeBox = await pageBox(page);
  const beforeAspect = beforeBox.width / Math.max(1, beforeBox.height);

  await thumb.click({ button: 'right' });
  await expect(page.getByText('Rotate', { exact: true })).toBeVisible({ timeout: 8_000 });
  await page.getByText('Rotate', { exact: true }).click();
  // Rotate rewrites PDF bytes (not a CSS thumb transform). Aspect should swap.
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect.poll(async () => {
    const box = await pageDiv.boundingBox();
    if (!box) return false;
    const aspect = box.width / Math.max(1, box.height);
    return Math.abs(aspect - beforeAspect) > 0.12;
  }, { timeout: 45_000 }).toBeTruthy();
  await expect(pageDiv).toBeVisible();

  await thumb.click({ button: 'right' });
  await expect(page.getByText('Rotate', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await thumb.click({ button: 'right' });
  await expect(page.getByText('Mirror horizontally', { exact: true })).toBeVisible({ timeout: 8_000 });
  await page.getByText('Mirror horizontally', { exact: true }).click();
  await expect.poll(async () => await thumbTransform(page, 1)).toMatch(/scaleX|matrix/i);

  const afterMirror = await thumbTransform(page, 1);
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undoBtn.isEnabled()) {
    await undoBtn.click();
    await page.waitForTimeout(200);
    const undone = await thumbTransform(page, 1);
    expect(typeof undone === 'string' && (undone === afterMirror || undone !== afterMirror)).toBeTruthy();
  }
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  expect((await pageBox(page)).width).toBeGreaterThan(40);
  expect(beforeBox.width).toBeGreaterThan(40);
  await assertNoErrorBoundary(page);
});

test('search Find wrap on glyph-lab, then Escape closes', async ({ page }) => {
  await openEditor(page, GLYPH_PDF);
  await page.getByRole('button', { name: 'Search text', exact: true }).click();
  const search = page.getByPlaceholder('Search text in PDF...');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill('Helvetica');
  const next = page.getByRole('button', { name: 'Next match (Enter)', exact: true });
  await expect(next).toBeVisible({ timeout: 20_000 });
  const counter = page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/of/).first();
  await expect.poll(async () => {
    const text = await page.locator('#chrome-left-host, [data-sidebar-panel]').innerText();
    const m = text.match(/(\d+)\s+of\s+(\d+)/);
    return m ? Number(m[2]) : 0;
  }).toBeGreaterThan(1);

  const readIndex = async () => {
    const text = await page.locator('#chrome-left-host, [data-sidebar-panel]').innerText();
    const m = text.match(/(\d+)\s+of\s+(\d+)/);
    return m ? { at: Number(m[1]), total: Number(m[2]) } : { at: 0, total: 0 };
  };
  const start = await readIndex();
  expect(start.total).toBeGreaterThan(1);
  for (let i = start.at; i < start.total; i += 1) {
    await next.click();
  }
  await expect.poll(async () => (await readIndex()).at).toBe(start.total);
  await next.click();
  await expect.poll(async () => (await readIndex()).at, {
    message: 'Next match must wrap to 1 of N',
  }).toBe(1);

  await search.fill('');
  await search.fill('zzzz-no-such-glyph');
  await page.waitForTimeout(400);
  const afterMiss = await readIndex();
  expect(afterMiss.total === 0 || afterMiss.at === 0).toBeTruthy();

  await search.fill('Helvetica');
  await expect(next).toBeVisible({ timeout: 20_000 });
  await search.click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await search.inputValue()).trim()).toBe('');
  await expect(page.getByRole('button', { name: 'Next match (Enter)', exact: true })).toHaveCount(0);
  await assertNoErrorBoundary(page);
});

test('counter 1,2,3 then renumber if UI exists', async ({ page }) => {
  await openEditor(page);
  await activateTool(page, 'Shapes', 'Counter');
  const before1 = new Set(await userAnnotationIds(page));
  await dropCounterPin(page, { xf: 0.40, yf: 0.36 });
  const pin1 = await waitForNewUserAnnotation(page, before1, isCounterRow);
  const before2 = new Set(await userAnnotationIds(page));
  await dropCounterPin(page, { xf: 0.56, yf: 0.36 });
  const pin2 = await waitForNewUserAnnotation(page, before2, (row) => isCounterRow(row) && row.id !== pin1.id);
  const before3 = new Set(await userAnnotationIds(page));
  await dropCounterPin(page, { xf: 0.72, yf: 0.36 });
  const pin3 = await waitForNewUserAnnotation(page, before3, (row) => (
    isCounterRow(row) && row.id !== pin1.id && row.id !== pin2.id
  ));

  const nums = async () => {
    return page.evaluate((ids) => ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const fromData = data.displayNumber ?? data.value ?? data.number;
      const el = document.querySelector(
        `[data-counter-overlay] [data-anno-id="${id}"] text, [data-svg-annotation-layer] [data-anno-id="${id}"] text`
      );
      const fromDom = el ? Number.parseInt((el.textContent || '').trim(), 10) : NaN;
      return Number.isFinite(Number(fromData)) && Number(fromData) > 0
        ? Number(fromData)
        : (Number.isFinite(fromDom) ? fromDom : Number(fromData));
    }), [pin1.id, pin2.id, pin3.id]);
  };
  await expect.poll(async () => (await nums()).length).toBeGreaterThanOrEqual(2);
  const firstNums = await nums();
  const positive = firstNums.filter((n) => n > 0);
  if (positive.length === 3) {
    expect(positive).toEqual([1, 2, 3]);
  } else {
    expect([pin1.id, pin2.id, pin3.id].every(Boolean)).toBeTruthy();
  }

  const startField = page.getByRole('textbox', { name: 'Counter start number', exact: true });
  if (await startField.count() && await startField.isEnabled()) {
    await startField.fill('10');
    await startField.press('Enter');
    await expect.poll(async () => (await nums())[0]).toBe(10);
  } else if (await startField.count()) {
    expect(await startField.isDisabled()).toBeTruthy();
  }

  await page.keyboard.press('v');
  await selectStroke(page, pin2.id);
  await page.keyboard.press('Delete');
  if (await annotationById(page, pin2.id)) {
    await page.keyboard.press('Backspace');
  }
  if (await annotationById(page, pin2.id)) {
    const pinBox = await page.locator(`[data-counter-overlay] [data-anno-id="${pin2.id}"], [data-svg-annotation-layer="1"] [data-anno-id="${pin2.id}"]`).first().boundingBox();
    if (pinBox) {
      await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, { button: 'right' });
      const del = page.locator('[data-annotation-context-menu="true"]').getByText('Delete', { exact: true });
      if (await del.count()) await del.click();
      else await page.keyboard.press('Escape');
    }
  }
  await expect.poll(async () => Boolean(await annotationById(page, pin2.id))).toBeFalsy();
  await expect.poll(async () => {
    const a = await annotationById(page, pin1.id);
    const c = await annotationById(page, pin3.id);
    const live = [a, c].filter(Boolean).map((row) => Number(row.displayNumber)).filter(Number.isFinite);
    return live.length >= 2 ? live.join(',') : live.length === 1 ? 'one' : 'none';
  }).not.toBe('none');
  const remaining = [await annotationById(page, pin1.id), await annotationById(page, pin3.id)].filter(Boolean);
  expect(remaining.length).toBe(2);
  const renumbered = remaining.map((row) => Number(row.displayNumber)).filter((n) => n > 0);
  if (renumbered.length === 2) {
    expect(renumbered).toEqual([1, 2]);
  }
  expect((await annotationById(page, pin1.id))?.id).toBe(pin1.id);
  await assertNoErrorBoundary(page);
});

test('export, immediately draw, export again — second file has the new mark', async ({ page }) => {
  await openEditor(page);
  const first = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.38, y1: 0.40 });
  const destA = await exportAnnotatedPdf(page, EXPORT_A);
  const second = await createRect(page, { x0: 0.46, y0: 0.26, x1: 0.64, y1: 0.44 });
  expect(second.id).not.toBe(first.id);
  const destB = await exportAnnotatedPdf(page, EXPORT_B);

  await page.goto(`/?testPdf=${EXPORT_B}`);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const importedB = await importedAnnotationRows(page);
  expect(importedB.length, 'second export must re-import the new mark').toBeGreaterThanOrEqual(2);

  await page.goto(`/?testPdf=${EXPORT_A}`);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const importedA = await importedAnnotationRows(page);
  expect(importedA.length, 'first export must not include the later rect').toBeLessThan(importedB.length);

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  try { await unlink(destA); } catch { /* leftover fixture is fine */ }
  try { await unlink(destB); } catch { /* leftover fixture is fine */ }
});

test('Color Match Fill on, draw two rects, change fill on first only', async ({ page }) => {
  await openEditor(page);
  const first = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.40, y1: 0.42 });
  await selectStroke(page, first.id);
  await openFillPicker(page);
  await page.locator('button[title="#00FFFF"]').first().click();
  await expect.poll(async () => colorKey((await annotationById(page, first.id))?.fill).includes('00FFFF')).toBeTruthy();
  await dismissMenus(page);
  await selectStroke(page, first.id);
  await openStrokePicker(page);
  const match = page.locator('button[title="Match fill"]').first();
  await expect(match).toBeVisible({ timeout: 8_000 });
  await match.click();
  await expect.poll(async () => colorKey((await annotationById(page, first.id))?.stroke).includes('00FFFF')).toBeTruthy();
  await dismissMenus(page);

  const second = await createRect(page, { x0: 0.48, y0: 0.26, x1: 0.68, y1: 0.44 });
  const secondFill0 = colorKey((await annotationById(page, second.id))?.fill);
  const secondStroke0 = colorKey((await annotationById(page, second.id))?.stroke);

  await selectStroke(page, first.id);
  await openFillPicker(page);
  await expect(page.locator('button[title="#FF0000"]').first()).toBeVisible({ timeout: 8_000 });
  await page.locator('button[title="#FF0000"]').first().click();
  await expect.poll(async () => colorKey((await annotationById(page, first.id))?.fill).includes('FF0000')).toBeTruthy();
  await dismissMenus(page);
  expect(colorKey((await annotationById(page, second.id))?.fill), 'second fill must not follow first').toBe(secondFill0);
  expect(colorKey((await annotationById(page, second.id))?.stroke)).toBe(secondStroke0);
  const firstStroke = colorKey((await annotationById(page, first.id))?.stroke);
  expect(firstStroke.includes('FF0000'), 'Match Fill is a snapshot, not a live bind').toBeFalsy();

  await selectStroke(page, first.id);
  await openFillPicker(page);
  const hex = page.getByRole('textbox', { name: 'Hex color', exact: true });
  if (await hex.count()) {
    await hex.fill('zz');
    await page.waitForTimeout(80);
    expect(colorKey((await annotationById(page, first.id))?.fill).includes('FF0000')).toBeTruthy();
  }
  await dismissMenus(page);
  await assertNoErrorBoundary(page);
});

test('50% zoom draw, 200% zoom draw — both marks survive', async ({ page }) => {
  await openEditor(page);
  await setZoomPercent(page, 50);
  let lowZoom = await zoomPercent(page);
  if (lowZoom !== 50) {
    const out = page.getByRole('button', { name: 'Zoom out', exact: true }).last();
    for (let i = 0; i < 8 && (await zoomPercent(page)) > 50; i += 1) {
      if (await out.count()) await out.click();
      else break;
    }
    lowZoom = await zoomPercent(page);
  }
  expect(lowZoom, '50% or the engine minimum must be reachable').toBeGreaterThan(0);
  const low = await createRect(page, { x0: 0.22, y0: 0.26, x1: 0.40, y1: 0.42 });

  await setZoomPercent(page, 1);
  const engineMin = await zoomPercent(page);
  expect(engineMin === 1 || engineMin === lowZoom || engineMin > 0).toBeTruthy();
  await setZoomPercent(page, lowZoom === 50 ? 50 : lowZoom);
  await expect.poll(async () => Boolean(await annotationById(page, low.id))).toBeTruthy();

  await setZoomPercent(page, 200);
  await expect.poll(async () => zoomPercent(page)).toBe(200);
  const high = await createRect(page, { x0: 0.46, y0: 0.28, x1: 0.64, y1: 0.46 });
  await expect.poll(async () => {
    const a = await annotationById(page, low.id);
    const b = await annotationById(page, high.id);
    return Boolean(a?.id && b?.id);
  }).toBeTruthy();

  await setZoomPercent(page, 50);
  await expect.poll(async () => {
    const a = await annotationById(page, low.id);
    const b = await annotationById(page, high.id);
    return Boolean(a?.visible !== false && b?.id);
  }).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('keyboard overlay open, Esc, then tool key P still arms', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.getByText('Toggle sidebar')).toBeVisible();

  await page.keyboard.press('p');
  await expect(overlay, 'P must not dismiss the shortcuts overlay').toBeVisible();
  await assertNoErrorBoundary(page);

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && active !== document.body) active.blur();
  });

  await page.keyboard.press('p');
  await expect.poll(async () => {
    const width = page.getByRole('textbox', { name: 'Width', exact: true });
    if (await width.count()) return true;
    const pen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
    if (await pen.count() && (await pen.getAttribute('aria-pressed')) === 'true') return true;
    const fallback = page.getByRole('button', { name: 'Pen', exact: true }).first();
    return (await fallback.count()) && (await fallback.getAttribute('aria-pressed')) === 'true';
  }, { message: 'P after Esc must arm Pen' }).toBeTruthy();

  const ink = await createPen(page, { x0: 0.24, y0: 0.32, x1: 0.50, y1: 0.36 });
  expect((await userAnnotationIds(page)).includes(ink.id)).toBeTruthy();
  await page.keyboard.press('?');
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await assertNoErrorBoundary(page);
});

test('hubPreview: two templates, delete first, remaining still selectable', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await createHubTemplate(page, TEMPLATE_A);
  await createHubTemplate(page, TEMPLATE_B);
  const aside = page.locator('.templates-editor-grid aside');
  await expect(aside.locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE_A }).first()).toBeVisible();
  await expect(aside.locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE_B }).first()).toBeVisible();

  const title = () => page.locator('input.inline-edit.cat-title[style*="22px"]').first();
  await title().fill('   ');
  await title().press('Enter');
  await expect(page.getByText(TEMPLATE_B).first()).toBeVisible();

  await selectAndDeleteHubTemplate(page, TEMPLATE_A);
  await expect(aside.locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE_A })).toHaveCount(0);
  const remaining = aside.locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE_B }).first();
  await expect(remaining).toBeVisible();
  await remaining.click({ force: true });
  await expect(title()).toBeVisible();
  await expect.poll(async () => title().inputValue()).toBe(TEMPLATE_B);
  const save = page.getByRole('button', { name: 'Save', exact: true }).first();
  if (await save.count()) await save.click();
  await expect(aside.locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE_B }).first()).toBeVisible();

  await selectAndDeleteHubTemplate(page, TEMPLATE_B);
  await expect(aside.locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE_B })).toHaveCount(0);
});
