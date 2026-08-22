import { test, expect } from '@playwright/test';

// C-06 leftover: CompactColorPicker Match Fill.
// C-01 grid / C-02 hex / C-03 opacity / C-04 spectrum already have dedicated
// intended+break+edge. Cloud/poly every-swatch clicked Match Fill once at
// default opacity. P1-38 proved the selected ring ±1 — do not replay it.
// This slice: Border snapshots fill color + opacity (the lock that sits
// below the Border minOpacity=1 slider), missing/transparent fill, 390.
// Distinct from leftover-18 and the 96 proved IDs. Do not stamp file.id.

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
  return null;
}

function strokeAlpha(row) {
  const fromStroke = parseAlpha(row?.stroke);
  if (fromStroke != null) return fromStroke;
  const fromVisual = parseAlpha(row?.visualStroke);
  if (fromVisual != null) return fromVisual;
  if (row?.visualStrokeOpacity != null && row.visualStrokeOpacity !== '') return Number(row.visualStrokeOpacity);
  if (row?.strokeOpacity != null) return Number(row.strokeOpacity);
  return null;
}

function storedFill(row) {
  return colorKey(row?.fill || row?.visualFill);
}

function storedStroke(row) {
  return colorKey(row?.stroke || row?.visualStroke);
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
        stroke: object.stroke || data.stroke || visual?.getAttribute('stroke') || null,
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

async function openColorPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
}

async function clickTab(page, name) {
  const tab = page.locator('[data-annotation-color-picker]').getByRole('button', { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
}

function opacityField(page) {
  return page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true })
    .or(page.getByRole('textbox', { name: 'Opacity percentage', exact: true }))
    .first();
}

async function setOpacityPercent(page, value) {
  const field = opacityField(page);
  await expect(field).toBeVisible();
  await field.fill(String(value));
}

async function clickMatchFill(page) {
  const cell = page.locator('button[title="Match fill"]').first();
  await expect(cell, 'Match fill cell').toBeVisible();
  await cell.click();
}

test('desktop Match Fill intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page);
  await selectStroke(page, rect.id);
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  expect(await page.locator('button[title="Match fill"]').count(), 'Fill tab Match fill must be 0').toBe(0);
  await page.locator('button[title="#00FFFF"]').first().click();
  await setOpacityPercent(page, 40);
  await expect.poll(async () => storedFill(await annotationById(page, rect.id))).toBe('#00FFFF');
  await expect.poll(async () => fillAlpha(await annotationById(page, rect.id)), {
    message: 'fill 40 must write',
  }).toBeCloseTo(0.4, 2);

  await clickTab(page, 'Border');
  await expect(page.locator('button[title="Match fill"]')).toBeVisible();
  await page.locator('button[title="#FF0000"]').first().click();
  await expect.poll(async () => storedStroke(await annotationById(page, rect.id))).toBe('#FF0000');
  await expect.poll(async () => strokeAlpha(await annotationById(page, rect.id))).toBeCloseTo(1, 2);
  await expect(opacityField(page)).toHaveValue('100');

  // Intended — Match Fill snapshots fill color + opacity onto the border
  // even though the Border slider floors at 100.
  await clickMatchFill(page);
  await expect.poll(async () => storedStroke(await annotationById(page, rect.id)), {
    message: 'Match Fill must copy fill #00FFFF onto stroke',
  }).toBe('#00FFFF');
  await expect.poll(async () => strokeAlpha(await annotationById(page, rect.id)), {
    message: 'opacity lock: stroke must sit at fill 40 below Border minOpacity=1',
  }).toBeCloseTo(0.4, 2);
  expect(fillAlpha(await annotationById(page, rect.id))).toBeCloseTo(0.4, 2);

  // Break — snapshot, not a live bind. Later fill must not rewrite stroke.
  await clickTab(page, 'Fill');
  await page.locator('button[title="#00FF00"]').first().click();
  await expect.poll(async () => storedFill(await annotationById(page, rect.id))).toBe('#00FF00');
  expect(storedStroke(await annotationById(page, rect.id)), 'Match Fill is a snapshot, not a live bind')
    .toBe('#00FFFF');
  expect(strokeAlpha(await annotationById(page, rect.id))).toBeCloseTo(0.4, 2);

  // Break — missing / transparent fill. One-visible keeps a side opaque.
  await page.locator('button[title="Transparent"]').first().click();
  await expect.poll(async () => fillAlpha(await annotationById(page, rect.id))).toBeCloseTo(0, 2);
  await clickTab(page, 'Border');
  await clickMatchFill(page);
  const afterMissing = await annotationById(page, rect.id);
  const fillAfterMissing = fillAlpha(afterMissing);
  const strokeAfterMissing = strokeAlpha(afterMissing);
  expect(
    (fillAfterMissing > 0) || (strokeAfterMissing > 0),
    'missing fill Match Fill must not hide both sides',
  ).toBeTruthy();

  await page.keyboard.press('Escape');

  // Isolation — second rect stays off the first stroke.
  const other = await createRect(page, { x0: 0.50, y0: 0.50, x1: 0.68, y1: 0.66 });
  expect(other.id).not.toBe(rect.id);
  const firstAfterOther = await annotationById(page, rect.id);
  expect(storedStroke(firstAfterOther), 'second rect must isolate the first stroke')
    .toBe(storedStroke(afterMissing));

  // Break — Line never offers Match Fill.
  const line = await createLine(page);
  await selectStroke(page, line.id);
  await openColorPicker(page);
  expect(await page.locator('[data-annotation-color-picker]').getByRole('button', { name: 'Fill', exact: true }).count())
    .toBe(0);
  expect(await page.locator('button[title="Match fill"]').count(), 'Line Match fill must be 0').toBe(0);
  await page.keyboard.press('Escape');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === line.id);
  }).toBe(false);
  expect(storedStroke(await annotationById(page, rect.id))).toBe(storedStroke(firstAfterOther));

  await clickVisible(page, 'Select');
  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 14, empty.y + 14);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);
  expect(await page.locator('button[title="Match fill"]').count()).toBe(0);

  await activateTool(page, 'Draw', 'Pen');
  expect(await page.locator('button[title="Match fill"]').count(), 'Pen hides Match fill').toBe(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('button[title="Match fill"]').count(), 'hubPreview Match fill must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('C06_DESKTOP_MATCH_FILL_PROOF', JSON.stringify({
    rectId: rect.id,
    intended: { fill: '#00FFFF', fillAlpha: 0.4, strokeAfter: '#00FFFF', strokeAlpha: 0.4 },
    snapshotHeld: true,
    missingFillKeptVisible: true,
    otherId: other.id,
    lineMatchFill: 0,
    viewBox,
    fileId: null,
  }));
});

test('390 Match Fill intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await closePagesOverlay(page);
  await ensurePageDrawTarget(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  await expect(page.getByRole('button', { name: 'Fill and border colors', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await clickVisible(page, 'Fill and border colors');
  await expect(page.getByRole('button', { name: 'Open fill color picker', exact: true })).toBeVisible();

  expect(await page.locator('button[title="Match fill"]').count(), '390 chip sheet Match fill must be 0').toBe(0);

  await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.locator('button[title="Match fill"]').count(), '390 Fill takeover Match fill must be 0').toBe(0);
  await page.locator('button[title="#00FFFF"]').first().click();
  await setOpacityPercent(page, 40);
  await expect(opacityField(page)).toHaveValue('40');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0);

  // Escape tears the takeover and can dismiss the sheet. Re-open, then Stroke tab.
  await closePagesOverlay(page);
  if (!(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).isVisible().catch(() => false))) {
    await clickVisible(page, 'Fill and border colors');
  }
  await expect(page.getByRole('button', { name: 'Open fill color picker', exact: true })).toBeVisible({ timeout: 8_000 });
  const strokeTab = page.getByRole('tab', { name: 'Stroke color', exact: true });
  await expect(strokeTab).toBeVisible();
  await strokeTab.click();
  await page.getByRole('button', { name: 'Open stroke color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await expect(page.locator('button[title="Match fill"]')).toBeVisible();
  await page.locator('button[title="#FF0000"]').first().click();
  await clickMatchFill(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0);
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
  await expect(page.getByRole('button', { name: 'Open fill color picker', exact: true })).toHaveCount(0);
  await closePagesOverlay(page);
  await dismissChrome(page);
  await closePagesOverlay(page);
  await ensurePageDrawTarget(page);

  const created = await createRect(page, { x0: 0.28, y0: 0.30, x1: 0.52, y1: 0.42 });
  await expect.poll(async () => storedFill(await annotationById(page, created.id))).toBe('#00FFFF');
  await expect.poll(async () => storedStroke(await annotationById(page, created.id)), {
    message: '390 next-draw Match Fill must stamp fill color on stroke',
  }).toBe('#00FFFF');
  await expect.poll(async () => strokeAlpha(await annotationById(page, created.id)), {
    message: '390 opacity lock must stamp fill 40 onto stroke',
  }).toBeCloseTo(0.4, 2);

  await activateTool(page, 'Shapes', 'Line');
  const strokeTrigger = page.getByRole('button', { name: 'Stroke color', exact: true }).first();
  await expect(strokeTrigger).toBeVisible({ timeout: 8_000 });
  await strokeTrigger.click();
  const openStroke = page.getByRole('button', { name: 'Open stroke color picker', exact: true });
  await expect(openStroke).toBeVisible();
  await openStroke.click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.locator('button[title="Match fill"]').count(), '390 Line Match fill must be 0').toBe(0);
  await page.keyboard.press('Escape');

  await activateTool(page, 'Draw', 'Pen');
  expect(await page.locator('button[title="Match fill"]').count(), '390 Pen hides Match fill').toBe(0);
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

  console.log('C06_390_MATCH_FILL_PROOF', JSON.stringify({
    created: { id: created.id, fill: '#00FFFF', stroke: '#00FFFF', strokeAlpha: 0.4 },
    lineMatchFill: 0,
    viewBox,
    fileId: null,
  }));
});
