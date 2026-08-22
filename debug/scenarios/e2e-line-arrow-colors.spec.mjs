import { test, expect } from '@playwright/test';

// Line/Arrow desktop every-swatch — CompactColorPicker stroke Color.
// Distinct from Pen select-and-patch (e2e-pickers-every-swatch), Highlighter
// every-swatch, C-02 hex lengths, and S-03/S-04 handles. Leftover-18 / X-01
// parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const COLOR_PICKER_PRESETS = [
  'transparent',
  '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
  '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
];

const SOLID_SWATCHES = COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent');
const PATCH_ORDER = [...SOLID_SWATCHES, 'transparent'];

function colorKey(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s || s === 'NONE' || s === 'TRANSPARENT') return 'TRANSPARENT';
  const rgba = s.match(/RGBA?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?/);
  if (rgba) {
    const alpha = rgba[4] == null ? 1 : Number(rgba[4]);
    if (alpha === 0) return 'TRANSPARENT';
    return `#${[rgba[1], rgba[2], rgba[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  if (s.startsWith('#')) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
  return s;
}

function storedStroke(row) {
  return colorKey(row?.stroke || row?.visualStroke || row?.computedStroke);
}

function isTransparentStroke(row) {
  const opacity = Number(row?.opacity ?? row?.strokeOpacity ?? 1);
  if (opacity === 0) return true;
  return storedStroke(row) === 'TRANSPARENT';
}

function isLineRow(row) {
  return row.tool === 'line' || (row.type === 'line' && row.tool !== 'arrow');
}

function isArrowRow(row) {
  return row.tool === 'arrow' || row.type === 'arrow';
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

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return button;
    }
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click();
  return buttons.first();
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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const style = data.style || {};
      const visual = document.querySelector(`[data-shape-id="${id}"]`);
      const computedVisual = visual ? getComputedStyle(visual) : null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        stroke: object.stroke || data.stroke || data.borderColor || style.borderColor || visual?.getAttribute('stroke') || null,
        opacity: object.opacity ?? data.opacity ?? style.opacity ?? null,
        strokeOpacity: object.strokeOpacity ?? data.strokeOpacity ?? style.strokeOpacity ?? null,
        arrowheadStyle: data.arrowheadStyle || style.arrowheadStyle || object.arrowheadStyle || null,
        visualStroke: visual?.getAttribute('stroke') || null,
        computedStroke: computedVisual?.stroke || null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNewUserAnnotation(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user annotation' }).not.toBeNull();
  return created;
}

async function annotationById(page, id) {
  return (await userAnnotationSnapshot(page)).find((row) => row.id === id) || null;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.getByRole('button', { name: toolName, exact: true });
  const visibleSub = async () => {
    const count = await sub.count();
    for (let i = 0; i < count; i += 1) {
      if (await sub.nth(i).isVisible().catch(() => false)) return sub.nth(i);
    }
    return null;
  };
  if (!(await visibleSub())) {
    await clickVisible(page, categoryName);
  }
  const target = (await visibleSub()) || sub.first();
  await expect(target).toBeVisible();
  const pressed = await target.getAttribute('aria-pressed');
  const active = String(await target.getAttribute('class') || '').includes('is-active')
    || String(await target.getAttribute('class') || '').includes('btn-active');
  if (pressed !== 'true' && !active) await target.click();
}

async function dismissChrome(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await pagesToggle.isVisible().catch(() => false)) {
    const expanded = await page.getByText('No documents yet').isVisible().catch(() => false);
    if (expanded) await pagesToggle.click();
  }
}

async function selectStroke(page, id) {
  await page.keyboard.press('v');
  const target = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer] [data-anno-id="${id}"]`).first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(6, Math.max(2, box.width / 2)), y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + box.width - 3, y: box.y + Math.max(2, box.height / 2) },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    const selected = await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count();
    const chrome = await page.getByRole('button', { name: /^(Color|Counter colors|Edit text)$/ }).count();
    if (selected > 0 || chrome > 0) return;
  }
}

async function openColorPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
}

async function clickSwatch(page, hexOrTitle) {
  const title = hexOrTitle === 'transparent' ? 'Transparent' : hexOrTitle;
  const swatch = page.locator(`button[title="${title}"]`).first();
  await expect(swatch).toBeVisible({ timeout: 4_000 });
  await swatch.click();
}

async function createLine(page, coords = { x0: 0.18, y0: 0.28, x1: 0.42, y1: 0.36 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isLineRow);
}

async function createArrow(page, coords = { x0: 0.52, y0: 0.28, x1: 0.76, y1: 0.36 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isArrowRow);
}

async function patchEverySwatch(page, id) {
  await selectStroke(page, id);
  await openColorPicker(page);
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Border', exact: true }).count()).toBe(0);
  const proof = [];
  for (const swatch of PATCH_ORDER) {
    await clickSwatch(page, swatch);
    if (swatch === 'transparent') {
      await expect.poll(async () => isTransparentStroke(await annotationById(page, id))).toBeTruthy();
      proof.push({ swatch, stored: 'TRANSPARENT' });
    } else {
      await expect.poll(async () => storedStroke(await annotationById(page, id))).toBe(swatch);
      proof.push({ swatch, stored: swatch });
    }
  }
  expect(proof.map((row) => row.swatch)).toEqual(PATCH_ORDER);
  return proof;
}

test('catalog: Line/Arrow desktop CompactColorPicker is the 16-swatch stroke grid', () => {
  expect([...COLOR_PICKER_PRESETS]).toEqual([
    'transparent',
    '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
  ]);
  expect(COLOR_PICKER_PRESETS).toHaveLength(16);
  expect(SOLID_SWATCHES).toHaveLength(15);
});

test('desktop Line/Arrow CompactColorPicker every swatch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  expect((await userAnnotationSnapshot(page)).filter((row) => isLineRow(row) || isArrowRow(row)).length).toBe(0);

  const line = await createLine(page, { x0: 0.16, y0: 0.26, x1: 0.40, y1: 0.34 });
  const lineProof = await patchEverySwatch(page, line.id);
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedStroke(await annotationById(page, line.id))).toBe('#FF0000');
  await page.keyboard.press('Escape');

  const arrow = await createArrow(page, { x0: 0.52, y0: 0.26, x1: 0.78, y1: 0.34 });
  const arrowProof = await patchEverySwatch(page, arrow.id);
  await clickSwatch(page, '#0000FF');
  await expect.poll(async () => storedStroke(await annotationById(page, arrow.id))).toBe('#0000FF');
  await page.keyboard.press('Escape');

  expect(storedStroke(await annotationById(page, line.id)), 'Line must keep red after Arrow every-swatch').toBe('#FF0000');
  expect(line.id).not.toBe(arrow.id);

  // Intended: armed next-draw uses the stroke Color picker.
  await activateTool(page, 'Shapes', 'Line');
  await openColorPicker(page);
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  await clickSwatch(page, '#80FF00');
  await page.keyboard.press('Escape');
  const nextLine = await createLine(page, { x0: 0.16, y0: 0.44, x1: 0.40, y1: 0.50 });
  await expect.poll(async () => storedStroke(await annotationById(page, nextLine.id))).toBe('#80FF00');
  expect(storedStroke(await annotationById(page, line.id))).toBe('#FF0000');

  await activateTool(page, 'Shapes', 'Arrow');
  await openColorPicker(page);
  await clickSwatch(page, '#FF8000');
  await page.keyboard.press('Escape');
  const nextArrow = await createArrow(page, { x0: 0.52, y0: 0.44, x1: 0.78, y1: 0.50 });
  await expect.poll(async () => storedStroke(await annotationById(page, nextArrow.id))).toBe('#FF8000');
  expect(storedStroke(await annotationById(page, arrow.id))).toBe('#0000FF');
  expect(storedStroke(await annotationById(page, nextLine.id))).toBe('#80FF00');

  // Break: Select / empty page invents 0. Pen-armed Color must not clobber
  // already-drawn Line/Arrow strokes.
  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);

  await activateTool(page, 'Draw', 'Pen');
  const colorBtn = page.getByRole('button', { name: 'Color', exact: true }).first();
  await colorBtn.click();
  await page.locator('button[title="#00FF00"]').first().click();
  await page.keyboard.press('Escape');
  expect(storedStroke(await annotationById(page, line.id))).toBe('#FF0000');
  expect(storedStroke(await annotationById(page, arrow.id))).toBe('#0000FF');
  expect(storedStroke(await annotationById(page, nextLine.id))).toBe('#80FF00');
  expect(storedStroke(await annotationById(page, nextArrow.id))).toBe('#FF8000');

  // Edge: undo drops the last next-draw arrow; prior Line/Arrow stay.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === nextArrow.id);
  }).toBe(false);
  expect(storedStroke(await annotationById(page, line.id))).toBe('#FF0000');
  expect(storedStroke(await annotationById(page, arrow.id))).toBe('#0000FF');
  expect(storedStroke(await annotationById(page, nextLine.id))).toBe('#80FF00');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Preset colors', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('LINE_ARROW_DESKTOP_SWATCH_PROOF', JSON.stringify({
    line: { id: line.id, proof: lineProof, restored: '#FF0000' },
    arrow: { id: arrow.id, proof: arrowProof, restored: '#0000FF' },
    nextLine: { id: nextLine.id, stored: '#80FF00' },
    nextArrow: { id: nextArrow.id, stored: '#FF8000', undone: true },
    viewBox,
    fileId,
  }));
});
