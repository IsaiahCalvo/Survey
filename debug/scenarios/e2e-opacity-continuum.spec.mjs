import { test, expect } from '@playwright/test';

// Live C-03 fill + stroke opacity continuum — % field + slider.
// Distinct from C-01 every-swatch, C-02 hex lengths, Templates entity
// opacity, and the smoke 55% / slider-40 row. Documented continuum
// (not every integer 0–100). Leftover-18 / X-01 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

// Representative stops across 0–100. Not a discrete catalog.
const FILL_STOPS = [1, 25, 40, 55, 80, 99, 100];
const STROKE_STOPS = [1, 25, 40, 55, 80, 99, 100];
const FILL_SLIDER = 70;
const STROKE_SLIDER = 33;

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

function strokeAlpha(row) {
  const fromStroke = parseAlpha(row?.stroke);
  if (fromStroke != null) return fromStroke;
  const fromVisual = parseAlpha(row?.visualStroke);
  if (fromVisual != null) return fromVisual;
  if (row?.visualStrokeOpacity != null && row.visualStrokeOpacity !== '') return Number(row.visualStrokeOpacity);
  if (row?.strokeOpacity != null) return Number(row.strokeOpacity);
  if (row?.opacity != null) return Number(row.opacity);
  return null;
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
  let covered = null;
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = String(await button.getAttribute('class') || '');
    if (cls.includes('mobile-header-select-button')) {
      covered = button;
      continue;
    }
    await button.click();
    return button;
  }
  if (name === 'Select') {
    const mode = page.getByRole('button', { name: 'Selection mode', exact: true }).first();
    if (await mode.isVisible().catch(() => false)) {
      await mode.click();
      return mode;
    }
    await page.keyboard.press('v');
    return mode;
  }
  if (covered) {
    await covered.click({ force: true });
    return covered;
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click({ force: true });
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
        stroke: object.stroke || data.stroke || visual?.getAttribute('stroke') || null,
        opacity: object.opacity ?? data.opacity ?? style.opacity ?? null,
        fillOpacity: object.fillOpacity ?? data.fillOpacity ?? style.fillOpacity ?? null,
        strokeOpacity: object.strokeOpacity ?? data.strokeOpacity ?? style.strokeOpacity ?? null,
        visualFill: visual?.getAttribute('fill') || null,
        visualStroke: visual?.getAttribute('stroke') || null,
        visualFillOpacity: visual?.getAttribute('fill-opacity') ?? null,
        visualStrokeOpacity: visual?.getAttribute('stroke-opacity') ?? null,
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

async function closePagesOverlay(page) {
  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await pagesToggle.isVisible().catch(() => false)) {
    await pagesToggle.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }
}

async function ensurePageDrawTarget(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(pageEl).toBeVisible();
  const overlay = page.locator('main').getByText('No documents yet').first();
  const toggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i }).first();
  const box = await pageEl.boundingBox();
  const covering = box && await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return /No documents yet|Upload your first PDF/.test(el?.textContent || '');
  }, { x: box.x + box.width * 0.4, y: box.y + box.height * 0.35 });
  const emptyVisible = await overlay.isVisible().catch(() => false);
  if (!covering && !emptyVisible) return;
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await page.waitForTimeout(300);
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
    row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect'
  ));
}

async function createLine(page, coords = { x0: 0.50, y0: 0.26, x1: 0.72, y1: 0.42 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'line' || row.tool === 'line'
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
    const chrome = await page.getByRole('button', { name: /^(Color|Fill and border colors|Stroke color|Edit text)$/ }).count();
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
  const fillTab = page.locator('[data-annotation-color-picker]').getByRole('button', { name: 'Fill', exact: true });
  if (await fillTab.count()) await fillTab.click();
}

async function openBorderTab(page) {
  const borderTab = page.locator('[data-annotation-color-picker]').getByRole('button', { name: 'Border', exact: true });
  await expect(borderTab).toBeVisible();
  await borderTab.click();
}

async function openColorPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
}

function opacityField(page) {
  return page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true })
    .or(page.getByRole('textbox', { name: 'Opacity percentage', exact: true }))
    .first();
}

function opacitySlider(page) {
  return page.locator('[data-annotation-color-picker] input[type="range"]')
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

async function strokeAlphaOf(page, id) {
  return strokeAlpha(await annotationById(page, id));
}

test('desktop fill + stroke opacity continuum intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page);
  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await page.locator('button[title="#FF0000"]').first().click();

  const fillProof = [];
  for (const stop of FILL_STOPS) {
    await setOpacityPercent(page, stop);
    await expect.poll(async () => fillAlphaOf(page, rect.id), { message: `fill ${stop}` })
      .toBeCloseTo(stop / 100, 2);
    fillProof.push(stop);
  }

  const slider = opacitySlider(page);
  await expect(slider).toBeVisible();
  await slider.fill(String(FILL_SLIDER));
  await expect.poll(async () => fillAlphaOf(page, rect.id), { message: `fill slider ${FILL_SLIDER}` })
    .toBeCloseTo(FILL_SLIDER / 100, 2);
  await expect(opacityField(page)).toHaveValue(String(FILL_SLIDER));

  await setOpacityPercent(page, 999);
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(1, 2);
  await setOpacityPercent(page, -10);
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(0, 2);
  await setOpacityPercent(page, '');
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(0, 2);
  await injectOpacityRaw(page, 'abc');
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(0, 2);

  await setOpacityPercent(page, 40);
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(0.4, 2);
  await page.locator('button[title="Transparent"]').first().click();
  await expect(slider).toBeDisabled();
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(0, 2);
  await page.locator('button[title="#FF0000"]').first().click();
  await expect(slider).toBeEnabled();
  await expect.poll(async () => fillAlphaOf(page, rect.id), { message: 'remembered 40 after transparent' })
    .toBeCloseTo(0.4, 2);

  await setOpacityPercent(page, 0);
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(0, 2);
  const strokeWhileFillZero = await strokeAlphaOf(page, rect.id);
  expect(strokeWhileFillZero, 'one-visible: border stays when fill is 0').toBeGreaterThan(0);

  await openBorderTab(page);
  await expect(opacityField(page)).toHaveValue('100');
  await expect(opacitySlider(page)).toHaveAttribute('min', '100');
  await setOpacityPercent(page, 40);
  await expect(opacityField(page)).toHaveValue('100');
  await expect.poll(async () => strokeAlphaOf(page, rect.id), { message: 'border minOpacity=1' })
    .toBeCloseTo(1, 2);
  expect(await fillAlphaOf(page, rect.id), 'border floor must not clobber fill 0').toBeCloseTo(0, 2);

  await setOpacityPercent(page, 999);
  await expect(opacityField(page)).toHaveValue('100');
  await injectOpacityRaw(page, 'abc');
  await expect.poll(async () => strokeAlphaOf(page, rect.id)).toBeCloseTo(1, 2);

  const fillTab = page.locator('[data-annotation-color-picker]').getByRole('button', { name: 'Fill', exact: true });
  await fillTab.click();
  await setOpacityPercent(page, 55);
  await expect.poll(async () => fillAlphaOf(page, rect.id)).toBeCloseTo(0.55, 2);
  await page.keyboard.press('Escape');

  const line = await createLine(page);
  await selectStroke(page, line.id);
  await openColorPicker(page);
  expect(await page.locator('[data-annotation-color-picker]').getByRole('button', { name: 'Fill', exact: true }).count())
    .toBe(0);
  await page.locator('button[title="#0000FF"]').first().click();

  const strokeProof = [];
  for (const stop of STROKE_STOPS) {
    await setOpacityPercent(page, stop);
    await expect.poll(async () => strokeAlphaOf(page, line.id), { message: `stroke ${stop}` })
      .toBeCloseTo(stop / 100, 2);
    strokeProof.push(stop);
  }

  await opacitySlider(page).fill(String(STROKE_SLIDER));
  await expect.poll(async () => strokeAlphaOf(page, line.id), { message: `stroke slider ${STROKE_SLIDER}` })
    .toBeCloseTo(STROKE_SLIDER / 100, 2);

  await setOpacityPercent(page, 999);
  await expect.poll(async () => strokeAlphaOf(page, line.id)).toBeCloseTo(1, 2);
  await setOpacityPercent(page, -10);
  await expect.poll(async () => strokeAlphaOf(page, line.id)).toBeCloseTo(0, 2);
  await setOpacityPercent(page, 80);
  await expect.poll(async () => strokeAlphaOf(page, line.id)).toBeCloseTo(0.8, 2);
  await page.keyboard.press('Escape');

  expect(await fillAlphaOf(page, rect.id), 'line stroke must not clobber rect fill').toBeCloseTo(0.55, 2);

  const other = await createLine(page, { x0: 0.22, y0: 0.58, x1: 0.44, y1: 0.72 });
  expect(other.id).not.toBe(line.id);
  await selectStroke(page, other.id);
  await openColorPicker(page);
  await setOpacityPercent(page, 10);
  await expect.poll(async () => strokeAlphaOf(page, other.id)).toBeCloseTo(0.1, 2);
  expect(await strokeAlphaOf(page, line.id), 'other-line patch must not clobber first stroke').toBeCloseTo(0.8, 2);
  await page.keyboard.press('Escape');

  await activateTool(page, 'Draw', 'Pen');
  expect(await fillAlphaOf(page, rect.id)).toBeCloseTo(0.55, 2);
  expect(await strokeAlphaOf(page, line.id)).toBeCloseTo(0.8, 2);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  for (let i = 0; i < 4; i += 1) {
    const stillThere = (await userAnnotationSnapshot(page)).some((row) => row.id === other.id);
    if (!stillThere) break;
    await undo.click();
  }
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === other.id);
  }).toBe(false);
  expect(await strokeAlphaOf(page, line.id)).toBeCloseTo(0.8, 2);
  expect(await fillAlphaOf(page, rect.id)).toBeCloseTo(0.55, 2);

  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('C03_DESKTOP_OPACITY_CONTINUUM_PROOF', JSON.stringify({
    fillStops: fillProof,
    fillSlider: FILL_SLIDER,
    strokeStops: strokeProof,
    strokeSlider: STROKE_SLIDER,
    remembered40: true,
    borderFloor: 100,
    isolationId: other.id,
    viewBox,
    fileId,
  }));
});

test('390 fill + stroke opacity continuum intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);

  const rect = await createRect(page, { x0: 0.28, y0: 0.30, x1: 0.52, y1: 0.42 });
  expect(rect.id).toBeTruthy();
  await activateTool(page, 'Shapes', 'Rectangle');
  await expect(page.getByRole('button', { name: 'Fill and border colors', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await clickVisible(page, 'Fill and border colors');
  await expect(page.getByRole('button', { name: 'Open fill color picker', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await page.locator('button[title="#00FF00"]').first().click();
  await setOpacityPercent(page, 25);
  await expect(opacityField(page)).toHaveValue('25');
  await setOpacityPercent(page, 999);
  await expect(opacityField(page)).toHaveValue('100');
  await setOpacityPercent(page, 25);
  await expect(opacityField(page)).toHaveValue('25');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0);
  const closeFill = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await closeFill.isVisible().catch(() => false)) await closeFill.click();

  await activateTool(page, 'Shapes', 'Line');
  const strokeTrigger = page.getByRole('button', { name: 'Stroke color', exact: true }).first();
  await expect(strokeTrigger).toBeVisible({ timeout: 8_000 });
  await strokeTrigger.click();
  const openStroke = page.getByRole('button', { name: 'Open stroke color picker', exact: true });
  await expect(openStroke).toBeVisible();
  await openStroke.click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await page.locator('button[title="#0000FF"]').first().click();
  await setOpacityPercent(page, 40);
  await expect(opacityField(page)).toHaveValue('40');
  await setOpacityPercent(page, 999);
  await expect(opacityField(page)).toHaveValue('100');
  await setOpacityPercent(page, -10);
  await expect(opacityField(page)).toHaveValue('0');
  await page.keyboard.press('Escape');
  const closeStroke = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await closeStroke.isVisible().catch(() => false)) await closeStroke.click();

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).count()).toBe(0);

  console.log('C03_390_OPACITY_CONTINUUM_PROOF', JSON.stringify({
    fillField: 25,
    strokeFieldClamp: { typed: 999, stored: 100, neg: 0 },
    drawn: rect.id,
    viewBox,
    fileId,
  }));
});
