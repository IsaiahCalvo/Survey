import { test, expect } from '@playwright/test';

// Counter Fill + Number every-swatch — CompactColorPicker tabs + 390
// Fill/Stroke chips. Distinct from pickers-every-swatch (single selected
// pin, no isolation / next-draw / 390), Size/Start, series Delete, nubbin,
// Continue pin, and Continue Count. Leftover-18 / X-01 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const COLOR_PICKER_PRESETS = [
  'transparent',
  '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
  '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
];

const SOLID_SWATCHES = COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent');
const PATCH_ORDER = [...SOLID_SWATCHES, 'transparent'];

const MOBILE_ANNOTATION_COLORS = [
  '#ff0000',
  '#4A90E2',
  '#27C07D',
  '#F4D35E',
  '#ffffff',
  '#1e293b',
  '#C7A7FF',
  '#FF8A3D',
  '#000000',
];

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

function storedFill(row) {
  return colorKey(row?.fill || row?.visualFill);
}

function storedNumber(row) {
  return colorKey(row?.numberColor || row?.visualNumber);
}

function isTransparentFill(row) {
  const opacity = Number(row?.fillOpacity ?? row?.opacity ?? 1);
  if (opacity === 0) return true;
  return storedFill(row) === 'TRANSPARENT';
}

function isTransparentNumber(row) {
  const opacity = Number(row?.strokeOpacity ?? 1);
  if (opacity === 0) return true;
  return storedNumber(row) === 'TRANSPARENT';
}

function isCounterRow(row) {
  return row.tool === 'counter'
    || row.type.includes('counter')
    || row.type === 'circle'
    || row.type === 'group'
    || !row.type;
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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const overlayIds = [...document.querySelectorAll(`[data-counter-overlay="${pageNum}"] [data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const layerIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const ids = [...new Set([...overlayIds, ...layerIds])];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const host = document.querySelector(`[data-counter-overlay="${pageNum}"] [data-anno-id="${id}"]`)
        || document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const visualFill = host?.querySelector('path, circle')?.getAttribute('fill') || null;
      const visualNumber = host?.querySelector('text')?.getAttribute('fill') || null;
      return {
        id,
        type: String(object.type || data.type || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        seriesId: data.seriesId || null,
        displayNumber: Number(data.displayNumber ?? host?.querySelector('text')?.textContent || 0),
        createdAt: data.createdAt ?? null,
        fill: object.fill || data.fill || visualFill || null,
        numberColor: data.numberColor || visualNumber || null,
        visualFill,
        visualNumber,
        fillOpacity: object.fillOpacity ?? data.fillOpacity ?? null,
        strokeOpacity: object.strokeOpacity ?? data.strokeOpacity ?? null,
        opacity: object.opacity ?? data.opacity ?? null,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function counterSnapshot(page) {
  return (await userAnnotationSnapshot(page))
    .filter(isCounterRow)
    .sort((a, b) => {
      const at = a.createdAt || 0;
      const bt = b.createdAt || 0;
      if (at !== bt) return at - bt;
      return (a.displayNumber || 0) - (b.displayNumber || 0);
    });
}

async function annotationById(page, id) {
  return (await counterSnapshot(page)).find((row) => row.id === id) || null;
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if (!(String(await sub.first().getAttribute('class') || '').includes('btn-active'))) {
      await sub.first().click();
    }
    return;
  }
  const buttons = page.getByRole('button', { name: categoryName, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    if (await buttons.nth(i).isVisible().catch(() => false)) {
      await buttons.nth(i).click();
      break;
    }
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if (!(String(await target.getAttribute('class') || '').includes('btn-active'))) {
    await target.click();
  }
}

async function activateCounter(page) {
  await activateTool(page, 'Shapes', 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
}

async function dropCounterPin(page, { xf = 0.40, yf = 0.36 } = {}) {
  const overlay = page.locator('[data-counter-overlay="1"]');
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(200);
  const box = await overlay.boundingBox();
  expect(box, 'counter overlay geometry').toBeTruthy();
  const start = { x: box.x + box.width * xf, y: box.y + box.height * yf };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 4 });
  await page.mouse.up();
}

async function dropPin(page, coords) {
  await activateCounter(page);
  const before = new Set((await counterSnapshot(page)).map((row) => row.id));
  await dropCounterPin(page, coords);
  let created = null;
  await expect.poll(async () => {
    const rows = await counterSnapshot(page);
    created = rows.find((row) => !before.has(row.id) && isCounterRow(row)) || null;
    return created;
  }, { message: `expected a new counter pin at ${JSON.stringify(coords)}` }).not.toBeNull();
  return created;
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

async function openColorPicker(page) {
  await activateCounter(page);
  const trigger = page.getByRole('button', { name: 'Counter colors', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  const picker = page.locator('[data-annotation-color-picker]');
  if (!(await picker.isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(picker).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
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

async function assertCounterTabs(page) {
  await expect(page.getByRole('button', { name: 'Fill', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Number', exact: true }).first()).toBeVisible();
  expect(await page.getByRole('button', { name: 'Border', exact: true }).count()).toBe(0);
  await expect(page.locator('button[title="Transparent"]')).toBeVisible();
  expect(await page.locator('button[title="Match fill"]').count()).toBe(0);
}

async function patchEverySwatch(page, id, layer) {
  await openColorPicker(page);
  await clickTab(page, layer === 'number' ? 'Number' : 'Fill');
  await assertCounterTabs(page);
  const proof = [];
  for (const swatch of PATCH_ORDER) {
    await clickSwatch(page, swatch);
    if (swatch === 'transparent') {
      if (layer === 'number') {
        await expect.poll(async () => isTransparentNumber(await annotationById(page, id))).toBeTruthy();
      } else {
        await expect.poll(async () => isTransparentFill(await annotationById(page, id))).toBeTruthy();
      }
      proof.push({ swatch, stored: 'TRANSPARENT' });
    } else if (layer === 'number') {
      await expect.poll(async () => storedNumber(await annotationById(page, id))).toBe(swatch);
      proof.push({ swatch, stored: swatch });
    } else {
      await expect.poll(async () => storedFill(await annotationById(page, id))).toBe(swatch);
      proof.push({ swatch, stored: swatch });
    }
  }
  expect(proof.map((row) => row.swatch)).toEqual(PATCH_ORDER);
  return proof;
}

async function openSeriesMenu(page) {
  const seriesBtn = page.getByRole('button', { name: 'Counter series' })
    .or(page.locator('[data-mobile-tool-properties="true"] button[aria-expanded]').first());
  await expect(seriesBtn.first()).toBeVisible({ timeout: 8_000 });
  await seriesBtn.first().click();
  const menu = page.locator('[data-annotation-dropdown-popover="true"][data-counter-series-menu="true"]')
    .or(page.locator('.mobile-pdf-properties__menu'));
  await expect(menu.first()).toBeVisible({ timeout: 8_000 });
  return menu.first();
}

async function clickNewCount(page) {
  const menu = await openSeriesMenu(page);
  const neu = menu.getByRole('button', { name: '+ New Count', exact: true });
  await expect(neu).toBeVisible({ timeout: 8_000 });
  await neu.click();
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible();
}

async function openCounterSheet(page, section = 'fill') {
  await activateCounter(page);
  const trigger = page.getByRole('button', { name: 'Counter colors', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  const chipName = section === 'fill'
    ? `Set Fill color ${MOBILE_ANNOTATION_COLORS[0]}`
    : `Set Stroke color ${MOBILE_ANNOTATION_COLORS[0]}`;
  if (!(await page.getByRole('button', { name: chipName, exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: chipName, exact: true })).toBeVisible({ timeout: 8_000 });
  const tab = page.getByRole('tab', { name: section === 'fill' ? 'Fill color' : 'Stroke color' });
  if (await tab.isVisible().catch(() => false)) {
    const selected = await tab.getAttribute('aria-selected');
    if (selected !== 'true') await tab.click();
  }
}

async function closeCounterSheet(page) {
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', { name: `Set Fill color ${MOBILE_ANNOTATION_COLORS[0]}`, exact: true })).toHaveCount(0);
}

test('catalog: Counter desktop CompactColorPicker is the 16-swatch Fill/Number grid', () => {
  expect([...COLOR_PICKER_PRESETS]).toEqual([
    'transparent',
    '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
  ]);
  expect(COLOR_PICKER_PRESETS).toHaveLength(16);
  expect(SOLID_SWATCHES).toHaveLength(15);
});

test('desktop Counter CompactColorPicker Fill + Number every swatch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  expect((await counterSnapshot(page)).length).toBe(0);

  const first = await dropPin(page, { xf: 0.28, yf: 0.30 });
  const sibling = await dropPin(page, { xf: 0.42, yf: 0.30 });
  expect(first.seriesId).toBeTruthy();
  expect(sibling.seriesId).toBe(first.seriesId);
  expect(first.id).not.toBe(sibling.id);

  const fillProof = await patchEverySwatch(page, first.id, 'fill');
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  await expect.poll(async () => storedFill(await annotationById(page, sibling.id))).toBe('#FF0000');

  const numberProof = await patchEverySwatch(page, first.id, 'number');
  await clickSwatch(page, '#0000FF');
  await expect.poll(async () => storedNumber(await annotationById(page, first.id))).toBe('#0000FF');
  await expect.poll(async () => storedNumber(await annotationById(page, sibling.id))).toBe('#0000FF');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  await expect.poll(async () => storedFill(await annotationById(page, sibling.id))).toBe('#FF0000');
  await page.keyboard.press('Escape');

  await clickNewCount(page);
  const second = await dropPin(page, { xf: 0.62, yf: 0.30 });
  expect(second.seriesId).toBeTruthy();
  expect(second.seriesId).not.toBe(first.seriesId);

  const secondFillProof = await patchEverySwatch(page, second.id, 'fill');
  await clickSwatch(page, '#00FFFF');
  await expect.poll(async () => storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  await page.keyboard.press('Escape');

  expect(storedFill(await annotationById(page, first.id)), 'series A fill stays red after series B every-swatch').toBe('#FF0000');
  expect(storedNumber(await annotationById(page, first.id)), 'series A number stays blue after series B every-swatch').toBe('#0000FF');
  expect(storedFill(await annotationById(page, sibling.id))).toBe('#FF0000');
  expect(storedNumber(await annotationById(page, sibling.id))).toBe('#0000FF');

  await dismissChrome(page);
  await clickNewCount(page);
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await assertCounterTabs(page);
  await clickSwatch(page, '#80FF00');
  await clickTab(page, 'Number');
  await clickSwatch(page, '#FF8000');
  await page.keyboard.press('Escape');
  const nextDraw = await dropPin(page, { xf: 0.28, yf: 0.52 });
  await expect.poll(async () => storedFill(await annotationById(page, nextDraw.id))).toBe('#80FF00');
  await expect.poll(async () => storedNumber(await annotationById(page, nextDraw.id))).toBe('#FF8000');
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedNumber(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  expect(nextDraw.seriesId).not.toBe(first.seriesId);
  expect(nextDraw.seriesId).not.toBe(second.seriesId);

  const beforeSelect = (await counterSnapshot(page)).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await counterSnapshot(page)).length).toBe(beforeSelect);

  await activateTool(page, 'Draw', 'Pen');
  const colorBtn = page.getByRole('button', { name: 'Color', exact: true }).first();
  await colorBtn.click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Number', exact: true }).count()).toBe(0);
  await page.locator('button[title="#00FF00"]').first().click();
  await page.keyboard.press('Escape');
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedNumber(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, sibling.id))).toBe('#FF0000');
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  expect(storedFill(await annotationById(page, nextDraw.id))).toBe('#80FF00');
  expect(storedNumber(await annotationById(page, nextDraw.id))).toBe('#FF8000');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await counterSnapshot(page);
    return rows.some((row) => row.id === nextDraw.id);
  }).toBe(false);
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedNumber(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Preset colors', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('COUNTER_DESKTOP_SWATCH_PROOF', JSON.stringify({
    first: { id: first.id, seriesId: first.seriesId, fill: fillProof, number: numberProof, restoredFill: '#FF0000', restoredNumber: '#0000FF' },
    sibling: { id: sibling.id, seriesId: sibling.seriesId, fill: '#FF0000', number: '#0000FF' },
    second: { id: second.id, seriesId: second.seriesId, fill: secondFillProof, restoredFill: '#00FFFF' },
    nextDraw: { id: nextDraw.id, storedFill: '#80FF00', storedNumber: '#FF8000', undone: true },
    viewBox,
    fileId,
  }));
});

test('390 Counter Fill + Stroke chips every hex intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const closePages = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await closePages.isVisible().catch(() => false)) {
    await closePages.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }

  expect((await counterSnapshot(page)).length).toBe(0);
  const pin = await dropPin(page, { xf: 0.34, yf: 0.32 });
  const fillProof = [];
  for (const color of MOBILE_ANNOTATION_COLORS) {
    await openCounterSheet(page, 'fill');
    await expect(page.getByRole('button', { name: `Set Fill color ${color}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Set Fill color ${color}`, exact: true }).click();
    await expect.poll(async () => storedFill(await annotationById(page, pin.id))).toBe(colorKey(color));
    fillProof.push({ chip: color, stored: colorKey(color) });
    await closeCounterSheet(page);
  }
  expect(fillProof.map((row) => row.chip)).toEqual([...MOBILE_ANNOTATION_COLORS]);

  const numberProof = [];
  for (const color of MOBILE_ANNOTATION_COLORS) {
    await openCounterSheet(page, 'stroke');
    await expect(page.getByRole('button', { name: `Set Stroke color ${color}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Set Stroke color ${color}`, exact: true }).click();
    await expect.poll(async () => storedNumber(await annotationById(page, pin.id))).toBe(colorKey(color));
    numberProof.push({ chip: color, stored: colorKey(color) });
    await closeCounterSheet(page);
  }
  expect(numberProof.map((row) => row.chip)).toEqual([...MOBILE_ANNOTATION_COLORS]);
  expect(storedFill(await annotationById(page, pin.id))).toBe(colorKey(MOBILE_ANNOTATION_COLORS[8]));

  await openCounterSheet(page, 'fill');
  await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await page.locator('button[title="#0000FF"]').first().click();
  await page.keyboard.press('Escape');
  await closeCounterSheet(page);
  await expect.poll(async () => storedFill(await annotationById(page, pin.id))).toBe('#0000FF');

  await clickNewCount(page);
  const isolated = await dropPin(page, { xf: 0.62, yf: 0.32 });
  expect(isolated.seriesId).not.toBe(pin.seriesId);
  await openCounterSheet(page, 'fill');
  await page.getByRole('button', { name: `Set Fill color ${MOBILE_ANNOTATION_COLORS[2]}`, exact: true }).click();
  await closeCounterSheet(page);
  await expect.poll(async () => storedFill(await annotationById(page, isolated.id))).toBe(colorKey(MOBILE_ANNOTATION_COLORS[2]));
  expect(storedFill(await annotationById(page, pin.id))).toBe('#0000FF');
  expect(storedNumber(await annotationById(page, pin.id))).toBe(colorKey(MOBILE_ANNOTATION_COLORS[8]));

  const beforeSelect = (await counterSnapshot(page)).length;
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await counterSnapshot(page)).length).toBe(beforeSelect);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await counterSnapshot(page);
    return rows.some((row) => row.id === isolated.id);
  }).toBe(false);
  expect(storedFill(await annotationById(page, pin.id))).toBe('#0000FF');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  const desktopChips = {};
  for (const color of MOBILE_ANNOTATION_COLORS) {
    desktopChips[color] = await page.getByRole('button', { name: `Set Fill color ${color}`, exact: true }).count();
  }
  expect(desktopChips['#4A90E2'], 'desktop must not mount the 390 Counter chip catalog').toBe(0);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: `Set Fill color ${MOBILE_ANNOTATION_COLORS[2]}`, exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('COUNTER_390_SWATCH_PROOF', JSON.stringify({
    pin: { id: pin.id, fill: fillProof, number: numberProof, compactFill: '#0000FF' },
    isolated: { id: isolated.id, stored: colorKey(MOBILE_ANNOTATION_COLORS[2]), undone: true },
    desktopChips,
    viewBox,
    fileId,
  }));
});
