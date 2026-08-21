import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

// Wave 10 — insert-blank page mutation (not a replay of wave7/8/9,
// survey-marker, page-duplicate, form-flatten, context-menu cut/copy, or
// History-on-?testPdf=). Desktop Pages menu previously omitted the wired
// onInsertBlankPage handler (mobile "Add" + legacy PAL only).

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

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  await expect(pages).toBeVisible();
  if ((await pages.getAttribute('aria-pressed')) !== 'true') {
    await pages.click();
  }
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"], [data-sidebar-panel] [data-page-number="${pageNumber}"]`).first();
}

async function openPageMenu(page, pageNumber) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.click({ button: 'right' });
  const insert = page.getByText('Insert blank page', { exact: true });
  await expect(insert).toBeVisible({ timeout: 8_000 });
  return insert;
}

async function insertBlankAfter(page, pageNumber) {
  const before = await page.locator('.survey-pdfjs-page-div').count();
  const insert = await openPageMenu(page, pageNumber);
  await insert.click();
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count(), {
    timeout: 45_000,
  }).toBe(before + 1);
  await expect(page.locator(`.survey-pdfjs-page-div[data-page-number="${before + 1}"]`)).toBeVisible({ timeout: 20_000 });
  await assertNoErrorBoundary(page);
  return before;
}

async function deletePage(page, pageNumber, { accept = true } = {}) {
  page.once('dialog', (dialog) => (accept ? dialog.accept() : dialog.dismiss()));
  const before = await page.locator('.survey-pdfjs-page-div').count();
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible();
  await thumb.click({ button: 'right' });
  const del = page.getByText('Delete', { exact: true });
  await expect(del).toBeVisible({ timeout: 8_000 });
  await del.click();
  if (!accept) {
    await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(before);
    return before;
  }
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count(), {
    timeout: 45_000,
  }).toBe(before - 1);
  return before;
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
    const page = pdf.getPage(i);
    const annots = page.node.Annots();
    const rows = [];
    if (annots) {
      for (const ref of annots.asArray()) {
        const dict = page.doc.context.lookup(ref);
        const subtype = String(dict.get(page.doc.context.obj('Subtype')) || '');
        rows.push({
          subtype,
          contents: decodePdfText(dict.get(page.doc.context.obj('Contents'))),
          isSquare: /^\/Square$/i.test(subtype),
          isCircle: /^\/Circle$/i.test(subtype),
          isLine: /^\/Line$/i.test(subtype),
          isInk: /^\/Ink$/i.test(subtype),
        });
      }
    }
    pages.push({
      index: i + 1,
      width: page.getWidth(),
      height: page.getHeight(),
      rows,
    });
  }
  return pages;
}

test('W10 insert-blank: intended remap+export, break dismiss, edge undo+delete', async ({ page }) => {
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });

  await openEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  // Break: menu is offered, Escape dismisses, page count stays 3.
  await openPageMenu(page, 1);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Insert blank page', { exact: true })).toHaveCount(0);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  const rect = await createShape(page, {
    category: 'Shapes',
    button: 'Rectangle',
    predicate: (row) => row.type === 'rect' || row.type === 'rectangle',
    coords: { x0: 0.20, y0: 0.24, x1: 0.40, y1: 0.40 },
    pageNumber: 1,
  });
  expect(rect.id, 'page-1 rect').toBeTruthy();

  const ellipse = await createShape(page, {
    category: 'Shapes',
    button: 'Ellipse',
    predicate: (row) => row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse',
    coords: { x0: 0.22, y0: 0.26, x1: 0.44, y1: 0.44 },
    pageNumber: 2,
  });
  expect(ellipse.id, 'page-2 ellipse').toBeTruthy();
  expect(ellipse.id).not.toBe(rect.id);

  const beforeInsert = await insertBlankAfter(page, 1);
  expect(beforeInsert).toBe(3);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(4);

  // Intended: page 1 keeps the rect; inserted page 2 is empty; old page 2 remaps to 3.
  await gotoPage(page, 1);
  expect(
    (await userAnnotationSnapshot(page, 1)).some((row) => row.id === rect.id),
    'insert must not steal the page-1 rect',
  ).toBeTruthy();
  await gotoPage(page, 2);
  expect(
    (await userAnnotationSnapshot(page, 2)).length,
    'inserted blank must not clone annotations',
  ).toBe(0);
  await gotoPage(page, 3);
  expect(
    (await userAnnotationSnapshot(page, 3)).some((row) => row.id === ellipse.id),
    'page-2 ellipse must remap to page 3',
  ).toBeTruthy();

  const line = await createShape(page, {
    category: 'Shapes',
    button: 'Line',
    predicate: (row) => row.type === 'line' || row.tool === 'line',
    coords: { x0: 0.24, y0: 0.30, x1: 0.52, y1: 0.46 },
    pageNumber: 2,
  });
  expect(line.id, 'draw on inserted blank').toBeTruthy();

  const exportBytes = await exportAnnotatedPdf(page);
  const exported = await exportedPages(exportBytes);
  expect(exported.length, 'export page count after insert').toBe(4);
  expect(exported[0].rows.some((row) => row.isSquare), 'page 1 export Square').toBeTruthy();
  expect(exported[1].rows.some((row) => row.isLine), 'inserted page 2 export Line').toBeTruthy();
  expect(exported[1].rows.some((row) => row.isSquare), 'inserted page must not inherit page-1 Square').toBeFalsy();
  expect(exported[2].rows.some((row) => row.isCircle), 'remapped page 3 export Circle').toBeTruthy();
  expect(exported[3].rows.length, 'untouched page 4 stays empty').toBe(0);

  printLogs.length = 0;
  await page.keyboard.press('Control+Shift+p');
  if (!printLogs.some((line) => /OPEN requested/i.test(line))) {
    await page.keyboard.press('Meta+Shift+p');
  }
  await expect.poll(() => printLogs.some((line) => /OPEN requested|withMarkup|diagnostics=/i.test(line))).toBeTruthy();
  await page.keyboard.press('Escape');

  // Edge: undo the line on the inserted page; remapped ellipse stays.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await gotoPage(page, 2);
  await expect.poll(async () => (await userAnnotationSnapshot(page, 2)).some((row) => row.id === line.id)).toBeFalsy();
  await gotoPage(page, 3);
  expect(
    (await userAnnotationSnapshot(page, 3)).some((row) => row.id === ellipse.id),
    'undo of inserted-page draw must keep remapped ellipse',
  ).toBeTruthy();
  await gotoPage(page, 1);
  expect(
    (await userAnnotationSnapshot(page, 1)).some((row) => row.id === rect.id),
    'undo of inserted-page draw must keep page-1 rect',
  ).toBeTruthy();

  const afterUndoBytes = await exportAnnotatedPdf(page);
  const afterUndo = await exportedPages(afterUndoBytes);
  expect(afterUndo.length).toBe(4);
  expect(afterUndo[1].rows.some((row) => row.isLine), 'undone line must leave the blank page empty').toBeFalsy();
  expect(afterUndo[0].rows.some((row) => row.isSquare)).toBeTruthy();
  expect(afterUndo[2].rows.some((row) => row.isCircle)).toBeTruthy();

  // Edge: dismiss Delete does not drop the inserted page.
  await deletePage(page, 2, { accept: false });
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(4);

  // Edge: accept Delete of the blank; ellipse remaps back to page 2.
  await deletePage(page, 2, { accept: true });
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);
  await gotoPage(page, 2);
  expect(
    (await userAnnotationSnapshot(page, 2)).some((row) => row.id === ellipse.id),
    'deleting the blank must remap the ellipse back to page 2',
  ).toBeTruthy();
  await gotoPage(page, 1);
  expect((await userAnnotationSnapshot(page, 1)).some((row) => row.id === rect.id)).toBeTruthy();

  const afterDeleteBytes = await exportAnnotatedPdf(page);
  const afterDelete = await exportedPages(afterDeleteBytes);
  expect(afterDelete.length).toBe(3);
  expect(afterDelete[0].rows.some((row) => row.isSquare)).toBeTruthy();
  expect(afterDelete[1].rows.some((row) => row.isCircle)).toBeTruthy();
  expect(afterDelete[2].rows.length, 'original page 3 stays empty').toBe(0);

  await assertNoErrorBoundary(page);
  console.log('W10_INSERT_BLANK', JSON.stringify({
    rectId: rect.id,
    ellipseId: ellipse.id,
    lineId: line.id,
    exportPages: exported.map((p) => ({ index: p.index, subtypes: p.rows.map((r) => r.subtype) })),
    afterUndoPages: afterUndo.map((p) => ({ index: p.index, subtypes: p.rows.map((r) => r.subtype) })),
    afterDeletePages: afterDelete.map((p) => ({ index: p.index, subtypes: p.rows.map((r) => r.subtype) })),
    leftover18: 'unchanged',
  }));
});
