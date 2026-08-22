import { test, expect } from '@playwright/test';

// UL-36 Edit text (Aa) — intended + break + edge.
// Unique leftover after V-09 overlay INPUT guard. Prior UL-36 was
// "wired + live disabled" smoke only. Not leftover-18. Distinct from
// T-01 create auto-edit, T-02 callout formatting, V-03 Select text,
// and leftover-18. Do not stamp file.id.
// Product: desktop Aa enters TextEditOverlay on a selected textbox or
// callout (same path as double-click). Armed Text/Callout with no
// selection shows Aa disabled. Pen / selected rect hide Aa. 390
// "Text formatting" enters edit when selected; otherwise opens defaults.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
}

function isCalloutRow(row) {
  return row.callout === true
    || row.tool === 'callout'
    || row.type === 'callout'
    || String(row.id || '').startsWith('callout-');
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

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }, pageNumber);
}

async function annotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set([
      ...[...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
        .map((group) => group.getAttribute('data-anno-id')),
      ...[...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id')),
    ].filter(Boolean))];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      if (object.isPdfImported === true || legacy.isPdfImported === true) return null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        callout: object.data?.type === 'callout'
          || String(id).startsWith('callout-')
          || object.callout === true,
        text: String(object.text ?? data.text ?? legacy.text ?? ''),
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function annotationById(page, id) {
  return (await annotationSnapshot(page)).find((row) => row.id === id) || null;
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
  await page.keyboard.press('Escape');
  const selectBtn = page.getByRole('button', { name: 'Selection mode', exact: true }).first();
  if (await selectBtn.isVisible().catch(() => false)) {
    await selectBtn.click();
  } else {
    await page.keyboard.press('v');
  }
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await pagesToggle.isVisible().catch(() => false)) {
    const expanded = await page.getByText('No documents yet').isVisible().catch(() => false);
    if (expanded) await pagesToggle.click();
  }
  await blurInputs(page);
}

async function commitEdit(page) {
  // Proven path from e2e-text-colors: click the page origin. The overlay
  // wrapper is pointer-events:none so document capture mousedown commits.
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(pageGeom.x + pageGeom.width - 12, pageGeom.y + pageGeom.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

function desktopEdit(page) {
  return page.getByRole('button', { name: 'Edit text', exact: true }).first();
}

function mobileEdit(page) {
  return page.getByRole('button', { name: 'Text formatting', exact: true }).first();
}

async function waitForNew(page, beforeIds, predicate) {
  let created = null;
  await expect.poll(async () => {
    const rows = await annotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new annotation' }).not.toBeNull();
  return created;
}

async function createText(page, text, coords = { x0: 0.18, y0: 0.24, x1: 0.42, y1: 0.40 }) {
  const before = new Set((await annotationSnapshot(page)).filter(isTextRow).map((row) => row.id));
  await blurInputs(page);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await commitEdit(page);
  const created = await waitForNew(page, before, isTextRow);
  await dismissChrome(page);
  await selectMode(page);
  return created;
}

async function createCallout(page, text, coords = { x0: 0.52, y0: 0.24, x1: 0.78, y1: 0.42 }) {
  const before = new Set((await annotationSnapshot(page)).filter(isCalloutRow).map((row) => row.id));
  await blurInputs(page);
  await activateTool(page, 'Text', 'Callout');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await commitEdit(page);
  const created = await waitForNew(page, before, isCalloutRow);
  await selectMode(page);
  return created;
}

async function createRect(page, coords = { x0: 0.16, y0: 0.58, x1: 0.36, y1: 0.74 }) {
  const before = new Set(await userAnnotationIds(page));
  await blurInputs(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  let created = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: 'expected a new rect' }).not.toBeNull();
  await selectMode(page);
  return created;
}

async function clickAnno(page, id) {
  const scoped = page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${id}"]`);
  const target = (await scoped.count())
    ? scoped.locator('[data-callout-part="textBox"]').first()
    : page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer="1"] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function selectAndExpectEditEnabled(page, id) {
  await selectMode(page);
  if (await page.locator('[data-text-edit-overlay]').count()) await commitEdit(page);
  await clickAnno(page, id);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await commitEdit(page);
    await selectMode(page);
    await clickAnno(page, id);
  }
  const edit = desktopEdit(page);
  await expect(edit, 'selected text/callout must show Edit text').toBeVisible({ timeout: 8_000 });
  await expect(edit).toBeEnabled();
  return edit;
}

test('desktop Edit text intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page), 'fresh editor must invent 0 user marks').toEqual([]);

  // Break — Text armed, nothing selected: Aa visible + disabled.
  await activateTool(page, 'Text', 'Text');
  const armed = desktopEdit(page);
  await expect(armed, 'armed Text must show Edit text').toBeVisible({ timeout: 8_000 });
  await expect(armed, 'armed Text with no selection must disable Edit text').toBeDisabled();
  await expect(armed).toHaveAttribute('aria-pressed', 'false');

  // Break — disabled click invents 0.
  await armed.click({ force: true });
  await expect(page.locator('[data-text-edit-overlay]'), 'disabled Aa must not open overlay').toHaveCount(0);
  expect(await userAnnotationIds(page)).toEqual([]);

  // Break — Callout armed, nothing selected: still disabled.
  await activateTool(page, 'Text', 'Callout');
  await expect(desktopEdit(page)).toBeVisible();
  await expect(desktopEdit(page), 'armed Callout with no selection must disable Edit text').toBeDisabled();

  // Break — Pen hides Aa.
  await activateTool(page, 'Draw', 'Pen');
  await expect(desktopEdit(page), 'Pen-armed must hide Edit text').toHaveCount(0);

  // Intended — create textbox (create auto-edit is T-01; this slice is Aa re-entry).
  const first = await createText(page, 'aa-1', { x0: 0.16, y0: 0.20, x1: 0.42, y1: 0.36 });
  expect(first.text).toContain('aa-1');

  const edit = await selectAndExpectEditEnabled(page, first.id);
  await edit.click();
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor, 'Edit text must open the same-surface overlay').toBeVisible({ timeout: 8_000 });
  await expect(desktopEdit(page)).toHaveAttribute('aria-pressed', 'true');

  // Intended — type more; commit keeps the id.
  await editor.click();
  await page.keyboard.press('End');
  await editor.pressSequentially('+', { delay: 8 });
  await commitEdit(page);
  await expect.poll(async () => (await annotationById(page, first.id))?.text || '').toMatch(/aa-1\+/);

  // Break — second click while already editing stays in edit (no extra mark).
  const afterFirst = await userAnnotationIds(page);
  const again = await selectAndExpectEditEnabled(page, first.id);
  await again.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible();
  await desktopEdit(page).click();
  await expect(page.locator('[data-text-edit-overlay]'), 'second Aa click must stay in edit').toHaveCount(1);
  expect(await userAnnotationIds(page)).toEqual(afterFirst);
  await commitEdit(page);

  // Intended — selected Callout also enters via Aa.
  const callout = await createCallout(page, 'aa-q', { x0: 0.52, y0: 0.20, x1: 0.80, y1: 0.38 });
  const calloutEdit = await selectAndExpectEditEnabled(page, callout.id);
  await calloutEdit.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 8_000 });
  await commitEdit(page);
  expect((await annotationById(page, callout.id))?.text).toContain('aa-q');

  // Break — selected rect hides Aa (mapped contextTool is rect).
  const rectId = await createRect(page);
  await selectMode(page);
  await clickAnno(page, rectId);
  await expect(desktopEdit(page), 'selected rect must hide Edit text').toHaveCount(0);

  // Break — Select / empty click invents 0 extra marks.
  const beforeSelect = (await annotationSnapshot(page)).length;
  await selectMode(page);
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await annotationSnapshot(page)).length).toBe(beforeSelect);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0);

  // Isolation — second textbox edit does not rewrite the first.
  const second = await createText(page, 'aa-2', { x0: 0.16, y0: 0.46, x1: 0.42, y1: 0.60 });
  const secondEdit = await selectAndExpectEditEnabled(page, second.id);
  await secondEdit.click();
  const secondEditor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(secondEditor).toBeVisible();
  await secondEditor.click();
  await page.keyboard.press('End');
  await secondEditor.pressSequentially('x', { delay: 8 });
  await commitEdit(page);
  await expect.poll(async () => (await annotationById(page, second.id))?.text || '').toMatch(/aa-2x/);
  expect((await annotationById(page, first.id))?.text).toMatch(/aa-1\+/);
  expect(first.id).not.toBe(second.id);

  // Edge — undo drops the last text commit; first stays.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  const secondBeforeUndo = (await annotationById(page, second.id))?.text;
  await undo.click();
  await expect.poll(async () => (await annotationById(page, second.id))?.text || '').not.toBe(secondBeforeUndo);
  expect((await annotationById(page, first.id))?.text).toMatch(/aa-1\+/);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await desktopEdit(page).count(), 'hubPreview Edit text must be 0').toBe(0);
  expect(await mobileEdit(page).count()).toBe(0);

  console.log('EDIT_TEXT_DESKTOP_PROOF', JSON.stringify({
    first: first.id,
    callout: callout.id,
    second: second.id,
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 Edit text intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await blurInputs(page);
  await assertNoErrorBoundary(page);

  expect(await userAnnotationIds(page)).toEqual([]);

  // Break — armed Text with no selection: 390 Aa is "Text formatting".
  // It does not enter the overlay; it opens defaults (not desktop-disabled).
  await activateTool(page, 'Text', 'Text');
  const aa = mobileEdit(page);
  await expect(aa, '390 armed Text must show Text formatting').toBeVisible({ timeout: 8_000 });
  await aa.click();
  await expect(page.locator('[data-text-edit-overlay]'), '390 unselected Aa must not enter overlay').toHaveCount(0);
  const defaults = page.getByRole('dialog').or(page.locator('[data-mobile-text-defaults]'));
  const defaultsOpen = await page.getByText('Font', { exact: true }).first().isVisible().catch(() => false)
    || await defaults.count() > 0
    || await page.getByRole('button', { name: /Arial|Helvetica/ }).first().isVisible().catch(() => false);
  expect(defaultsOpen || await aa.getAttribute('aria-expanded') === 'true', '390 unselected Aa opens defaults').toBeTruthy();
  const closeX = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  await expect(closeX, '390 defaults sheet Close').toBeVisible({ timeout: 8_000 });
  await closeX.click();
  await expect(page.getByRole('button', { name: 'Close text formatting', exact: true })).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);

  // Intended — create + select + Aa enters overlay.
  const first = await createText(page, 'm-aa', { x0: 0.16, y0: 0.18, x1: 0.62, y1: 0.34 });
  await selectMode(page);
  if (await page.locator('[data-text-edit-overlay]').count()) await commitEdit(page);
  await clickAnno(page, first.id);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await commitEdit(page);
    await selectMode(page);
    await clickAnno(page, first.id);
  }
  const selectedAa = mobileEdit(page);
  await expect(selectedAa, '390 selected textbox must show Text formatting').toBeVisible({ timeout: 8_000 });
  await selectedAa.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first(), '390 Aa must enter overlay').toBeVisible({ timeout: 8_000 });
  const overlayEditor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await overlayEditor.click();
  await page.keyboard.press('End');
  await overlayEditor.pressSequentially('+', { delay: 8 });
  await commitEdit(page);
  await expect.poll(async () => (await annotationById(page, first.id))?.text || '').toMatch(/m-aa\+/);

  // Break — Pen hides the 390 Aa.
  await activateTool(page, 'Draw', 'Pen');
  await expect(mobileEdit(page), '390 Pen-armed must hide Text formatting').toHaveCount(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('EDIT_TEXT_390_PROOF', JSON.stringify({
    first: first.id,
    viewBox,
    fileId: await fileId(page),
  }));
});
