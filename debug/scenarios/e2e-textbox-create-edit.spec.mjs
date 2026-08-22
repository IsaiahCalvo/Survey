import { test, expect } from '@playwright/test';

// T-01 leftover: textbox create auto-edit type / commit / blank / Escape /
// tight-fit / wrap / re-edit.
// Prior T-01 was wave overlay drag + click-out smoke. UL-36 is Aa re-entry
// only. Style Solid/Dashed/Dotted is e2e-rect-ellipse-text-dash.
// Distinct from leftover-18, T-02 callout, V-03 Select text, UL-36 Aa,
// color / Match Fill / zoom / page-field / rotation catalogs.
// Do not stamp file.id. Do not replay P1-07 / P1-28 Node-only IDs.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const WRAP_TEXT = 'The quick brown fox jumps over the lazy dog again';

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
}

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
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

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function annotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set([
      ...[...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id')),
    ].filter(Boolean))];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      if (object.isPdfImported === true || /^\d+R$/i.test(String(id || ''))) return null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        callout: object.data?.type === 'callout'
          || String(id).startsWith('callout-')
          || object.callout === true,
        text: String(object.text ?? data.text ?? ''),
        width: Number(object.width || 0) * Math.abs(Number(object.scaleX) || 1),
        height: Number(object.height || 0) * Math.abs(Number(object.scaleY) || 1),
        fontFamily: String(object.fontFamily || data.fontFamily || ''),
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function textRows(page) {
  return (await annotationSnapshot(page)).filter(isTextRow);
}

async function textById(page, id) {
  return (await textRows(page)).find((row) => row.id === id) || null;
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
    return;
  }
  const mobile = page.getByRole('button', { name: toolName, exact: true });
  const count = await mobile.count();
  for (let i = 0; i < count; i += 1) {
    const btn = mobile.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const pressed = await btn.getAttribute('aria-pressed');
    const cls = String(await btn.getAttribute('class') || '');
    if (pressed === 'true' || cls.includes('is-active') || cls.includes('btn-active')) return;
    await btn.click();
    return;
  }
  await expect(hostTool, `tool ${toolName} after ${categoryName}`).toBeVisible();
}

async function selectMode(page) {
  await blurInputs(page);
  if (await page.locator('[data-text-edit-overlay]').count()) await commitEdit(page);
  await blurInputs(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  await expect.poll(async () => page.locator('[data-text-overlay="1"]').count(), {
    timeout: 8_000,
    message: 'V must leave the Text draw overlay',
  }).toBe(0);
}

async function commitEdit(page) {
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(pageGeom.x + pageGeom.width - 12, pageGeom.y + pageGeom.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function waitForNewText(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await textRows(page);
    created = rows.find((row) => !beforeIds.has(row.id)) || null;
    return created;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  return created;
}

async function armText(page) {
  await blurInputs(page);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
}

async function typeInOverlay(page, text) {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  return editor;
}

async function createText(page, text, coords) {
  const before = new Set((await textRows(page)).map((row) => row.id));
  await armText(page);
  await dragOnPage(page, coords);
  await typeInOverlay(page, text);
  await commitEdit(page);
  const created = await waitForNewText(page, before);
  await selectMode(page);
  return created;
}

async function clickAnno(page, id) {
  const target = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer="1"] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox();
  expect(box, `annotation ${id} geometry`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function enterExistingEdit(page, id) {
  await selectMode(page);
  const target = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer="1"] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox();
  expect(box, `annotation ${id} geometry`).toBeTruthy();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  if (!(await page.locator('[data-text-edit-overlay] [contenteditable]').count())) {
    await armText(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 10_000 });
}

test('desktop T-01 textbox create/edit intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);

  expect(await page.locator('[data-text-edit-overlay]').count()).toBe(0);

  // Intended — drag + type + click-out commits.
  const hello = await createText(page, 'Hello', { x0: 0.18, y0: 0.18, x1: 0.46, y1: 0.30 });
  expect(hello.text, 'typed Hello must commit Hello').toBe('Hello');
  expect(hello.fontFamily, 'create fontFamily must be a single name').toBe('Helvetica');
  expect(hello.width, 'committed Hello must have a width').toBeGreaterThan(8);

  // Intended — single-line tight-fits (hugs glyphs, not the wide drag).
  const hi = await createText(page, 'Hi', { x0: 0.16, y0: 0.34, x1: 0.72, y1: 0.46 });
  expect(hi.text, 'typed Hi must commit Hi').toBe('Hi');
  expect(hi.width, 'single-line Hi must tight-fit under the wide wrap target').toBeLessThan(90);

  // Intended — wrapped create keeps the wrap width the user saw.
  const wrapped = await createText(page, WRAP_TEXT, { x0: 0.16, y0: 0.50, x1: 0.42, y1: 0.70 });
  expect(wrapped.text, 'wrapped create must keep the typed text').toBe(WRAP_TEXT);
  expect(wrapped.width, 'wrapped create must keep the drag wrap width').toBeGreaterThan(hi.width + 20);
  expect(wrapped.height, 'wrapped create must grow taller than Hi').toBeGreaterThan(hi.height);

  // Break — Escape discards a new box.
  const beforeEscape = new Set((await textRows(page)).map((row) => row.id));
  await armText(page);
  await dragOnPage(page, { x0: 0.50, y0: 0.18, x1: 0.74, y1: 0.30 });
  await typeInOverlay(page, 'SHOULD-DIE');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text-edit-overlay]'), 'Escape must close the overlay').toHaveCount(0, { timeout: 8_000 });
  expect(
    (await textRows(page)).map((row) => row.id).sort(),
    'Escape must discard a new box',
  ).toEqual([...beforeEscape].sort());

  // Break — blank / whitespace click-out discards.
  const beforeBlank = new Set((await textRows(page)).map((row) => row.id));
  await armText(page);
  await dragOnPage(page, { x0: 0.50, y0: 0.34, x1: 0.74, y1: 0.46 });
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 10_000 });
  await commitEdit(page);
  expect(
    (await textRows(page)).map((row) => row.id).sort(),
    'empty click-out must discard',
  ).toEqual([...beforeBlank].sort());

  await armText(page);
  await dragOnPage(page, { x0: 0.50, y0: 0.50, x1: 0.74, y1: 0.62 });
  await typeInOverlay(page, '   ');
  await commitEdit(page);
  expect(
    (await textRows(page)).map((row) => row.id).sort(),
    'whitespace click-out must discard',
  ).toEqual([...beforeBlank].sort());

  // Break — Pen-armed invents 0 and holds committed text.
  const marksBeforePen = (await textRows(page)).map((row) => row.id).sort();
  await activateTool(page, 'Draw', 'Pen');
  expect(await page.locator('[data-text-overlay="1"]').count(), 'Pen hide must drop Text overlay').toBe(0);
  expect(await page.locator('[data-text-edit-overlay]').count()).toBe(0);
  expect((await textById(page, hello.id))?.text, 'Pen hide must hold Hello').toBe('Hello');
  expect((await textRows(page)).map((row) => row.id).sort()).toEqual(marksBeforePen);

  // Edge — re-edit grows height, never shrinks width; Escape restores.
  await enterExistingEdit(page, hello.id);
  const reEditor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await reEditor.click();
  await reEditor.press('Control+A');
  await reEditor.pressSequentially('CHANGED', { delay: 6 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  expect((await textById(page, hello.id))?.text, 'Escape must restore Hello and not commit CHANGED').toBe('Hello');

  const helloWidth = (await textById(page, hello.id)).width;
  await enterExistingEdit(page, hello.id);
  const growEditor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await growEditor.click();
  await growEditor.press('End');
  await growEditor.pressSequentially(' world and more wrap text here', { delay: 6 });
  await commitEdit(page);
  const grown = await textById(page, hello.id);
  expect(grown.text, 're-edit click-out must commit the longer text').toContain('Hello world');
  expect(grown.width, 're-edit must lock wrap width').toBeGreaterThanOrEqual(helloWidth - 1);
  expect(grown.height, 're-edit must grow or hold height').toBeGreaterThanOrEqual((await textById(page, hi.id)).height - 1);

  // Edge — blank existing commit deletes (P1-28 live).
  const doomed = await createText(page, 'doomed', { x0: 0.48, y0: 0.66, x1: 0.72, y1: 0.78 });
  await enterExistingEdit(page, doomed.id);
  const wipe = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await wipe.click();
  await wipe.press('Control+A');
  await wipe.press('Backspace');
  await commitEdit(page);
  expect(await textById(page, doomed.id), 'blank re-edit must delete the box').toBeNull();
  expect((await textById(page, hello.id))?.text, 'blank delete must isolate Hello').toContain('Hello world');

  // Edge — isolation + undo.
  const second = await createText(page, 'Second', { x0: 0.18, y0: 0.74, x1: 0.40, y1: 0.86 });
  expect(second.text, 'second box must commit Second').toBe('Second');
  expect((await textById(page, hello.id))?.text, 'second box must isolate the first text').toContain('Hello world');
  await page.keyboard.press('Control+Z');
  expect(await textById(page, second.id), 'undo must drop Second').toBeNull();
  expect((await textById(page, hello.id))?.text, 'undo must hold Hello').toContain('Hello world');

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-text-edit-overlay]').count()).toBe(0);
  expect(await page.locator('[data-text-overlay="1"]').count()).toBe(0);

  console.log('TEXTBOX_CREATE_EDIT_DESKTOP_PROOF', JSON.stringify({
    helloId: hello.id,
    hiId: hi.id,
    wrapId: wrapped.id,
    hiWidth: hi.width,
    wrapWidth: wrapped.width,
    viewBox,
    fileId: null,
  }));
});

test('390 T-01 textbox create/edit intended + break + edge', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);

  const a = await createText(page, 'Mobile', { x0: 0.18, y0: 0.20, x1: 0.62, y1: 0.34 });
  expect(a.text, '390 typed Mobile must commit Mobile').toBe('Mobile');

  const beforeEscape = new Set((await textRows(page)).map((row) => row.id));
  await armText(page);
  await dragOnPage(page, { x0: 0.18, y0: 0.40, x1: 0.62, y1: 0.54 });
  await typeInOverlay(page, 'NOPE');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  expect(
    (await textRows(page)).map((row) => row.id).sort(),
    '390 Escape must discard a new box',
  ).toEqual([...beforeEscape].sort());

  const beforeBlank = new Set((await textRows(page)).map((row) => row.id));
  await armText(page);
  await dragOnPage(page, { x0: 0.18, y0: 0.58, x1: 0.62, y1: 0.72 });
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 10_000 });
  await commitEdit(page);
  expect(
    (await textRows(page)).map((row) => row.id).sort(),
    '390 empty click-out must discard',
  ).toEqual([...beforeBlank].sort());
  expect((await textById(page, a.id))?.text, '390 blank discard must hold Mobile').toBe('Mobile');

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('TEXTBOX_CREATE_EDIT_390_PROOF', JSON.stringify({
    id: a.id,
    viewBox,
    fileId: null,
  }));
});
