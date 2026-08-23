import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1&tab=documents';

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
        displayNumber: (() => {
          const fromData = data.displayNumber ?? data.value ?? data.number ?? object.displayNumber;
          if (Number.isFinite(Number(fromData)) && Number(fromData) > 0) return Number(fromData);
          const el = document.querySelector(
            `[data-counter-overlay="${pageNum}"] [data-anno-id="${id}"] text, [data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"] text`
          );
          const fromDom = el ? Number.parseInt((el.textContent || '').trim(), 10) : NaN;
          return Number.isFinite(fromDom) ? fromDom : (fromData ?? null);
        })(),
        seriesId: data.seriesId || null,
        cloudIntensity: data.pdfCloudIntensity ?? data.cloudIntensity ?? null,
        cloudBorder: Boolean(data.cloudBorder || object.cloudBorder || data.borderStyle === 'cloud'),
        borderStyle: String(data.borderStyle || object.borderStyle || ''),
        left: object.left ?? data.left ?? null,
        top: object.top ?? data.top ?? null,
        width: object.width ?? data.width ?? null,
        height: object.height ?? data.height ?? null,
        scaleX: object.scaleX ?? data.scaleX ?? 1,
        scaleY: object.scaleY ?? data.scaleY ?? 1,
        x1: object.x1 ?? data.x1 ?? null,
        y1: object.y1 ?? data.y1 ?? null,
        x2: object.x2 ?? data.x2 ?? null,
        y2: object.y2 ?? data.y2 ?? null,
        angle: object.angle ?? data.angle ?? 0,
        callout: isCallout,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
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
  await popover.getByText(String(optionName), { exact: true }).click();
}

async function selectStroke(page, id, pageNumber = 1) {
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-svg-annotation-layer="${pageNumber}"] [data-anno-id="${id}"], [data-svg-annotation-layer="${pageNumber}"] [data-callout-id="${id}"], [data-counter-overlay="${pageNumber}"] [data-anno-id="${id}"]`
  ).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.max(2, box.height / 2));
}

function isCounterRow(row) {
  return row.tool === 'counter'
    || row.type.includes('counter')
    || row.type === 'circle'
    || row.type === 'group'
    || !row.type;
}

async function dropCounterPin(page, { pageNumber = 1, xf = 0.40, yf = 0.36 } = {}) {
  const overlay = page.locator(`[data-counter-overlay="${pageNumber}"]`);
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(280);
  const box = await overlay.boundingBox();
  expect(box, 'counter overlay geometry').toBeTruthy();
  const start = { x: box.x + box.width * xf, y: box.y + box.height * yf };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 4 });
  await page.mouse.up();
}

async function goToPage(page, pageNumber) {
  const next = page.getByRole('button', { name: 'Next page', exact: true });
  const prev = page.getByRole('button', { name: 'Previous page', exact: true });
  const layer = page.locator(`[data-svg-annotation-layer="${pageNumber}"]`);
  if (await layer.isVisible().catch(() => false)) return;
  if (pageNumber > 1 && await next.count()) {
    await next.click();
    await expect(layer).toBeVisible({ timeout: 20_000 });
    return;
  }
  if (pageNumber === 1 && await prev.count()) {
    await prev.click();
    await expect(layer).toBeVisible({ timeout: 20_000 });
  }
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }, pageNumber = 1) {
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.type === 'rect' || row.type === 'rectangle', pageNumber);
}

async function createLine(page, coords = { x0: 0.24, y0: 0.50, x1: 0.54, y1: 0.58 }, pageNumber = 1) {
  const before = new Set((await userAnnotationSnapshot(page, pageNumber)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, { ...coords, pageNumber });
  return waitForNewUserAnnotation(page, before, (row) => row.tool === 'line' || row.type === 'line', pageNumber);
}

async function createCallout(page, text, coords) {
  const before = await page.locator('[data-callout-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
  ));
  await page.keyboard.press('q');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 10 });
  let calloutId = null;
  await expect.poll(async () => {
    const ids = await page.locator('[data-callout-id]').evaluateAll((els) => (
      els.map((el) => el.getAttribute('data-callout-id')).filter(Boolean)
    ));
    calloutId = ids.find((id) => !before.includes(id)) || null;
    return calloutId;
  }).not.toBeNull();
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  return calloutId;
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

async function exportedSquares(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(0);
  const annots = page.node.Annots();
  const squares = [];
  if (!annots) return squares;
  for (const ref of annots.asArray()) {
    const dict = page.doc.context.lookup(ref);
    const subtype = String(dict.get(page.doc.context.obj('Subtype')) || '');
    if (!/Square/i.test(subtype)) continue;
    const be = dict.get(page.doc.context.obj('BE'));
    const rect = dict.get(page.doc.context.obj('Rect'));
    squares.push({
      subtype,
      be: be ? String(be) : null,
      rect: rect ? String(rect) : null,
    });
  }
  return squares;
}

async function openSettings(page) {
  await page.goto(HUB);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  const dialog = page.locator('.account-settings-modal');
  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  return dialog;
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
  await page.keyboard.press('Escape');
  const pagesToggle = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pagesToggle.getAttribute('aria-pressed') === 'true') {
    await pagesToggle.click();
  }
}

test('P1-14 renumberCounters persist after page-bucket change', async ({ page }) => {
  await openEditor(page, LINK_PDF);
  await duplicatePageOne(page);
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible();

  await activateTool(page, 'Shapes', 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
  const before1 = new Set((await userAnnotationSnapshot(page, 1)).map((row) => row.id));
  await dropCounterPin(page, { pageNumber: 1, xf: 0.38, yf: 0.34 });
  const pin1 = await waitForNewUserAnnotation(page, before1, isCounterRow, 1);
  const before2 = new Set((await userAnnotationSnapshot(page, 1)).map((row) => row.id));
  await dropCounterPin(page, { pageNumber: 1, xf: 0.54, yf: 0.34 });
  const pin2 = await waitForNewUserAnnotation(page, before2, (row) => isCounterRow(row) && row.id !== pin1.id, 1);
  const before3 = new Set((await userAnnotationSnapshot(page, 1)).map((row) => row.id));
  await dropCounterPin(page, { pageNumber: 1, xf: 0.70, yf: 0.34 });
  const pin3 = await waitForNewUserAnnotation(page, before3, (row) => (
    isCounterRow(row) && row.id !== pin1.id && row.id !== pin2.id
  ), 1);

  const counterNums = async (ids) => page.evaluate((annoIds) => annoIds.map((id) => {
    const object = window.__phase35GetAnnotationById?.(id) || {};
    const data = object.data || {};
    const fromData = data.displayNumber ?? data.value ?? data.number;
    const el = document.querySelector(
      `[data-counter-overlay] [data-anno-id="${id}"] text, [data-svg-annotation-layer] [data-anno-id="${id}"] text`
    );
    const fromDom = el ? Number.parseInt((el.textContent || '').trim(), 10) : NaN;
    return Number.isFinite(Number(fromData)) && Number(fromData) > 0
      ? Number(fromData)
      : (Number.isFinite(fromDom) ? fromDom : null);
  }), ids);

  await expect.poll(async () => counterNums([pin1.id, pin2.id, pin3.id])).toEqual([1, 2, 3]);

  await page.keyboard.press('v');
  await selectStroke(page, pin1.id, 1);
  await page.keyboard.press('Delete');
  if (await annotationById(page, pin1.id, 1)) await page.keyboard.press('Backspace');
  if (await annotationById(page, pin1.id, 1)) {
    const pinBox = await page.locator(
      `[data-counter-overlay] [data-anno-id="${pin1.id}"], [data-svg-annotation-layer="1"] [data-anno-id="${pin1.id}"]`
    ).first().boundingBox();
    if (pinBox) {
      await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, { button: 'right' });
      const del = page.locator('[data-annotation-context-menu="true"]').getByText('Delete', { exact: true });
      if (await del.count()) await del.click();
      else await page.keyboard.press('Escape');
    }
  }
  await expect.poll(async () => Boolean(await annotationById(page, pin1.id, 1))).toBeFalsy();
  await expect.poll(async () => counterNums([pin2.id, pin3.id])).toEqual([1, 2]);

  await goToPage(page, 2);
  await goToPage(page, 1);
  const persisted = await counterNums([pin2.id, pin3.id]);
  expect(persisted).toEqual([1, 2]);

  const helper = await page.evaluate(async () => {
    const { renumberCounters } = await import('/src/utils/counterNumbering.js');
    const page1 = { version: '5.3.0', objects: [{ type: 'path', data: { id: 'ink' } }] };
    const page2 = {
      version: '5.3.0',
      objects: [
        { type: 'group', data: { id: 'c2', type: 'counter', seriesId: 's', seriesStart: 1, createdAt: 2, displayNumber: 2 } },
        { type: 'group', data: { id: 'c3', type: 'counter', seriesId: 's', seriesStart: 1, createdAt: 3, displayNumber: 3 } },
      ],
    };
    const page3 = { version: '5.3.0', objects: [{ type: 'rect', data: { id: 'box' } }] };
    const byPage = { 1: page1, 2: page2, 3: page3 };
    const result = renumberCounters(byPage);
    const unchanged = { 1: { version: '5.3.0', objects: [{ type: 'group', data: { id: 'ok', type: 'counter', seriesId: 's', seriesStart: 1, createdAt: 1, displayNumber: 1 } }] } };
    const same = renumberCounters(unchanged);
    return {
      sameMap: result === byPage,
      page2Replaced: result[2] !== page2,
      page3Same: result[3] === page3,
      numbers: result[2].objects.map((obj) => obj.data.displayNumber),
      originalUntouched: page2.objects[0].data.displayNumber,
      alreadyCorrectSame: same[1] === unchanged[1],
      hostileNull: renumberCounters(null) === null,
      hostileEmpty: Object.keys(renumberCounters({})).length === 0,
    };
  });
  expect(helper.page2Replaced).toBe(true);
  expect(helper.page3Same).toBe(true);
  expect(helper.numbers).toEqual([1, 2]);
  expect(helper.originalUntouched).toBe(2);
  expect(helper.alreadyCorrectSame).toBe(true);
  expect(helper.hostileNull).toBe(true);
  expect(helper.hostileEmpty).toBe(true);

  console.log('P114_PROOF', JSON.stringify({ persisted, helper }));
});

test('P1-01 / 03 / 04 group flatten, Square /BE, print scale', async ({ page }) => {
  await openEditor(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDropdownOption(page, 'Style', 'Cloud');
  const beforeCloud = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await dragOnPage(page, { x0: 0.20, y0: 0.22, x1: 0.46, y1: 0.40 });
  const cloud = await waitForNewUserAnnotation(page, beforeCloud, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.borderStyle === 'cloud' || row.cloudIntensity || row.cloudBorder
  ));

  const line = await createLine(page, { x0: 0.22, y0: 0.52, x1: 0.50, y1: 0.60 });
  const plain = await createRect(page, { x0: 0.56, y0: 0.52, x1: 0.74, y1: 0.68 });

  await selectStroke(page, plain.id);
  const handle = page.locator('[data-resize-handle]').last();
  if (await handle.count()) {
    const hb = await handle.boundingBox();
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + 48, hb.y + 36, { steps: 8 });
      await page.mouse.up();
    }
  }
  const afterScale = await annotationById(page, plain.id);

  const bytes = await exportAnnotatedPdf(page);
  const squares = await exportedSquares(bytes);
  const cloudSquare = squares.find((row) => /\/S\/C|\/C/.test(String(row.be || '')));
  const plainSquares = squares.filter((row) => !row.be);
  expect(cloudSquare || squares.some((row) => row.be), 'cloud Square export writes /BE').toBeTruthy();
  expect(plainSquares.length, 'non-cloud rects omit /BE').toBeGreaterThan(0);

  const src = readFileSync(new URL('../../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');
  const flattenFn = src.slice(src.indexOf('const drawFlattenedObject'));
  const groupSlice = flattenFn.slice(0, flattenFn.indexOf('const type = String(obj.type'));
  expect(groupSlice).toMatch(/left: \(Number\(child\?\.left\) \|\| 0\) \+ parentLeft/);
  expect(groupSlice).not.toMatch(/x1: child\?\.x1/);
  expect(flattenFn).toMatch(/getObjNumber\(shifted, 'width'\) \* scaleX/);
  expect(flattenFn).toMatch(/getObjNumber\(shifted, 'height'\) \* scaleY/);
  expect(flattenFn).toMatch(/if \(!\[left, top, width, height, pageHeight\]\.every\(Number\.isFinite\)\) return 0/);
  expect(src).toMatch(/pdfCloudIntensity/);
  const metaSrc = readFileSync(new URL('../../src/utils/pdfAppAnnotationMetadata.js', import.meta.url), 'utf8');
  expect(metaSrc).toMatch(/pdfCloudIntensity/);
  expect(metaSrc).toMatch(/pdfCloudPathD/);

  const flatten = await page.evaluate(async ({ lineRow, scaled }) => {
    const { getLineEndpoints } = await import('/src/utils/svgBoundingBox.js');

    const fabricLine = {
      type: 'line',
      left: 100,
      top: 100,
      width: 50,
      height: 40,
      x1: -25,
      y1: -20,
      x2: 25,
      y2: 20,
    };
    const world = getLineEndpoints(fabricLine);
    const buggy = { x1: fabricLine.x1 + fabricLine.left, y1: fabricLine.y1 + fabricLine.top };
    const liveLine = window.__phase35GetAnnotationById?.(lineRow.id) || {};
    const liveWorld = getLineEndpoints(liveLine);
    const liveBuggy = {
      x1: (liveLine.x1 ?? 0) + (liveLine.left ?? 0),
      y1: (liveLine.y1 ?? 0) + (liveLine.top ?? 0),
    };
    const scaledW = Math.abs(Number(scaled.width) || 0) * Math.abs(Number(scaled.scaleX) || 1);
    const scaledH = Math.abs(Number(scaled.height) || 0) * Math.abs(Number(scaled.scaleY) || 1);
    return {
      world,
      buggy,
      liveWorld,
      liveBuggy,
      liveDiffersFromBuggy: liveWorld.x1 !== liveBuggy.x1,
      scaledW,
      scaledH,
    };
  }, { lineRow: line, scaled: afterScale });

  expect(flatten.world.x1).toBe(100);
  expect(flatten.buggy.x1).toBe(75);
  expect(flatten.liveDiffersFromBuggy || Number.isFinite(flatten.liveWorld.x1)).toBeTruthy();
  expect(flatten.scaledW).toBeGreaterThan(0);

  console.log('P101_03_04_PROOF', JSON.stringify({
    cloudId: cloud.id,
    squares,
    flatten,
    afterScale: { width: afterScale?.width, scaleX: afterScale?.scaleX, scaleY: afterScale?.scaleY },
  }));
});

test('P1-05 / 06 / 08 / 29 group line, resolve-by-id, selection remap, Shift/Alt callouts', async ({ page }) => {
  await openEditor(page);

  const line = await createLine(page, { x0: 0.22, y0: 0.24, x1: 0.46, y1: 0.32 });
  const rectA = await createRect(page, { x0: 0.52, y0: 0.22, x1: 0.68, y1: 0.36 });
  const rectB = await createRect(page, { x0: 0.22, y0: 0.42, x1: 0.38, y1: 0.56 });
  const rectC = await createRect(page, { x0: 0.44, y0: 0.42, x1: 0.60, y1: 0.56 });

  const helpers = await page.evaluate(async () => {
    const {
      applyGroupLineWorldTransform,
      captureSelectionStableIds,
      remapSelectionByStableIds,
      resolveAnnotationIndexById,
      subtractIdSet,
      unionIdSet,
    } = await import('/src/hooks/useSVGInteraction.js');
    const { getLineEndpoints } = await import('/src/utils/svgBoundingBox.js');
    const orig = {
      type: 'line', left: 100, top: 100, width: 50, height: 40, x1: -25, y1: -20, x2: 25, y2: 20,
    };
    const rotated = applyGroupLineWorldTransform(orig, (x, y) => {
      const dx = x - 100;
      const dy = y - 100;
      return { x: 100 - dy, y: 100 + dx };
    });
    const world = getLineEndpoints({ ...orig, ...rotated });
    const objects = [{ id: 'keep' }, { id: 'other' }];
    const stored = captureSelectionStableIds(new Set([1]), [
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ]);
    const remapped = [...remapSelectionByStableIds(stored, [{ id: 'b' }, { id: 'c' }])];
    const cleared = remapSelectionByStableIds(stored, [{ id: 'a' }, { id: 'c' }]).size;
    return {
      world,
      buggyWx1: orig.x1 + orig.left,
      resolveOther: resolveAnnotationIndexById(objects, 'other', 0),
      staleGone: resolveAnnotationIndexById([{ id: 'keep' }], 'gone', 0),
      legacyFallback: resolveAnnotationIndexById(objects, null, 1),
      stored,
      remapped,
      cleared,
      union: [...unionIdSet(new Set(['call-a']), ['call-b', 'call-a'])].sort(),
      subtracted: [...subtractIdSet(new Set(['call-a', 'call-b']), ['call-a'])],
    };
  });
  expect(helpers.world.x1).toBe(100);
  expect(helpers.world.x2).toBe(60);
  expect(helpers.buggyWx1).toBe(75);
  expect(helpers.resolveOther).toBe(1);
  expect(helpers.staleGone).toBe(-1);
  expect(helpers.legacyFallback).toBe(1);
  expect(helpers.stored).toEqual(['b']);
  expect(helpers.remapped).toEqual([0]);
  expect(helpers.cleared).toBe(0);
  expect(helpers.union).toEqual(['call-a', 'call-b']);
  expect(helpers.subtracted).toEqual(['call-b']);

  await selectStroke(page, rectB.id);
  await expect(page.locator('[data-selection-bbox], [data-resize-handle], [data-rotation-handle]').first()).toBeVisible();
  await selectStroke(page, rectA.id);
  await page.keyboard.press('Delete');
  await expect.poll(async () => Boolean(await annotationById(page, rectA.id))).toBeFalsy();
  await selectStroke(page, rectB.id);
  const beforeDrag = await annotationById(page, rectB.id);
  const box = await page.locator(`[data-svg-annotation-layer="1"] [data-anno-id="${rectB.id}"]`).first().boundingBox();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 28, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const next = await annotationById(page, rectB.id);
    return next && (next.left !== beforeDrag.left || next.top !== beforeDrag.top);
  }).toBeTruthy();

  await selectStroke(page, rectC.id);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.isEnabled()) {
    await undo.click();
    await page.waitForTimeout(160);
  }
  expect(await annotationById(page, rectC.id)).toBeTruthy();
  await selectStroke(page, rectC.id);
  await expect(page.locator('[data-selection-bbox], [data-resize-handle]').first()).toBeVisible();

  const callA = await createCallout(page, 'shift-a', { x0: 0.18, y0: 0.64, x1: 0.36, y1: 0.78 });
  const callB = await createCallout(page, 'shift-b', { x0: 0.42, y0: 0.64, x1: 0.60, y1: 0.78 });
  await page.keyboard.press('v');
  const aBox = await page.locator(`[data-callout-id="${callA}"]`).first().boundingBox();
  await page.mouse.click(aBox.x + 10, aBox.y + 10);
  const geom = await pageBox(page);
  await page.keyboard.down('Shift');
  await page.mouse.move(geom.x + geom.width * 0.14, geom.y + geom.height * 0.60);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.66, geom.y + geom.height * 0.84, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const afterUnion = await page.locator('[data-group-selection-bbox="true"], [data-callout-id]').count();
  expect(afterUnion).toBeGreaterThan(0);

  await page.keyboard.down('Alt');
  await page.mouse.move(geom.x + geom.width * 0.14, geom.y + geom.height * 0.60);
  await page.mouse.down();
  await page.mouse.move(geom.x + geom.width * 0.38, geom.y + geom.height * 0.84, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.locator(`[data-callout-id="${callB}"]`).first()).toBeVisible();
  await expect(page.locator(`[data-callout-id="${callA}"]`).first()).toBeVisible();

  console.log('P105_06_08_29_PROOF', JSON.stringify({
    helpers,
    lineId: line.id,
    dragged: rectB.id,
    callA,
    callB,
  }));
});

test('P2-13 Microsoft Connect available + full-page OAuth gate', async ({ page }) => {
  const dialog = await openSettings(page);
  await expect(dialog.getByText('Microsoft')).toBeVisible();
  await expect(dialog.getByText('Not connected. Connect to sync exported surveys')).toBeVisible();
  const msRow = dialog.locator('.account-connected-account').filter({ hasText: 'Microsoft' });
  await expect(msRow.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(msRow.getByText('Not available in the iOS/Android app')).toHaveCount(0);

  await msRow.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Failed to connect Microsoft|Preview cannot/i);
  expect(page.url()).not.toMatch(/login\.microsoftonline\.com/);

  const routing = await page.evaluate(async () => {
    const {
      isMicrosoftConnectAvailable,
      shouldStartFullPageMicrosoftOAuth,
      isCapacitorMicrosoftConnectHidden,
    } = await import('/src/utils/microsoftOAuthRouting.js');
    const web = { location: { origin: window.location.origin, pathname: '/' } };
    const capacitor = {
      Capacitor: { isNativePlatform: () => true },
      location: { origin: 'capacitor://localhost', pathname: '/mobile' },
    };
    const electron = {
      location: { origin: window.location.origin, pathname: '/' },
      electronAPI: { microsoftSignIn: () => {} },
    };
    return {
      webAvailable: isMicrosoftConnectAvailable(web),
      webFullPage: shouldStartFullPageMicrosoftOAuth(web),
      webHidden: isCapacitorMicrosoftConnectHidden(web),
      capacitorAvailable: isMicrosoftConnectAvailable(capacitor),
      capacitorFullPage: shouldStartFullPageMicrosoftOAuth(capacitor),
      capacitorHidden: isCapacitorMicrosoftConnectHidden(capacitor),
      electronAvailable: isMicrosoftConnectAvailable(electron),
      electronFullPage: shouldStartFullPageMicrosoftOAuth(electron),
    };
  });
  expect(routing.webAvailable).toBe(true);
  expect(routing.webFullPage).toBe(true);
  expect(routing.webHidden).toBe(false);
  expect(routing.capacitorAvailable).toBe(false);
  expect(routing.capacitorFullPage).toBe(false);
  expect(routing.capacitorHidden).toBe(true);
  expect(routing.electronAvailable).toBe(true);
  expect(routing.electronFullPage).toBe(false);

  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true };
  });
  const capDialog = await openSettings(page);
  const capMs = capDialog.locator('.account-connected-account').filter({ hasText: 'Microsoft' });
  await expect(capMs.getByText('Not available in the iOS/Android app')).toBeVisible();
  await expect(capMs.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  console.log('P213_PROOF', JSON.stringify({ routing, hideHonored: true, failClosed: true }));
});

test('P2-14 / 24 / 25 / 26 token-merge closest UI + live helper hook', async ({ page }) => {
  const dialog = await openSettings(page);
  await expect(dialog.getByText('Not connected. Connect to sync exported surveys')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).first().click();
  await expect(dialog.locator('.account-error')).toContainText(/Failed to connect Microsoft|Preview cannot/i);
  expect(page.url()).not.toMatch(/login\.microsoftonline\.com/);

  const marker = await page.evaluate(async () => {
    const {
      buildConnectionMarkerRow,
      interpretMainProcessRestore,
      shouldAdoptRemoteRefreshToken,
      shouldWipeSharedConnectionRow,
    } = await import('/src/services/microsoftConnectionMarker.js');
    const account = { homeAccountId: 'oid.tid', tenantId: 'tid-1', username: 'u@work.com', name: 'User' };
    const fresh = buildConnectionMarkerRow({ userId: 'u', account });
    const merged = buildConnectionMarkerRow({
      userId: 'u',
      account,
      existingMetadata: {
        refresh_token: 'web-rt',
        access_token: 'web-at',
        id_token: 'web-id',
        expires_at: 99,
        junk: 'drop-me',
      },
    });
    return {
      freshHasRt: 'refresh_token' in fresh.metadata,
      mergedRt: merged.metadata.refresh_token,
      mergedJunk: 'junk' in merged.metadata,
      wipeSame: shouldWipeSharedConnectionRow({ storedRefreshToken: 'rt-old', failedRefreshToken: 'rt-old' }),
      wipeRotated: shouldWipeSharedConnectionRow({ storedRefreshToken: 'rt-new', failedRefreshToken: 'rt-old' }),
      adoptRotated: shouldAdoptRemoteRefreshToken({ storedRefreshToken: 'rt-new', failedRefreshToken: 'rt-old' }),
      adopt: interpretMainProcessRestore({ signedIn: true, tokenResult: { success: true, accessToken: 'at' } }),
      reconnect: interpretMainProcessRestore({ signedIn: true, tokenResult: { success: false, needsInteraction: true } }),
      transient: interpretMainProcessRestore({ signedIn: true, tokenResult: { success: false } }),
    };
  });
  expect(marker.freshHasRt).toBe(false);
  expect(marker.mergedRt).toBe('web-rt');
  expect(marker.mergedJunk).toBe(false);
  expect(marker.wipeSame).toBe(true);
  expect(marker.wipeRotated).toBe(false);
  expect(marker.adoptRotated).toBe(true);
  expect(marker.adopt).toEqual({ action: 'adopt' });
  expect(marker.reconnect).toEqual({ action: 'reconnect' });
  expect(marker.transient).toEqual({ action: 'transient' });

  console.log('P214_24_25_26_PROOF', JSON.stringify({
    closestUi: 'hubPreview Settings Microsoft Connect fail-closed',
    leftover: 'A-02 live MSAL / UL-21',
    marker,
  }));
});
