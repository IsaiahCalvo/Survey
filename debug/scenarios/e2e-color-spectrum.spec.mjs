import { test, expect } from '@playwright/test';

// C-04 leftover: CompactColorPicker Color spectrum (HSV).
// C-01 grid, C-02 hex, and C-03 opacity already have dedicated
// intended+break+edge. Prior C-04 only sampled aria valuetext / leave-reenter
// — it never wrote a selected annotation. Distinct from leftover-18,
// Match Fill, and the 96 proved IDs. Do not stamp file.id.
// Product hue is clamp 0–360 (not wrap).

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

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
          || key.startsWith('toolPrefs_')
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

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const pageEl = page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  await expect(pageEl).toBeVisible();
  const box = await pageEl.boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
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
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || style.fillColor || visual?.getAttribute('fill') || null,
        visualFill: visual?.getAttribute('fill') || null,
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

function storedFill(row) {
  return colorKey(row?.fill || row?.visualFill);
}

function isSpectrumGreen(hex) {
  const match = String(hex || '').match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i);
  if (!match) return false;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  // Live hue aria-valuenow is Math.round(hue). 119.5° displays as 120
  // and hsvToHex yields #01FF00, not catalog #00FF00.
  return g === 255 && r <= 2 && b <= 2;
}

async function storedFillOf(page, id) {
  return storedFill(await annotationById(page, id));
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

async function closePagesOverlay(page) {
  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await pagesToggle.isVisible().catch(() => false)) {
    await pagesToggle.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }
}

async function dismissChrome(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await closePagesOverlay(page);
}

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
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
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    const selected = await page.locator('[data-resize-handle], [data-rotation-handle="mtr"]').count();
    const chrome = await page.getByRole('button', { name: /^(Color|Fill and border colors|Edit text)$/ }).count();
    if (selected > 0 || chrome > 0) return;
  }
}

async function openFillPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
}

async function openSpectrum(page) {
  const spectrumBtn = page.getByRole('button', { name: 'Color spectrum', exact: true });
  await expect(spectrumBtn).toBeVisible();
  await spectrumBtn.click();
  await expect(page.locator('[data-color-picker-spectrum="true"]')).toBeVisible();
  await expect(page.locator('[data-color-picker-hue="true"]')).toBeVisible();
}

async function svSlider(page) {
  return page.locator('[data-color-picker-spectrum="true"]');
}

async function hueSlider(page) {
  return page.locator('[data-color-picker-hue="true"]');
}

async function dragSpectrumOutside(page, { fromX, fromY, toX, toY }) {
  const spectrum = await svSlider(page);
  const box = await spectrum.boundingBox();
  expect(box, 'spectrum geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * fromX, box.y + box.height * fromY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * toY, { steps: 10 });
  await page.mouse.up();
}

async function clickSwatch(page, hex) {
  const grid = page.getByRole('button', { name: 'Preset colors', exact: true });
  if (!(await page.locator(`button[title="${hex}"]`).first().isVisible().catch(() => false))) {
    await grid.click();
  }
  await page.locator(`button[title="${hex}"]`).first().click();
}

async function nudgeHueTo(page, target) {
  const hue = await hueSlider(page);
  await expect.poll(async () => {
    const now = Number(await hue.getAttribute('aria-valuenow'));
    if (!Number.isFinite(now)) return -1;
    if (now === target) return now;
    const delta = target - now;
    if (Math.abs(delta) >= 10) await hue.press(delta > 0 ? 'PageUp' : 'PageDown');
    else await hue.press(delta > 0 ? 'ArrowRight' : 'ArrowLeft');
    return Number(await hue.getAttribute('aria-valuenow'));
  }, { message: `hue must reach ${target}` }).toBe(target);
}

test('desktop Color spectrum intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page);
  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#FF0000');

  await openSpectrum(page);
  const spectrum = await svSlider(page);
  const hue = await hueSlider(page);
  await expect(spectrum).toHaveAttribute('aria-label', 'Saturation and brightness');
  await expect(hue).toHaveAttribute('aria-label', 'Hue');
  expect(await page.getByRole('button', { name: 'Color spectrum', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: 'Preset colors', exact: true }).count()).toBeGreaterThan(0);

  // Intended — hue keyboard writes the selected fill from a clean #FF0000 HSV.
  await nudgeHueTo(page, 120);
  await expect.poll(async () => isSpectrumGreen(await storedFillOf(page, rect.id)), {
    message: 'hue 120 must write green',
  }).toBe(true);
  expect(await hue.getAttribute('aria-valuenow')).toBe('120');

  // Intended — SV pointer writes fill (not just valuetext). Out-of-bounds clamps.
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#FF0000');
  await openSpectrum(page);
  await dragSpectrumOutside(page, { fromX: 0.5, fromY: 0.5, toX: -0.4, toY: -0.4 });
  await expect.poll(async () => storedFillOf(page, rect.id), {
    message: 'SV left-top / out-of-bounds must write white',
  }).toBe('#FFFFFF');
  expect(await (await svSlider(page)).getAttribute('aria-valuetext')).toMatch(/Saturation 0%, brightness 100%/);

  await dragSpectrumOutside(page, { fromX: 0.4, fromY: 0.4, toX: 1.6, toY: -0.4 });
  await expect.poll(async () => storedFillOf(page, rect.id), {
    message: 'SV right-top / out-of-bounds must restore pure hue red',
  }).toBe('#FF0000');

  // Break — hue clamps, it does not wrap. Press on the slider so
  // page-nav Home/End cannot steal the chord.
  const hueClamp = await hueSlider(page);
  await hueClamp.press('PageUp');
  await hueClamp.press('PageUp');
  await hueClamp.press('Home');
  await expect.poll(async () => Number(await hueClamp.getAttribute('aria-valuenow'))).toBe(0);
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#FF0000');
  await hueClamp.press('ArrowLeft');
  expect(await hueClamp.getAttribute('aria-valuenow')).toBe('0');
  expect(await storedFillOf(page, rect.id)).toBe('#FF0000');
  await hueClamp.press('End');
  await expect.poll(async () => Number(await hueClamp.getAttribute('aria-valuenow'))).toBe(360);
  expect(await storedFillOf(page, rect.id)).toBe('#FF0000');
  await hueClamp.press('ArrowRight');
  expect(await hueClamp.getAttribute('aria-valuenow')).toBe('360');

  // Break — SV Home stays at sat 0; unused keys do not steal.
  const svClamp = await svSlider(page);
  await svClamp.press('Home');
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#FFFFFF');
  const satBefore = await svClamp.getAttribute('aria-valuenow');
  await svClamp.press('ArrowLeft');
  expect(await svClamp.getAttribute('aria-valuenow')).toBe(satBefore);
  await svClamp.press('x');
  await svClamp.press('Enter');
  expect(await storedFillOf(page, rect.id)).toBe('#FFFFFF');
  await svClamp.press('End');
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#FF0000');

  // Break — Select invents 0; Pen hides Color spectrum.
  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await page.keyboard.press('Escape');
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 14, empty.y + 14);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);
  expect(await page.getByRole('button', { name: 'Color spectrum', exact: true }).count()).toBe(0);

  await activateTool(page, 'Draw', 'Pen');
  expect(await page.getByRole('button', { name: 'Color spectrum', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-color-picker-spectrum="true"]').count()).toBe(0);

  // Edge — isolation + undo. Spectrum green must not stamp the next rect.
  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await clickSwatch(page, '#FF0000');
  await openSpectrum(page);
  await nudgeHueTo(page, 120);
  await expect.poll(async () => isSpectrumGreen(await storedFillOf(page, rect.id))).toBe(true);
  await page.keyboard.press('Escape');

  const other = await createRect(page, { x0: 0.50, y0: 0.50, x1: 0.68, y1: 0.66 });
  expect(other.id).not.toBe(rect.id);
  expect(isSpectrumGreen(await storedFillOf(page, rect.id))).toBe(true);
  expect(isSpectrumGreen(await storedFillOf(page, other.id))).toBe(false);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === other.id);
  }).toBe(false);
  expect(isSpectrumGreen(await storedFillOf(page, rect.id))).toBe(true);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Color spectrum', exact: true }).count(), 'hubPreview Color spectrum must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('C04_DESKTOP_SPECTRUM_PROOF', JSON.stringify({
    rectId: rect.id,
    white: '#FFFFFF',
    green: 'spectrum-green',
    hueClamp: { home: 0, end: 360, noWrap: true },
    otherId: other.id,
    viewBox,
    fileId: null,
  }));
});

test('390 Color spectrum intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await closePagesOverlay(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  await expect(page.getByRole('button', { name: 'Fill and border colors', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await clickVisible(page, 'Fill and border colors');
  await expect(page.getByRole('button', { name: 'Open fill color picker', exact: true })).toBeVisible();

  // Break: 390 chip sheet is not the spectrum.
  expect(await page.locator('[data-color-picker-spectrum="true"]').count()).toBe(0);

  await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await clickSwatch(page, '#FF0000');
  await openSpectrum(page);

  const spectrum = await svSlider(page);
  const hue = await hueSlider(page);
  await nudgeHueTo(page, 120);
  await expect.poll(async () => Number(await hue.getAttribute('aria-valuenow'))).toBe(120);
  await spectrum.press('End');
  await expect.poll(async () => (await spectrum.getAttribute('aria-valuetext'))).toMatch(/Saturation 100%/);

  // Break — hue clamp + unused key.
  await hue.press('Home');
  await hue.press('ArrowLeft');
  expect(await hue.getAttribute('aria-valuenow')).toBe('0');
  await hue.press('x');
  expect(await hue.getAttribute('aria-valuenow')).toBe('0');

  // Intended — hue 120 next-draw stamps green on the created rect.
  await nudgeHueTo(page, 120);
  await expect.poll(async () => Number(await hue.getAttribute('aria-valuenow'))).toBe(120);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0);
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
  await expect(page.getByRole('button', { name: 'Open fill color picker', exact: true })).toHaveCount(0);
  await closePagesOverlay(page);
  await dismissChrome(page);
  await closePagesOverlay(page);

  const created = await createRect(page, { x0: 0.28, y0: 0.30, x1: 0.52, y1: 0.42 });
  await expect.poll(async () => isSpectrumGreen(await storedFillOf(page, created.id))).toBe(true);

  // Break: Pen hides Color spectrum / takeover.
  await activateTool(page, 'Draw', 'Pen');
  expect(await page.getByRole('button', { name: 'Color spectrum', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).count()).toBe(0);

  await clickVisible(page, 'Select');
  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).count()).toBe(0);

  console.log('C04_390_SPECTRUM_PROOF', JSON.stringify({
    created: { id: created.id, stored: 'spectrum-green' },
    viewBox,
    fileId: null,
  }));
});
