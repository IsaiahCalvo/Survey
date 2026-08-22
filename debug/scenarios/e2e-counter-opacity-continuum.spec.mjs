import { test, expect } from '@playwright/test';

// Counter Fill + Number opacity continuum — % field + slider.
// Distinct from C-03 rect Fill + Line stroke, Counter every-swatch,
// Size/Start, nubbin, and Continue Count. Documented continuum
// (not every integer 0–100). Leftover-18 / X-01 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const FILL_STOPS = [1, 25, 40, 55, 80, 99, 100];
const NUMBER_STOPS = [1, 25, 40, 55, 80, 99, 100];
const FILL_SLIDER = 70;
const NUMBER_SLIDER = 33;

function parseAlpha(raw) {
  const s = String(raw || '').trim();
  if (!s || s.toLowerCase() === 'none' || s.toLowerCase() === 'transparent') return 0;
  const rgba = s.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (/^rgb\(/i.test(s)) return 1;
  if (s.startsWith('#')) return 1;
  return null;
}

function fillAlpha(row) {
  const fromFill = parseAlpha(row?.fill);
  if (fromFill != null) return fromFill;
  const fromVisual = parseAlpha(row?.visualFill);
  if (fromVisual != null) return fromVisual;
  if (row?.visualFillOpacity != null && row.visualFillOpacity !== '') return Number(row.visualFillOpacity);
  if (row?.fillOpacity != null) return Number(row.fillOpacity);
  if (row?.opacity != null) return Number(row.opacity);
  return null;
}

function numberAlpha(row) {
  const fromNumber = parseAlpha(row?.numberColor);
  if (fromNumber != null) return fromNumber;
  const fromVisual = parseAlpha(row?.visualNumber);
  if (fromVisual != null) return fromVisual;
  if (row?.visualNumberOpacity != null && row.visualNumberOpacity !== '') return Number(row.visualNumberOpacity);
  if (row?.strokeOpacity != null) return Number(row.strokeOpacity);
  return null;
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
      const visualFillEl = host?.querySelector('path, circle');
      const visualNumberEl = host?.querySelector('text');
      return {
        id,
        type: String(object.type || data.type || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        tool: String(data.tool || data.type || object.tool || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        imported: object.isPdfImported === true,
        seriesId: data.seriesId || null,
        displayNumber: Number(data.displayNumber ?? (host?.querySelector('text')?.textContent || 0)),
        createdAt: data.createdAt ?? null,
        fill: object.fill || data.fill || visualFillEl?.getAttribute('fill') || null,
        numberColor: data.numberColor || visualNumberEl?.getAttribute('fill') || null,
        visualFill: visualFillEl?.getAttribute('fill') || null,
        visualNumber: visualNumberEl?.getAttribute('fill') || null,
        visualFillOpacity: visualFillEl?.getAttribute('fill-opacity') ?? visualFillEl?.getAttribute('opacity') ?? null,
        visualNumberOpacity: visualNumberEl?.getAttribute('fill-opacity') ?? visualNumberEl?.getAttribute('opacity') ?? null,
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
  expect(await page.locator('button[title="Match fill"]').count()).toBe(0);
}

function opacityField(page) {
  return page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true })
    .or(page.getByRole('textbox', { name: 'Opacity percentage', exact: true }))
    .first();
}

function opacitySlider(page) {
  return page.locator('[data-annotation-color-picker] input[type="range"]')
    .or(page.locator('.mobile-pdf-colorpicker-surface input[type="range"]'))
    .or(page.locator('input[type="range"]'))
    .first();
}

async function setOpacityPercent(page, value) {
  const field = opacityField(page);
  await expect(field).toBeVisible();
  await field.fill(String(value));
}

async function injectOpacityRaw(page, raw) {
  const field = opacityField(page);
  await expect(field).toBeVisible();
  await field.evaluate((el, next) => {
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    proto.set.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(raw));
}

async function fillAlphaOf(page, id) {
  return fillAlpha(await annotationById(page, id));
}

async function numberAlphaOf(page, id) {
  return numberAlpha(await annotationById(page, id));
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
  const fillChip = 'Set Fill color #ff0000';
  if (!(await page.getByRole('button', { name: fillChip, exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: fillChip, exact: true })).toBeVisible({ timeout: 8_000 });
  const tab = page.getByRole('tab', { name: section === 'fill' ? 'Fill color' : 'Stroke color' });
  await expect(tab).toBeVisible({ timeout: 8_000 });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

async function closeCounterSheet(page) {
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', { name: 'Set Fill color #ff0000', exact: true })).toHaveCount(0);
}

test('desktop Counter Fill + Number opacity continuum intended + break + edge', async ({ page }) => {
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

  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await assertCounterTabs(page);
  await clickSwatch(page, '#FF0000');

  const fillProof = [];
  for (const stop of FILL_STOPS) {
    await setOpacityPercent(page, stop);
    await expect.poll(async () => fillAlphaOf(page, first.id), { message: `fill ${stop}` })
      .toBeCloseTo(stop / 100, 2);
    await expect.poll(async () => fillAlphaOf(page, sibling.id), { message: `sibling fill ${stop}` })
      .toBeCloseTo(stop / 100, 2);
    fillProof.push(stop);
  }

  const slider = opacitySlider(page);
  await expect(slider).toBeVisible();
  expect(await slider.getAttribute('min')).toBe('0');
  await slider.fill(String(FILL_SLIDER));
  await expect.poll(async () => fillAlphaOf(page, first.id), { message: `fill slider ${FILL_SLIDER}` })
    .toBeCloseTo(FILL_SLIDER / 100, 2);
  await expect(opacityField(page)).toHaveValue(String(FILL_SLIDER));

  await setOpacityPercent(page, 999);
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(1, 2);
  await setOpacityPercent(page, -10);
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(0, 2);
  await setOpacityPercent(page, '');
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(0, 2);
  await injectOpacityRaw(page, 'abc');
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(0, 2);

  await setOpacityPercent(page, 40);
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(0.4, 2);
  await clickSwatch(page, 'transparent');
  await expect(slider).toBeDisabled();
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(0, 2);
  await clickSwatch(page, '#FF0000');
  await expect(slider).toBeEnabled();
  await expect.poll(async () => fillAlphaOf(page, first.id), { message: 'remembered 40 after transparent' })
    .toBeCloseTo(0.4, 2);

  await setOpacityPercent(page, 0);
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(0, 2);
  const numberWhileFillZero = await numberAlphaOf(page, first.id);
  expect(numberWhileFillZero, 'fill 0 must not force Number invisible').not.toBe(0);

  await clickTab(page, 'Number');
  await assertCounterTabs(page);
  await clickSwatch(page, '#0000FF');

  const numberProof = [];
  for (const stop of NUMBER_STOPS) {
    await setOpacityPercent(page, stop);
    await expect.poll(async () => numberAlphaOf(page, first.id), { message: `number ${stop}` })
      .toBeCloseTo(stop / 100, 2);
    await expect.poll(async () => numberAlphaOf(page, sibling.id), { message: `sibling number ${stop}` })
      .toBeCloseTo(stop / 100, 2);
    numberProof.push(stop);
  }

  await expect(opacitySlider(page)).toHaveAttribute('min', '0');
  await opacitySlider(page).fill(String(NUMBER_SLIDER));
  await expect.poll(async () => numberAlphaOf(page, first.id), { message: `number slider ${NUMBER_SLIDER}` })
    .toBeCloseTo(NUMBER_SLIDER / 100, 2);

  await setOpacityPercent(page, 999);
  await expect.poll(async () => numberAlphaOf(page, first.id)).toBeCloseTo(1, 2);
  await setOpacityPercent(page, -10);
  await expect.poll(async () => numberAlphaOf(page, first.id)).toBeCloseTo(0, 2);
  await setOpacityPercent(page, '');
  await expect.poll(async () => numberAlphaOf(page, first.id)).toBeCloseTo(0, 2);
  await injectOpacityRaw(page, 'abc');
  await expect.poll(async () => numberAlphaOf(page, first.id)).toBeCloseTo(0, 2);

  await setOpacityPercent(page, 40);
  await expect.poll(async () => numberAlphaOf(page, first.id)).toBeCloseTo(0.4, 2);
  await clickSwatch(page, 'transparent');
  await expect(opacitySlider(page)).toBeDisabled();
  await expect.poll(async () => numberAlphaOf(page, first.id)).toBeCloseTo(0, 2);
  await clickSwatch(page, '#0000FF');
  await expect(opacitySlider(page)).toBeEnabled();
  await expect.poll(async () => numberAlphaOf(page, first.id), { message: 'number remembered 40 after transparent' })
    .toBeCloseTo(0.4, 2);

  await setOpacityPercent(page, 80);
  await expect.poll(async () => numberAlphaOf(page, first.id)).toBeCloseTo(0.8, 2);
  await clickTab(page, 'Fill');
  await setOpacityPercent(page, 55);
  await expect.poll(async () => fillAlphaOf(page, first.id)).toBeCloseTo(0.55, 2);
  expect(await numberAlphaOf(page, first.id), 'Fill must not clobber Number').toBeCloseTo(0.8, 2);
  expect(await fillAlphaOf(page, sibling.id)).toBeCloseTo(0.55, 2);
  expect(await numberAlphaOf(page, sibling.id)).toBeCloseTo(0.8, 2);
  await page.keyboard.press('Escape');

  await clickNewCount(page);
  const isolated = await dropPin(page, { xf: 0.62, yf: 0.30 });
  expect(isolated.seriesId).toBeTruthy();
  expect(isolated.seriesId).not.toBe(first.seriesId);

  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await clickSwatch(page, '#00FFFF');
  await setOpacityPercent(page, 10);
  await expect.poll(async () => fillAlphaOf(page, isolated.id)).toBeCloseTo(0.1, 2);
  await page.keyboard.press('Escape');

  expect(await fillAlphaOf(page, first.id), 'series B fill must not clobber series A fill').toBeCloseTo(0.55, 2);
  expect(await numberAlphaOf(page, first.id), 'series B fill must not clobber series A number').toBeCloseTo(0.8, 2);
  expect(await fillAlphaOf(page, sibling.id)).toBeCloseTo(0.55, 2);
  expect(await numberAlphaOf(page, sibling.id)).toBeCloseTo(0.8, 2);

  await activateTool(page, 'Draw', 'Pen');
  expect(await fillAlphaOf(page, first.id)).toBeCloseTo(0.55, 2);
  expect(await numberAlphaOf(page, first.id)).toBeCloseTo(0.8, 2);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  for (let i = 0; i < 8; i += 1) {
    const stillThere = (await counterSnapshot(page)).some((row) => row.id === isolated.id);
    if (!stillThere) break;
    await undo.click();
  }
  await expect.poll(async () => {
    const rows = await counterSnapshot(page);
    return rows.some((row) => row.id === isolated.id);
  }).toBe(false);
  expect(await fillAlphaOf(page, first.id)).toBeCloseTo(0.55, 2);
  expect(await numberAlphaOf(page, first.id)).toBeCloseTo(0.8, 2);

  const beforeSelect = (await counterSnapshot(page)).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await counterSnapshot(page)).length).toBe(beforeSelect);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('COUNTER_DESKTOP_OPACITY_CONTINUUM_PROOF', JSON.stringify({
    first: { id: first.id, seriesId: first.seriesId, fillStops: fillProof, numberStops: numberProof, fill: 55, number: 80 },
    sibling: { id: sibling.id, fill: 55, number: 80 },
    isolationId: isolated.id,
    fillSlider: FILL_SLIDER,
    numberSlider: NUMBER_SLIDER,
    remembered40: true,
    viewBox,
    fileId,
  }));
});

test('390 Counter Fill + Number opacity continuum intended + break + edge', async ({ page }) => {
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

  await openCounterSheet(page, 'fill');
  await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await clickSwatch(page, '#00FF00');
  await setOpacityPercent(page, 25);
  await expect(opacityField(page)).toHaveValue('25');
  await expect.poll(async () => fillAlphaOf(page, pin.id), { message: '390 fill 25' }).toBeCloseTo(0.25, 2);
  await setOpacityPercent(page, 999);
  await expect(opacityField(page)).toHaveValue('100');
  await expect.poll(async () => fillAlphaOf(page, pin.id)).toBeCloseTo(1, 2);
  await setOpacityPercent(page, -10);
  await expect(opacityField(page)).toHaveValue('0');
  await expect.poll(async () => fillAlphaOf(page, pin.id)).toBeCloseTo(0, 2);
  await setOpacityPercent(page, 25);
  await expect(opacityField(page)).toHaveValue('25');
  await expect.poll(async () => fillAlphaOf(page, pin.id)).toBeCloseTo(0.25, 2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0);
  await closeCounterSheet(page);

  await openCounterSheet(page, 'stroke');
  await page.getByRole('button', { name: 'Open stroke color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await clickSwatch(page, '#0000FF');
  await setOpacityPercent(page, 40);
  await expect(opacityField(page)).toHaveValue('40');
  await expect.poll(async () => numberAlphaOf(page, pin.id), { message: '390 number 40' }).toBeCloseTo(0.4, 2);
  await setOpacityPercent(page, 999);
  await expect(opacityField(page)).toHaveValue('100');
  await expect.poll(async () => numberAlphaOf(page, pin.id)).toBeCloseTo(1, 2);
  await setOpacityPercent(page, -10);
  await expect(opacityField(page)).toHaveValue('0');
  await expect.poll(async () => numberAlphaOf(page, pin.id)).toBeCloseTo(0, 2);
  expect(await fillAlphaOf(page, pin.id), '390 Number clamp must not clobber Fill').toBeCloseTo(0.25, 2);
  await page.keyboard.press('Escape');
  await closeCounterSheet(page);

  const beforeSelect = (await counterSnapshot(page)).length;
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await counterSnapshot(page)).length).toBe(beforeSelect);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).count()).toBe(0);

  console.log('COUNTER_390_OPACITY_CONTINUUM_PROOF', JSON.stringify({
    pin: pin.id,
    fillField: 25,
    numberFieldClamp: { typed: 999, stored: 100, neg: 0 },
    viewBox,
    fileId,
  }));
});
