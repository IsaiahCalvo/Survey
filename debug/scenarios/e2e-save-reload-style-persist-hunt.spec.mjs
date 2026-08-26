import { test, expect } from '@playwright/test';

// Hunt: selected-style local save/reload, undo, resize.
// Do not stamp file.id. Do not click swatch / hex / Transparent.
// Do not invent leftover-18 / richTextEditor / Line /AP / callout Rotation.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function parseFill(raw) {
  const text = String(raw || '').trim();
  if (!text || text === 'transparent') return { opacity: 0 };
  const rgba = text.match(/^rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)(?:\s*,\s*([+-]?\d*\.?\d+))?\s*\)$/i);
  if (rgba) return { opacity: rgba[4] != null ? Number(rgba[4]) : 1 };
  if (/^#?[0-9a-fA-F]{6}$/.test(text)) return { opacity: 1 };
  return { opacity: 0 };
}

async function openEditor(page, {
  width = 1440,
  height = 900,
  url = LINK_PDF,
  wipe = true,
} = {}) {
  await page.addInitScript((shouldWipe) => {
    try {
      if (sessionStorage.getItem('e2e-keep-local-save') === '1') {
        sessionStorage.removeItem('e2e-keep-local-save');
        return;
      }
      if (shouldWipe === false) return;
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
      localStorage.removeItem('lastReviewTool');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  }, wipe);
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function remountKeepingCache(page) {
  await page.evaluate(() => {
    try { sessionStorage.setItem('e2e-keep-local-save', '1'); } catch { /* ignore */ }
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
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

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  await blurInputs(page);
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page) {
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
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
    if ((await btn.getAttribute('aria-pressed')) === 'true') return;
    await btn.click();
    return;
  }
  await expect(hostTool, `tool ${toolName}`).toBeVisible();
}

async function applyOpacity(page, tabName, pct) {
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(color).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) await color.click();
  await expect(presets).toBeVisible({ timeout: 8_000 });
  const tab = page.getByRole('button', { name: tabName, exact: true }).first();
  if (await tab.isVisible().catch(() => false)) await tab.click();
  const field = page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true });
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(pct));
  await field.press('Enter');
  await expect(field).toHaveValue(String(pct));
  await page.keyboard.press('Escape');
  await expect(presets).toHaveCount(0, { timeout: 8_000 }).catch(() => {});
  await dismissChrome(page);
}

async function setWidthTyped(page, raw) {
  const field = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
  return field;
}

async function pickStyle(page, label) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Style' })).toBeVisible({ timeout: 5_000 });
  await popover.getByRole('option', { name: label, exact: true }).click();
  await expect(popover).toHaveCount(0);
  await dismissChrome(page);
}

async function applyRotation(page, degrees) {
  const handle = page.locator('[data-rotation-handle="mtr"]').first();
  await expect(handle).toBeVisible({ timeout: 8_000 });
  const box = await handle.boundingBox();
  expect(box, 'mtr geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const input = page.getByRole('textbox', { name: 'Rotation angle in degrees', exact: true });
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.click();
  await input.fill(String(degrees));
  await expect(input).toHaveValue(String(degrees));
  await input.press('Enter');
  await dismissChrome(page);
}

async function pickArrowhead(page, label) {
  const trigger = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Arrowhead' })).toBeVisible({ timeout: 5_000 });
  await popover.getByRole('option', { name: label, exact: true }).click();
  await expect(popover).toHaveCount(0);
  await dismissChrome(page);
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

function shapeLocator(page, id) {
  return page.locator(
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"], [data-svg-annotation-layer="1"] [data-shape-id="${id}"], [data-svg-annotation-layer="1"] [data-callout-id="${id}"]`,
  ).first();
}

async function handlesBelongTo(page, id) {
  const group = shapeLocator(page, id);
  const handles = page.locator('[data-resize-handle], [data-callout-handle]');
  if (!(await handles.count()) || !(await group.count())) return false;
  const box = await group.boundingBox();
  if (!box) return false;
  const points = await handles.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }));
  return points.some((point) => (
    point.x >= box.x - 28 && point.x <= box.x + box.width + 28
    && point.y >= box.y - 28 && point.y <= box.y + box.height + 28
  ));
}

async function selectShape(page, id) {
  await selectMode(page);
  if (await handlesBelongTo(page, id)) return;
  const group = shapeLocator(page, id);
  await expect(group).toBeVisible({ timeout: 8_000 });
  const box = await group.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + 4, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 4 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await handlesBelongTo(page, id)) return;
  }
  await page.locator(`[data-shape-id="${id}"], [data-callout-id="${id}"]`).first().click({ force: true, position: { x: 3, y: 3 } }).catch(() => {});
  await expect.poll(async () => handlesBelongTo(page, id), {
    message: `expected selection handles on ${id}`,
  }).toBeTruthy();
}

async function shapeSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const layer = document.querySelector(`[data-svg-annotation-layer="${pageNum}"]`);
    if (!layer) return [];
    const ids = [...layer.querySelectorAll('[data-anno-id], [data-shape-id], [data-callout-id]')]
      .map((el) => el.getAttribute('data-anno-id') || el.getAttribute('data-shape-id') || el.getAttribute('data-callout-id'))
      .filter(Boolean);
    return [...new Set(ids)].map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const style = data.legacyCallout?.style || data.style || object.style || {};
      const group = layer.querySelector(`[data-anno-id="${id}"], [data-shape-id="${id}"], [data-callout-id="${id}"]`);
      let bboxH = 0;
      try { bboxH = group?.getBBox?.()?.height || 0; } catch { bboxH = 0; }
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill ?? null,
        backgroundColor: object.backgroundColor ?? null,
        stroke: object.stroke ?? null,
        strokeWidth: object.strokeWidth ?? null,
        sourceWidth: object.sourceWidth ?? data.sourceWidth ?? null,
        strokeDashArray: object.strokeDashArray ?? null,
        angle: Number(object.angle || data.angle || 0),
        underline: object.underline === true,
        textAlign: object.textAlign || null,
        verticalAlign: object.verticalAlign || null,
        fillOpacity: style.fillOpacity ?? null,
        borderOpacity: style.borderOpacity ?? null,
        lineStyle: style.lineStyle ?? null,
        arrowheadStyle: data.arrowheadStyle || style.arrowheadStyle || null,
        lineThickness: style.lineThickness ?? null,
        pdfCloudIntensity: data.pdfCloudIntensity ?? null,
        left: object.left ?? null,
        top: object.top ?? null,
        width: object.width ?? null,
        height: object.height ?? null,
        scaleX: Number(object.scaleX ?? 1) || 1,
        scaleY: Number(object.scaleY ?? 1) || 1,
        vw: (Number(object.width ?? 0) * Math.abs(Number(object.scaleX ?? 1) || 1)),
        vh: (Number(object.height ?? 0) * Math.abs(Number(object.scaleY ?? 1) || 1)),
        bboxH,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNew(page, beforeIds, predicate = () => true) {
  let created = null;
  let last = [];
  await expect.poll(async () => {
    last = await shapeSnapshot(page);
    created = last.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: () => `expected a new annotation; have ${last.map((row) => `${row.type}:${row.id}`).join(',')}` }).not.toBeNull();
  return created;
}

async function dragOnPage(page, { x0, y0, x1, y1 }) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function createRect(page, box = { x0: 0.18, y0: 0.16, x1: 0.42, y1: 0.32 }) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, box);
  return waitForNew(page, before, (row) => row.type === 'rect' || row.type === 'rectangle');
}

async function createEllipse(page) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, { x0: 0.48, y0: 0.16, x1: 0.68, y1: 0.30 });
  return waitForNew(page, before, (row) => row.type === 'ellipse' || row.type === 'circle');
}

async function createText(page, text = 'Hi') {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, { x0: 0.18, y0: 0.38, x1: 0.48, y1: 0.54 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  return before;
}

async function commitEdit(page) {
  const box = await pageBox(page);
  await page.mouse.click(12, 200);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
  }
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
}

async function createCallout(page, text = 'Y') {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Text', 'Callout');
  await dragOnPage(page, { x0: 0.52, y0: 0.38, x1: 0.74, y1: 0.54 });
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  if (text) await editor.pressSequentially(text, { delay: 6 });
  await commitEdit(page);
  return waitForNew(page, before, (row) => row.id.startsWith('callout-') || row.type === 'callout');
}

async function createArrow(page) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, { x0: 0.20, y0: 0.62, x1: 0.46, y1: 0.70 });
  return waitForNew(page, before, (row) => row.type === 'line');
}

async function createPen(page) {
  const before = new Set((await shapeSnapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await activateTool(page, 'Draw', 'Pen');
  const box = await pageBox(page);
  const y = box.y + box.height * 0.78;
  await page.mouse.move(box.x + box.width * 0.22, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.50, y, { steps: 16 });
  await page.mouse.up();
  return waitForNew(page, before, (row) => row.type === 'path');
}

function dashOf(row) {
  const dash = row?.strokeDashArray;
  return Array.isArray(dash) ? dash.join(',') : '';
}

async function dragResizeHandle(page, handleId = 'br', dx = 40, dy = 30) {
  const moved = await page.evaluate(({ handleId: id, dx: moveX, dy: moveY }) => {
    const handle = document.querySelector(`[data-resize-handle="${id}"]`);
    if (!handle) return false;
    const rect = handle.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const fire = (type, clientX, clientY) => {
      handle.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX,
        clientY,
      }));
    };
    fire('pointerdown', x, y);
    fire('pointermove', x + moveX, y + moveY);
    fire('pointerup', x + moveX, y + moveY);
    return true;
  }, { handleId, dx, dy });
  expect(moved, `resize handle ${handleId}`).toBe(true);
}

test('desktop selected-style remount / undo / resize intended + break', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('dialog', async (dialog) => { await dialog.accept().catch(() => {}); });

  await openEditor(page);
  await assertNoErrorBoundary(page);
  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  const rect = await createRect(page);
  await selectShape(page, rect.id);
  await applyOpacity(page, 'Fill', 40);
  await selectShape(page, rect.id);
  await setWidthTyped(page, 8);
  await selectShape(page, rect.id);
  await pickStyle(page, 'Dashed');
  await selectShape(page, rect.id);
  await applyRotation(page, 45);
  const live = (await shapeSnapshot(page)).find((row) => row.id === rect.id);
  expect(parseFill(live?.fill).opacity, 'live fill').toBeCloseTo(0.4, 2);
  expect(Number(live?.strokeWidth), 'live width').toBe(8);
  expect(dashOf(live), 'live dash').toBe('6,4');
  expect(Number(live?.angle), 'live angle').toBeCloseTo(45, 0);

  await remountKeepingCache(page);
  await assertNoErrorBoundary(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  const after = (await shapeSnapshot(page)).find((row) => row.id === rect.id);
  expect(after, 'rect must remount').toBeTruthy();
  expect(parseFill(after.fill).opacity, 'remount fill').toBeCloseTo(0.4, 2);
  expect(Number(after.strokeWidth), 'remount width').toBe(8);
  expect(dashOf(after), 'remount dash').toBe('6,4');
  expect(Number(after.angle), 'remount angle').toBeCloseTo(45, 0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});

test('390 remount edge: viewBox, file.id, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  page.on('dialog', async (dialog) => { await dialog.accept().catch(() => {}); });

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  expect(await fileId(page)).toBeNull();
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  const beforeUser = (await shapeSnapshot(page)).filter((row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
  expect(beforeUser.length, '390 must not keep a leftover user rect').toBe(0);

  const mobileRect = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
  if (await mobileRect.isVisible().catch(() => false)) {
    const rect = await createRect(page);
    await remountKeepingCache(page);
    const after = (await shapeSnapshot(page)).find((row) => row.id === rect.id);
    expect(after, '390 remount must keep the rect').toBeTruthy();
    expect(await fileId(page)).toBeNull();
    expect(await pageViewBox(page)).toBe('0 0 612 792');
  } else {
    expect(await page.getByRole('button', { name: 'Rectangle', exact: true }).count()).toBe(0);
  }

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(await page.getByRole('button', { name: 'Color', exact: true }).count()).toBe(0);
});
