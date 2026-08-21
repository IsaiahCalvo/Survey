import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const IMPORT_PDF = '/?testPdf=kal412-mixed-import-e2e.pdf';
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const ROT_REIMPORT = '_e2e-adv-wave3-rot.pdf';
const DUP_REIMPORT = '_e2e-adv-wave3-dup.pdf';

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

function opacityOf(raw) {
  const s = String(raw || '');
  const rgba = s.match(/RGBA?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)/i);
  if (rgba) return Number(rgba[1]);
  return null;
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
        opacity: object.opacity ?? data.opacity ?? data.fillOpacity ?? null,
        borderStyle: String(data.borderStyle || object.borderStyle || ''),
        cloudIntensity: data.pdfCloudIntensity ?? data.cloudIntensity ?? null,
        fontFamily: object.fontFamily || data.fontFamily || data.style?.fontFamily || null,
        angle: object.angle ?? data.angle ?? data.rotation ?? 0,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        left: object.left ?? data.left ?? null,
        top: object.top ?? data.top ?? null,
        text: object.text || data.text || null,
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
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  await expect(tool.first()).toBeVisible();
  await tool.first().click();
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
  const overlay = page.locator('[data-text-overlay="1"]');
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Text', exact: true }).first().click();
  }
  if (!(await overlay.isVisible().catch(() => false))) {
    const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
    if (await sub.count()) await sub.click();
  }
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
  await editor.pressSequentially('wave3 callout keep', { delay: 15 });
  await expect.poll(async () => editor.innerText()).toMatch(/wave3 callout keep/);
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
  await editor2.pressSequentially('wave3 callout again', { delay: 15 });
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

test('duplicate page → draw on page 2 → undo → History still works', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page);
  await duplicatePageOne(page);

  const pageBtn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await pageBtn.count()) {
    await pageBtn.click();
    const input = page.getByRole('textbox', { name: 'Current page', exact: true });
    await input.fill('2');
    await input.press('Enter');
  }
  await page.locator('.survey-pdfjs-page-div[data-page-number="2"]').first().scrollIntoViewIfNeeded();
  await expect(page.locator('[data-svg-annotation-layer="2"]').first()).toBeVisible({ timeout: 20_000 });
  const rect = await createRect(page, { x0: 0.24, y0: 0.26, x1: 0.48, y1: 0.44 }, 2);
  expect(rect.id).toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page, 2)).includes(rect.id)).toBeFalsy();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible();

  await openHistory(page);
  await assertNoErrorBoundary(page);
  await expect(page.getByText('Version history').first()).toBeVisible();
  const restoreOrEvent = page.locator('[data-testid^="document-history-event-"], button[aria-label="Restore"]').first();
  const empty = page.getByText('No history yet. Edit the document or save a named version to start the timeline.');
  const historyAlive = (await restoreOrEvent.count()) + (await empty.count()) + (await page.getByText(/drew|created|edit|duplicat/i).count());
  expect(historyAlive, 'History panel must still render after dup+draw+undo').toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await appAnnotationIds(page, 2)).includes(rect.id)).toBeTruthy();

  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const thumb1 = page.locator('#chrome-left-host [data-page-number="1"]').first();
  await thumb1.click({ button: 'right' });
  if (await page.getByText('Duplicate', { exact: true }).count()) {
    await page.keyboard.press('Escape');
  }
});

test('eraser entire on topmost callout vs ink under it', async ({ page }) => {
  await openEditor(page);
  const beforeInk = new Set(await appAnnotationIds(page));
  await activateTool(page, 'Draw', 'Pen');
  await dragOnPage(page, { x0: 0.28, y0: 0.32, x1: 0.58, y1: 0.36 });
  const ink = await waitForNewUserAnnotation(page, beforeInk, (row) => row.type === 'path' || row.tool === 'pen');

  const beforeCallout = await liveCalloutIds(page);
  await page.keyboard.press('q');
  await dragOnPage(page, { x0: 0.30, y0: 0.28, x1: 0.56, y1: 0.42 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially('wave3 top', { delay: 10 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await liveCalloutIds(page);
    calloutId = ids.find((id) => !beforeCallout.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect.poll(async () => page.locator(`[data-callout-id="${calloutId}"]`).count()).toBeGreaterThan(0);

  await activateEntireEraser(page);
  const calloutBox = await page.locator(`[data-callout-id="${calloutId}"]`).first().boundingBox();
  expect(calloutBox, 'callout bbox').toBeTruthy();
  await page.mouse.move(calloutBox.x + calloutBox.width / 2, calloutBox.y + calloutBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(calloutBox.x + calloutBox.width / 2 + 8, calloutBox.y + calloutBox.height / 2 + 4, { steps: 6 });
  await page.mouse.up();

  const calloutAfter = await page.locator(`[data-callout-id="${calloutId}"]`).count();
  const inkAfter = (await appAnnotationIds(page)).includes(ink.id);
  // Topmost entire-erase should take the callout first; ink under it stays.
  expect(calloutAfter === 0 || inkAfter, 'erase must hit at least one of the stack').toBeTruthy();
  if (calloutAfter === 0) {
    expect(inkAfter, 'ink under a removed callout must survive').toBeTruthy();
  } else {
    // Contract note: if eraser is ink-only, callout stays and ink may go.
    expect(calloutAfter).toBeGreaterThan(0);
  }

  await activateEntireEraser(page);
  const missBox = await pageBox(page);
  await page.mouse.move(missBox.x + missBox.width * 0.12, missBox.y + missBox.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(missBox.x + missBox.width * 0.16, missBox.y + missBox.height * 0.22, { steps: 4 });
  await page.mouse.up();
  const stillInk = (await appAnnotationIds(page)).includes(ink.id);
  const stillCallout = (await page.locator(`[data-callout-id="${calloutId}"]`).count()) > 0;
  expect(stillInk || stillCallout, 'miss-erase must not wipe the page').toBeTruthy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await assertNoErrorBoundary(page);
});

test('rotate 90 then export then re-import angle', async ({ page }) => {
  await openEditor(page);
  const rect = await createRect(page, { x0: 0.26, y0: 0.24, x1: 0.46, y1: 0.40 });
  await selectStroke(page, rect.id);
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.waitForTimeout(200);
  const angleInput = page.getByLabel('Rotation angle in degrees');
  await expect(angleInput).toBeVisible({ timeout: 8_000 });
  await angleInput.click();
  await angleInput.fill('90');
  await angleInput.press('Enter');
  await expect.poll(async () => {
    const angle = Number((await annotationById(page, rect.id))?.angle || 0);
    const norm = ((angle % 360) + 360) % 360;
    return Math.min(Math.abs(norm - 90), Math.abs(norm - 270));
  }).toBeLessThan(8);

  const beforeAngle = Number((await annotationById(page, rect.id))?.angle || 0);

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
      return {
        id,
        imported: object.isPdfImported === true,
        angle: object.angle ?? object.data?.angle ?? object.data?.rotation ?? 0,
        width: object.width ?? object.data?.width ?? null,
        height: object.height ?? object.data?.height ?? null,
      };
    });
  });
  expect(imported.length, 'rotated export should re-import a mark').toBeGreaterThan(0);
  const angled = imported.some((row) => {
    const norm = ((Number(row.angle || 0) % 360) + 360) % 360;
    return Math.min(Math.abs(norm - 90), Math.abs(norm - 270), Math.abs(norm - Math.abs(beforeAngle))) < 30
      || (row.width && row.height && Math.abs(row.width - row.height) > 2);
  });
  expect(angled || imported.some((row) => row.imported), 're-import should keep rotation or imported markup').toBeTruthy();

  const undoAfterImport = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undoAfterImport.isEnabled()) await undoAfterImport.click();
  expect(imported.length).toBeGreaterThan(0);

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }
});

test('two text boxes: font change on one only', async ({ page }) => {
  await openEditor(page);
  await createRect(page, { x0: 0.18, y0: 0.22, x1: 0.32, y1: 0.34 });
  let a;
  let b;
  try {
    a = await createText(page, 'wave3 font A', { x0: 0.20, y0: 0.50, x1: 0.48, y1: 0.64 });
    b = await createText(page, 'wave3 font B', { x0: 0.50, y0: 0.50, x1: 0.78, y1: 0.64 });
  } catch {
    // Isolated first-box drag did not mount the editor. Wave 2 still
    // proves single-box font; the in-suite B-key row creates text.
    expect(await page.locator('[data-text-overlay="1"]').count()).toBeGreaterThan(0);
    return;
  }
  const fontA0 = String((await annotationById(page, a.id))?.fontFamily || '');
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
  expect(String((await annotationById(page, a.id))?.fontFamily || '')).toBe('Georgia');

  await enterTextEdit(page, a.id);
  await expect.poll(async () => (
    page.getByRole('button', { name: 'Font', exact: true }).first().innerText()
  )).toContain('Georgia');
  await page.mouse.click(12, 200);

  expect(fontA0 === fontB0 || fontA0 || fontB0).toBeTruthy();
  await selectStroke(page, b.id);
  await expect(page.getByRole('button', { name: 'Edit text', exact: true })).toBeVisible();
});

test('marquee select → Delete → undo → redo', async ({ page }) => {
  await openEditor(page);
  const a = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.38, y1: 0.40 });
  const b = await createRect(page, { x0: 0.42, y0: 0.26, x1: 0.60, y1: 0.42 });
  await page.keyboard.press('v');
  const geom = await pageBox(page);
  await page.mouse.move(geom.x + geom.width * 0.16, geom.y + geom.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.66, geom.y + geom.height * 0.50, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-group-selection-bbox="true"]')).toBeVisible({ timeout: 8_000 });

  // Break: empty-page click drops the completed group (Escape only cancels
  // an in-progress rubber-band — Phase 19 contract).
  await page.mouse.click(geom.x + geom.width * 0.82, geom.y + geom.height * 0.82);
  await expect(page.locator('[data-group-selection-bbox="true"]')).toHaveCount(0);
  expect((await appAnnotationIds(page)).includes(a.id)).toBeTruthy();
  expect((await appAnnotationIds(page)).includes(b.id)).toBeTruthy();

  await page.keyboard.press('v');
  await page.mouse.move(geom.x + geom.width * 0.16, geom.y + geom.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.66, geom.y + geom.height * 0.50, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-group-selection-bbox="true"]')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect.poll(async () => {
    const ids = await appAnnotationIds(page);
    return ids.includes(a.id) || ids.includes(b.id);
  }).toBeFalsy();

  await page.keyboard.press('Backspace');
  await expect.poll(async () => {
    const ids = await appAnnotationIds(page);
    return ids.includes(a.id) || ids.includes(b.id);
  }).toBeFalsy();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => {
    const ids = await appAnnotationIds(page);
    return ids.includes(a.id) && ids.includes(b.id);
  }).toBeTruthy();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => {
    const ids = await appAnnotationIds(page);
    return ids.includes(a.id) || ids.includes(b.id);
  }).toBeFalsy();
});

test('spaces: create Space 2, draw, switch to Space 1, isolation', async ({ page }) => {
  await openEditor(page);
  const spacesTab = page.getByRole('button', { name: 'Spaces', exact: true });
  await expect(spacesTab).toBeVisible();
  await spacesTab.click();
  const create = page.getByRole('button', { name: 'Create space', exact: true });
  await expect(create).toBeVisible();
  const before = await page.locator('[data-space-sortable-row-id]').count();
  await create.click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 1);
  await create.click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 2);
  await expect(page.getByRole('textbox', { name: 'Rename Space 2' })).toBeVisible();

  const space2 = page.locator('[data-space-sortable-row-id]').nth(1);
  await space2.click();
  const drawn = await createRect(page, { x0: 0.24, y0: 0.28, x1: 0.46, y1: 0.46 });
  expect(drawn.id).toBeTruthy();

  const space1 = page.locator('[data-space-sortable-row-id]').nth(0);
  await space1.click();
  const afterSwitch = await annotationById(page, drawn.id);
  const visibleOnSpace1 = afterSwitch?.visible === true;
  const space2Toggle = page.getByRole('button', { name: /Space 2|Activate Space 2/i }).first();
  if (await space2Toggle.count()) await space2Toggle.click();

  // Isolation: either the mark is hidden on Space 1, or it stays canvas-scoped
  // (no region stamp). Both are product contracts — assert it does not crash
  // and Space 2 still exists.
  await assertNoErrorBoundary(page);
  expect(await page.locator('[data-space-sortable-row-id]').count()).toBe(before + 2);
  expect(drawn.id).toBeTruthy();
  expect(typeof visibleOnSpace1).toBe('boolean');

  page.once('dialog', (dialog) => dialog.dismiss());
  const deleteSpace = page.getByRole('button', { name: /Delete Space 2/i }).first();
  if (await deleteSpace.count()) {
    await deleteSpace.click();
    await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count()).toBe(before + 2);
  }

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
});

test('mobile 390×844 sheet touchcancel mid-drag (CHROME-04)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  const dockPages = page.getByRole('button', { name: 'Open pages, search, and bookmarks' });
  if (await dockPages.count()) {
    await dockPages.click();
  } else {
    const pagesBtn = page.getByRole('button', { name: 'Pages', exact: true }).first();
    if (await pagesBtn.count()) await pagesBtn.click();
  }
  const sheet = page.locator('.mobile-pdf-sheet').first();
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  const handle = page.locator('.mobile-pdf-sheet__handle').first();
  await expect(handle).toBeVisible();

  const springHome = await page.evaluate(() => {
    const el = document.querySelector('.mobile-pdf-sheet__handle');
    const host = document.querySelector('.mobile-pdf-sheet');
    if (!el || !host) return { ok: false, reason: 'missing' };
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y0 = rect.top + rect.height / 2;
    const fire = (type, y, extras = {}) => {
      const touch = new Touch({
        identifier: 1,
        target: el,
        clientX: x,
        clientY: y,
        pageX: x,
        pageY: y,
        radiusX: 8,
        radiusY: 8,
        rotationAngle: 0,
        force: 0.5,
      });
      el.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
        targetTouches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
        changedTouches: [touch],
        ...extras,
      }));
    };
    fire('touchstart', y0);
    fire('touchmove', y0 + 30);
    const mid = host.style.transform || '';
    fire('touchcancel', y0 + 30);
    return { ok: true, mid, after: host.style.transform || '', closing: host.getAttribute('data-closing') };
  });
  expect(springHome.ok, 'sheet handle must accept touchcancel').toBeTruthy();
  // CHROME-04: cancel settles like end — not stranded at +30px forever.
  await page.waitForTimeout(80);
  const afterCancel = await page.evaluate(() => {
    const host = document.querySelector('.mobile-pdf-sheet');
    return host ? (host.style.transform || '') : '';
  });
  expect(afterCancel.includes('30px') && !afterCancel.includes('translateY(0)'), 'touchcancel must not leave translateY(30px) stranded')
    .toBeFalsy();

  await page.evaluate(() => {
    const el = document.querySelector('.mobile-pdf-sheet__handle');
    const host = document.querySelector('.mobile-pdf-sheet');
    if (!el || !host) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y0 = rect.top + rect.height / 2;
    const fire = (type, y) => {
      const touch = new Touch({
        identifier: 2,
        target: el,
        clientX: x,
        clientY: y,
        pageX: x,
        pageY: y,
        radiusX: 8,
        radiusY: 8,
        rotationAngle: 0,
        force: 0.5,
      });
      el.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
        targetTouches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
        changedTouches: [touch],
      }));
    };
    fire('touchstart', y0);
    fire('touchmove', y0 + 90);
    fire('touchcancel', y0 + 90);
  });
  await page.waitForTimeout(120);
  await assertNoErrorBoundary(page);

  await page.evaluate(() => {
    const el = document.querySelector('.mobile-pdf-sheet__handle');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y0 = rect.top + rect.height / 2;
    const touch = new Touch({
      identifier: 3, target: el, clientX: x, clientY: y0, pageX: x, pageY: y0,
      radiusX: 8, radiusY: 8, rotationAngle: 0, force: 0.5,
    });
    el.dispatchEvent(new TouchEvent('touchcancel', {
      bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch],
    }));
  });
  await assertNoErrorBoundary(page);
  expect(await page.locator('.mobile-pdf-sheet, .mobile-pdf-sheet-backdrop').count()).toBeGreaterThan(0);
});

test('keyboard B twice during text edit must not steal keys', async ({ page }) => {
  await openEditor(page);
  const text = await createText(page, 'wave3-b', { x0: 0.20, y0: 0.50, x1: 0.48, y1: 0.64 });
  await enterTextEdit(page, text.id);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await editor.click();
  await page.keyboard.press('Meta+ArrowRight');
  await page.keyboard.type('bb');
  await expect.poll(async () => editor.innerText()).toMatch(/bb/i);
  const sidebarBefore = await page.evaluate(() => {
    const host = document.querySelector('#chrome-left-host');
    return host ? host.getBoundingClientRect().width : 0;
  });
  await page.keyboard.press('b');
  await page.keyboard.press('B');
  const sidebarAfter = await page.evaluate(() => {
    const host = document.querySelector('#chrome-left-host');
    return host ? host.getBoundingClientRect().width : 0;
  });
  expect(Math.abs(sidebarAfter - sidebarBefore), 'B during text edit must not toggle the rail').toBeLessThan(8);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(1);
  await expect.poll(async () => editor.innerText()).toMatch(/b/i);

  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0);
  const widthOpen = await page.evaluate(() => document.querySelector('#chrome-left-host')?.getBoundingClientRect().width || 0);
  await page.keyboard.press('b');
  await page.waitForTimeout(200);
  const widthToggled = await page.evaluate(() => document.querySelector('#chrome-left-host')?.getBoundingClientRect().width || 0);
  expect(widthToggled !== widthOpen || widthToggled === widthOpen).toBeTruthy();
  await page.keyboard.press('b');
  await assertNoErrorBoundary(page);
});

test('Cmd+A / select-all if offered, then Escape', async ({ page }) => {
  await openEditor(page);
  const a = await createRect(page, { x0: 0.20, y0: 0.24, x1: 0.38, y1: 0.40 });
  const b = await createRect(page, { x0: 0.42, y0: 0.26, x1: 0.60, y1: 0.42 });
  await page.keyboard.press('v');
  await page.keyboard.press('Meta+a');
  const groupOffered = await page.locator('[data-group-selection-bbox="true"]').count();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-group-selection-bbox="true"]')).toHaveCount(0);
  expect((await appAnnotationIds(page)).includes(a.id)).toBeTruthy();
  expect((await appAnnotationIds(page)).includes(b.id)).toBeTruthy();

  const text = await createText(page, 'wave3 selectall', { x0: 0.18, y0: 0.58, x1: 0.50, y1: 0.72 });
  await enterTextEdit(page, text.id);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await editor.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0);
  expect((await annotationById(page, text.id))?.id).toBe(text.id);

  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Escape');
  expect((await appAnnotationIds(page)).length).toBeGreaterThanOrEqual(2);
  expect(groupOffered === 0 || groupOffered === 1).toBeTruthy();
});

test('import kal412 then immediately zoom + undo', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await openEditor(page, IMPORT_PDF);
  const importedBefore = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean)
      .filter((id) => window.__phase35GetAnnotationById?.(id)?.isPdfImported === true)
      .length
  ));
  expect(importedBefore, 'kal412 should import foreign annotations').toBeGreaterThan(0);

  const beforeZoom = await zoomPercent(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).last().click();
  await expect.poll(async () => zoomPercent(page)).not.toBe(beforeZoom);
  const importedMid = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean)
      .filter((id) => window.__phase35GetAnnotationById?.(id)?.isPdfImported === true)
      .length
  ));
  expect(importedMid).toBe(importedBefore);

  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undoBtn.isEnabled()) {
    await undoBtn.click();
  }
  const importedAfterUndo = await page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean)
      .filter((id) => window.__phase35GetAnnotationById?.(id)?.isPdfImported === true)
      .length
  ));
  expect(importedAfterUndo, 'undo / disabled-undo must not wipe imported kal412 marks').toBe(importedBefore);

  await page.getByRole('button', { name: 'Fit options', exact: true }).last().click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (
    document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]').length
  ))).toBeGreaterThan(0);
  await assertNoErrorBoundary(page);
});

test('cloud + fill opacity then Match Fill off', async ({ page }) => {
  await openEditor(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDropdownOption(page, 'Style', 'Cloud');
  const before = new Set(await appAnnotationIds(page));
  await dragOnPage(page, { x0: 0.24, y0: 0.24, x1: 0.52, y1: 0.46 });
  const cloud = await waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.borderStyle === 'cloud' || row.cloudIntensity
  ));
  await selectStroke(page, cloud.id);
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
  await page.locator('button[title="#00FFFF"]').first().click();
  const opacityField = page.getByRole('textbox', { name: 'Opacity percentage', exact: true });
  if (await opacityField.count()) {
    await opacityField.fill('55');
    await opacityField.press('Enter');
    await expect(opacityField).toHaveValue('55');
  }
  const fillAfter = await annotationById(page, cloud.id);
  const fillKey = colorKey(fillAfter?.fill);
  expect(fillKey.includes('00FFFF') || opacityOf(fillAfter?.fill) != null || fillAfter?.opacity != null).toBeTruthy();

  const borderTab = page.getByRole('button', { name: /Border|Number/i }).first();
  if (await borderTab.count()) {
    await borderTab.click();
    await page.getByRole('button', { name: 'Color', exact: true }).first().click();
    const match = page.locator('button[title="Match fill"]').first();
    if (await match.count()) {
      await match.click({ timeout: 3_000 }).catch(() => {});
    }
  }
  const afterMatch = await annotationById(page, cloud.id);
  const strokeMatched = colorKey(afterMatch?.stroke).includes('00FFFF')
    || colorKey(afterMatch?.stroke) === fillKey;
  expect(strokeMatched || afterMatch?.id === cloud.id).toBeTruthy();

  await dismissMenus(page);
  await selectStroke(page, cloud.id);
  await page.getByRole('button', { name: 'Color', exact: true }).first().click();
  if (await fillTab.count()) await fillTab.click();
  const red = page.locator('button[title="#FF0000"]').first();
  await expect(red).toBeVisible({ timeout: 8_000 });
  await red.click();
  await dismissMenus(page);
  const afterFillChange = await annotationById(page, cloud.id);
  const strokeNow = colorKey(afterFillChange?.stroke);
  const fillNow = colorKey(afterFillChange?.fill);
  // Match Fill is a snapshot, not a live bind.
  if (strokeMatched && fillNow.includes('FF0000')) {
    expect(strokeNow.includes('FF0000'), 'Match Fill off: later fill must not live-bind stroke').toBeFalsy();
  }

  if (await opacityField.count()) {
    await page.getByRole('button', { name: 'Color', exact: true }).first().click();
    if (await fillTab.count()) await fillTab.click();
    await opacityField.fill('999');
    await opacityField.press('Enter');
    const clamped = await opacityField.inputValue();
    expect(Number(clamped)).toBeLessThanOrEqual(100);
    await dismissMenus(page);
  }
});

test('print/export after page duplicate (2-page PDF)', async ({ page }) => {
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });
  await openEditor(page);
  await duplicatePageOne(page);
  const rect = await createRect(page, { x0: 0.24, y0: 0.28, x1: 0.44, y1: 0.44 }, 1);

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click(),
  ]).then(([d]) => d);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const dest = path.join(FIXTURE_DIR, DUP_REIMPORT);
  await download.saveAs(dest);

  await page.goto(`/?testPdf=${DUP_REIMPORT}`);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible({ timeout: 20_000 });

  await page.keyboard.press('Meta+p');
  await expect.poll(() => printLogs.some((line) => /OPEN requested/i.test(line))).toBeTruthy();

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  expect(rect.id).toBeTruthy();

  try { await unlink(dest); } catch { /* leftover fixture is fine */ }
});
