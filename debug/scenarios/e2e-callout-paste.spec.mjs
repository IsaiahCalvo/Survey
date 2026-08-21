import { test, expect } from '@playwright/test';

// Callout cross-page clone: context-menu Paste must clone the most recently
// copied item. If the last copy was a callout, paste the callout (new id,
// destination page, leader/text intact). Does not invent a toolbar.
// Not leftover-18. Not a replay of waves 5–13.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';

async function openEditor(page) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.goto(GLYPH_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
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
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function calloutIdsOnPage(page, pageNumber) {
  return page.locator(`[data-svg-annotation-layer="${pageNumber}"] [data-callout-id]`).evaluateAll((els) => (
    [...new Set(els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean))]
  ));
}

async function calloutSnapshot(page, calloutId) {
  return page.evaluate((id) => {
    const nodes = [...document.querySelectorAll(`[data-callout-id="${id}"]`)];
    const text = nodes
      .flatMap((node) => [...node.querySelectorAll('[data-callout-part="text"]')])
      .map((el) => (el.textContent || '').trim())
      .find(Boolean) || nodes.map((el) => (el.textContent || '').trim()).find(Boolean) || '';
    const parts = [...new Set(nodes.flatMap((node) => (
      [...node.querySelectorAll('[data-callout-part]')].map((el) => el.getAttribute('data-callout-part'))
    )).filter(Boolean))];
    return { id, text, parts, count: nodes.length };
  }, calloutId);
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

async function clickMenuItem(page, label) {
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText(label, { exact: true }).click();
}

async function createRect(page, coords, pageNumber = 1) {
  await gotoPage(page, pageNumber);
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { ...coords, pageNumber });
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, pageNumber);
    created = rows.find((row) => !before.has(row.id) && (row.type === 'rect' || row.type === 'rectangle')) || null;
    return created;
  }).not.toBeNull();
  return created;
}

async function createCallout(page, text, coords, pageNumber = 1) {
  await gotoPage(page, pageNumber);
  const before = await calloutIdsOnPage(page, pageNumber);
  await page.keyboard.press('q');
  await dragOnPage(page, { ...coords, pageNumber });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 8 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await calloutIdsOnPage(page, pageNumber);
    calloutId = ids.find((id) => !before.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  return calloutId;
}

async function copyCallout(page, calloutId) {
  await selectMode(page);
  const target = page.locator(`[data-callout-id="${calloutId}"]`).first();
  await expect(target).toBeVisible({ timeout: 15_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for callout ${calloutId}`).toBeTruthy();
  await page.mouse.click(box.x + Math.min(10, box.width / 2), box.y + Math.min(10, box.height / 2), { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await expect(menu.getByText('Copy', { exact: true })).toBeVisible();
  await menu.getByText('Copy', { exact: true }).click();
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
}

async function copyAnnotation(page, id, pageNumber = 1) {
  await gotoPage(page, pageNumber);
  await selectMode(page);
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] > g[data-anno-id="${id}"]`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  const box = await target.boundingBox();
  await page.mouse.click(box.x + Math.min(4, box.width / 2), box.y + box.height / 2, { button: 'right' });
  await clickMenuItem(page, 'Copy');
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
}

async function pasteCalloutOnPage(page, pageNumber, beforeIds, { xf = 0.62, yf = 0.28 } = {}) {
  await rightClickEmptyPage(page, pageNumber, { xf, yf });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  const pasteItem = menu.getByText('Paste', { exact: true });
  const pasteColor = await pasteItem.evaluate((el) => getComputedStyle(el).color);
  expect(pasteColor, 'Paste must be enabled (clipboard populated)').not.toMatch(/rgb\(90,\s*100,\s*115\)/);
  await pasteItem.click();
  let created = null;
  await expect.poll(async () => {
    const ids = await calloutIdsOnPage(page, pageNumber);
    created = ids.find((id) => !beforeIds.has(id)) || null;
    return created;
  }, { message: `expected a new callout on page ${pageNumber}` }).not.toBeNull();
  return created;
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
  return {
    rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }),
    deleteBtn: pagesMenu(page).getByRole('button', { name: 'Delete', exact: true }),
  };
}

test('callout cross-page paste: last-copied wins + break/edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  const hunts = [];

  // Break: empty clipboard — Paste-only empty-page menu stays gray and no-ops.
  await selectMode(page);
  await rightClickEmptyPage(page, 2, { xf: 0.82, yf: 0.82 });
  const emptyMenu = page.locator('[data-annotation-context-menu="true"]');
  await expect(emptyMenu).toBeVisible({ timeout: 8_000 });
  const emptyLabels = await emptyMenu.evaluate((el) => (
    [...el.querySelectorAll('div')].map((node) => (node.textContent || '').trim()).filter(Boolean)
  ));
  expect(emptyLabels).toEqual(['Paste']);
  const emptyColor = await emptyMenu.getByText('Paste', { exact: true }).evaluate((el) => getComputedStyle(el).color);
  expect(emptyColor).toMatch(/rgb\(90,\s*100,\s*115\)/);
  const beforeEmpty = new Set(await calloutIdsOnPage(page, 2));
  await emptyMenu.getByText('Paste', { exact: true }).click();
  await page.waitForTimeout(250);
  expect(await calloutIdsOnPage(page, 2)).toEqual([...beforeEmpty]);
  hunts.push({ hunt: 'break — empty clipboard', pass: true });

  const sourceText = 'xp-call';
  const calloutId = await createCallout(page, sourceText, {
    x0: 0.22, y0: 0.24, x1: 0.46, y1: 0.40,
  }, 1);
  expect(calloutId).toBeTruthy();
  const sourceSnap = await calloutSnapshot(page, calloutId);
  expect(sourceSnap.text).toMatch(/xp-call/);
  expect(sourceSnap.parts.some((part) => part === 'line1' || part === 'line2')).toBeTruthy();

  await copyCallout(page, calloutId);

  // Intended: copy on page 1, paste on page 2 → new id, leader/text intact.
  const page2Before = new Set(await calloutIdsOnPage(page, 2));
  const firstPaste = await pasteCalloutOnPage(page, 2, page2Before, { xf: 0.70, yf: 0.30 });
  expect(firstPaste).not.toBe(calloutId);
  expect((await calloutIdsOnPage(page, 1)).includes(calloutId)).toBeTruthy();
  const firstSnap = await calloutSnapshot(page, firstPaste);
  expect(firstSnap.text).toMatch(/xp-call/);
  expect(firstSnap.parts.some((part) => part === 'line1' || part === 'line2')).toBeTruthy();
  hunts.push({
    hunt: 'intended — copy callout page 1 → paste page 2',
    pass: true,
    source: calloutId,
    clone: firstPaste,
  });

  // Edge: second paste does not share id with the first paste.
  const page2AfterFirst = new Set(await calloutIdsOnPage(page, 2));
  const secondPaste = await pasteCalloutOnPage(page, 2, page2AfterFirst, { xf: 0.36, yf: 0.62 });
  expect(secondPaste).not.toBe(firstPaste);
  expect(secondPaste).not.toBe(calloutId);
  hunts.push({ hunt: 'edge — second paste unique id', pass: true, clone: secondPaste });

  // Break: paste while Pen is armed still clones the callout.
  await activateTool(page, 'Draw', 'Pen');
  const page2BeforeArmed = new Set(await calloutIdsOnPage(page, 2));
  const armedPaste = await pasteCalloutOnPage(page, 2, page2BeforeArmed, { xf: 0.22, yf: 0.78 });
  expect(armedPaste).toBeTruthy();
  hunts.push({ hunt: 'break — paste while Pen armed', pass: true, clone: armedPaste });

  // Break: copy shape THEN copy callout → paste must be the callout.
  const rectThenCallout = await createRect(page, {
    x0: 0.56, y0: 0.22, x1: 0.72, y1: 0.36,
  }, 1);
  await copyAnnotation(page, rectThenCallout.id, 1);
  await copyCallout(page, calloutId);
  const page2BeforeShapeThenCallout = new Set(await calloutIdsOnPage(page, 2));
  const page2ShapesBefore = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  const afterShapeThenCallout = await pasteCalloutOnPage(page, 2, page2BeforeShapeThenCallout, {
    xf: 0.80, yf: 0.48,
  });
  const newShapes = (await userAnnotationSnapshot(page, 2)).filter((row) => !page2ShapesBefore.has(row.id));
  expect(newShapes.some((row) => row.type === 'rect' || row.type === 'rectangle')).toBeFalsy();
  hunts.push({
    hunt: 'break — copy shape THEN copy callout',
    pass: true,
    clone: afterShapeThenCallout,
  });

  // Break: copy callout THEN copy rect → paste must be the rect.
  await copyCallout(page, calloutId);
  await copyAnnotation(page, rectThenCallout.id, 1);
  const page2CalloutsBeforeRect = new Set(await calloutIdsOnPage(page, 2));
  const page2ShapesBeforeRect = new Set((await userAnnotationSnapshot(page, 2)).map((row) => row.id));
  await rightClickEmptyPage(page, 2, { xf: 0.18, yf: 0.22 });
  await clickMenuItem(page, 'Paste');
  let pastedRect = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, 2);
    pastedRect = rows.find((row) => !page2ShapesBeforeRect.has(row.id) && (row.type === 'rect' || row.type === 'rectangle')) || null;
    return pastedRect;
  }).not.toBeNull();
  expect(pastedRect.id).not.toBe(rectThenCallout.id);
  expect(await calloutIdsOnPage(page, 2)).toEqual([...page2CalloutsBeforeRect]);
  hunts.push({ hunt: 'break — copy callout THEN copy rect', pass: true, clone: pastedRect.id });

  // Edge: paste after undo of the source — clipboard still yields a new callout.
  // Dedicated create → copy → undo so Undo removes THIS callout, not a later paste.
  const undoSource = await createCallout(page, 'xp-undo', {
    x0: 0.20, y0: 0.48, x1: 0.42, y1: 0.64,
  }, 1);
  await copyCallout(page, undoSource);
  await selectMode(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await calloutIdsOnPage(page, 1)).includes(undoSource)).toBeFalsy();
  const page2BeforeUndo = new Set(await calloutIdsOnPage(page, 2));
  const pastedAfterUndo = await pasteCalloutOnPage(page, 2, page2BeforeUndo, { xf: 0.54, yf: 0.18 });
  expect(pastedAfterUndo).not.toBe(undoSource);
  hunts.push({ hunt: 'edge — paste after undo of source', pass: true, clone: pastedAfterUndo });

  await copyCallout(page, calloutId);

  // Edge: paste after rotating the destination page.
  const { rotateCw } = await openPageMenu(page, 2);
  await rotateCw.click();
  await expect(pagesMenu(page)).toHaveCount(0);
  await waitForEditorReady(page);
  const page2BeforeRotate = new Set(await calloutIdsOnPage(page, 2));
  const pastedAfterRotate = await pasteCalloutOnPage(page, 2, page2BeforeRotate, { xf: 0.42, yf: 0.42 });
  expect(pastedAfterRotate).toBeTruthy();
  hunts.push({ hunt: 'edge — paste after destination rotate', pass: true, clone: pastedAfterRotate });

  // Break: paste after source page delete still lands on a remaining page.
  const doomed = await createCallout(page, 'xp-doomed', {
    x0: 0.24, y0: 0.24, x1: 0.46, y1: 0.40,
  }, 3);
  await copyCallout(page, doomed);
  page.once('dialog', (dialog) => dialog.accept());
  const { deleteBtn } = await openPageMenu(page, 3);
  await deleteBtn.click();
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count(), {
    timeout: 45_000,
    message: 'page 3 must leave after Delete',
  }).toBe(2);
  await waitForEditorReady(page);
  const remainingBefore = new Set(await calloutIdsOnPage(page, 1));
  const pastedAfterDelete = await pasteCalloutOnPage(page, 1, remainingBefore, { xf: 0.78, yf: 0.22 });
  expect(pastedAfterDelete).not.toBe(doomed);
  hunts.push({
    hunt: 'break — paste after source page deleted',
    pass: true,
    clone: pastedAfterDelete,
  });

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
  console.log('CALLOUT_CROSS_PAGE_PASTE', JSON.stringify({ hunts, leftover18: 'unchanged' }));
});
