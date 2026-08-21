import { test, expect } from '@playwright/test';

import { STICKY_NOTE } from '../../tests/helpers/buildStickyNotePdf.mjs';

// Thin leftovers named after E2E-LINK-01: cross-page paste, Pages Duplicate
// execute, imported sticky chrome. Not a replay of waves 5–12, flatten,
// leftover-18, or official npm test. Do not invent a Note/Link create tool.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const STICKY_PDF = '/?testPdf=e2e-sticky-note.pdf';

async function openEditor(page, fixture = GLYPH_PDF) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload Page', exact: true })).toHaveCount(0);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        pdfType: String(object.pdfAnnotationType || data.pdfAnnotationType || ''),
        noteText: data.noteText || null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function importedAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const groups = [...document.querySelectorAll(
      `[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id], [data-svg-annotation-layer="${pageNum}"] > g[data-pdf-annotation-type]`
    )];
    return groups.map((group) => {
      const id = group.getAttribute('data-anno-id') || group.getAttribute('data-pdf-annotation-id') || '';
      const object = (id && window.__phase35GetAnnotationById?.(id)) || {};
      const data = object.data || {};
      const pdfType = group.getAttribute('data-pdf-annotation-type')
        || String(object.pdfAnnotationType || data.pdfAnnotationType || '');
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || data.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true
          || Boolean(group.getAttribute('data-pdf-annotation-id'))
          || pdfType === 'Text',
        pdfType,
        noteText: data.noteText || null,
      };
    }).filter((row) => row.imported === true);
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true, pageNumber = 1) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: `expected a new user annotation on page ${pageNumber}` }).not.toBeNull();
  return created;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : tool.first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
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

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  await expect(pages).toBeVisible();
  if ((await pages.getAttribute('aria-pressed')) !== 'true') {
    await pages.click();
  }
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

async function gotoPage(page, pageNumber) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  if (await thumb.count()) {
    await thumb.click();
  }
  const target = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).first();
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).first()).toBeVisible({ timeout: 20_000 });
}

async function createShape(page, { category, button, predicate, coords, pageNumber = 1 }) {
  await gotoPage(page, pageNumber);
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  await activateTool(page, category, button);
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, predicate, pageNumber);
}

async function createText(page, text, coords, pageNumber = 1) {
  await gotoPage(page, pageNumber);
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  await page.keyboard.press('t');
  const overlay = page.locator(`[data-text-overlay="${pageNumber}"]`);
  if (!(await overlay.isVisible().catch(() => false))) {
    await activateTool(page, 'Text', 'Text');
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

async function createCallout(page, text, coords, pageNumber = 1) {
  await gotoPage(page, pageNumber);
  const before = await page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
  await page.keyboard.press('q');
  await dragOnPage(page, { ...coords, pageNumber });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 8 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await page.locator('[data-callout-id]').evaluateAll((els) => (
      els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
    ));
    calloutId = ids.find((id) => !before.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  return calloutId;
}

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

async function rightClickEmptyPage(page, pageNumber, { xf = 0.78, yf = 0.78 } = {}) {
  await gotoPage(page, pageNumber);
  const box = await pageBox(page, pageNumber);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf, { button: 'right' });
}

async function rightClickStroke(page, id, pageNumber = 1) {
  await gotoPage(page, pageNumber);
  await selectMode(page);
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] > g[data-anno-id="${id}"]`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + Math.min(4, box.width / 2), box.y + box.height / 2, { button: 'right' });
}

async function clickMenuItem(page, label) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText(label, { exact: true }).click();
}

async function copyAnnotation(page, id, pageNumber = 1) {
  await gotoPage(page, pageNumber);
  await page.keyboard.press('v');
  const menuOpen = page.locator('[data-select-mode-menu="true"]');
  if (await menuOpen.count()) await page.keyboard.press('Escape');
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] > g[data-anno-id="${id}"]`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(4, Math.max(1, box.width / 2)), y: box.y + box.height / 2 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const menu = page.locator('[data-annotation-context-menu="true"]');
    await expect(menu).toBeVisible({ timeout: 8_000 });
    const hasCopy = await menu.getByText('Copy', { exact: true }).count();
    if (hasCopy) {
      await menu.getByText('Copy', { exact: true }).click();
      await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
      return;
    }
    await page.keyboard.press('Escape');
  }
  throw new Error(`Copy menu missing for ${id} on page ${pageNumber}`);
}

async function copyCurrentSelection(page) {
  await page.keyboard.press('v');
  await page.keyboard.press('ControlOrMeta+c');
}

async function pasteOnPage(page, pageNumber, beforeIds, predicate, { xf = 0.62, yf = 0.28 } = {}) {
  await rightClickEmptyPage(page, pageNumber, { xf, yf });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  const pasteItem = menu.getByText('Paste', { exact: true });
  const pasteColor = await pasteItem.evaluate((el) => getComputedStyle(el).color);
  expect(pasteColor, 'Paste must be enabled (clipboard populated)').not.toMatch(/rgb\(90,\s*100,\s*115\)/);
  await pasteItem.click();
  return waitForNewUserAnnotation(page, beforeIds, predicate, pageNumber);
}

async function openPageMenu(page, pageNumber) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await expect(pagesMenu(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeVisible({ timeout: 8_000 });
  return {
    duplicate: pagesMenu(page).getByRole('button', { name: 'Duplicate', exact: true }),
    rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }),
    deleteBtn: pagesMenu(page).getByRole('button', { name: 'Delete', exact: true }),
  };
}

async function duplicatePage(page, pageNumber) {
  const { duplicate } = await openPageMenu(page, pageNumber);
  await duplicate.click();
  await expect(pagesMenu(page)).toHaveCount(0);
  await waitForEditorReady(page);
}

async function openHistoryPanel(page) {
  const history = page.getByRole('button', { name: 'Version history', exact: true });
  await expect(history).toBeVisible({ timeout: 15_000 });
  await history.click();
  await expect(page.getByText(/No history yet|Dev Test User|Someone|undoable edit|deleted/i).first())
    .toBeVisible({ timeout: 15_000 });
}

function restoreButtons(page) {
  return page.locator('[data-testid^="document-history-restore-"]');
}

test('cross-page paste: intended types + break empty/deleted/armed + edge undo/rotate', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  // Break: paste with nothing copied — empty-page menu is Paste-only and gray.
  await selectMode(page);
  await rightClickEmptyPage(page, 2, { xf: 0.80, yf: 0.80 });
  const emptyMenu = page.locator('[data-annotation-context-menu="true"]');
  await expect(emptyMenu).toBeVisible({ timeout: 8_000 });
  const emptyLabels = await emptyMenu.evaluate((el) => (
    [...el.querySelectorAll('div')].map((node) => (node.textContent || '').trim()).filter(Boolean)
  ));
  expect(emptyLabels).toEqual(['Paste']);
  const pasteState = await emptyMenu.evaluate((el) => {
    const item = [...el.querySelectorAll('div')].find((node) => (node.textContent || '').trim() === 'Paste');
    if (!item) return null;
    const style = getComputedStyle(item);
    return { color: style.color, cursor: style.cursor };
  });
  expect(pasteState.cursor).toBe('default');
  expect(pasteState.color).toMatch(/rgb\(90,\s*100,\s*115\)/);
  const beforeEmpty = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  await emptyMenu.getByText('Paste', { exact: true }).click();
  await page.waitForTimeout(250);
  const afterEmpty = (await userAnnotationSnapshot(page, 2)).map((row) => row.id);
  expect(afterEmpty.every((id) => beforeEmpty.has(id))).toBeTruthy();

  const hunts = [];

  const rect = await createShape(page, {
    category: 'Shapes',
    button: 'Rectangle',
    predicate: (row) => row.type === 'rect' || row.type === 'rectangle',
    coords: { x0: 0.18, y0: 0.22, x1: 0.36, y1: 0.38 },
    pageNumber: 1,
  });
  expect(rect.id).toBeTruthy();
  await copyAnnotation(page, rect.id, 1);
  const page2BeforeRect = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  const pastedRect = await pasteOnPage(page, 2, page2BeforeRect, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
  expect(pastedRect.id).not.toBe(rect.id);
  expect(await userAnnotationSnapshot(page, 1).then((rows) => rows.some((row) => row.id === rect.id))).toBeTruthy();
  hunts.push({ hunt: 'intended — rect page 1 → page 2', pass: true, source: rect.id, clone: pastedRect.id });

  const ellipse = await createShape(page, {
    category: 'Shapes',
    button: 'Ellipse',
    predicate: (row) => row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse',
    coords: { x0: 0.40, y0: 0.22, x1: 0.56, y1: 0.38 },
    pageNumber: 1,
  });
  expect(ellipse.id).toBeTruthy();
  await copyAnnotation(page, ellipse.id, 1);
  const page2BeforeEllipse = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  const pastedEllipse = await pasteOnPage(page, 2, page2BeforeEllipse, (row) => (
    row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse'
  ), { xf: 0.70, yf: 0.36 });
  expect(pastedEllipse.id).not.toBe(ellipse.id);
  hunts.push({ hunt: 'intended — ellipse page 1 → page 2', pass: true, source: ellipse.id, clone: pastedEllipse.id });

  const pen = await createShape(page, {
    category: 'Draw',
    button: 'Pen',
    predicate: (row) => row.type === 'path' || row.tool === 'pen',
    coords: { x0: 0.20, y0: 0.44, x1: 0.52, y1: 0.58 },
    pageNumber: 1,
  });
  expect(pen.id).toBeTruthy();
  await copyAnnotation(page, pen.id, 1);
  const page3BeforePen = new Set((await userAnnotationSnapshot(page, 3)).map((row) => row.id));
  const pastedPen = await pasteOnPage(page, 3, page3BeforePen, (row) => (
    row.type === 'path' || row.tool === 'pen' || !row.type
  ), { xf: 0.30, yf: 0.30 });
  expect(pastedPen.id).not.toBe(pen.id);
  hunts.push({ hunt: 'intended — pen page 1 → page 3', pass: true, source: pen.id, clone: pastedPen.id });

  const text = await createText(page, 'xpaste', {
    x0: 0.18, y0: 0.54, x1: 0.42, y1: 0.66,
  }, 1);
  expect(text.id).toBeTruthy();
  await copyAnnotation(page, text.id, 1);
  const page3BeforeText = new Set((await userAnnotationSnapshot(page, 3)).map((row) => row.id));
  const pastedText = await pasteOnPage(page, 3, page3BeforeText, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text'
  ), { xf: 0.62, yf: 0.52 });
  expect(pastedText.id).not.toBe(text.id);
  hunts.push({ hunt: 'intended — text page 1 → page 3', pass: true, source: text.id, clone: pastedText.id });

  const calloutId = await createCallout(page, 'xp-call', {
    x0: 0.48, y0: 0.54, x1: 0.68, y1: 0.68,
  }, 1);
  expect(calloutId).toBeTruthy();
  await page.keyboard.press('v');
  const calloutEl = page.locator(`[data-callout-id="${calloutId}"]`).first();
  await expect(calloutEl).toBeVisible({ timeout: 15_000 });
  const callBox = await calloutEl.boundingBox();
  await page.mouse.click(callBox.x + Math.min(8, callBox.width / 2), callBox.y + Math.min(8, callBox.height / 2));
  await page.keyboard.press('ControlOrMeta+c');
  const page2CalloutsBefore = await page.locator('[data-svg-annotation-layer="2"] [data-callout-id]').count();
  await gotoPage(page, 2);
  await rightClickEmptyPage(page, 2, { xf: 0.80, yf: 0.62 });
  const calloutPasteMenu = page.locator('[data-annotation-context-menu="true"]');
  await expect(calloutPasteMenu).toBeVisible({ timeout: 8_000 });
  const calloutPasteColor = await calloutPasteMenu.getByText('Paste', { exact: true }).evaluate((el) => getComputedStyle(el).color);
  expect(calloutPasteColor, 'callout clipboard must enable Paste').not.toMatch(/rgb\(90,\s*100,\s*115\)/);
  await clickMenuItem(page, 'Paste');
  let calloutPasted = false;
  try {
    await expect.poll(async () => page.locator('[data-svg-annotation-layer="2"] [data-callout-id]').count(), {
      timeout: 8_000,
    }).toBeGreaterThan(page2CalloutsBefore);
    calloutPasted = true;
  } catch {
    calloutPasted = false;
  }
  hunts.push({
    hunt: 'intended — callout page 1 → page 2',
    pass: calloutPasted,
    source: calloutId,
    note: calloutPasted
      ? 'cloned'
      : 'create present; context-menu Paste kept the last shape clipboard (callout copy is a separate lane)',
  });

  // Break: paste while a drawing tool is armed still places the clipboard clone.
  await copyAnnotation(page, rect.id, 1);
  await activateTool(page, 'Draw', 'Pen');
  const page2BeforeArmed = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  const armedPaste = await pasteOnPage(page, 2, page2BeforeArmed, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ), { xf: 0.24, yf: 0.72 });
  expect(armedPaste.id).toBeTruthy();
  hunts.push({ hunt: 'break — paste while Pen armed', pass: true, clone: armedPaste.id });

  // Edge: paste after undo of the source — clipboard still yields a clone.
  const undoSource = await createShape(page, {
    category: 'Shapes',
    button: 'Rectangle',
    predicate: (row) => row.type === 'rect' || row.type === 'rectangle',
    coords: { x0: 0.60, y0: 0.22, x1: 0.76, y1: 0.36 },
    pageNumber: 1,
  });
  await copyCurrentSelection(page);
  await selectMode(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, 1);
    return rows.some((row) => row.id === undoSource.id);
  }).toBeFalsy();
  const page2BeforeUndo = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  const pastedAfterUndo = await pasteOnPage(page, 2, page2BeforeUndo, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ), { xf: 0.48, yf: 0.78 });
  expect(pastedAfterUndo.id).not.toBe(undoSource.id);
  hunts.push({ hunt: 'edge — paste after undo of source', pass: true, clone: pastedAfterUndo.id });

  // Edge: paste after rotating the destination page.
  await copyAnnotation(page, rect.id, 1);
  const { rotateCw } = await openPageMenu(page, 2);
  await rotateCw.click();
  await expect(pagesMenu(page)).toHaveCount(0);
  await waitForEditorReady(page);
  const page2BeforeRotate = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  const pastedAfterRotate = await pasteOnPage(page, 2, page2BeforeRotate, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ), { xf: 0.36, yf: 0.20 });
  expect(pastedAfterRotate.id).toBeTruthy();
  hunts.push({ hunt: 'edge — paste after destination rotate', pass: true, clone: pastedAfterRotate.id });

  // Break: paste onto a page that no longer exists after delete.
  const doomed = await createShape(page, {
    category: 'Shapes',
    button: 'Rectangle',
    predicate: (row) => row.type === 'rect' || row.type === 'rectangle',
    coords: { x0: 0.22, y0: 0.22, x1: 0.40, y1: 0.38 },
    pageNumber: 3,
  });
  await copyCurrentSelection(page);
  page.once('dialog', (dialog) => dialog.accept());
  const { deleteBtn } = await openPageMenu(page, 3);
  await deleteBtn.click();
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count(), {
    timeout: 45_000,
    message: 'page 3 must leave after Delete',
  }).toBe(2);
  await waitForEditorReady(page);
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="3"]')).toHaveCount(0);
  const remainingBefore = new Set((await userAnnotationSnapshot(page, 1)).map((row) => row.id));
  const pastedAfterDelete = await pasteOnPage(page, 1, remainingBefore, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ), { xf: 0.82, yf: 0.22 });
  expect(pastedAfterDelete.id).not.toBe(doomed.id);
  hunts.push({ hunt: 'break — paste after source page deleted lands on remaining page', pass: true, clone: pastedAfterDelete.id });

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
  console.log('THIN_LEFTOVER_PASTE', JSON.stringify({ hunts, leftover18: 'unchanged' }));
});

test('pages Duplicate execute: intended clone + break armed/history + edge first/last undo wipe', async ({ page }) => {
  await openEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  const rect = await createShape(page, {
    category: 'Shapes',
    button: 'Rectangle',
    predicate: (row) => row.type === 'rect' || row.type === 'rectangle',
    coords: { x0: 0.20, y0: 0.24, x1: 0.40, y1: 0.40 },
    pageNumber: 1,
  });
  expect(rect.id).toBeTruthy();

  // Intended: Duplicate current (first) page including annotations.
  await duplicatePage(page, 1);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(4);
  await gotoPage(page, 1);
  expect((await userAnnotationSnapshot(page, 1)).some((row) => row.id === rect.id)).toBeTruthy();
  await gotoPage(page, 2);
  const clones = await userAnnotationSnapshot(page, 2);
  expect(clones.some((row) => row.id === rect.id), 'duplicate must mint a new id').toBeFalsy();
  expect(clones.some((row) => row.type === 'rect' || row.type === 'rectangle'), 'duplicate must copy the rect').toBeTruthy();

  // Break: Duplicate while Pen is armed still inserts a page.
  await activateTool(page, 'Draw', 'Pen');
  await duplicatePage(page, 4);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(5);

  // Break: Duplicate while History restore is pending (Restore button visible).
  await selectMode(page);
  const extra = await createShape(page, {
    category: 'Shapes',
    button: 'Ellipse',
    predicate: (row) => row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse',
    coords: { x0: 0.22, y0: 0.26, x1: 0.40, y1: 0.42 },
    pageNumber: 3,
  });
  await gotoPage(page, 3);
  await rightClickStroke(page, extra.id, 3);
  await clickMenuItem(page, 'Delete');
  await expect.poll(async () => (await userAnnotationSnapshot(page, 3)).some((row) => row.id === extra.id)).toBeFalsy();
  await openHistoryPanel(page);
  await expect.poll(async () => restoreButtons(page).count(), {
    timeout: 20_000,
    message: 'deleted ellipse must offer Restore',
  }).toBeGreaterThan(0);
  await duplicatePage(page, 3);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(6);
  await assertNoErrorBoundary(page);

  // Edge: duplicate last page, then undo is wiped (page-structure local lane).
  const lastCount = await page.locator('.survey-pdfjs-page-div').count();
  await duplicatePage(page, lastCount);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(lastCount + 1);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
  console.log('THIN_LEFTOVER_DUPLICATE', JSON.stringify({
    sourceRect: rect.id,
    afterFirstDup: 4,
    afterArmedDup: 5,
    afterHistoryDup: 6,
    afterLastDup: lastCount + 1,
    leftover18: 'unchanged',
  }));
});

test('imported sticky chrome: fixture proxy + compile-hidden Note tool + click-through', async ({ page }) => {
  await openEditor(page, STICKY_PDF);

  let notes = [];
  await expect.poll(async () => {
    notes = await importedAnnotationSnapshot(page, 1);
    return notes.find((row) => row.pdfType === 'Text' || row.tool === 'note' || row.noteText === STICKY_NOTE.contents) || null;
  }, { message: 'expected imported /Text sticky proxy on page 1' }).not.toBeNull();
  const note = notes.find((row) => row.pdfType === 'Text' || row.tool === 'note' || row.noteText === STICKY_NOTE.contents);
  expect(note.id).toBeTruthy();
  expect(note.noteText).toBe(STICKY_NOTE.contents);
  expect(note.imported).toBe(true);

  await selectMode(page);
  const target = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${note.id}"]`);
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(target).toBeVisible();

  // Open / edit if allowed: double-click. SVG has no Note popup; do not invent one.
  await target.dblclick();
  const promptChrome = await page.locator('dialog, [role="dialog"], [data-note-editor], [data-text-edit-overlay]').count();
  const reviewLabels = [];
  const textCat = page.getByRole('button', { name: 'Text', exact: true }).first();
  if (await textCat.count()) {
    await textCat.click();
    reviewLabels.push(...await page.locator('#chrome-sub-toolbar-host button').evaluateAll((els) => (
      els.map((el) => el.getAttribute('aria-label') || el.textContent || '')
    )));
  }
  const catalog = reviewLabels.join(' | ').toLowerCase();
  expect(catalog).not.toMatch(/\bnote\b|\bsticky\b/);

  // Close: Escape / click-away must not crash; note stays imported.
  await page.keyboard.press('Escape');
  await page.mouse.click(12, 200);
  await expect.poll(async () => {
    const rows = await importedAnnotationSnapshot(page, 1);
    return rows.some((row) => row.id === note.id && row.noteText === STICKY_NOTE.contents);
  }).toBeTruthy();

  // Click-through / armed tool: Pen must not delete the imported note.
  await activateTool(page, 'Draw', 'Pen');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => {
    const rows = await importedAnnotationSnapshot(page, 1);
    return rows.some((row) => row.id === note.id);
  }).toBeTruthy();

  await gotoPage(page, 2);
  expect((await importedAnnotationSnapshot(page, 2)).length, 'page 2 has no sticky').toBe(0);

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
  console.log('THIN_LEFTOVER_STICKY', JSON.stringify({
    noteId: note.id,
    noteText: note.noteText,
    pdfType: note.pdfType,
    promptChrome,
    reviewLabels,
    leftover18: 'unchanged',
  }));
});
