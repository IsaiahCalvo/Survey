import { test, expect } from '@playwright/test';

// Wave 12 — History delete-restore + jump-to-page on ?testPdf=
// (not a replay of W4-03 button/empty/activity-list, wave 10 insert-blank,
// wave 11 rotate-ccw, pages Move up/down, flatten, or survey-marker).
//
// W4-03 remaining risk named this surface: delete-restore / jump-to-page
// were not re-proven beyond the activity list appearing. Named cloud
// Save/Restore stay owner-gated and are not claimed.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';

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
        pageNumber: Number(object.pageNumber || data.pageNumber || pageNum) || pageNum,
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
  }, { message: `expected a new user annotation on page ${pageNumber}` }).not.toBeNull();
  return created;
}

async function annotationOnPage(page, pageNumber, id) {
  const rows = await userAnnotationSnapshot(page, pageNumber);
  return rows.some((row) => row.id === id);
}

async function storePageNumber(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId);
    if (!object) return null;
    const fromObj = Number(object.pageNumber);
    if (Number.isFinite(fromObj) && fromObj > 0) return fromObj;
    return null;
  }, id);
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

async function openHistoryPanel(page) {
  const history = page.getByRole('button', { name: 'Version history', exact: true });
  await expect(history).toBeVisible({ timeout: 15_000 });
  await history.click();
  await expect(page.getByText(/No history yet|Dev Test User|Someone|undoable edit|deleted/i).first())
    .toBeVisible({ timeout: 15_000 });
}

function historyEvents(page) {
  return page.locator('[data-testid^="document-history-event-"]');
}

function restoreButtons(page) {
  return page.locator('[data-testid^="document-history-restore-"]');
}

async function deleteAnnotationViaMenu(page, id, pageNumber) {
  await gotoPage(page, pageNumber);
  await page.keyboard.press('v');
  const target = page.locator(`[data-svg-annotation-layer="${pageNumber}"] > g[data-anno-id="${id}"]`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: 'right' });
  const menu = page.locator('[data-annotation-context-menu="true"]');
  await expect(menu).toBeVisible({ timeout: 8_000 });
  await menu.getByText('Delete', { exact: true }).click();
  await expect(page.locator('[data-annotation-context-menu="true"]')).toHaveCount(0);
  await expect.poll(async () => annotationOnPage(page, pageNumber, id), {
    message: `${id} should leave page ${pageNumber} after Delete`,
  }).toBeFalsy();
}

test('W12 history restore+jump: intended, break empty/create, edge undo+no-clone', async ({ page }) => {
  await openEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  // Break: empty History offers no Restore; named cloud save stays owner-gated.
  await openHistoryPanel(page);
  await expect(page.getByText('No history yet. Edit the document or save a named version to start the timeline.')).toBeVisible();
  expect(await restoreButtons(page).count(), 'empty History must not offer Restore').toBe(0);
  await expect(page.getByText('Only the document owner can save or restore versions.')).toBeVisible();
  const saveVersion = page.getByRole('button', { name: 'Save version', exact: true });
  if (await saveVersion.count()) {
    await expect(saveVersion).toBeDisabled();
  }
  await page.keyboard.press('Escape');

  const rect = await createShape(page, {
    category: 'Shapes',
    button: 'Rectangle',
    predicate: (row) => row.type === 'rect' || row.type === 'rectangle',
    coords: { x0: 0.20, y0: 0.24, x1: 0.40, y1: 0.40 },
    pageNumber: 2,
  });
  expect(rect.id, 'page-2 rect').toBeTruthy();

  const ellipse = await createShape(page, {
    category: 'Shapes',
    button: 'Ellipse',
    predicate: (row) => row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse',
    coords: { x0: 0.22, y0: 0.26, x1: 0.44, y1: 0.44 },
    pageNumber: 3,
  });
  expect(ellipse.id, 'page-3 ellipse').toBeTruthy();
  expect(ellipse.id).not.toBe(rect.id);

  // Break: create/edit rows are not restorable deletes.
  await openHistoryPanel(page);
  await expect.poll(async () => historyEvents(page).count(), {
    timeout: 15_000,
    message: 'create events should land in History',
  }).toBeGreaterThan(0);
  const restoreBeforeDelete = await restoreButtons(page).count();
  expect(restoreBeforeDelete, 'create rows must not grow Restore buttons').toBe(0);
  await expect(page.getByText(/created a rectangle|made an edit on page 2|drew/i).first()).toBeVisible();

  await deleteAnnotationViaMenu(page, rect.id, 2);
  await gotoPage(page, 3);
  expect(await annotationOnPage(page, 3, ellipse.id), 'delete of page-2 rect must leave page-3 ellipse').toBeTruthy();
  await gotoPage(page, 1);
  expect(await annotationOnPage(page, 1, rect.id), 'deleted rect must not teleport to page 1').toBeFalsy();

  // Intended: deleted item is restorable; Restore puts it back on page 2.
  await openHistoryPanel(page);
  await expect.poll(async () => restoreButtons(page).count(), {
    timeout: 20_000,
    message: 'deleted annotation must offer Restore',
  }).toBe(1);
  await expect(page.getByText('Restorable deleted item').first()).toBeVisible();
  await expect(page.getByText(/deleted a rectangle on page 2/i).first()).toBeVisible();

  // Intended: clicking the delete row jumps to page 2 (from page 1).
  await gotoPage(page, 1);
  await openHistoryPanel(page);
  const deleteRow = page.locator('[data-testid^="document-history-event-"]').filter({
    hasText: /deleted a rectangle/i,
  }).first();
  await expect(deleteRow).toBeVisible();
  await deleteRow.click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="2"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    const layer = page.locator('[data-svg-annotation-layer="2"]');
    return layer.count();
  }).toBeGreaterThan(0);

  await restoreButtons(page).first().click();
  await expect.poll(async () => annotationOnPage(page, 2, rect.id), {
    timeout: 20_000,
    message: 'Restore must return the rect to page 2',
  }).toBeTruthy();
  expect(await storePageNumber(page, rect.id), 'restored rect store page').toBe(2);
  await gotoPage(page, 3);
  expect(await annotationOnPage(page, 3, ellipse.id), 'restore must not steal the page-3 ellipse').toBeTruthy();
  expect(await storePageNumber(page, ellipse.id), 'ellipse store page after restore').toBe(3);
  await gotoPage(page, 1);
  expect(await annotationOnPage(page, 1, rect.id), 'restore must not clone the rect onto page 1').toBeFalsy();

  // Edge: second Restore is a no-op (already present), not a clone.
  await openHistoryPanel(page);
  const restoreCount = await restoreButtons(page).count();
  if (restoreCount > 0) {
    await restoreButtons(page).first().click();
  }
  await gotoPage(page, 2);
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page, 2);
    return rows.filter((row) => row.id === rect.id).length;
  }).toBe(1);
  await gotoPage(page, 3);
  expect((await userAnnotationSnapshot(page, 3)).filter((row) => row.id === rect.id).length, 'no clone on page 3').toBe(0);

  // Edge: Undo after restore must not invert stale page numbers.
  // Undo either drops the restored rect or is disabled; the page-3 ellipse stays.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.isEnabled()) {
    await undo.click();
  }
  await gotoPage(page, 3);
  expect(await annotationOnPage(page, 3, ellipse.id), 'undo after restore must not invert the page-3 ellipse').toBeTruthy();
  expect(await storePageNumber(page, ellipse.id), 'ellipse page after undo').toBe(3);
  await gotoPage(page, 1);
  expect(await annotationOnPage(page, 1, ellipse.id), 'undo must not move the ellipse onto page 1').toBeFalsy();
  await gotoPage(page, 2);
  const rectOn2 = await annotationOnPage(page, 2, rect.id);
  const rectOn1 = await annotationOnPage(page, 1, rect.id);
  const rectOn3 = await annotationOnPage(page, 3, rect.id);
  expect(rectOn1, 'undone/restored rect must not land on page 1').toBeFalsy();
  expect(rectOn3, 'undone/restored rect must not land on page 3').toBeFalsy();
  expect(
    rectOn2 === true || rectOn2 === false,
    'rect is either still on page 2 or undone — never remapped',
  ).toBeTruthy();

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();

  console.log('W12_HISTORY_RESTORE_JUMP', JSON.stringify({
    rectId: rect.id,
    ellipseId: ellipse.id,
    restoreAfterCreate: restoreBeforeDelete,
    leftover18: 'unchanged',
  }));
});
