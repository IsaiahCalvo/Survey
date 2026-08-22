import { test, expect } from '@playwright/test';

// Cloud desktop Fill + Border every-swatch — CompactColorPicker on a
// Style→Cloud rectangle (`data-shape-kind="cloud-rect"`). Distinct from
// selected-solid-rect Fill/Border (e2e-pickers-every-swatch), Cloud bump
// 1–20, Line/Arrow stroke, Callout/Text Fill+Border. Poly imported
// polygon/polyline Color stays the next leftover. Leftover-18 / X-01
// parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const COLOR_PICKER_PRESETS = [
  'transparent',
  '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
  '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
];

const SOLID_SWATCHES = COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent');
const FILL_ORDER = [...SOLID_SWATCHES, 'transparent'];
const BORDER_ORDER = [...SOLID_SWATCHES];

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
  const opacity = Number(row?.fillOpacity ?? row?.opacity ?? 1);
  if (opacity === 0) return true;
  return storedFill(row) === 'TRANSPARENT';
}

function isCloudRow(row) {
  if (row?.imported === true) return false;
  const type = String(row?.type || '').toLowerCase();
  if (!(type === 'rect' || type === 'rectangle')) return false;
  return row?.cloud === true
    || Number.isFinite(row?.cloudIntensity)
    || row?.shapeKind === 'cloud-rect';
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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const visual = document.querySelector(`[data-shape-id="${id}"]`);
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        fill: object.fill || data.fill || null,
        stroke: object.stroke || data.stroke || data.borderColor || null,
        opacity: object.opacity ?? data.opacity ?? null,
        fillOpacity: object.fillOpacity ?? data.fillOpacity ?? null,
        strokeOpacity: object.strokeOpacity ?? data.strokeOpacity ?? null,
        cloudIntensity: Number.isFinite(data.pdfCloudIntensity) ? Number(data.pdfCloudIntensity) : null,
        cloud: Number.isFinite(data.pdfCloudIntensity) || data.lineBorderStyle === 'cloud',
        shapeKind: visual?.getAttribute('data-shape-kind') || null,
        visualFill: visual?.getAttribute('fill') || null,
        visualStroke: visual?.getAttribute('stroke') || null,
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

async function pickStyle(page, optionName) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  if (!(await popover.isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(optionName), exact: true });
  if (await option.count()) {
    await option.click();
    return;
  }
  await popover.getByText(String(optionName), { exact: true }).click();
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

async function selectCloud(page, id) {
  // Color only patches a selected cloud when activeTool === 'select'.
  // Do not Escape first: create leaves the new cloud selected; Escape drops it
  // and the default fillOpacity-0 cloud path is stroke-only to hit.
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');

  const handles = page.locator('[data-resize-handle], [data-rotation-handle="mtr"]');
  if (await handles.count()) {
    await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 8_000 });
    return;
  }

  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(group).toBeVisible({ timeout: 8_000 });
  const box = await group.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + Math.min(8, Math.max(3, box.width / 2)), y: box.y + Math.max(3, box.height / 2) },
    { x: box.x + 4, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 4 },
    { x: box.x + box.width - 4, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + box.height - 4 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await handles.count()) {
      await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 8_000 });
      return;
    }
  }
  await page.locator(`[data-shape-id="${id}"]`).click({ force: true, position: { x: 3, y: 3 } });
  await expect(handles.first()).toBeVisible({ timeout: 8_000 });
}

async function openColorPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
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

async function assertCloudTabs(page, { onBorder = false } = {}) {
  await expect(page.getByRole('button', { name: 'Fill', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Border', exact: true }).first()).toBeVisible();
  if (onBorder) {
    await expect(page.locator('button[title="Match fill"]')).toBeVisible();
    expect(await page.locator('button[title="Transparent"]').count()).toBe(0);
  } else {
    await expect(page.locator('button[title="Transparent"]')).toBeVisible();
    expect(await page.locator('button[title="Match fill"]').count()).toBe(0);
  }
}

async function assertStillCloud(page, id) {
  const row = await annotationById(page, id);
  expect(isCloudRow(row), `${id} must stay a cloud-rect`).toBeTruthy();
  expect(row.shapeKind).toBe('cloud-rect');
  expect(Number.isFinite(row.cloudIntensity)).toBeTruthy();
}

async function armCloudRect(page) {
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickStyle(page, 'Cloud');
  await expect(page.getByRole('textbox', { name: 'Cloud bump size', exact: true })).toBeVisible({ timeout: 8_000 });
}

async function createCloud(page, coords = { x0: 0.16, y0: 0.24, x1: 0.40, y1: 0.40 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await armCloudRect(page);
  await dragOnPage(page, coords);
  const created = await waitForNewUserAnnotation(page, before, isCloudRow);
  expect(created.shapeKind).toBe('cloud-rect');
  expect(Number.isFinite(created.cloudIntensity)).toBeTruthy();
  await page.keyboard.press('v');
  return created;
}

async function patchFillEverySwatch(page, id) {
  await selectCloud(page, id);
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await assertCloudTabs(page, { onBorder: false });
  const proof = [];
  for (const swatch of FILL_ORDER) {
    await clickSwatch(page, swatch);
    if (swatch === 'transparent') {
      await expect.poll(async () => isTransparentFill(await annotationById(page, id))).toBeTruthy();
      proof.push({ swatch, stored: 'TRANSPARENT' });
    } else {
      await expect.poll(async () => storedFill(await annotationById(page, id))).toBe(swatch);
      proof.push({ swatch, stored: swatch });
    }
    await assertStillCloud(page, id);
  }
  expect(proof.map((row) => row.swatch)).toEqual(FILL_ORDER);
  return proof;
}

async function patchBorderEverySwatch(page, id) {
  await selectCloud(page, id);
  await openColorPicker(page);
  await clickTab(page, 'Border');
  await assertCloudTabs(page, { onBorder: true });
  const proof = [];
  for (const swatch of BORDER_ORDER) {
    await clickSwatch(page, swatch);
    await expect.poll(async () => storedBorder(await annotationById(page, id))).toBe(swatch);
    await assertStillCloud(page, id);
    proof.push({ swatch, stored: swatch });
  }
  await page.locator('button[title="Match fill"]').click();
  const fillNow = storedFill(await annotationById(page, id));
  await expect.poll(async () => storedBorder(await annotationById(page, id))).toBe(fillNow);
  await assertStillCloud(page, id);
  proof.push({ swatch: 'match-fill', stored: fillNow });
  expect(proof.map((row) => row.swatch)).toEqual([...BORDER_ORDER, 'match-fill']);
  return proof;
}

test('catalog: Cloud desktop CompactColorPicker is the 16-swatch Fill/Border grid', () => {
  expect([...COLOR_PICKER_PRESETS]).toEqual([
    'transparent',
    '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
  ]);
  expect(COLOR_PICKER_PRESETS).toHaveLength(16);
  expect(SOLID_SWATCHES).toHaveLength(15);
});

test('desktop Cloud CompactColorPicker Fill + Border every swatch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  expect((await userAnnotationSnapshot(page)).filter(isCloudRow).length).toBe(0);

  const first = await createCloud(page, { x0: 0.16, y0: 0.22, x1: 0.40, y1: 0.38 });
  const fillProof = await patchFillEverySwatch(page, first.id);
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');

  const borderProof = await patchBorderEverySwatch(page, first.id);
  await clickSwatch(page, '#0000FF');
  await expect.poll(async () => storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  await expect.poll(async () => storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  await assertStillCloud(page, first.id);
  await page.keyboard.press('Escape');

  const second = await createCloud(page, { x0: 0.52, y0: 0.22, x1: 0.78, y1: 0.38 });
  const secondFillProof = await patchFillEverySwatch(page, second.id);
  await clickSwatch(page, '#00FFFF');
  await expect.poll(async () => storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  await page.keyboard.press('Escape');

  expect(storedFill(await annotationById(page, first.id)), 'first Cloud must keep red fill after second every-swatch').toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id)), 'first Cloud must keep blue border after second every-swatch').toBe('#0000FF');
  expect(first.id).not.toBe(second.id);
  await assertStillCloud(page, first.id);
  await assertStillCloud(page, second.id);

  // Intended: armed next-draw Cloud uses Fill / Border tabs and stays a cloud.
  await dismissChrome(page);
  await armCloudRect(page);
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await assertCloudTabs(page, { onBorder: false });
  await clickSwatch(page, '#80FF00');
  await clickTab(page, 'Border');
  await assertCloudTabs(page, { onBorder: true });
  await clickSwatch(page, '#FF8000');
  await page.keyboard.press('Escape');
  const nextCloud = await createCloud(page, { x0: 0.16, y0: 0.46, x1: 0.40, y1: 0.60 });
  await expect.poll(async () => storedFill(await annotationById(page, nextCloud.id))).toBe('#80FF00');
  await expect.poll(async () => storedBorder(await annotationById(page, nextCloud.id))).toBe('#FF8000');
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  await assertStillCloud(page, nextCloud.id);

  // Break: Select / empty page invents 0. Pen-armed Color must not clobber
  // already-drawn Cloud fill/border. Solid rect is a different path.
  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await userAnnotationSnapshot(page)).length).toBe(beforeSelect);

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
  expect(storedFill(await annotationById(page, nextCloud.id))).toBe('#80FF00');
  expect(storedBorder(await annotationById(page, nextCloud.id))).toBe('#FF8000');
  await assertStillCloud(page, first.id);
  await assertStillCloud(page, second.id);
  await assertStillCloud(page, nextCloud.id);

  // Edge: undo drops the last next-draw cloud; prior Clouds stay.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === nextCloud.id);
  }).toBe(false);
  expect(storedFill(await annotationById(page, first.id))).toBe('#FF0000');
  expect(storedBorder(await annotationById(page, first.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, second.id))).toBe('#00FFFF');
  await assertStillCloud(page, first.id);
  await assertStillCloud(page, second.id);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Preset colors', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('CLOUD_DESKTOP_SWATCH_PROOF', JSON.stringify({
    first: {
      id: first.id,
      fillProof,
      borderProof,
      restoredFill: '#FF0000',
      restoredBorder: '#0000FF',
    },
    second: { id: second.id, fillProof: secondFillProof, restored: '#00FFFF' },
    nextCloud: { id: nextCloud.id, fill: '#80FF00', border: '#FF8000', undone: true },
    viewBox,
    fileId,
  }));
});
