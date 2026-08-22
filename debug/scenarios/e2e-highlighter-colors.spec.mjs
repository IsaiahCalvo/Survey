import { test, expect } from '@playwright/test';

// Highlighter every-swatch — 390 stroke chips + desktop CompactColorPicker.
// Distinct from Pen select-and-patch (e2e-pickers-every-swatch) and from
// 390 Fill / Text chip specs. Leftover-18 / X-01 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

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

const COLOR_PICKER_PRESETS = [
  'transparent',
  '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
  '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
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

async function openEditor(page, { width = 390, height = 844, url = LINK_PDF } = {}) {
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
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || style.fillColor || visual?.getAttribute('fill') || null,
        stroke: object.stroke || data.stroke || visual?.getAttribute('stroke') || null,
        visualFill: visual?.getAttribute('fill') || null,
        blend: object.globalCompositeOperation || visual?.style?.mixBlendMode || null,
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

function storedHighlighterColor(row) {
  return colorKey(row?.fill || row?.visualFill);
}

function isHighlighterRow(row) {
  return row.tool === 'highlighter' || String(row.tool).includes('highlight');
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

async function deselectAll(page) {
  await clickVisible(page, 'Select');
  const box = await pageBox(page);
  await page.mouse.click(box.x + 10, box.y + 10);
  await page.waitForTimeout(80);
}

async function openStrokeSheet(page) {
  await activateTool(page, 'Draw', 'Highlighter');
  await clickVisible(page, 'Stroke color');
  const chip = page.getByRole('button', { name: `Set Stroke color ${MOBILE_ANNOTATION_COLORS[0]}`, exact: true });
  if (!(await chip.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape');
    await activateTool(page, 'Draw', 'Highlighter');
    await clickVisible(page, 'Stroke color');
  }
  await expect(chip).toBeVisible({ timeout: 8_000 });
}

async function closeStrokeSheet(page) {
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', { name: `Set Stroke color ${MOBILE_ANNOTATION_COLORS[0]}`, exact: true })).toHaveCount(0);
}

async function createHighlighter(page, coords = { x0: 0.20, y0: 0.28, x1: 0.58, y1: 0.32 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Draw', 'Highlighter');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isHighlighterRow);
}

test('390 Highlighter stroke chips every hex intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const emptyBefore = await userAnnotationSnapshot(page);
  expect(emptyBefore.filter(isHighlighterRow).length).toBe(0);

  const closePages = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await closePages.isVisible().catch(() => false)) {
    await closePages.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }

  await activateTool(page, 'Draw', 'Highlighter');
  await expect(page.getByRole('button', { name: 'Stroke color', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  expect(await page.getByRole('button', { name: 'Fill and border colors', exact: true }).count()).toBe(0);

  const highlighterProof = [];
  for (let i = 0; i < MOBILE_ANNOTATION_COLORS.length; i += 1) {
    const color = MOBILE_ANNOTATION_COLORS[i];
    await openStrokeSheet(page);
    await expect(page.getByRole('button', { name: 'Fill color', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Set Stroke color ${color}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Set Stroke color ${color}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Set Stroke color ${color}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await closeStrokeSheet(page);
    const x0 = 0.18 + (i % 3) * 0.08;
    const y0 = 0.24 + Math.floor(i / 3) * 0.10;
    const created = await createHighlighter(page, { x0, y0, x1: x0 + 0.36, y1: y0 + 0.04 });
    const expected = colorKey(color);
    await expect.poll(async () => storedHighlighterColor(await annotationById(page, created.id))).toBe(expected);
    const row = await annotationById(page, created.id);
    expect(row.blend === 'multiply' || row.tool === 'highlighter').toBeTruthy();
    highlighterProof.push({ chip: color, stored: expected, id: created.id });
    await deselectAll(page);
  }
  expect(highlighterProof.map((row) => row.chip)).toEqual([...MOBILE_ANNOTATION_COLORS]);
  expect(highlighterProof.map((row) => row.stored)).toEqual(MOBILE_ANNOTATION_COLORS.map((color) => colorKey(color)));
  expect(highlighterProof[0].id).not.toBe(highlighterProof[1].id);
  expect(
    storedHighlighterColor(await annotationById(page, highlighterProof[0].id)),
    'earlier chip must stay on its highlighter',
  ).toBe(colorKey(MOBILE_ANNOTATION_COLORS[0]));

  // Edge: large swatch still opens CompactColorPicker (desktop catalog).
  await openStrokeSheet(page);
  await page.getByRole('button', { name: 'Open stroke color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await page.locator('button[title="#0000FF"]').first().click();
  const hex = page.getByRole('textbox', { name: 'Hex color', exact: true });
  if (await hex.isVisible().catch(() => false)) {
    await hex.fill('red');
    await page.waitForTimeout(80);
    await hex.fill('#FF00');
    await page.waitForTimeout(80);
  }
  await page.keyboard.press('Escape');
  await closeStrokeSheet(page);
  const compactHi = await createHighlighter(page, { x0: 0.18, y0: 0.62, x1: 0.54, y1: 0.66 });
  await expect.poll(async () => storedHighlighterColor(await annotationById(page, compactHi.id))).toBe('#0000FF');
  expect(storedHighlighterColor(await annotationById(page, highlighterProof[0].id))).toBe(colorKey(MOBILE_ANNOTATION_COLORS[0]));

  // Break: Select / empty page does not invent another highlighter.
  await deselectAll(page);
  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);

  // Edge: undo drops the CompactColorPicker highlighter; prior chip strokes stay.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === compactHi.id);
  }).toBe(false);
  expect(storedHighlighterColor(await annotationById(page, highlighterProof[8].id))).toBe(colorKey(MOBILE_ANNOTATION_COLORS[8]));

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  // Break: desktop CompactColorPicker catalog is not this 9-chip sheet.
  await openEditor(page, { width: 1440, height: 900 });
  const desktopChips = {};
  for (const color of MOBILE_ANNOTATION_COLORS) {
    desktopChips[color] = await page.getByRole('button', { name: `Set Stroke color ${color}`, exact: true }).count();
  }
  expect(desktopChips['#4A90E2'], 'desktop must not mount the 390 Highlighter chip catalog').toBe(0);
  expect(Object.values(desktopChips).every((count) => count === 0)).toBe(true);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Set Stroke color #4A90E2', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('HIGHLIGHTER_390_STROKE_PROOF', JSON.stringify({
    desktopChips,
    highlighter: highlighterProof,
    compactPicker: { id: compactHi.id, stored: '#0000FF' },
    viewBox,
    fileId,
  }));
});

test('desktop Highlighter CompactColorPicker every swatch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await activateTool(page, 'Draw', 'Highlighter');
  await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 8_000 });

  const desktopProof = [];
  const order = [...COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent'), 'transparent'];
  for (let i = 0; i < order.length; i += 1) {
    const swatch = order[i];
    await activateTool(page, 'Draw', 'Highlighter');
    const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
    if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
      await trigger.click();
    }
    await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
    expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
    const title = swatch === 'transparent' ? 'Transparent' : swatch;
    await page.locator(`button[title="${title}"]`).first().click();
    await page.keyboard.press('Escape');
    const x0 = 0.12 + (i % 4) * 0.16;
    const y0 = 0.16 + Math.floor(i / 4) * 0.10;
    const created = await createHighlighter(page, { x0, y0, x1: x0 + 0.14, y1: y0 + 0.03 });
    const expected = swatch === 'transparent' ? 'TRANSPARENT' : colorKey(swatch);
    await expect.poll(async () => storedHighlighterColor(await annotationById(page, created.id))).toBe(expected);
    desktopProof.push({ swatch, stored: expected, id: created.id });
  }
  expect(desktopProof.map((row) => row.swatch)).toEqual(order);
  expect(desktopProof[0].id).not.toBe(desktopProof[1].id);
  expect(storedHighlighterColor(await annotationById(page, desktopProof[0].id))).toBe('#FF0000');
  expect(storedHighlighterColor(await annotationById(page, desktopProof[10].id))).toBe('#FFFF00');

  // Break: Select / empty page invents 0. Pen-armed Color must not clobber
  // an already-drawn highlighter fill. Desktop chrome can leave a covered
  // header Select under the pdf.js surface — V is the live Select key.
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
  expect(storedHighlighterColor(await annotationById(page, desktopProof[0].id))).toBe('#FF0000');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('HIGHLIGHTER_DESKTOP_SWATCH_PROOF', JSON.stringify({
    desktop: desktopProof,
    viewBox,
    fileId,
  }));
});
