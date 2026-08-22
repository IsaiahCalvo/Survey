import { test, expect } from '@playwright/test';

// Live C-02 hex lengths — CompactColorPicker "Hex color" field.
// Distinct from swatch catalogs (C-01 / 390 chips / Highlighter every-swatch)
// and from the thin 6-digit + ZZZZZZ checks in pickers-every-swatch /
// adversarial-repass. Leftover-18 / X-01 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const INTENDED = [
  { typed: 'f00', stored: '#FF0000', kind: '3-digit bare' },
  { typed: '#0f0', stored: '#00FF00', kind: '3-digit hash' },
  { typed: '0000FF', stored: '#0000FF', kind: '6-digit bare' },
  { typed: '#FF8000', stored: '#FF8000', kind: '6-digit hash' },
  { typed: 'abc', stored: '#AABBCC', kind: '3-digit mixed' },
];

const REJECTED = [
  { typed: 'red', kind: 'named' },
  { typed: 'blue', kind: 'named' },
  { typed: 'rgba(255,0,0,1)', kind: 'rgba()' },
  { typed: 'rgb(0, 128, 0)', kind: 'rgb()' },
  { typed: 'FF00', kind: '4-digit bare' },
  { typed: '#F0F0', kind: '4-digit hash' },
  { typed: '12345', kind: '5-digit bare' },
  { typed: '#12345', kind: '5-digit hash' },
  { typed: '1234567', kind: '7-digit bare' },
  { typed: 'FF0000FF', kind: '8-digit bare' },
  { typed: '#AABBCCDD', kind: '8-digit hash' },
  { typed: 'zzzzzz', kind: 'non-hex' },
  { typed: '', kind: 'empty' },
  { typed: 'transparent', kind: 'named transparent' },
  { typed: '##FF0000', kind: 'double hash' },
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
      const overlay = document.querySelector('[data-text-edit-overlay] [contenteditable]');
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || data.fillColor || style.fillColor || visual?.getAttribute('fill') || null,
        stroke: object.stroke || data.stroke || visual?.getAttribute('stroke') || null,
        visualFill: visual?.getAttribute('fill') || null,
        overlayColor: overlay ? getComputedStyle(overlay).color : null,
        fontColor: style.fontColor || data.fontColor || object.fill || null,
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

async function createRect(page, coords = { x0: 0.22, y0: 0.26, x1: 0.42, y1: 0.44 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle'
  ));
}

async function createText(page, text, coords = { x0: 0.50, y0: 0.26, x1: 0.72, y1: 0.40 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Text', 'Text');
  const overlay = page.locator('[data-text-overlay="1"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await page.keyboard.type(text);
  await page.mouse.click(12, 200);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'textbox' || row.type === 'text' || row.tool === 'text'
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

async function hexField(page) {
  const field = page.getByRole('textbox', { name: 'Hex color', exact: true }).first();
  await expect(field).toBeVisible();
  return field;
}

async function storedFillOf(page, id) {
  return storedFill(await annotationById(page, id));
}

test('desktop CompactColorPicker hex lengths intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page);
  await selectStroke(page, rect.id);
  await openFillPicker(page);
  await page.locator('button[title="#000000"]').first().click();
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#000000');

  const field = await hexField(page);
  const intendedProof = [];
  for (const row of INTENDED) {
    await field.fill(row.typed);
    await expect.poll(async () => storedFillOf(page, rect.id), { message: `${row.kind} ${row.typed}` })
      .toBe(row.stored);
    intendedProof.push({ ...row, id: rect.id });
  }

  const lastValid = INTENDED[INTENDED.length - 1].stored;
  expect(await storedFillOf(page, rect.id)).toBe(lastValid);

  const rejectedProof = [];
  for (const row of REJECTED) {
    await field.fill(row.typed);
    await page.waitForTimeout(80);
    const stored = await storedFillOf(page, rect.id);
    expect(stored, `${row.kind} ${JSON.stringify(row.typed)} must keep ${lastValid}`).toBe(lastValid);
    rejectedProof.push({ ...row, stored });
  }

  // Edge: whitespace 3-digit still expands after a rejected value.
  await field.fill('  00f  ');
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#0000FF');

  // Edge: after another reject, a later valid 3-digit still applies.
  await field.fill('not-a-color');
  await page.waitForTimeout(80);
  expect(await storedFillOf(page, rect.id)).toBe('#0000FF');
  await field.fill('f0f');
  await expect.poll(async () => storedFillOf(page, rect.id)).toBe('#FF00FF');

  await page.keyboard.press('Escape');

  // Font-color site uses the same hex field.
  const text = await createText(page, 'hex lengths');
  await selectStroke(page, text.id);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true });
  if (await edit.isVisible().catch(() => false)) await edit.click();
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 8_000 });
  const fontTrigger = page.getByRole('button', { name: 'Font color', exact: true }).first();
  await expect(fontTrigger).toBeVisible();
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await fontTrigger.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const fontHex = await hexField(page);
  await fontHex.fill('0f0');
  await expect.poll(async () => {
    const row = await annotationById(page, text.id);
    return colorKey(row?.overlayColor || row?.fontColor || row?.fill);
  }).toBe('#00FF00');
  await fontHex.fill('FF00');
  await page.waitForTimeout(80);
  expect(colorKey((await annotationById(page, text.id))?.overlayColor
    || (await annotationById(page, text.id))?.fontColor
    || (await annotationById(page, text.id))?.fill)).toBe('#00FF00');
  await page.keyboard.press('Escape');
  await page.mouse.click(12, 200);

  // Isolation: a second rect does not inherit the typed magenta.
  const other = await createRect(page, { x0: 0.50, y0: 0.50, x1: 0.68, y1: 0.66 });
  expect(other.id).not.toBe(rect.id);
  expect(await storedFillOf(page, rect.id)).toBe('#FF00FF');
  expect(await storedFillOf(page, other.id)).not.toBe('#FF00FF');

  // Undo drops the isolation rect; the hex-patched fill stays.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === other.id);
  }).toBe(false);
  expect(await storedFillOf(page, rect.id)).toBe('#FF00FF');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('C02_DESKTOP_HEX_LENGTH_PROOF', JSON.stringify({
    intended: intendedProof,
    rejected: rejectedProof.map((row) => row.kind),
    whitespace: '#0000FF',
    afterReject: '#FF00FF',
    fontColor: '#00FF00',
    otherId: other.id,
    viewBox,
    fileId,
  }));
});

test('390 CompactColorPicker hex lengths intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const closePages = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await page.getByText('No documents yet').isVisible().catch(() => false) && await closePages.isVisible().catch(() => false)) {
    await closePages.click();
    await expect(page.getByText('No documents yet')).toHaveCount(0);
  }

  await activateTool(page, 'Shapes', 'Rectangle');
  await expect(page.getByRole('button', { name: 'Fill and border colors', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await clickVisible(page, 'Fill and border colors');
  await expect(page.getByRole('button', { name: 'Open fill color picker', exact: true })).toBeVisible();

  // Break: 390 chip sheet is not the hex field.
  expect(await page.getByRole('textbox', { name: 'Hex color', exact: true }).count()).toBe(0);

  await page.getByRole('button', { name: 'Open fill color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  const field = await hexField(page);

  await field.fill('f00');
  await expect.poll(async () => (await field.inputValue()).replace('#', '').toUpperCase()).toBe('FF0000');

  // Invalid typed text stays in the field locally; applyHex does not run.
  await field.fill('red');
  await page.waitForTimeout(80);
  expect((await field.inputValue()).toLowerCase()).toBe('red');
  await field.fill('FF0000FF');
  await page.waitForTimeout(80);
  expect((await field.inputValue()).replace('#', '').toUpperCase()).toBe('FF0000FF');

  await page.keyboard.press('Escape');
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
  else await page.keyboard.press('Escape');

  const created = await createRect(page, { x0: 0.28, y0: 0.30, x1: 0.52, y1: 0.42 });
  await expect.poll(async () => storedFillOf(page, created.id)).toBe('#FF0000');

  // Break: Select / empty page invents 0.
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

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).count()).toBe(0);

  console.log('C02_390_HEX_LENGTH_PROOF', JSON.stringify({
    created: { id: created.id, stored: '#FF0000' },
    viewBox,
    fileId,
  }));
});
