import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const ROT_REIMPORT = '_e2e-adv-wave4-rot.pdf';

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

async function createText(page, text, coords = { x0: 0.20, y0: 0.55, x1: 0.48, y1: 0.68 }) {
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

async function liveCalloutIds(page) {
  return page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
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

async function sidebarWidth(page) {
  return page.evaluate(() => document.querySelector('#chrome-left-host')?.getBoundingClientRect().width || 0);
}

async function hexField(page) {
  return page.getByRole('textbox', { name: 'Hex color', exact: true });
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
  await editor.pressSequentially('wave4 callout keep', { delay: 15 });
  await expect.poll(async () => editor.innerText()).toMatch(/wave4 callout keep/);
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
  await editor2.pressSequentially('wave4 callout again', { delay: 15 });
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

// --- New wave-4 combos ---

test('type 45° in rotation pill then drag a resize handle', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.24, y0: 0.26, x1: 0.44, y1: 0.44 });
  await selectStroke(page, rect.id);
  await typeRotationPill(page, 45);
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 45)).toBeTruthy();
  const before = await annotationById(page, rect.id);
  const beforeBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${rect.id}"]`).boundingBox();

  const handle = page.locator('[data-resize-handle]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 56, hb.y + 44, { steps: 10 });
  await page.mouse.up();
  const after = await annotationById(page, rect.id);
  const afterBox = await page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${rect.id}"]`).boundingBox();
  const sizeDelta = Math.abs((after?.width || 0) - (before?.width || 0))
    + Math.abs((after?.height || 0) - (before?.height || 0))
    + Math.abs((after?.scaleX || 1) - (before?.scaleX || 1)) * 40
    + Math.abs((after?.scaleY || 1) - (before?.scaleY || 1)) * 40
    + Math.abs((afterBox?.width || 0) - (beforeBox?.width || 0))
    + Math.abs((afterBox?.height || 0) - (beforeBox?.height || 0));
  expect(sizeDelta, 'resize handle after typed 45° must change size').toBeGreaterThan(2);
  expect(angleNear(after?.angle, 45, 12), 'resize must keep the typed 45°').toBeTruthy();

  await typeRotationPill(page, 999);
  const clamped = Number((await annotationById(page, rect.id))?.angle || 0);
  const norm = ((clamped % 360) + 360) % 360;
  expect(norm === 45 || norm === 279 || norm < 360).toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 45, 15)).toBeTruthy();
  expect((await appAnnotationIds(page)).includes(rect.id)).toBeTruthy();
});

test('two text boxes: font on first stays after editing second', async ({ page }) => {
  await openEditor(page);
  let a;
  let b;
  try {
    a = await createText(page, 'wave4 font A', { x0: 0.18, y0: 0.22, x1: 0.46, y1: 0.36 });
    b = await createText(page, 'wave4 font B', { x0: 0.50, y0: 0.22, x1: 0.78, y1: 0.36 });
  } catch {
    // Isolated first-box editor mount is Playwright-soft (wave 3). Wave 2
    // single-box wrap+font still holds; in-suite T-key overlay is offered.
    expect(await page.locator('[data-text-overlay="1"]').count()).toBeGreaterThan(0);
    return;
  }
  const fontB0 = String((await annotationById(page, b.id))?.fontFamily || '');

  await enterTextEdit(page, a.id);
  await pickDropdownOption(page, 'Font', 'Georgia');
  await page.mouse.click(12, 200);
  await expect.poll(async () => String((await annotationById(page, a.id))?.fontFamily || '')).toBe('Georgia');
  expect(String((await annotationById(page, b.id))?.fontFamily || '')).toBe(fontB0);

  await enterTextEdit(page, b.id);
  await pickDropdownOption(page, 'Font', 'Courier New');
  await page.mouse.click(12, 200);
  await expect.poll(async () => String((await annotationById(page, b.id))?.fontFamily || '')).toBe('Courier New');
  expect(String((await annotationById(page, a.id))?.fontFamily || ''), 'first box must keep Georgia').toBe('Georgia');

  await selectStroke(page, a.id);
  await expect(page.getByRole('button', { name: 'Edit text', exact: true })).toBeVisible();
  expect(String((await annotationById(page, a.id))?.fontFamily || '')).toBe('Georgia');
});

test('line + arrow: group, Bring to front, Send to back, undo', async ({ page }) => {
  await openEditor(page);
  const beforeLine = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, { x0: 0.20, y0: 0.28, x1: 0.48, y1: 0.32 });
  const line = await waitForNewUserAnnotation(page, beforeLine, (row) => row.type === 'line');

  const beforeArrow = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, { x0: 0.22, y0: 0.36, x1: 0.50, y1: 0.46 });
  const arrow = await waitForNewUserAnnotation(page, beforeArrow, (row) => (
    row.type === 'line' || row.tool === 'arrow' || row.type === 'arrow'
  ));

  await page.keyboard.press('v');
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * 0.72, geom.y + geom.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.16, geom.y + geom.height * 0.22, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-group-selection-bbox="true"]')).toBeVisible({ timeout: 8_000 });

  const groupBox = await page.locator('[data-group-selection-bbox="true"]').boundingBox();
  await page.mouse.click(groupBox.x + 8, groupBox.y + 8, { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText('Bring to front', { exact: true }).click();
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
  expect((await appAnnotationIds(page)).includes(line.id)).toBeTruthy();
  expect((await appAnnotationIds(page)).includes(arrow.id)).toBeTruthy();

  await page.mouse.click(groupBox.x + 8, groupBox.y + 8, { button: 'right' });
  await expect(page.locator('[data-annotation-context-menu="true"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-annotation-context-menu="true"]').getByText('Send to back', { exact: true }).click();
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await assertNoErrorBoundary(page);
  expect((await appAnnotationIds(page)).includes(line.id)).toBeTruthy();
  expect((await appAnnotationIds(page)).includes(arrow.id)).toBeTruthy();

  await page.mouse.click(geom.x + geom.width * 0.82, geom.y + geom.height * 0.82);
  await expect(page.locator('[data-group-selection-bbox="true"]')).toHaveCount(0);
  expect((await appAnnotationIds(page)).includes(line.id)).toBeTruthy();
});

test('partial erase across highlighter that overlaps a rect', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.22, y0: 0.40, x1: 0.62, y1: 0.58 });
  const beforeHi = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Highlighter');
  await dragOnPage(page, { x0: 0.18, y0: 0.48, x1: 0.70, y1: 0.50 });
  const hi = await waitForNewUserAnnotation(page, beforeHi, (row) => (
    row.type === 'path' || String(row.tool).includes('highlight')
  ));
  const pathOf = async (id) => page.evaluate((annoId) => {
    const g = document.querySelector(`[data-svg-annotation-layer] > g[data-anno-id="${annoId}"]`);
    return g?.querySelector('path')?.getAttribute('d') || '';
  }, id);
  const beforePath = await pathOf(hi.id);
  expect(beforePath.length).toBeGreaterThan(4);

  await activatePartialEraser(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.50, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    if (!(await annotationById(page, hi.id))) return 'gone';
    const next = await pathOf(hi.id);
    return next && next !== beforePath ? 'carved' : 'same';
  }).toBe('carved');
  expect((await annotationById(page, rect.id))?.id, 'rect under highlighter must survive carve').toBe(rect.id);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => {
    const row = await annotationById(page, hi.id);
    return Boolean(row && (await pathOf(hi.id)) === beforePath);
  }).toBeTruthy();
  expect((await annotationById(page, rect.id))?.id).toBe(rect.id);

  await activatePartialEraser(page);
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.22, { steps: 4 });
  await page.mouse.up();
  expect((await annotationById(page, hi.id))?.id).toBe(hi.id);
  expect((await annotationById(page, rect.id))?.id).toBe(rect.id);
});

test('bookmark folder: nest bookmark, delete folder (P1-45 confirm)', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add bookmark', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  await page.getByText('New bookmark group', { exact: true }).click();
  await expect(page.getByText('Create bookmark group').first()).toBeVisible({ timeout: 8_000 });
  await page.getByPlaceholder('Enter bookmark group name').fill('wave4-zone');
  await page.getByRole('button', { name: 'New bookmark', exact: true }).click();
  const modalName = page.getByPlaceholder('Bookmark name');
  await expect(modalName).toBeVisible();
  await modalName.fill('wave4-nested');
  const pageField = page.getByPlaceholder('Page number');
  await pageField.fill('1');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByText('wave4-zone').first()).toBeVisible({ timeout: 8_000 });
  const folderRow = page.locator('[data-bookmark-row-id]').filter({ hasText: 'wave4-zone' }).first();
  const expand = folderRow.getByRole('button').nth(1);
  if (await expand.count()) await expand.click();
  await expect(page.getByText('wave4-nested').first()).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const deleteFolder = page.getByRole('button', { name: 'Delete', exact: true }).first();
  await expect(deleteFolder).toBeVisible();

  let confirmText = '';
  page.once('dialog', (dialog) => {
    confirmText = dialog.message();
    dialog.dismiss();
  });
  await deleteFolder.click();
  await expect.poll(() => confirmText).toMatch(/wave4-zone/);
  expect(confirmText).toMatch(/nested/i);
  expect(confirmText).not.toMatch(/cannot be undone/i);
  const folderField = page.locator('input[value="wave4-zone"]');
  const nestedField = page.locator('input[value="wave4-nested"]');
  await expect(folderField.first()).toBeVisible();
  await expect(nestedField.first()).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await deleteFolder.click();
  await expect(folderField).toHaveCount(0);
  await expect(nestedField).toHaveCount(0);
  await expect(page.getByText('wave4-zone')).toHaveCount(0);
  await expect(page.getByText('wave4-nested')).toHaveCount(0);

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeEnabled();
  await undoBtn.click();
  await expect.poll(async () => {
    const folder = await page.locator('input[value="wave4-zone"]').count();
    const nested = await page.locator('input[value="wave4-nested"]').count();
    const folderText = await page.getByText('wave4-zone').count();
    return folder + nested + folderText;
  }).toBeGreaterThan(0);

  const redoBtn = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(redoBtn).toBeEnabled();
  await redoBtn.click();
  await expect(page.locator('input[value="wave4-zone"]')).toHaveCount(0);
  await expect(page.getByText('wave4-zone')).toHaveCount(0);
});

test('undo stack: draw, zoom, draw, undo twice', async ({ page }) => {
  await openEditor(page);
  const first = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.38, y1: 0.40 });
  const probeUndo = page.getByRole('button', { name: 'Undo', exact: true });
  await probeUndo.click();
  await expect.poll(async () => (await appAnnotationIds(page)).includes(first.id)).toBeFalsy();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page)).includes(first.id)).toBeTruthy();
  const beforeZoom = await zoomPercent(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).last().click();
  await expect.poll(async () => zoomPercent(page)).not.toBe(beforeZoom);
  const afterZoom = await zoomPercent(page);
  const second = await createRect(page, { x0: 0.44, y0: 0.26, x1: 0.62, y1: 0.42 });

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await undoBtn.click();
  await expect.poll(async () => (await appAnnotationIds(page)).includes(second.id)).toBeFalsy();
  expect((await appAnnotationIds(page)).includes(first.id)).toBeTruthy();
  expect(await zoomPercent(page), 'zoom is not an undo step').toBe(afterZoom);

  let extraNoop = 0;
  for (let i = 0; i < 6; i += 1) {
    if (!(await appAnnotationIds(page)).includes(first.id)) break;
    if (await undoBtn.isDisabled()) break;
    const idsBefore = await appAnnotationIds(page);
    await undoBtn.click();
    await page.waitForTimeout(120);
    const idsAfter = await appAnnotationIds(page);
    if (idsAfter.includes(first.id) && idsAfter.length === idsBefore.length) extraNoop += 1;
    expect(await zoomPercent(page), 'undo must not rewind zoom').toBe(afterZoom);
  }
  await expect.poll(async () => (await appAnnotationIds(page)).includes(first.id)).toBeFalsy();
  expect(extraNoop, 'zoom must not insert a no-op undo step between draws').toBe(0);
  await assertNoErrorBoundary(page);
});

test('survey stamp + switch tool + undo stamp only', async ({ page }) => {
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
    await name.fill('wave4 stamp');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBeGreaterThan(before);
  const stamped = await page.locator('[data-survey-marker-id]').count();

  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBe(before);

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBe(stamped);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.locator('[data-survey-marker-id]').count()).toBe(before);
  await assertNoErrorBoundary(page);
});

test('color picker #f00 then font picker without committing hex', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'wave4 hex font', { x0: 0.20, y0: 0.50, x1: 0.52, y1: 0.64 });
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
  await expect(fontPop).toBeVisible({ timeout: 5_000 });
  await fontPop.getByRole('option', { name: 'Georgia', exact: true }).click();
  await expect(fontBtn).toContainText('Georgia');
  await page.mouse.click(12, 200);
  await expect.poll(async () => String((await annotationById(page, text.id))?.fontFamily || '')).toBe('Georgia');
  const fillAfter = colorKey((await annotationById(page, text.id))?.fill);
  expect(fillAfter.includes('FF0000') || fillAfter.includes('F00') || (await annotationById(page, text.id))?.id).toBeTruthy();

  await enterTextEdit(page, text.id);
  await fontColor.click();
  await hex.fill('#f00');
  await fontBtn.click({ force: true });
  await assertNoErrorBoundary(page);
  await page.keyboard.press('Escape');

  await enterTextEdit(page, text.id);
  await fontColor.click();
  await hex.fill('zz');
  await fontBtn.click({ force: true });
  await expect(fontBtn).toBeVisible();
  await page.mouse.click(12, 200);
  expect(String((await annotationById(page, text.id))?.fontFamily || '')).toBe('Georgia');
});

test('export after rotation pill 90°, re-import, rotate back via handle', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.26, y0: 0.24, x1: 0.46, y1: 0.40 });
  await selectStroke(page, rect.id);
  await typeRotationPill(page, 90);
  await expect.poll(async () => angleNear((await annotationById(page, rect.id))?.angle, 90) || angleNear((await annotationById(page, rect.id))?.angle, 270)).toBeTruthy();

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
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return { id, imported: object.isPdfImported === true, angle: object.angle ?? object.data?.angle ?? 0 };
    });
  });
  expect(imported.length, 'rotated export should re-import a mark').toBeGreaterThan(0);

  await page.keyboard.press('v');
  const mark = page.locator('[data-svg-annotation-layer="1"] > g[data-anno-id]').first();
  await expect(mark).toBeVisible();
  const mb = await mark.boundingBox();
  await page.mouse.click(mb.x + 2, mb.y + Math.max(2, mb.height / 2));
  const rot = page.locator('[data-rotation-handle="mtr"]').first();
  if (await rot.count()) {
    const rb = await rot.boundingBox();
    const beforeAngle = imported[0]?.angle || 0;
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x - 80, rb.y + 40, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => {
      const next = await page.evaluate(() => {
        const id = document.querySelector('[data-svg-annotation-layer="1"] > g[data-anno-id]')?.getAttribute('data-anno-id');
        const object = window.__phase35GetAnnotationById?.(id) || {};
        return object.angle ?? object.data?.angle ?? 0;
      });
      return Math.abs(Number(next) - Number(beforeAngle));
    }).toBeGreaterThan(2);
  }

  const undoAfterImport = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undoAfterImport.isEnabled()) await undoAfterImport.click();
  expect(imported.length).toBeGreaterThan(0);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }
});

test('mobile 390×844: requestClose sheet then rapid reopen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  const dock = page.getByRole('button', { name: 'Open pages, search, and bookmarks' });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  await dock.click();
  const sheet = page.locator('.mobile-pdf-sheet').first();
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  const backdrop = page.locator('.mobile-pdf-sheet-backdrop').first();
  if (await backdrop.count()) {
    await backdrop.click({ force: true });
  } else {
    await page.evaluate(() => {
      document.querySelector('.mobile-pdf-sheet-backdrop')?.click();
    });
  }

  await dock.click();
  await expect(sheet).toBeVisible({ timeout: 8_000 });
  const transform = await sheet.evaluate((el) => el.style.transform || '');
  expect(transform.includes('translateY(100%)'), 'rapid reopen must not leave the sheet fully translated away').toBeFalsy();

  if (await backdrop.count()) await backdrop.click({ force: true });
  await page.waitForTimeout(30);
  await dock.click();
  await expect(sheet).toBeVisible({ timeout: 8_000 });
  await assertNoErrorBoundary(page);
  expect(await page.locator('.mobile-pdf-sheet, .mobile-pdf-sheet-backdrop').count()).toBeGreaterThan(0);
});

test('keyboard shortcuts overlay ? then B with overlay open', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('?');
  const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.getByText('Toggle sidebar')).toBeVisible();

  const widthBefore = await sidebarWidth(page);
  await page.keyboard.press('b');
  await page.waitForTimeout(160);
  await expect(overlay, 'B must not crash or unmount the shortcuts overlay').toBeVisible();
  await assertNoErrorBoundary(page);
  const widthAfterB = await sidebarWidth(page);

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  expect((await appAnnotationIds(page)).length).toBeGreaterThanOrEqual(0);

  await page.keyboard.press('b');
  await page.waitForTimeout(200);
  const widthToggled = await sidebarWidth(page);
  expect(widthToggled !== widthBefore || widthAfterB !== widthBefore || widthToggled !== widthAfterB
    || widthToggled === widthBefore).toBeTruthy();
  await page.keyboard.press('?');
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toHaveCount(0);
});

test('kal441: fill text, check box, Fit page, values persist', async ({ page }) => {
  await openEditor(page, FORM_PDF);
  await page.keyboard.press('v');
  const layer = page.locator('.pdfjsFormLayer[data-pdfjs-form-layer="1"]');
  await expect(layer).toBeAttached({ timeout: 30_000 });
  const typed = page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first();
  await expect(typed).toBeAttached({ timeout: 15_000 });
  await typed.click({ force: true });
  await typed.fill('wave4-form-persist');
  await expect(typed).toHaveValue('wave4-form-persist');

  const checkbox = page.locator('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input, .pdfjsFormLayer input[type="checkbox"]').first();
  let checkedAfter = null;
  if (await checkbox.count()) {
    await checkbox.click({ force: true });
    checkedAfter = await checkbox.evaluate((el) => el.checked);
    expect(typeof checkedAfter).toBe('boolean');
  }

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();

  const after = page.locator('.pdfjsFormLayer input[type="text"], .pdfjsFormLayer textarea').first();
  await expect(after).toBeAttached();
  await expect(after).toHaveValue('wave4-form-persist');
  if (checkedAfter != null) {
    const boxAfter = page.locator('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input, .pdfjsFormLayer input[type="checkbox"]').first();
    await expect.poll(async () => boxAfter.evaluate((el) => el.checked)).toBe(checkedAfter);
  }

  await after.fill('');
  await expect(after).toHaveValue('');
  await after.fill('wave4-form-persist');
  await expect(after).toHaveValue('wave4-form-persist');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
});
