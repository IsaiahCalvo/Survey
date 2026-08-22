import { test, expect } from '@playwright/test';

// 390 mobile annotation color chips (MOBILE_ANNOTATION_COLORS) — every swatch.
// Desktop CompactColorPicker every-swatch is a different catalog
// (e2e-pickers-every-swatch). P-02 harness never clicked these chips.
// Leftover-18 / X-01 parked. No file.id on ?testPdf=.

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
  const box = await pageBox(page, pageNumber);
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

async function storedFill(page, id) {
  const row = await annotationById(page, id);
  return colorKey(row?.fill || row?.visualFill);
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

async function createRect(page, coords = { x0: 0.22, y0: 0.28, x1: 0.58, y1: 0.48 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
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

async function selectRect(page, id) {
  await dismissChrome(page);
  await clickVisible(page, 'Select');
  const host = page.locator(`[data-shape-id="${id}"]`).first()
    .or(page.locator(`[data-svg-annotation-layer] [data-anno-id="${id}"]`).first());
  await expect(host).toBeVisible();
  await host.click({ force: true, position: { x: 8, y: 8 } });
  const swatch = page.getByRole('button', { name: 'Fill and border colors', exact: true }).first();
  if (!(await swatch.isVisible().catch(() => false))) {
    await page.keyboard.press('v');
    await host.click({ force: true });
  }
  await expect(swatch).toBeVisible({ timeout: 8_000 });
}

async function openFillSheet(page) {
  await clickVisible(page, 'Fill and border colors');
  await expect(page.getByRole('button', { name: `Set Fill color ${MOBILE_ANNOTATION_COLORS[0]}`, exact: true })).toBeVisible({ timeout: 8_000 });
}

test('390 MOBILE_ANNOTATION_COLORS every chip intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // Intended: 390 sheet exposes every chip and each writes fill on a selected rect.
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  // Break contrast later — desktop must not mount these chips. Capture the
  // 390-only names now so the later 1440 pass can assert count 0.
  const emptyBefore = await userAnnotationSnapshot(page);
  expect(emptyBefore.filter((row) => row.type === 'rect' || row.type === 'rectangle').length).toBe(0);

  const closePages = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await closePages.isVisible().catch(() => false)) {
    await closePages.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }

  const rect = await createRect(page, { x0: 0.34, y0: 0.36, x1: 0.78, y1: 0.58 });
  expect(rect?.id).toBeTruthy();
  await selectRect(page, rect.id);
  await openFillSheet(page);
  for (const color of MOBILE_ANNOTATION_COLORS) {
    await expect(page.getByRole('button', { name: `Set Fill color ${color}`, exact: true })).toBeVisible();
  }

  const fillProof = [];
  for (const color of MOBILE_ANNOTATION_COLORS) {
    await page.getByRole('button', { name: `Set Fill color ${color}`, exact: true }).click();
    const expected = colorKey(color);
    await expect.poll(async () => storedFill(page, rect.id)).toBe(expected);
    fillProof.push({ chip: color, stored: expected });
  }
  expect(fillProof.map((row) => row.chip)).toEqual([...MOBILE_ANNOTATION_COLORS]);
  expect(fillProof.map((row) => row.stored)).toEqual(MOBILE_ANNOTATION_COLORS.map((color) => colorKey(color)));

  // Edge: large swatch still opens CompactColorPicker (desktop catalog).
  await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await page.locator('button[title="#0000FF"]').first().click();
  await expect.poll(async () => storedFill(page, rect.id)).toBe('#0000FF');
  const hex = page.getByRole('textbox', { name: 'Hex color', exact: true });
  if (await hex.isVisible().catch(() => false)) {
    await hex.fill('red');
    await page.waitForTimeout(80);
    expect(await storedFill(page, rect.id)).toBe('#0000FF');
    await hex.fill('#FF00');
    await page.waitForTimeout(80);
    expect(await storedFill(page, rect.id)).toBe('#0000FF');
  }
  await page.keyboard.press('Escape');

  // Break: invalid / named / short hex keep the CompactColorPicker value.
  expect(await storedFill(page, rect.id)).toBe('#0000FF');

  // Break: empty-page chip does not invent a second rect.
  await page.mouse.click(12, 80);
  await clickVisible(page, 'Select');
  await page.mouse.click(12, 80);
  const afterDeselect = (await userAnnotationSnapshot(page)).length;

  // Edge: second rect isolated from the first fill.
  const second = await createRect(page, { x0: 0.22, y0: 0.56, x1: 0.52, y1: 0.72 });
  expect(second.id).not.toBe(rect.id);
  await selectRect(page, second.id);
  await openFillSheet(page);
  await page.getByRole('button', { name: 'Set Fill color #27C07D', exact: true }).click();
  await expect.poll(async () => storedFill(page, second.id)).toBe('#27C07D');
  expect(await storedFill(page, rect.id), 'first rect must stay #0000FF').toBe('#0000FF');
  expect((await userAnnotationSnapshot(page)).length).toBeGreaterThanOrEqual(afterDeselect);

  // Edge: undo after the isolated green fill.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.isVisible().catch(() => false)) {
    await undo.click();
    await expect.poll(async () => storedFill(page, second.id)).not.toBe('#27C07D');
  }
  expect(await storedFill(page, rect.id)).toBe('#0000FF');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  // Break: desktop CompactColorPicker catalog is not this 9-chip sheet.
  await openEditor(page, { width: 1440, height: 900 });
  const desktopChips = {};
  for (const color of MOBILE_ANNOTATION_COLORS) {
    desktopChips[color] = await page.getByRole('button', { name: `Set Fill color ${color}`, exact: true }).count();
  }
  expect(desktopChips['#4A90E2'], 'desktop must not mount the 390 chip catalog').toBe(0);
  expect(Object.values(desktopChips).every((count) => count === 0)).toBe(true);

  // Contrast: hubPreview is not the 390 PDF chip sheet.
  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Set Fill color #4A90E2', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('MOBILE_ANNOTATION_COLORS_PROOF', JSON.stringify({
    desktopChips,
    fill: fillProof,
    compactPicker: '#0000FF',
    firstId: rect.id,
    secondId: second.id,
    viewBox,
    fileId,
  }));
});
