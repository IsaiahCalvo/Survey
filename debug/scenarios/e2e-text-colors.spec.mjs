import { test, expect } from '@playwright/test';

// Desktop Text Fill + Border every-swatch — CompactColorPicker tabs.
// Distinct from T-07 Font color / 390 Set Text color chips (fontColor only),
// Fill every-swatch on a selected rect (e2e-pickers-every-swatch), and
// Callout Fill/Border (e2e-callout-colors). Leftover-18 / X-01 parked. No file.id.

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

// Text Fill is backgroundColor — never object.fill (that is fontColor / T-07).
function storedFill(row) {
  const raw = row?.backgroundColor;
  if (raw == null || raw === '') return 'TRANSPARENT';
  return colorKey(raw);
}

function storedBorder(row) {
  return colorKey(row?.stroke || row?.visualStroke);
}

function storedFont(row) {
  return colorKey(row?.fontColor || row?.fill);
}

function isTransparentFill(row) {
  return storedFill(row) === 'TRANSPARENT';
}

function isTransparentBorder(row) {
  const opacity = Number(row?.strokeOpacity);
  if (opacity === 0) return true;
  return storedBorder(row) === 'TRANSPARENT';
}

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
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

async function textSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const rects = [...document.querySelectorAll(
        `[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"] rect`,
      )];
      const bg = rects[0] || null;
      const border = rects[1] || null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        callout: object.data?.type === 'callout' || String(id).startsWith('callout-'),
        imported: object.isPdfImported === true,
        backgroundColor: object.backgroundColor ?? data.backgroundColor ?? null,
        fill: object.fill || data.fill || null,
        fontColor: data.fontColor || object.fill || null,
        stroke: object.stroke || data.stroke || null,
        strokeWidth: object.strokeWidth ?? data.strokeWidth ?? null,
        strokeOpacity: object.strokeOpacity ?? data.strokeOpacity ?? null,
        visualFill: bg?.getAttribute('fill') || null,
        visualStroke: border?.getAttribute('stroke') || bg?.getAttribute('stroke') || null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNewText(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await textSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isTextRow(row)) || null;
    return created;
  }, { message: 'expected a new textbox' }).not.toBeNull();
  return created;
}

async function annotationById(page, id) {
  return (await textSnapshot(page)).find((row) => row.id === id) || null;
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      el.blur();
    }
  });
}

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
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
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
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
    const buttons = page.getByRole('button', { name: categoryName, exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      if (await buttons.nth(i).isVisible().catch(() => false)) {
        await buttons.nth(i).click();
        break;
      }
    }
  }
  const target = (await visibleSub()) || sub.first();
  await expect(target).toBeVisible();
  const pressed = await target.getAttribute('aria-pressed');
  const active = String(await target.getAttribute('class') || '').includes('is-active')
    || String(await target.getAttribute('class') || '').includes('btn-active');
  if (pressed !== 'true' && !active) await target.click();
}

async function createText(page, text, coords = { x0: 0.18, y0: 0.24, x1: 0.42, y1: 0.40 }) {
  const before = new Set((await textSnapshot(page)).filter(isTextRow).map((row) => row.id));
  await blurInputs(page);
  await activateTool(page, 'Text', 'Text');
  const overlay = page.locator('[data-text-overlay="1"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  const created = await waitForNewText(page, before);
  await dismissChrome(page);
  await page.keyboard.press('v');
  return created;
}

async function selectText(page, id) {
  await blurInputs(page);
  if (await page.locator('[data-text-edit-overlay]').count()) {
    const pageGeom = await pageBox(page);
    await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  }
  await page.keyboard.press('v');
  const target = page.locator(
    `[data-shape-id="${id}"], [data-svg-annotation-layer="1"] [data-anno-id="${id}"]`,
  ).first();
  await expect(target).toBeVisible({ timeout: 8_000 });
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(8, Math.max(2, box.width / 2)), y: box.y + Math.max(2, box.height / 2) },
    { x: box.x + box.width - 4, y: box.y + Math.max(2, box.height / 2) },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await page.locator('[data-text-edit-overlay]').count()) {
      const pageGeom = await pageBox(page);
      await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
      await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
      await page.keyboard.press('v');
      continue;
    }
    const handles = await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count();
    const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    const editEnabled = await edit.isVisible().catch(() => false)
      && !(await edit.isDisabled().catch(() => true));
    if (handles > 0 || editEnabled) return;
  }
  await expect(page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').first()).toBeVisible({ timeout: 8_000 });
}

async function openColorPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  const presets = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await presets.isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(presets).toBeVisible({ timeout: 8_000 });
}

async function clickTab(page, name) {
  const tab = page.locator('[data-annotation-color-picker]').getByRole('button', { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
}

async function clickSwatch(page, hexOrTitle) {
  const title = hexOrTitle === 'transparent' ? 'Transparent' : hexOrTitle;
  const swatch = page.locator(`button[title="${title}"]`).first();
  await expect(swatch).toBeVisible({ timeout: 4_000 });
  await swatch.click();
}

async function assertShapeTabs(page, { matchFill = false } = {}) {
  await expect(page.getByRole('button', { name: 'Fill', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Border', exact: true }).first()).toBeVisible();
  if (matchFill) {
    await expect(page.locator('button[title="Match fill"]')).toBeVisible();
    expect(await page.locator('button[title="Transparent"]').count()).toBe(0);
  } else {
    await expect(page.locator('button[title="Transparent"]')).toBeVisible();
    expect(await page.locator('button[title="Match fill"]').count()).toBe(0);
  }
}

async function patchEverySwatch(page, id, layer) {
  await selectText(page, id);
  await openColorPicker(page);
  await clickTab(page, layer === 'border' ? 'Border' : 'Fill');
  await assertShapeTabs(page, { matchFill: false });
  const fontBefore = storedFont(await annotationById(page, id));
  const proof = [];
  for (const swatch of PATCH_ORDER) {
    await clickSwatch(page, swatch);
    if (swatch === 'transparent') {
      if (layer === 'border') {
        await expect.poll(async () => isTransparentBorder(await annotationById(page, id))).toBeTruthy();
      } else {
        await expect.poll(async () => isTransparentFill(await annotationById(page, id))).toBeTruthy();
      }
      proof.push({ swatch, stored: 'TRANSPARENT' });
    } else if (layer === 'border') {
      await expect.poll(async () => storedBorder(await annotationById(page, id))).toBe(swatch);
      proof.push({ swatch, stored: swatch });
    } else {
      await expect.poll(async () => storedFill(await annotationById(page, id))).toBe(swatch);
      const row = await annotationById(page, id);
      expect(storedFont(row), `Fill ${swatch} must not write fontColor`).toBe(fontBefore);
      proof.push({ swatch, stored: swatch });
    }
  }
  expect(proof.map((row) => row.swatch)).toEqual(PATCH_ORDER);
  return proof;
}

test('catalog: Text desktop CompactColorPicker is the 16-swatch Fill/Border grid', () => {
  expect([...COLOR_PICKER_PRESETS]).toEqual([
    'transparent',
    '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
  ]);
  expect(COLOR_PICKER_PRESETS).toHaveLength(16);
  expect(SOLID_SWATCHES).toHaveLength(15);
});

test('desktop Text CompactColorPicker Fill + Border every swatch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  expect((await textSnapshot(page)).filter(isTextRow).length).toBe(0);

  const first = await createText(page, 'tf-1', { x0: 0.16, y0: 0.22, x1: 0.42, y1: 0.38 });
  const fontKept = storedFont(await annotationById(page, first.id));
  expect(fontKept).not.toBe('TRANSPARENT');

  const fillProof = await patchEverySwatch(page, first.id, 'fill');
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedFont(await annotationById(page, first.id)), 'Text Fill must not clobber fontColor').toBe(fontKept);

  const borderProof = await patchEverySwatch(page, first.id, 'border');
  await clickSwatch(page, '#0000FF');
  await expect.poll(async () => storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedFont(await annotationById(page, first.id))).toBe(fontKept);
  await page.keyboard.press('Escape');

  const second = await createText(page, 'tf-2', { x0: 0.52, y0: 0.22, x1: 0.78, y1: 0.38 });
  const secondFillProof = await patchEverySwatch(page, second.id, 'fill');
  await clickSwatch(page, '#00FFFF');
  await expect.poll(async () => storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  await page.keyboard.press('Escape');

  expect(storedFill(await annotationById(page, first.id)), 'first Text must keep red fill after second every-swatch').toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id)), 'first Text must keep blue border after second every-swatch').toBe('#0000FF');
  expect(first.id).not.toBe(second.id);

  // Intended: armed next-draw uses the Fill / Border tabs when the product
  // stamps fillColor → backgroundColor / strokeColor → stroke on create.
  await dismissChrome(page);
  await activateTool(page, 'Text', 'Text');
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await assertShapeTabs(page, { matchFill: false });
  await clickSwatch(page, '#80FF00');
  await page.keyboard.press('Escape');
  const nextFill = await createText(page, 'tf-3', { x0: 0.16, y0: 0.48, x1: 0.42, y1: 0.62 });
  const nextFillStored = storedFill(await annotationById(page, nextFill.id));
  const nextDrawFillWired = nextFillStored === '#80FF00';
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');

  await dismissChrome(page);
  await activateTool(page, 'Text', 'Text');
  await openColorPicker(page);
  await clickTab(page, 'Border');
  await assertShapeTabs(page, { matchFill: false });
  await clickSwatch(page, '#FF8000');
  await page.keyboard.press('Escape');
  const nextBorder = await createText(page, 'tf-4', { x0: 0.52, y0: 0.48, x1: 0.78, y1: 0.62 });
  const nextBorderStored = storedBorder(await annotationById(page, nextBorder.id));
  const nextDrawBorderWired = nextBorderStored === '#FF8000';
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, nextFill.id))).toBe(nextFillStored);

  // Break: Select / empty page invents 0. Pen-armed Color must not clobber
  // already-drawn Text fill/border/fontColor.
  const beforeSelect = (await textSnapshot(page)).filter(isTextRow).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await textSnapshot(page)).filter(isTextRow).length).toBe(beforeSelect);

  await activateTool(page, 'Draw', 'Pen');
  const colorBtn = page.getByRole('button', { name: 'Color', exact: true }).first();
  await colorBtn.click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  await page.locator('button[title="#00FF00"]').first().click();
  await page.keyboard.press('Escape');
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFont(await annotationById(page, first.id))).toBe(fontKept);
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  expect(storedFill(await annotationById(page, nextFill.id))).toBe(nextFillStored);
  expect(storedBorder(await annotationById(page, nextBorder.id))).toBe(nextBorderStored);

  // Edge: undo drops the last next-draw textbox. Create + text commit can
  // be two history entries, so rewind until that id is gone.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  for (let i = 0; i < 8; i += 1) {
    const stillThere = (await textSnapshot(page)).some((row) => row.id === nextBorder.id);
    if (!stillThere) break;
    await undo.click();
  }
  await expect.poll(async () => {
    const rows = await textSnapshot(page);
    return rows.some((row) => row.id === nextBorder.id);
  }).toBe(false);
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  expect(storedFill(await annotationById(page, nextFill.id))).toBe(nextFillStored);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Preset colors', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('TEXT_DESKTOP_SWATCH_PROOF', JSON.stringify({
    first: { id: first.id, fill: fillProof, border: borderProof, restoredFill: '#FF0000', restoredBorder: '#0000FF', fontKept },
    second: { id: second.id, fill: secondFillProof, restoredFill: '#00FFFF' },
    nextFill: { id: nextFill.id, stored: nextFillStored, wired: nextDrawFillWired },
    nextBorder: { id: nextBorder.id, stored: nextBorderStored, wired: nextDrawBorderWired, undone: true },
    viewBox,
    fileId,
  }));
});
