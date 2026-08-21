import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

// Wave 11 — desktop Pages "Rotate counter-clockwise" (not a replay of
// wave7/8/9/10 insert-blank, survey-marker, form-flatten, or History-on-?testPdf=).
//
// Menu audit (mobile PagesPanel / expo-go / legacy PAL vs desktop Pages):
//   Desktop already had Cut, Copy, Paste, Duplicate, Insert blank, Rotate (CW),
//   Mirror H/V, Reset, Delete. Drag reorder covers mobile Move up/down.
//   Insert after last is Insert blank on the last thumb. No extract handler
//   exists on any surface. Gap: canvas/legacy PAL exposes Rotate
//   Counter-Clockwise (handleRotatePageCCW, delta -90); desktop Pages did not.

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
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
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
  const rotateCcw = pagesMenu(page).getByText('Rotate counter-clockwise', { exact: true });
  await expect(rotateCcw).toBeVisible({ timeout: 8_000 });
  return { rotateCcw, rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }) };
}

async function rotatePage(page, pageNumber, direction = 'ccw') {
  await gotoPage(page, pageNumber);
  const beforeBox = await pageBox(page, pageNumber);
  const items = await openPageMenu(page, pageNumber);
  await (direction === 'cw' ? items.rotateCw : items.rotateCcw).click();
  await expect(page.getByText('Rotate counter-clockwise', { exact: true })).toHaveCount(0);
  await waitForEditorReady(page);
  await expect.poll(async () => {
    const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
    if (!box) return false;
    const wasPortrait = beforeBox.height > beforeBox.width + 8;
    const nowLandscape = box.width > box.height + 8;
    const nowPortrait = box.height > box.width + 8;
    return wasPortrait ? nowLandscape : nowPortrait;
  }, { timeout: 45_000, message: `page ${pageNumber} should flip aspect after ${direction} rotate` }).toBeTruthy();
  await assertNoErrorBoundary(page);
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
        });
      }
    }
    pages.push({
      index: i + 1,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle,
      rows,
    });
  }
  return pages;
}

test('W11 rotate-ccw: intended remap+export, break dismiss, edge CW restore', async ({ page }) => {
  await openEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  const page2Before = await pageBox(page, 2);
  expect(page2Before.height, 'glyph-lab page 2 starts portrait').toBeGreaterThan(page2Before.width);

  // Break: menu is offered, Escape dismisses, rotation stays 0 / portrait.
  await openPageMenu(page, 2);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Rotate counter-clockwise', { exact: true })).toHaveCount(0);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);
  const page2AfterEscape = await pageBox(page, 2);
  expect(page2AfterEscape.height, 'Escape must not rotate page 2').toBeGreaterThan(page2AfterEscape.width);

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

  await rotatePage(page, 2, 'ccw');
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  await gotoPage(page, 2);
  expect(
    (await userAnnotationSnapshot(page, 2)).some((row) => row.id === rect.id),
    'CCW rotate must not steal the page-2 rect',
  ).toBeTruthy();
  await gotoPage(page, 3);
  expect(
    (await userAnnotationSnapshot(page, 3)).some((row) => row.id === ellipse.id),
    'CCW rotate of page 2 must leave the page-3 ellipse',
  ).toBeTruthy();
  await gotoPage(page, 1);
  expect(
    (await userAnnotationSnapshot(page, 1)).length,
    'CCW rotate must not clone annotations onto page 1',
  ).toBe(0);

  const page1Box = await pageBox(page, 1);
  const page3Box = await pageBox(page, 3);
  expect(page1Box.height, 'sibling page 1 stays portrait').toBeGreaterThan(page1Box.width);
  expect(page3Box.height, 'sibling page 3 stays portrait').toBeGreaterThan(page3Box.width);

  const exportBytes = await exportAnnotatedPdf(page);
  const exported = await exportedPages(exportBytes);
  expect(exported.length, 'export page count after CCW').toBe(3);
  expect(exported[0].rotation, 'page 1 export rotation').toBe(0);
  expect(exported[1].rotation, 'page 2 export CCW').toBe(270);
  expect(exported[2].rotation, 'page 3 export rotation').toBe(0);
  expect(exported[1].rows.some((row) => row.isSquare), 'rotated page 2 export Square').toBeTruthy();
  expect(exported[2].rows.some((row) => row.isCircle), 'page 3 export Circle').toBeTruthy();
  expect(exported[0].rows.length, 'page 1 stays empty').toBe(0);

  // Edge: existing desktop Rotate (CW) undoes the CCW; last-page CCW is isolated.
  await rotatePage(page, 2, 'cw');
  await gotoPage(page, 2);
  expect(
    (await userAnnotationSnapshot(page, 2)).some((row) => row.id === rect.id),
    'CW restore must keep the page-2 rect',
  ).toBeTruthy();

  const afterCwBytes = await exportAnnotatedPdf(page);
  const afterCw = await exportedPages(afterCwBytes);
  expect(afterCw.map((row) => row.rotation)).toEqual([0, 0, 0]);
  expect(afterCw[1].rows.some((row) => row.isSquare)).toBeTruthy();
  expect(afterCw[2].rows.some((row) => row.isCircle)).toBeTruthy();

  await rotatePage(page, 3, 'ccw');
  await gotoPage(page, 2);
  expect(
    (await userAnnotationSnapshot(page, 2)).some((row) => row.id === rect.id),
    'rotating the last page must not move the page-2 rect',
  ).toBeTruthy();
  await gotoPage(page, 3);
  expect(
    (await userAnnotationSnapshot(page, 3)).some((row) => row.id === ellipse.id),
    'last-page CCW must keep the page-3 ellipse',
  ).toBeTruthy();

  const afterLastBytes = await exportAnnotatedPdf(page);
  const afterLast = await exportedPages(afterLastBytes);
  expect(afterLast.map((row) => row.rotation)).toEqual([0, 0, 270]);
  expect(afterLast[1].rows.some((row) => row.isSquare)).toBeTruthy();
  expect(afterLast[2].rows.some((row) => row.isCircle)).toBeTruthy();

  await assertNoErrorBoundary(page);
  console.log('W11_ROTATE_CCW', JSON.stringify({
    rectId: rect.id,
    ellipseId: ellipse.id,
    exportRotations: exported.map((row) => row.rotation),
    afterCwRotations: afterCw.map((row) => row.rotation),
    afterLastRotations: afterLast.map((row) => row.rotation),
    leftover18: 'unchanged',
  }));
});
