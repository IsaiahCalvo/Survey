import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

// Desktop Pages "Move up / Move down" — exposed in ba4ef0e5 (was mobileMode-only),
// gated by P1-43 canReorderPages. Not a replay of wave 11 rotate-ccw,
// wave 10 insert-blank, leftover-18, or official npm test.

const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';

async function openEditor(page, fixture = GLYPH_PDF) {
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

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
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

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

function pagesPanelRows(page) {
  return page.locator('#chrome-left-host [data-page-number]:has(img[alt^="Page "])');
}

async function sidebarPageNumbers(page) {
  return pagesPanelRows(page).evaluateAll((els) => (
    els.map((el) => Number(el.getAttribute('data-page-number'))).filter((n) => Number.isFinite(n) && n > 0)
  ));
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
  const moveUp = pagesMenu(page).getByRole('button', { name: 'Move up', exact: true });
  const moveDown = pagesMenu(page).getByRole('button', { name: 'Move down', exact: true });
  await expect(moveUp).toBeVisible({ timeout: 8_000 });
  await expect(moveDown).toBeVisible();
  return { moveUp, moveDown };
}

async function menuDisabledState(page, pageNumber) {
  const items = await openPageMenu(page, pageNumber);
  return {
    moveUp: await items.moveUp.isDisabled(),
    moveDown: await items.moveDown.isDisabled(),
  };
}

async function annotationOnPage(page, pageNumber, id) {
  return (await userAnnotationSnapshot(page, pageNumber)).some((row) => row.id === id);
}

async function exportAnnotatedPdf(page) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  const path = await download.path();
  expect(path, 'exported PDF path').toBeTruthy();
  const fs = await import('node:fs/promises');
  return fs.readFile(path);
}

function decodePdfText(value) {
  if (!value) return '';
  if (typeof value.decodeText === 'function') return value.decodeText();
  if (typeof value.asString === 'function') return value.asString();
  return String(value);
}

async function exportedPages(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const pages = [];
  for (let i = 0; i < pdf.getPageCount(); i += 1) {
    const pdfPage = pdf.getPage(i);
    const annots = pdfPage.node.Annots();
    const rows = [];
    if (annots) {
      for (const ref of annots.asArray()) {
        const dict = pdfPage.doc.context.lookup(ref);
        const subtype = String(dict.get(pdfPage.doc.context.obj('Subtype')) || '');
        rows.push({
          subtype,
          contents: decodePdfText(dict.get(pdfPage.doc.context.obj('Contents'))),
          isSquare: /^\/Square$/i.test(subtype),
          isCircle: /^\/Circle$/i.test(subtype),
          isLine: /^\/Line$/i.test(subtype),
        });
      }
    }
    pages.push({
      index: i + 1,
      width: pdfPage.getWidth(),
      height: pdfPage.getHeight(),
      rotation: pdfPage.getRotation().angle,
      objectNumber: pdfPage.ref?.objectNumber ?? null,
      rows,
    });
  }
  return pages;
}

async function activateAssignedRegionFilter(page, pageSpec = '2, 3') {
  await page.getByRole('button', { name: 'Spaces', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create space', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByRole('textbox', { name: /Rename Space/i }).first()).toBeVisible();

  const pageInput = page.getByPlaceholder('Add pages (e.g. 3, 6-9, 12)');
  await expect(pageInput).toBeVisible();
  await pageInput.fill(pageSpec);
  await page.getByRole('button', { name: 'Add pages', exact: true }).click();

  const expectedPages = pageSpec.split(/[,\s]+/).map((value) => Number(value)).filter((n) => n > 0);
  for (const pageNumber of expectedPages) {
    await expect(page.getByRole('button', { name: `Go to page ${pageNumber}`, exact: true })).toBeVisible({ timeout: 8_000 });
  }

  await page.getByLabel('Turn on space').click();
  await expect(page.getByText(/no regions yet/i).first()).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Edit region areas on the page' }).first().click();
  await expect(page.getByLabel('Turn off space')).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  await openPagesPanel(page);
  await expect.poll(async () => (await sidebarPageNumbers(page)).length, { timeout: 15_000 }).toBe(expectedPages.length);
  return sidebarPageNumbers(page);
}

test('pages move-up/down: intended remap+export, break first/last+region, edge undo+escape', async ({ page }) => {
  await openEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  // Break: first-page Move up and last-page Move down are disabled (no-op).
  const firstMenu = await menuDisabledState(page, 1);
  expect(firstMenu.moveUp, 'first-page Move up must be disabled').toBe(true);
  expect(firstMenu.moveDown, 'first-page Move down stays available').toBe(false);
  await pagesMenu(page).getByRole('button', { name: 'Move up', exact: true }).click({ force: true });
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  const lastMenu = await menuDisabledState(page, 3);
  expect(lastMenu.moveDown, 'last-page Move down must be disabled').toBe(true);
  expect(lastMenu.moveUp, 'last-page Move up stays available').toBe(false);
  await pagesMenu(page).getByRole('button', { name: 'Move down', exact: true }).click({ force: true });
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  // Edge: Escape dismisses the menu without moving.
  await openPageMenu(page, 2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Move up', exact: true })).toHaveCount(0);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

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

  // Intended: move the middle page up; annotations remap; export order matches.
  const { moveUp } = await openPageMenu(page, 2);
  await expect(moveUp).toBeEnabled();
  await moveUp.click();
  await expect(page.getByRole('button', { name: 'Move up', exact: true })).toHaveCount(0);
  await waitForEditorReady(page);

  await expect.poll(async () => {
    await gotoPage(page, 1);
    return annotationOnPage(page, 1, rect.id);
  }, { timeout: 45_000, message: 'page-2 rect must remap to page 1 after Move up' }).toBeTruthy();
  await gotoPage(page, 3);
  expect(await annotationOnPage(page, 3, ellipse.id), 'page-3 ellipse must stay on page 3').toBeTruthy();
  await gotoPage(page, 2);
  expect(await annotationOnPage(page, 2, rect.id), 'moved rect must leave page 2').toBeFalsy();
  expect(await annotationOnPage(page, 2, ellipse.id), 'ellipse must not land on page 2').toBeFalsy();

  const exportBytes = await exportAnnotatedPdf(page);
  const exported = await exportedPages(exportBytes);
  expect(exported.length, 'export page count after Move up').toBe(3);
  expect(exported[0].rows.some((row) => row.isSquare), 'moved page (export 1) Square').toBeTruthy();
  expect(exported[1].rows.some((row) => row.isSquare), 'old page 1 slot must not keep Square').toBeFalsy();
  expect(exported[1].rows.some((row) => row.isCircle), 'old page 1 slot must not steal Circle').toBeFalsy();
  expect(exported[2].rows.some((row) => row.isCircle), 'unmoved page 3 export Circle').toBeTruthy();
  expect(exported[0].rows.some((row) => row.isCircle), 'moved page must not steal Circle').toBeFalsy();

  // Edge: page mutations clear history; a post-move draw undoes without un-moving.
  const line = await createShape(page, {
    category: 'Shapes',
    button: 'Line',
    predicate: (row) => row.type === 'line' || row.tool === 'line',
    coords: { x0: 0.24, y0: 0.30, x1: 0.52, y1: 0.46 },
    pageNumber: 2,
  });
  expect(line.id, 'post-move line').toBeTruthy();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await gotoPage(page, 2);
  await expect.poll(async () => annotationOnPage(page, 2, line.id)).toBeFalsy();
  await gotoPage(page, 1);
  expect(await annotationOnPage(page, 1, rect.id), 'undo after move must keep remapped rect').toBeTruthy();
  await gotoPage(page, 3);
  expect(await annotationOnPage(page, 3, ellipse.id), 'undo after move must keep remapped ellipse').toBeTruthy();

  const afterUndoBytes = await exportAnnotatedPdf(page);
  const afterUndo = await exportedPages(afterUndoBytes);
  expect(afterUndo.length).toBe(3);
  expect(afterUndo[0].rows.some((row) => row.isSquare)).toBeTruthy();
  expect(afterUndo[1].rows.some((row) => row.isLine), 'undone line must leave the swapped page empty').toBeFalsy();
  expect(afterUndo[2].rows.some((row) => row.isCircle)).toBeTruthy();

  // Break: assigned-region subset fails canReorderPages — items no-op.
  const filtered = await activateAssignedRegionFilter(page, '1, 3');
  expect(filtered).toEqual([1, 3]);
  const regionGate = await page.evaluate(async (allowed) => {
    const { canReorderVisiblePages } = await import('/src/sidebar/pagesPanelUtils.js');
    return canReorderVisiblePages({ allowedPages: allowed, numPages: 3 });
  }, filtered);
  expect(regionGate, 'subset view must fail canReorderPages').toBe(false);

  const regionMenu = await menuDisabledState(page, 1);
  expect(regionMenu.moveUp, 'region filter disables Move up').toBe(true);
  expect(regionMenu.moveDown, 'region filter disables Move down').toBe(true);
  await pagesMenu(page).getByRole('button', { name: 'Move down', exact: true }).click({ force: true });
  await expect.poll(async () => sidebarPageNumbers(page)).toEqual([1, 3]);
  await gotoPage(page, 1);
  expect(await annotationOnPage(page, 1, rect.id), 'region no-op must keep remapped rect').toBeTruthy();
  await gotoPage(page, 3);
  expect(await annotationOnPage(page, 3, ellipse.id), 'region no-op must keep ellipse').toBeTruthy();

  await assertNoErrorBoundary(page);
  console.log('PAGES_MOVE_UP_DOWN', JSON.stringify({
    rectId: rect.id,
    ellipseId: ellipse.id,
    lineId: line.id,
    firstMenu,
    lastMenu,
    exportPages: exported.map((row) => ({ index: row.index, subtypes: row.rows.map((item) => item.subtype) })),
    afterUndoPages: afterUndo.map((row) => ({ index: row.index, subtypes: row.rows.map((item) => item.subtype) })),
    filtered,
    regionGate,
    leftover18: 'unchanged',
  }));
});
