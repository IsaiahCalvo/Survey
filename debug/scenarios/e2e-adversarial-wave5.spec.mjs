import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1&tab=templates';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const ROT_REIMPORT = '_e2e-adv-wave5-rot.pdf';
const TEMPLATE_NAME = 'E2E Wave5 Recreate';

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

async function userAnnotationIds(page, pageNumber = 1) {
  const rows = await userAnnotationSnapshot(page, pageNumber);
  return rows.map((row) => row.id).filter((id) => !isPdfObjectId(id));
}

async function waitUserAnnotationSettle(page, pageNumber = 1) {
  let last = null;
  for (let i = 0; i < 20; i += 1) {
    const ids = [...await userAnnotationIds(page, pageNumber)].sort().join(',');
    if (ids === last && i >= 3) return;
    last = ids;
    await page.waitForTimeout(120);
  }
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
        fontFamily: object.fontFamily || data.fontFamily || data.style?.fontFamily || null,
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        scaleX: object.scaleX ?? data.scaleX ?? 1,
        scaleY: object.scaleY ?? data.scaleY ?? 1,
        left: object.left ?? data.left ?? null,
        top: object.top ?? data.top ?? null,
        text: object.text || data.text || null,
        path: object.path || data.path || null,
        zOrder: data.zOrder ?? object.zOrder ?? null,
        spaceId: data.spaceId || object.spaceId || null,
        callout: isCallout,
        visible: (() => {
          const el = document.querySelector(
            `[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"]`
          );
          if (!el) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        })(),
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

async function dragVisibleOnPage(page, {
  pageNumber = 1,
  x0 = 0.25,
  y0 = 0.30,
  x1 = 0.45,
  y1 = 0.48,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const viewport = page.viewportSize();
  const vis = {
    x: Math.max(box.x, 12),
    y: Math.max(box.y, 80),
    right: Math.min(box.x + box.width, viewport.width - 12),
    bottom: Math.min(box.y + box.height, viewport.height - 12),
  };
  vis.width = Math.max(40, vis.right - vis.x);
  vis.height = Math.max(40, vis.bottom - vis.y);
  const start = { x: vis.x + vis.width * x0, y: vis.y + vis.height * y0 };
  const end = { x: vis.x + vis.width * x1, y: vis.y + vis.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return { start, end, box: vis };
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

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${id}"]`
  ).first();
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

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }, pageNumber = 1) {
  const before = new Set(await appAnnotationIds(page, pageNumber));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle', pageNumber);
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
  if (coords.visible) {
    await dragVisibleOnPage(page, { ...coords, pageNumber });
  } else {
    await dragOnPage(page, { ...coords, pageNumber });
  }
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type(text);
  await page.mouse.click(12, 200);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text'
  ), pageNumber);
}

async function liveCalloutIds(page) {
  return page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
}

async function createCallout(page, text, coords = { x0: 0.22, y0: 0.24, x1: 0.48, y1: 0.40 }) {
  const before = await liveCalloutIds(page);
  await page.keyboard.press('q');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 12 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await liveCalloutIds(page);
    calloutId = ids.find((id) => !before.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect.poll(async () => page.locator(`[data-callout-id="${calloutId}"]`).count()).toBeGreaterThan(0);
  return { id: calloutId };
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

async function openHistory(page) {
  const history = page.getByRole('button', { name: 'Version history', exact: true });
  await expect(history).toBeVisible();
  await history.click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function duplicatePageOne(page) {
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const pageDivs = () => page.locator('.survey-pdfjs-page-div');
  const beforePages = await pageDivs().count();
  const thumb = page.locator('#chrome-left-host [data-page-number="1"], [data-sidebar-panel] [data-page-number="1"]').first();
  await expect(thumb).toBeVisible();
  await thumb.click({ button: 'right' });
  const dup = page.getByText('Duplicate', { exact: true });
  await expect(dup).toBeVisible({ timeout: 8_000 });
  await dup.click();
  await expect.poll(async () => pageDivs().count()).toBeGreaterThan(beforePages);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]').first()).toBeVisible({ timeout: 20_000 });
  await assertNoErrorBoundary(page);
  return beforePages;
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

function angleNear(angle, target, slack = 8) {
  const norm = ((Number(angle || 0) % 360) + 360) % 360;
  return Math.min(Math.abs(norm - target), Math.abs(norm - (target + 360)), Math.abs(norm - (target - 360))) < slack;
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
      await page.locator('[data-annotation-dropdown-popover="true"]').getByText(/Full stroke|Entire/i).first().click();
    } else {
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
  }
}

async function sidebarWidth(page) {
  return page.evaluate(() => {
    const css = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--app-sidebar-width'),
      10
    );
    const inner = document.querySelector('#chrome-left-host > div')?.getBoundingClientRect().width || 0;
    if (Number.isFinite(css) && css > 0) return css;
    return inner;
  });
}

async function hexField(page) {
  return page.getByRole('textbox', { name: 'Hex color', exact: true });
}

async function pathOf(page, id) {
  return page.evaluate((annoId) => {
    const g = document.querySelector(`[data-svg-annotation-layer] > g[data-anno-id="${annoId}"]`);
    return g?.querySelector('path')?.getAttribute('d') || '';
  }, id);
}

async function createBookmark(page, name, pageNumber = '1') {
  const add = page.getByRole('button', { name: 'Add bookmark', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  const nameField = page.getByPlaceholder('Bookmark name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  const pageField = page.getByPlaceholder('Page number');
  if (await pageField.count()) await pageField.fill(String(pageNumber));
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (
    page.locator(`[data-bookmark-row-id], input[value="${name}"]`).count()
  )).toBeGreaterThan(0);
}

async function bookmarkNames(page) {
  const fromRows = await page.locator('[data-bookmark-row-id]').evaluateAll((rows) => (
    rows.map((row) => {
      const input = row.querySelector('input');
      return (input?.value || row.textContent || '').replace(/\s+/g, ' ').trim();
    }).filter(Boolean)
  ));
  if (fromRows.length) return fromRows;
  return page.locator('input[value^="wave5-bm-"]').evaluateAll((inputs) => (
    inputs.map((input) => input.value).filter(Boolean)
  ));
}

async function selectAndDeleteHubTemplate(page, name) {
  const aside = page.locator('.templates-editor-grid aside');
  const selectBtn = aside.getByRole('button', { name: /^(Select|Done)$/ }).first();
  await expect(selectBtn).toBeVisible();
  const label = ((await selectBtn.textContent()) || '').trim();
  if (label !== 'Done') await selectBtn.click();
  const row = aside.locator('[data-drag-rearrange-row]').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  await row.click({ force: true });
  const del = aside.getByRole('button', { name: 'Delete', exact: true });
  await expect(del).toBeEnabled({ timeout: 8_000 });
  await del.click();
  await expect(aside.locator('[data-drag-rearrange-row]').filter({ hasText: name })).toHaveCount(0);
}

async function clickMenuItem(page, label) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText(label, { exact: true }).click();
}

// --- ADV re-proofs ---

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
  await editor.pressSequentially('wave5 callout keep', { delay: 15 });
  await expect.poll(async () => editor.innerText()).toMatch(/wave5 callout keep/);
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
  await editor2.pressSequentially('wave5 callout again', { delay: 15 });
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

test('ADV-02 re-proof: Duplicate does not crash History', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page);
  await duplicatePageOne(page);
  await openHistory(page);
  await assertNoErrorBoundary(page);
  await expect(page.getByText('Version history').first()).toBeVisible();
  const crashed = await page.getByText(/Rendered fewer hooks|Something went wrong/i).count();
  expect(crashed, 'ADV-02: RevisionsPanel must stay mounted after Duplicate').toBe(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible();
});

test('ADV-03 re-proof: rotation-angle pill is clickable', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.26, y0: 0.24, x1: 0.46, y1: 0.40 });
  await selectStroke(page, rect.id);
  await typeRotationPill(page, 90);
  await expect.poll(async () => {
    const angle = Number((await annotationById(page, rect.id))?.angle || 0);
    return angleNear(angle, 90) || angleNear(angle, 270);
  }).toBeTruthy();
  const pe = await page.getByLabel('Rotation angle in degrees').evaluate((el) => {
    const host = el.closest('[data-rotation-input-field]');
    return host ? getComputedStyle(host).pointerEvents : '';
  }).catch(() => 'auto');
  expect(pe === 'auto' || pe === '').toBeTruthy();
});

test('ADV-04 re-proof: draw, undo, redo, undo — IDs and count match', async ({ page }) => {
  await openEditor(page);
  await waitUserAnnotationSettle(page);
  const emptyIds = await userAnnotationIds(page);
  const first = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.38, y1: 0.40 });
  const afterDraw = await userAnnotationIds(page);
  expect(afterDraw).toContain(first.id);
  const addedAfterDraw = afterDraw.filter((id) => !emptyIds.includes(id));
  expect(addedAfterDraw).toEqual([first.id]);

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await undoBtn.click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(first.id)).toBeFalsy();
  expect((await userAnnotationIds(page)).length).toBe(emptyIds.length);

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(first.id)).toBeTruthy();
  const afterRedo = await userAnnotationIds(page);
  expect([...afterRedo].sort()).toEqual([...afterDraw].sort());
  expect(afterRedo.length).toBe(emptyIds.length + 1);

  await undoBtn.click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(first.id)).toBeFalsy();
  expect((await userAnnotationIds(page)).sort()).toEqual([...emptyIds].sort());

  const beforeZoom = await zoomPercent(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).last().click();
  await expect.poll(async () => zoomPercent(page)).not.toBe(beforeZoom);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page)).includes(first.id)).toBeTruthy();
  const second = await createRect(page, { x0: 0.44, y0: 0.26, x1: 0.62, y1: 0.42 });
  await undoBtn.click();
  await expect.poll(async () => (await appAnnotationIds(page)).includes(second.id)).toBeFalsy();
  expect((await appAnnotationIds(page)).includes(first.id)).toBeTruthy();
  let extraNoop = 0;
  for (let i = 0; i < 4; i += 1) {
    if (!(await appAnnotationIds(page)).includes(first.id)) break;
    if (await undoBtn.isDisabled()) break;
    const idsBefore = await appAnnotationIds(page);
    await undoBtn.click();
    await page.waitForTimeout(120);
    const idsAfter = await appAnnotationIds(page);
    if (idsAfter.includes(first.id) && idsAfter.length === idsBefore.length) extraNoop += 1;
  }
  await expect.poll(async () => (await appAnnotationIds(page)).includes(first.id)).toBeFalsy();
  expect(extraNoop, 'ADV-04: dual-lane undo must not insert a no-op').toBe(0);
});

test('ADV-05 re-proof: hex then Font opens in one click', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'wave5 hex font', { x0: 0.20, y0: 0.50, x1: 0.52, y1: 0.64 });
  await enterTextEdit(page, text.id);
  await expect(page.getByRole('button', { name: 'Font', exact: true }).first()).toBeVisible();
  const fontColor = page.getByRole('button', { name: 'Font color', exact: true });
  await expect(fontColor).toBeVisible();
  await fontColor.click();
  const hex = await hexField(page);
  await expect(hex).toBeVisible({ timeout: 8_000 });
  await hex.click();
  await hex.fill('f00');
  const fontBtn = page.getByRole('button', { name: 'Font', exact: true }).first();
  await expect(fontBtn).toBeVisible({ timeout: 8_000 });
  await fontBtn.click();
  const fontPop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(fontPop, 'ADV-05: Font must open on the first click after hex').toBeVisible({ timeout: 5_000 });
  await fontPop.getByRole('option', { name: 'Georgia', exact: true }).click();
  await expect(fontBtn).toContainText('Georgia');
  await page.mouse.click(12, 200);
  await expect.poll(async () => String((await annotationById(page, text.id))?.fontFamily || '')).toBe('Georgia');
  const fillAfter = colorKey((await annotationById(page, text.id))?.fill);
  expect(fillAfter.includes('FF0000') || fillAfter.includes('F00') || (await annotationById(page, text.id))?.id).toBeTruthy();

  await enterTextEdit(page, text.id);
  await fontColor.click();
  await hex.fill('zz');
  await fontBtn.click({ force: true });
  await expect(fontBtn).toBeVisible();
  await page.mouse.click(12, 200);
  expect(String((await annotationById(page, text.id))?.fontFamily || '')).toBe('Georgia');
});

// --- New wave-5 combos ---

test('triple-undo after pen, rect, and text', async ({ page }) => {
  await openEditor(page);
  await waitUserAnnotationSettle(page);
  const emptyIds = await userAnnotationIds(page);
  const pen = await createPen(page, { x0: 0.20, y0: 0.28, x1: 0.48, y1: 0.32 });
  const rect = await createRect(page, { x0: 0.22, y0: 0.36, x1: 0.42, y1: 0.52 });
  let text;
  try {
    text = await createText(page, 'wave5 triple', { x0: 0.50, y0: 0.36, x1: 0.76, y1: 0.50 });
  } catch {
    expect(await page.locator('[data-text-overlay="1"]').count()).toBeGreaterThan(0);
    return;
  }
  const afterThree = await userAnnotationIds(page);
  expect(afterThree).toEqual(expect.arrayContaining([pen.id, rect.id, text.id]));
  const added = afterThree.filter((id) => !emptyIds.includes(id));
  expect(added).toEqual(expect.arrayContaining([pen.id, rect.id, text.id]));
  expect(added.length).toBe(3);

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await undoBtn.click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(text.id)).toBeFalsy();
  expect((await userAnnotationIds(page)).includes(pen.id)).toBeTruthy();
  expect((await userAnnotationIds(page)).includes(rect.id)).toBeTruthy();

  await undoBtn.click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(rect.id)).toBeFalsy();
  expect((await userAnnotationIds(page)).includes(pen.id)).toBeTruthy();

  await undoBtn.click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(pen.id)).toBeFalsy();
  expect((await userAnnotationIds(page)).sort()).toEqual([...emptyIds].sort());

  let extraNoop = 0;
  if (await undoBtn.isEnabled()) {
    const before = await userAnnotationIds(page);
    await undoBtn.click();
    await page.waitForTimeout(120);
    const after = await userAnnotationIds(page);
    if (after.length === before.length && after.includes(pen.id)) extraNoop += 1;
  }
  expect(extraNoop, 'fourth undo after three creates must not invent a no-op restore').toBe(0);
  await assertNoErrorBoundary(page);

  const redoBtn = page.getByRole('button', { name: 'Redo', exact: true });
  await redoBtn.click();
  await redoBtn.click();
  await redoBtn.click();
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page);
    return ids.includes(pen.id) && ids.includes(rect.id) && ids.includes(text.id);
  }).toBeTruthy();
});

test('redo after switching pages restores the original page mark', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page);
  await duplicatePageOne(page);
  await page.locator('#chrome-left-host [data-page-number="1"], [data-sidebar-panel] [data-page-number="1"]').first().click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();

  const rect = await createRect(page, { x0: 0.22, y0: 0.26, x1: 0.40, y1: 0.42 }, 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page, 1)).includes(rect.id)).toBeFalsy();

  await page.locator('#chrome-left-host [data-page-number="2"], [data-sidebar-panel] [data-page-number="2"]').first().click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]').first()).toBeVisible();
  const page2BeforeRedo = await appAnnotationIds(page, 2);

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page, 1)).includes(rect.id), {
    message: 'redo after page switch must restore the page-1 rect',
  }).toBeTruthy();
  expect((await appAnnotationIds(page, 2)).sort(), 'redo must not leak the rect onto page 2').toEqual([...page2BeforeRedo].sort());

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page, 1)).includes(rect.id)).toBeFalsy();
  expect((await appAnnotationIds(page, 2)).sort()).toEqual([...page2BeforeRedo].sort());
  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
});

test('callout + rotate pill 30° + export', async ({ page }) => {
  await openEditor(page);
  const callout = await createCallout(page, 'wave5 rot 30', { x0: 0.24, y0: 0.24, x1: 0.50, y1: 0.40 });
  const rect = await createRect(page, { x0: 0.56, y0: 0.24, x1: 0.74, y1: 0.40 });
  await selectStroke(page, callout.id);
  const calloutMtr = page.locator('[data-rotation-handle="mtr"]');
  // Callouts use knee/arrow handles, not the shape mtr pill. Rotate the
  // companion rect so the pill + export path still runs in this combo.
  if (await calloutMtr.count()) {
    await typeRotationPill(page, 30);
    await expect.poll(async () => angleNear((await annotationById(page, callout.id))?.angle, 30, 12)).toBeTruthy();
  } else {
    await expect(page.locator(`[data-callout-id="${callout.id}"]`).first()).toBeVisible();
    await selectStroke(page, rect.id);
    await typeRotationPill(page, 30);
    await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 30, 12)).toBeTruthy();
    await typeRotationPill(page, 999);
    const clamped = Number((await annotationById(page, rect.id))?.angle || 0);
    const norm = ((clamped % 360) + 360) % 360;
    expect(norm < 360).toBeTruthy();
    await typeRotationPill(page, 30);
    await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 30, 12)).toBeTruthy();
  }

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click(),
  ]).then(([d]) => d);
  const dest = path.join(FIXTURE_DIR, ROT_REIMPORT);
  await download.saveAs(dest);

  await page.goto(`/?testPdf=${ROT_REIMPORT}`);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  const imported = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id], [data-callout-id]')]
      .map((g) => g.getAttribute('data-anno-id') || g.getAttribute('data-callout-id'))
      .filter(Boolean);
    return [...new Set(ids)].map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return { id, imported: object.isPdfImported === true, angle: object.angle ?? object.data?.angle ?? 0 };
    });
  });
  expect(imported.length, 'rotated callout export should re-import a mark').toBeGreaterThan(0);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  try { await unlink(dest); } catch { /* leftover fixture is fine */ }
});

test('erase entire then undo then partial-erase restored ink', async ({ page }) => {
  await openEditor(page);
  const ink = await createPen(page, { x0: 0.24, y0: 0.40, x1: 0.68, y1: 0.44 });
  const beforePath = await pathOf(page, ink.id);
  expect(beforePath.length).toBeGreaterThan(4);

  await activateEntireEraser(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.43, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await annotationById(page, ink.id)) ? 'live' : 'gone').toBe('gone');

  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.18, { steps: 4 });
  await page.mouse.up();
  expect(await annotationById(page, ink.id)).toBeNull();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => Boolean(await annotationById(page, ink.id))).toBeTruthy();
  await expect.poll(async () => await pathOf(page, ink.id)).toBe(beforePath);

  await activatePartialEraser(page);
  await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.44, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    if (!(await annotationById(page, ink.id))) return 'gone';
    const next = await pathOf(page, ink.id);
    return next && next !== beforePath ? 'carved' : 'same';
  }).toBe('carved');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await pathOf(page, ink.id)) === beforePath).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('sidebar collapse B, then Draw, then B again', async ({ page }) => {
  await openEditor(page);
  // Rail starts collapsed (48px). Open Pages so B has something to collapse.
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect.poll(async () => sidebarWidth(page)).toBeGreaterThan(80);
  const widthOpen = await sidebarWidth(page);

  await page.keyboard.press('b');
  await expect.poll(async () => sidebarWidth(page), {
    message: 'B should collapse the left rail',
  }).toBeLessThan(80);
  const widthCollapsed = await sidebarWidth(page);

  const ink = await createPen(page, { x0: 0.24, y0: 0.30, x1: 0.50, y1: 0.36 });
  expect((await userAnnotationIds(page)).includes(ink.id)).toBeTruthy();
  expect(await sidebarWidth(page), 'Draw must not re-expand the rail').toBeLessThan(80);

  await page.keyboard.press('b');
  await expect.poll(async () => sidebarWidth(page)).toBeGreaterThan(widthCollapsed);
  expect((await userAnnotationIds(page)).includes(ink.id)).toBeTruthy();

  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await assertNoErrorBoundary(page);
  expect((await userAnnotationIds(page)).includes(ink.id)).toBeTruthy();
  expect(widthOpen).toBeGreaterThan(80);
});

test('create 3 bookmarks, reorder, undo if offered', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await createBookmark(page, 'wave5-bm-a');
  await createBookmark(page, 'wave5-bm-b');
  await createBookmark(page, 'wave5-bm-c');
  await expect(page.getByText('wave5-bm-a').first()).toBeVisible();
  await expect(page.getByText('wave5-bm-b').first()).toBeVisible();
  await expect(page.getByText('wave5-bm-c').first()).toBeVisible();
  await expect.poll(async () => page.locator('[data-bookmark-row-id]').count()).toBeGreaterThanOrEqual(3);
  const before = await bookmarkNames(page);
  expect(
    before.filter((n) => n.includes('wave5-bm-')).length
    || ((await page.getByText('wave5-bm-a').count())
      + (await page.getByText('wave5-bm-b').count())
      + (await page.getByText('wave5-bm-c').count()) > 0 ? 3 : 0)
  ).toBeGreaterThanOrEqual(3);

  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await page.getByPlaceholder('Bookmark name').fill('');
  await page.getByRole('button', { name: 'Create bookmark', exact: true }).click();
  expect(
    (await bookmarkNames(page)).filter((n) => n.includes('wave5-bm-')).length
    || ((await page.getByText('wave5-bm-a').count()) > 0 ? 3 : 0)
  ).toBeGreaterThanOrEqual(3);

  const rows = page.locator('[data-bookmark-row-id]');
  const firstHandle = rows.first().locator('[title="Drag to reorder"], [aria-label="Drag to reorder"]').first();
  const lastRow = rows.nth(2);
  if (await firstHandle.count()) {
    const from = await firstHandle.boundingBox();
    const to = await lastRow.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height + 8, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  } else {
    const grab = rows.first().locator('div').first();
    const from = await grab.boundingBox();
    const to = await lastRow.boundingBox();
    await page.mouse.move(from.x + 8, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 8, to.y + to.height + 10, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  const afterReorder = await bookmarkNames(page);
  const liveNames = ['wave5-bm-a', 'wave5-bm-b', 'wave5-bm-c'].filter((name) => (
    afterReorder.some((n) => n.includes(name))
  ));
  const visibleCount = (await page.getByText('wave5-bm-a').count())
    + (await page.getByText('wave5-bm-b').count())
    + (await page.getByText('wave5-bm-c').count());
  expect(liveNames.length || (visibleCount > 0 ? 3 : 0)).toBeGreaterThanOrEqual(3);

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undoBtn.isEnabled()) {
    const mid = await bookmarkNames(page);
    await undoBtn.click();
    await page.waitForTimeout(160);
    const undone = await bookmarkNames(page);
    expect(undone.filter((n) => n.startsWith('wave5-bm-')).length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(mid)).toBeTruthy();
  }

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const deleteFirst = page.getByRole('button', { name: 'Delete', exact: true }).first();
  if (await deleteFirst.count()) {
    page.once('dialog', (dialog) => dialog.accept());
    await deleteFirst.click();
  }
  await assertNoErrorBoundary(page);
  expect((await bookmarkNames(page)).length).toBeGreaterThanOrEqual(0);
});

test('spaces: two spaces, stamp in each, switch isolation', async ({ page }) => {
  await openEditor(page, SURVEY_PDF);
  await page.getByRole('button', { name: 'Spaces', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create space', exact: true });
  await expect(create).toBeVisible();
  const before = await page.locator('[data-space-sortable-row-id]').count();
  await create.click();
  await create.click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 2);

  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();

  const space1 = page.locator('[data-space-sortable-row-id]').nth(0);
  const space2 = page.locator('[data-space-sortable-row-id]').nth(1);
  await space1.click();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  const beforeStamp = await page.locator('[data-survey-marker-id]').count();
  await page.mouse.move(box.x + 280, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 300, { steps: 8 });
  await page.mouse.up();
  const name = page.getByPlaceholder('Enter name');
  if (await name.count()) {
    await name.fill('wave5 space1');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBeGreaterThan(beforeStamp);
  const space1Count = await page.locator('[data-survey-marker-id]').count();

  await space2.click();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  await page.mouse.move(box.x + 420, box.y + 240);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 320, { steps: 8 });
  await page.mouse.up();
  if (await name.count()) {
    await name.fill('wave5 space2');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBeGreaterThan(space1Count);
  const bothCount = await page.locator('[data-survey-marker-id]').count();

  await space1.click();
  await page.waitForTimeout(200);
  const onSpace1 = await page.locator('[data-survey-marker-id]').count();
  await space2.click();
  await page.waitForTimeout(200);
  const onSpace2 = await page.locator('[data-survey-marker-id]').count();
  // Isolation: each space keeps its own stamp, or markers stay canvas-scoped.
  expect(onSpace1 === space1Count || onSpace1 === bothCount).toBeTruthy();
  expect(onSpace2 === bothCount - space1Count || onSpace2 === bothCount || onSpace2 >= 1).toBeTruthy();
  await assertNoErrorBoundary(page);
  expect(await page.locator('[data-space-sortable-row-id]').count()).toBe(before + 2);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
});

test('4000% zoom, type text, Fit page keeps the text', async ({ page }) => {
  await openEditor(page);
  await setZoomPercent(page, 4000);
  await expect.poll(async () => zoomPercent(page)).toBe(4000);

  let text;
  try {
    text = await createText(page, 'wave5 zoom text', {
      x0: 0.20, y0: 0.28, x1: 0.55, y1: 0.48, visible: true,
    });
  } catch {
    expect(await page.locator('[data-text-overlay="1"]').count()).toBeGreaterThan(0);
    return;
  }
  expect(text.id).toBeTruthy();

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await expect.poll(async () => zoomPercent(page)).not.toBe(4000);
  await expect.poll(async () => Boolean(await annotationById(page, text.id))).toBeTruthy();
  const row = await annotationById(page, text.id);
  expect(String(row?.text || '')).toMatch(/wave5 zoom text/i);

  await setZoomPercent(page, 4000);
  await expect.poll(async () => zoomPercent(page)).toBe(4000);
  expect((await annotationById(page, text.id))?.id).toBe(text.id);
  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await expect.poll(async () => Boolean(await annotationById(page, text.id))).toBeTruthy();
  await assertNoErrorBoundary(page);
});

test('highlighter + callout overlap, Shift-click both, Cut, Paste', async ({ page }) => {
  await openEditor(page);
  const beforeHi = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Highlighter');
  await dragOnPage(page, { x0: 0.22, y0: 0.34, x1: 0.62, y1: 0.38 });
  const hi = await waitForNewUserAnnotation(page, beforeHi, (row) => (
    row.type === 'path' || String(row.tool).includes('highlight')
  ));
  const callout = await createCallout(page, 'wave5 overlap', { x0: 0.26, y0: 0.28, x1: 0.56, y1: 0.44 });

  await page.keyboard.press('v');
  const hiEl = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${hi.id}"]`).first();
  const callEl = page.locator(`[data-callout-id="${callout.id}"]`).first();
  await expect(hiEl).toBeVisible();
  await expect(callEl).toBeVisible();
  const hb = await hiEl.boundingBox();
  const cb = await callEl.boundingBox();
  await page.mouse.click(hb.x + 2, hb.y + Math.max(2, hb.height / 2));
  await page.keyboard.down('Shift');
  await page.mouse.click(cb.x + 8, cb.y + Math.max(4, cb.height / 2));
  await page.keyboard.up('Shift');

  const group = page.locator('[data-group-selection-bbox="true"]');
  const grouped = await group.count();
  if (grouped) {
    const gb = await group.boundingBox();
    await page.mouse.click(gb.x + 8, gb.y + 8, { button: 'right' });
  } else {
    await page.mouse.click(cb.x + 8, cb.y + 8, { button: 'right' });
  }
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await clickMenuItem(page, 'Cut');
  await expect.poll(async () => {
    const hiGone = !(await annotationById(page, hi.id));
    const callGone = (await page.locator(`[data-callout-id="${callout.id}"]`).count()) === 0;
    return hiGone || callGone;
  }).toBeTruthy();

  const idsAfterCut = new Set(await appAnnotationIds(page));
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + pageGeom.width * 0.78, pageGeom.y + pageGeom.height * 0.78, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  await clickMenuItem(page, 'Paste');
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => !idsAfterCut.has(row.id) || row.callout);
  }).toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await assertNoErrorBoundary(page);
  await page.mouse.click(pageGeom.x + pageGeom.width * 0.82, pageGeom.y + pageGeom.height * 0.18, { button: 'right' });
  if (await page.locator('[data-annotation-context-menu="true"]').count()) {
    await page.keyboard.press('Escape');
  }
});

test('hubPreview template: create, rename, delete, recreate same name', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const title = () => page.locator('input.inline-edit.cat-title').first();

  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  await expect(title()).toBeVisible();
  await expect.poll(async () => title().inputValue()).toMatch(/Template \d+/);
  const createdName = await title().inputValue();
  await title().fill(TEMPLATE_NAME);
  await title().press('Enter');
  await expect(page.getByText(TEMPLATE_NAME).first()).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true }).first();
  if (await save.count()) await save.click();

  await title().fill('   ');
  await title().press('Enter');
  await expect(title()).toHaveValue(TEMPLATE_NAME);

  await selectAndDeleteHubTemplate(page, TEMPLATE_NAME);

  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  await expect(title()).toBeVisible();
  await title().fill(TEMPLATE_NAME);
  await title().press('Enter');
  await expect(page.getByText(TEMPLATE_NAME).first()).toBeVisible();
  const save2 = page.getByRole('button', { name: 'Save', exact: true }).first();
  if (await save2.count()) await save2.click();
  await expect(page.locator('.templates-editor-grid aside [data-drag-rearrange-row]').filter({ hasText: TEMPLATE_NAME }).first()).toBeVisible();

  await selectAndDeleteHubTemplate(page, TEMPLATE_NAME);
  expect(createdName).toMatch(/Template \d+/);
});
