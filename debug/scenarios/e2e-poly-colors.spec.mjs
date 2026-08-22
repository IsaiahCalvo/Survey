import { test, expect } from '@playwright/test';

// Poly desktop Color every-swatch — CompactColorPicker on imported
// polygon Fill+Border (`contextTool` maps to rect) and polyline stroke
// (`contextTool` maps to line). No create-poly tool. Distinct from
// Cloud/Text/Callout Fill+Border, Line/Arrow stroke, selected-solid-rect
// pickers, and vertex-N / bbox leftovers. Leftover-18 / X-01 parked.
// No file.id.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const HUB = '/?hubPreview=1';

const COLOR_PICKER_PRESETS = [
  'transparent',
  '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
  '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
];

const SOLID_SWATCHES = COLOR_PICKER_PRESETS.filter((c) => c !== 'transparent');
const FILL_ORDER = [...SOLID_SWATCHES, 'transparent'];
const BORDER_ORDER = [...SOLID_SWATCHES];
const STROKE_ORDER = [...SOLID_SWATCHES, 'transparent'];

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

function storedStroke(row) {
  return colorKey(row?.stroke || row?.visualStroke);
}

function isTransparentFill(row) {
  const opacity = Number(row?.fillOpacity ?? row?.opacity ?? 1);
  if (opacity === 0 && storedFill(row) !== storedStroke(row)) return true;
  return storedFill(row) === 'TRANSPARENT';
}

function isTransparentStroke(row) {
  const opacity = Number(row?.strokeOpacity ?? row?.opacity ?? 1);
  if (opacity === 0) return true;
  return storedStroke(row) === 'TRANSPARENT';
}

async function openEditor(page, { width = 1440, height = 900, url = POLY_PDF } = {}) {
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

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  return { raw, W: parts[2] || 612, H: parts[3] || 792 };
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const { W, H } = await pageViewBox(page);
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
}

async function polySnapshot(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const annoId = group.getAttribute('data-anno-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"], [data-shape-kind="cloud-polygon"]');
      const object = (annoId && window.__phase35GetAnnotationById?.(annoId))
        || (pdfId && window.__phase35GetAnnotationById?.(pdfId))
        || {};
      const raw = shape?.getAttribute('points') || '';
      return {
        id: pdfId || annoId,
        annoId,
        type,
        imported: object.isPdfImported === true || Boolean(pdfId),
        fill: object.fill || null,
        stroke: object.stroke || null,
        opacity: object.opacity ?? null,
        fillOpacity: object.fillOpacity ?? null,
        strokeOpacity: object.strokeOpacity ?? null,
        shapeKind: shape?.getAttribute('data-shape-kind') || null,
        visualFill: shape?.getAttribute('fill') || null,
        visualStroke: shape?.getAttribute('stroke') || null,
        points: raw.trim().split(/\s+/).filter(Boolean).length,
      };
    }).filter((row) => row.type === 'polygon' || row.type === 'polyline');
  });
}

async function annotationById(page, id) {
  return (await polySnapshot(page)).find((row) => row.id === id) || null;
}

async function listPolyGeom(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"]');
      const raw = shape?.getAttribute('points') || '';
      const transform = shape?.getAttribute('transform') || '';
      const match = /translate\(([-0-9.]+),\s*([-0-9.]+)\)/.exec(transform);
      const left = match ? Number(match[1]) : 0;
      const top = match ? Number(match[2]) : 0;
      const points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      return {
        id: pdfId,
        type,
        points,
        world: points.map((point) => ({ x: point.x + left, y: point.y + top })),
      };
    }).filter((row) => (row.type === 'polygon' || row.type === 'polyline') && row.points.length >= 3);
  });
}

async function clickCentroid(page, geom) {
  const xs = geom.world.map((p) => p.x);
  const ys = geom.world.map((p) => p.y);
  const screen = await pageToScreen(
    page,
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  );
  await page.mouse.click(screen.x, screen.y);
}

async function clickPolylineStroke(page, geom) {
  const a = geom.world[0];
  const b = geom.world[1] || a;
  const screen = await pageToScreen(page, (a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.click(screen.x, screen.y);
}

async function selectMode(page) {
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function vertexHandlesOn(page, id) {
  const handles = page.locator('circle[data-handle^="vertex-"]');
  const count = await handles.count();
  if (!count) return false;
  const rows = await listPolyGeom(page);
  const geom = rows.find((row) => row.id === id);
  if (!geom || count < geom.points.length) return false;
  return page.getByRole('button', { name: 'Color', exact: true }).first().isVisible().catch(() => false);
}

async function selectPoly(page, id) {
  // Color only patches when activeTool === 'select'. Do not Escape first:
  // that drops a just-created selection. Skip the page re-click when this
  // poly is already selected — a second click races CompactColorPicker's
  // outside-dismiss and leaves Color focused with the popover unmounted.
  await selectMode(page);
  if (await vertexHandlesOn(page, id)) {
    await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 8_000 });
    return;
  }
  const handles = page.locator('circle[data-handle^="vertex-"]');
  await expect.poll(async () => {
    const rows = await listPolyGeom(page);
    const geom = rows.find((row) => row.id === id);
    if (!geom) return 0;
    if (geom.type === 'polyline') await clickPolylineStroke(page, geom);
    else await clickCentroid(page, geom);
    return handles.count();
  }, { timeout: 12_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('button', { name: 'Color', exact: true }).first()).toBeVisible({ timeout: 8_000 });
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

async function dismissChrome(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
}

async function openColorPicker(page) {
  const trigger = page.getByRole('button', { name: 'Color', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  const picker = page.locator('[data-annotation-color-picker]');
  if (await picker.isVisible().catch(() => false)) {
    await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
    return;
  }
  await trigger.click();
  if (!(await picker.isVisible().catch(() => false))) {
    await page.waitForTimeout(80);
    if (!(await picker.isVisible().catch(() => false))) {
      await trigger.click();
    }
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

async function assertPolygonTabs(page, { onBorder = false } = {}) {
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

async function assertPolylineStrokeOnly(page) {
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Border', exact: true }).count()).toBe(0);
  await expect(page.locator('button[title="Transparent"]')).toBeVisible();
  expect(await page.locator('button[title="Match fill"]').count()).toBe(0);
}

async function assertStillKind(page, id, kind) {
  const row = await annotationById(page, id);
  expect(row, `${id} still present`).toBeTruthy();
  expect(row.type).toBe(kind === 'polyline' ? 'polyline' : 'polygon');
  expect(row.shapeKind).toBe(kind);
}

async function patchPolygonFillEverySwatch(page, id) {
  await selectPoly(page, id);
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await assertPolygonTabs(page, { onBorder: false });
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
    await assertStillKind(page, id, 'polygon');
  }
  expect(proof.map((row) => row.swatch)).toEqual(FILL_ORDER);
  return proof;
}

async function patchPolygonBorderEverySwatch(page, id) {
  await selectPoly(page, id);
  await openColorPicker(page);
  await clickTab(page, 'Border');
  await assertPolygonTabs(page, { onBorder: true });
  const proof = [];
  for (const swatch of BORDER_ORDER) {
    await clickSwatch(page, swatch);
    await expect.poll(async () => storedStroke(await annotationById(page, id))).toBe(swatch);
    await assertStillKind(page, id, 'polygon');
    proof.push({ swatch, stored: swatch });
  }
  await page.locator('button[title="Match fill"]').click();
  const fillNow = storedFill(await annotationById(page, id));
  await expect.poll(async () => storedStroke(await annotationById(page, id))).toBe(fillNow);
  await assertStillKind(page, id, 'polygon');
  proof.push({ swatch: 'match-fill', stored: fillNow });
  expect(proof.map((row) => row.swatch)).toEqual([...BORDER_ORDER, 'match-fill']);
  return proof;
}

async function patchPolylineStrokeEverySwatch(page, id) {
  await selectPoly(page, id);
  await openColorPicker(page);
  await assertPolylineStrokeOnly(page);
  const proof = [];
  for (const swatch of STROKE_ORDER) {
    await clickSwatch(page, swatch);
    if (swatch === 'transparent') {
      await expect.poll(async () => isTransparentStroke(await annotationById(page, id))).toBeTruthy();
      proof.push({ swatch, stored: 'TRANSPARENT' });
    } else {
      await expect.poll(async () => storedStroke(await annotationById(page, id))).toBe(swatch);
      proof.push({ swatch, stored: swatch });
    }
    await assertStillKind(page, id, 'polyline');
  }
  expect(proof.map((row) => row.swatch)).toEqual(STROKE_ORDER);
  return proof;
}

test('catalog: Poly desktop CompactColorPicker is the 16-swatch Fill/Border + stroke grid', () => {
  expect([...COLOR_PICKER_PRESETS]).toEqual([
    'transparent',
    '#FF0000', '#FF0080', '#FF00FF', '#8000FF', '#0000FF', '#0080FF', '#00FFFF',
    '#00FF80', '#00FF00', '#80FF00', '#FFFF00', '#FF8000', '#FFFFFF', '#808080', '#000000',
  ]);
  expect(COLOR_PICKER_PRESETS).toHaveLength(16);
  expect(SOLID_SWATCHES).toHaveLength(15);
});

test('desktop Poly CompactColorPicker Fill + Border + polyline stroke every swatch intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  let polys = [];
  await expect.poll(async () => {
    polys = await polySnapshot(page);
    return polys.filter((row) => row.imported && row.points >= 3).length;
  }, { message: 'expected imported polygon + polyline' }).toBeGreaterThanOrEqual(3);

  const polyA = polys.find((row) => row.type === 'polygon' && row.points === 4);
  const polyLine = polys.find((row) => row.type === 'polyline');
  const polyB = polys.find((row) => row.type === 'polygon' && row.points === 3 && row.id !== polyA?.id);
  expect(polyA?.id, 'polygon A').toBeTruthy();
  expect(polyLine?.id, 'polyline').toBeTruthy();
  expect(polyB?.id, 'polygon B').toBeTruthy();
  expect(polyA.id).not.toBe(polyB.id);
  expect(polyA.shapeKind).toBe('polygon');
  expect(polyLine.shapeKind).toBe('polyline');

  const fillProof = await patchPolygonFillEverySwatch(page, polyA.id);
  await clickSwatch(page, '#FF0000');
  await expect.poll(async () => storedFill(await annotationById(page, polyA.id))).toBe('#FF0000');

  const borderProof = await patchPolygonBorderEverySwatch(page, polyA.id);
  await clickSwatch(page, '#0000FF');
  await expect.poll(async () => storedStroke(await annotationById(page, polyA.id))).toBe('#0000FF');
  await expect.poll(async () => storedFill(await annotationById(page, polyA.id))).toBe('#FF0000');
  await assertStillKind(page, polyA.id, 'polygon');
  await page.keyboard.press('Escape');

  const secondFillProof = await patchPolygonFillEverySwatch(page, polyB.id);
  await clickSwatch(page, '#00FFFF');
  await expect.poll(async () => storedFill(await annotationById(page, polyB.id))).toBe('#00FFFF');
  await page.keyboard.press('Escape');

  expect(storedFill(await annotationById(page, polyA.id)), 'polygon A must keep red fill after B every-swatch').toBe('#FF0000');
  expect(storedStroke(await annotationById(page, polyA.id)), 'polygon A must keep blue border after B every-swatch').toBe('#0000FF');
  await assertStillKind(page, polyA.id, 'polygon');
  await assertStillKind(page, polyB.id, 'polygon');

  const lineProof = await patchPolylineStrokeEverySwatch(page, polyLine.id);
  await clickSwatch(page, '#FF8000');
  await expect.poll(async () => storedStroke(await annotationById(page, polyLine.id))).toBe('#FF8000');
  await page.keyboard.press('Escape');

  expect(storedFill(await annotationById(page, polyA.id))).toBe('#FF0000');
  expect(storedStroke(await annotationById(page, polyA.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, polyB.id))).toBe('#00FFFF');
  await assertStillKind(page, polyLine.id, 'polyline');

  // No create-poly tool: armed next-draw cannot stamp a new polygon/polyline.
  await selectMode(page);
  const emptyBefore = await pageBox(page);
  await page.mouse.click(emptyBefore.x + 16, emptyBefore.y + 16);
  await activateTool(page, 'Shapes', 'Rectangle');
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Polyline', exact: true }).count()).toBe(0);
  expect((await polySnapshot(page)).length).toBe(3);

  // Break: Select / empty page invents 0. Pen-armed Color must not clobber
  // already-imported poly fill/border/stroke.
  const beforeSelect = (await polySnapshot(page)).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await polySnapshot(page)).length).toBe(beforeSelect);

  await activateTool(page, 'Draw', 'Pen');
  const colorBtn = page.getByRole('button', { name: 'Color', exact: true }).first();
  await colorBtn.click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: 'Fill', exact: true }).count()).toBe(0);
  await page.locator('button[title="#00FF00"]').first().click();
  await page.keyboard.press('Escape');
  expect(storedFill(await annotationById(page, polyA.id))).toBe('#FF0000');
  expect(storedStroke(await annotationById(page, polyA.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, polyB.id))).toBe('#00FFFF');
  expect(storedStroke(await annotationById(page, polyLine.id))).toBe('#FF8000');
  await assertStillKind(page, polyA.id, 'polygon');
  await assertStillKind(page, polyB.id, 'polygon');
  await assertStillKind(page, polyLine.id, 'polyline');

  // Edge: undo drops the last dedicated color patch; imported polys stay.
  await selectPoly(page, polyA.id);
  await openColorPicker(page);
  await clickTab(page, 'Fill');
  await clickSwatch(page, '#FFFF00');
  await expect.poll(async () => storedFill(await annotationById(page, polyA.id))).toBe('#FFFF00');
  await page.keyboard.press('Escape');
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => storedFill(await annotationById(page, polyA.id))).toBe('#FF0000');
  expect(storedStroke(await annotationById(page, polyA.id))).toBe('#0000FF');
  expect(storedFill(await annotationById(page, polyB.id))).toBe('#00FFFF');
  expect(storedStroke(await annotationById(page, polyLine.id))).toBe('#FF8000');
  await assertStillKind(page, polyA.id, 'polygon');
  await assertStillKind(page, polyB.id, 'polygon');
  await assertStillKind(page, polyLine.id, 'polyline');

  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Preset colors', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('POLY_DESKTOP_SWATCH_PROOF', JSON.stringify({
    polyA: {
      id: polyA.id,
      fillProof,
      borderProof,
      restoredFill: '#FF0000',
      restoredBorder: '#0000FF',
    },
    polyB: { id: polyB.id, fillProof: secondFillProof, restored: '#00FFFF' },
    polyLine: { id: polyLine.id, strokeProof: lineProof, restored: '#FF8000' },
    noCreateTool: true,
    viewBox,
    fileId,
  }));
});
