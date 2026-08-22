import { test, expect } from '@playwright/test';

// Callout desktop Fill + Border every-swatch — CompactColorPicker tabs.
// Distinct from Fill every-swatch on a selected rect (e2e-pickers-every-swatch),
// Line/Arrow stroke-only, Highlighter, C-02 hex lengths, and T-02 handles.
// Leftover-18 / X-01 parked. No file.id.

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

function storedFill(row) {
  return colorKey(row?.fill || row?.visualFill);
}

function storedBorder(row) {
  return colorKey(row?.stroke || row?.visualStroke);
}

function isTransparentFill(row) {
  const opacity = Number(row?.fillOpacity);
  if (opacity === 0) return true;
  return storedFill(row) === 'TRANSPARENT';
}

function isTransparentBorder(row) {
  const opacity = Number(row?.borderOpacity ?? row?.strokeOpacity);
  if (opacity === 0) return true;
  return storedBorder(row) === 'TRANSPARENT';
}

function isCalloutRow(row) {
  return row.callout === true
    || row.tool === 'callout'
    || row.type === 'callout'
    || String(row.id || '').startsWith('callout-');
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

async function calloutSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const legacy = data.legacyCallout || {};
      const style = legacy.style || data.style || {};
      const box = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"] [data-callout-part="textBox"]`,
      );
      return {
        id,
        type: String(object.type || data.type || 'callout').toLowerCase(),
        tool: String(data.tool || data.type || 'callout').toLowerCase(),
        callout: true,
        imported: object.isPdfImported === true || legacy.isPdfImported === true,
        fill: style.fillColor || data.fillColor || null,
        stroke: style.borderColor || style.lineColor || data.borderColor || null,
        fillOpacity: style.fillOpacity ?? data.fillOpacity ?? null,
        borderOpacity: style.borderOpacity ?? data.borderOpacity ?? null,
        strokeOpacity: style.borderOpacity ?? data.strokeOpacity ?? null,
        visualFill: box?.getAttribute('fill') || null,
        visualStroke: box?.getAttribute('stroke') || null,
        visualFillOpacity: box?.getAttribute('fill-opacity') ?? null,
        visualStrokeOpacity: box?.getAttribute('stroke-opacity') ?? null,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function waitForNewCallout(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isCalloutRow(row)) || null;
    return created;
  }, { message: 'expected a new callout' }).not.toBeNull();
  return created;
}

async function annotationById(page, id) {
  return (await calloutSnapshot(page)).find((row) => row.id === id) || null;
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

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

async function createCallout(page, text, coords = { x0: 0.18, y0: 0.24, x1: 0.42, y1: 0.40 }) {
  const before = new Set((await calloutSnapshot(page)).map((row) => row.id));
  await page.keyboard.press('q');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  const created = await waitForNewCallout(page, before);
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await selectMode(page);
  return created;
}

async function selectCallout(page, id) {
  await selectMode(page);
  const scoped = page.locator(`[data-svg-annotation-layer="1"] [data-callout-id="${id}"]`);
  const candidates = [
    scoped.locator('[data-callout-part="textBox"]').first(),
    scoped.locator('[data-callout-part="knee"]').last(),
    scoped.first(),
  ];
  for (const target of candidates) {
    if (!(await target.count())) continue;
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const box = await target.boundingBox();
    if (!box || box.width < 1 || box.height < 1) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const colorBtn = page.getByRole('button', { name: 'Color', exact: true }).first();
    if (await colorBtn.isVisible().catch(() => false)) return;
  }
  await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 8_000 });
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
  const tab = page.getByRole('button', { name, exact: true }).first();
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
  await selectCallout(page, id);
  await openColorPicker(page);
  await clickTab(page, layer === 'border' ? 'Border' : 'Fill');
  await assertShapeTabs(page, { matchFill: false });
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
      proof.push({ swatch, stored: swatch });
    }
  }
  expect(proof.map((row) => row.swatch)).toEqual(PATCH_ORDER);
  return proof;
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

test('catalog: Callout desktop CompactColorPicker is the 16-swatch Fill/Border grid', () => {
  expect([...COLOR_PICKER_PRESETS]).toEqual([
    'transparent',
    '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
  ]);
  expect(COLOR_PICKER_PRESETS).toHaveLength(16);
  expect(SOLID_SWATCHES).toHaveLength(15);
});

test('desktop Callout CompactColorPicker Fill + Border every swatch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  expect((await calloutSnapshot(page)).length).toBe(0);

  const first = await createCallout(page, 'cf-1', { x0: 0.16, y0: 0.22, x1: 0.42, y1: 0.38 });
  const fillProof = await patchEverySwatch(page, first.id, 'fill');
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');

  const borderProof = await patchEverySwatch(page, first.id, 'border');
  await clickSwatch(page, '#0000FF');
  await expect.poll(async () => storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  await page.keyboard.press('Escape');

  const second = await createCallout(page, 'cf-2', { x0: 0.52, y0: 0.22, x1: 0.78, y1: 0.38 });
  const secondFillProof = await patchEverySwatch(page, second.id, 'fill');
  await clickSwatch(page, '#00FFFF');
  await expect.poll(async () => storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  await page.keyboard.press('Escape');

  expect(storedFill(await annotationById(page, first.id)), 'first Callout must keep red fill after second every-swatch').toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id)), 'first Callout must keep blue border after second every-swatch').toBe('#0000FF');
  expect(first.id).not.toBe(second.id);

  // Intended: armed next-draw uses the Fill / Border tabs.
  await page.keyboard.press('q');
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await assertShapeTabs(page, { matchFill: false });
  await clickSwatch(page, '#80FF00');
  await page.keyboard.press('Escape');
  const nextFill = await createCallout(page, 'cf-3', { x0: 0.16, y0: 0.48, x1: 0.42, y1: 0.62 });
  await expect.poll(async () => storedFill(await annotationById(page, nextFill.id))).toBe('#80FF00');
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');

  await page.keyboard.press('q');
  await openColorPicker(page);
  await clickTab(page, 'Border');
  await assertShapeTabs(page, { matchFill: false });
  await clickSwatch(page, '#FF8000');
  await page.keyboard.press('Escape');
  const nextBorder = await createCallout(page, 'cf-4', { x0: 0.52, y0: 0.48, x1: 0.78, y1: 0.62 });
  await expect.poll(async () => storedBorder(await annotationById(page, nextBorder.id))).toBe('#FF8000');
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, nextFill.id))).toBe('#80FF00');

  // Break: Select / empty page invents 0. Pen-armed Color must not clobber
  // already-drawn Callout fill/border.
  const beforeSelect = (await calloutSnapshot(page)).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await calloutSnapshot(page)).length).toBe(beforeSelect);

  await activateTool(page, 'Draw', 'Pen');
  const colorBtn = page.getByRole('button', { name: 'Color', exact: true }).first();
  await colorBtn.click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  await page.locator('button[title="#00FF00"]').first().click();
  await page.keyboard.press('Escape');
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  expect(storedFill(await annotationById(page, nextFill.id))).toBe('#80FF00');
  expect(storedBorder(await annotationById(page, nextBorder.id))).toBe('#FF8000');

  // Edge: undo drops the last next-draw callout; prior fill/border stay.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    return rows.some((row) => row.id === nextBorder.id);
  }).toBe(false);
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  expect(storedFill(await annotationById(page, nextFill.id))).toBe('#80FF00');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Preset colors', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('CALLOUT_DESKTOP_SWATCH_PROOF', JSON.stringify({
    first: { id: first.id, fill: fillProof, border: borderProof, restoredFill: '#FF0000', restoredBorder: '#0000FF' },
    second: { id: second.id, fill: secondFillProof, restoredFill: '#00FFFF' },
    nextFill: { id: nextFill.id, stored: '#80FF00' },
    nextBorder: { id: nextBorder.id, stored: '#FF8000', undone: true },
    viewBox,
    fileId,
  }));
});
