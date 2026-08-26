import { test, expect } from '@playwright/test';

// 390 mobile stroke Color Opacity was locked at 100 for rect / ellipse /
// rect-mapped imported polygons (minOpacity: 1). Desktop AppShell already
// lifted that floor (2161fa7f). Distinct from leftover-18, Polygon /BS /CA,
// C-03 Line stroke continuum, and C-06 Match Fill. Do not invent a
// create-poly tool. Do not click swatch / hex / Transparent apply.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const HUB = '/?hubPreview=1';
const LIVE_OPACITY = 40;

async function openEditor(page, {
  width = 390,
  height = 844,
  url = LINK_PDF,
} = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('lastShapeTool');
      localStorage.removeItem('lastDrawTool');
      localStorage.removeItem('lastReviewTool');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
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
  return (await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
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

async function dismissMobileSheet(page) {
  const close = page.getByRole('button', { name: /Close (annotation settings|text formatting)/i });
  const count = await close.count();
  for (let i = 0; i < count; i += 1) {
    const button = close.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => {});
    }
  }
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

function parseAlpha(raw) {
  const s = String(raw || '').trim();
  if (!s || s.toLowerCase() === 'none' || s.toLowerCase() === 'transparent') return 0;
  const rgba = s.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)/i);
  if (rgba) return Number(rgba[1]);
  if (/^rgb\(/i.test(s)) return 1;
  if (s.startsWith('#')) return 1;
  return null;
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
        stroke: object.stroke || data.stroke || visual?.getAttribute('stroke') || null,
        strokeOpacity: object.strokeOpacity ?? data.strokeOpacity ?? style.strokeOpacity ?? null,
        visualStroke: visual?.getAttribute('stroke') || null,
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

function strokeAlpha(row) {
  const fromStroke = parseAlpha(row?.stroke);
  if (fromStroke != null) return fromStroke;
  const fromVisual = parseAlpha(row?.visualStroke);
  if (fromVisual != null) return fromVisual;
  if (row?.visualStrokeOpacity != null && row?.visualStrokeOpacity !== '') return Number(row.visualStrokeOpacity);
  if (row?.strokeOpacity != null) return Number(row.strokeOpacity);
  return null;
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

async function createRect(page, coords = { x0: 0.28, y0: 0.30, x1: 0.52, y1: 0.42 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect'
  ));
}

function opacityField(page) {
  return page.getByRole('spinbutton', { name: 'Opacity percentage', exact: true })
    .or(page.getByRole('textbox', { name: 'Opacity percentage', exact: true }))
    .first();
}

function opacitySlider(page) {
  return page.locator('.mobile-pdf-colorpicker-surface input[type="range"]').first();
}

async function openStrokePickerFromSheet(page) {
  await expect(page.getByRole('button', { name: 'Fill and border colors', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await clickVisible(page, 'Fill and border colors');
  const strokeTab = page.getByRole('tab', { name: 'Stroke color', exact: true });
  await expect(strokeTab).toBeVisible({ timeout: 8_000 });
  await strokeTab.click();
  await page.getByRole('button', { name: 'Open stroke color picker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
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
      const data = object.data || {};
      const raw = shape?.getAttribute('points') || '';
      const storedPoints = Array.isArray(object.points) ? object.points.length : 0;
      return {
        id: pdfId || annoId,
        type,
        imported: object.isPdfImported === true || Boolean(pdfId),
        points: storedPoints || raw.trim().split(/\s+/).filter(Boolean).length,
        stroke: object.stroke ?? data.stroke ?? null,
        visualStroke: shape?.getAttribute('stroke') || '',
        shapeKind: shape?.getAttribute('data-shape-kind') || null,
      };
    }).filter((row) => (
      row.type === 'polygon'
      || row.type === 'polyline'
      || row.shapeKind === 'polygon'
      || row.shapeKind === 'polyline'
      || row.shapeKind === 'cloud-polygon'
    ));
  });
}

async function listPolyGeom(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-pdf-annotation-type]')];
    return groups.map((group) => {
      const pdfId = group.getAttribute('data-pdf-annotation-id') || '';
      const type = String(group.getAttribute('data-pdf-annotation-type') || '').toLowerCase();
      const shape = group.querySelector('[data-shape-kind="polygon"], [data-shape-kind="polyline"], [data-shape-kind="cloud-polygon"]');
      const object = window.__phase35GetAnnotationById?.(pdfId) || {};
      const raw = shape?.getAttribute('points') || '';
      const transform = shape?.getAttribute('transform') || '';
      const match = /translate\(([-0-9.]+),\s*([-0-9.]+)\)/.exec(transform);
      const left = match ? Number(match[1]) : 0;
      const top = match ? Number(match[2]) : 0;
      let points = raw.trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
      if (!points.length && Array.isArray(object.points)) {
        points = object.points.map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }));
      }
      return {
        id: pdfId,
        type,
        points,
        world: points.map((point) => ({ x: point.x + left, y: point.y + top })),
      };
    }).filter((row) => row.points.length >= 3);
  });
}

async function pageToScreen(page, x, y) {
  const box = await pageBox(page);
  const raw = await pageViewBox(page);
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  const W = parts[2] || 612;
  const H = parts[3] || 792;
  return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
}

async function waitImportedPolygon(page) {
  let polys = [];
  await expect.poll(async () => {
    polys = await polySnapshot(page);
    const byKind = await page.locator('[data-shape-kind="polygon"], [data-shape-kind="polyline"]').count();
    return Math.max(polys.filter((row) => row.imported && row.points >= 3).length, byKind);
  }, { message: 'expected imported polygon + polyline', timeout: 45_000 }).toBeGreaterThanOrEqual(3);
  const polyA = polys.find((row) => (
    (row.type === 'polygon' || row.shapeKind === 'polygon')
    && row.shapeKind !== 'cloud-polygon'
    && row.points === 4
  )) || polys.find((row) => row.points === 4 && row.shapeKind !== 'cloud-polygon');
  expect(polyA?.id, 'polygon A').toBeTruthy();
  return polyA;
}

async function selectPoly(page, id) {
  await dismissChrome(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const rows = await listPolyGeom(page);
    const geom = rows.find((row) => row.id === id);
    if (!geom) return 0;
    const xs = geom.world.map((p) => p.x);
    const ys = geom.world.map((p) => p.y);
    const screen = await pageToScreen(
      page,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    );
    await page.mouse.click(screen.x, screen.y);
    const style = await page.getByRole('button', { name: 'Style', exact: true }).first().isVisible().catch(() => false);
    const colors = await page.getByRole('button', { name: 'Fill and border colors', exact: true }).first().isVisible().catch(() => false);
    return (style || colors) ? 1 : 0;
  }, { timeout: 12_000, message: `expected Style or Fill and border colors on selected polygon ${id}` }).toBe(1);
}

test('390 rect Border Opacity can leave 100 intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844, url: LINK_PDF });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);

  const rect = await createRect(page);
  expect(rect.id).toBeTruthy();
  await openStrokePickerFromSheet(page);

  const slider = opacitySlider(page);
  await expect(slider).toBeVisible();
  expect(await slider.getAttribute('min'), 'slider min must be 0').toBe('0');

  const field = opacityField(page);
  await expect(field).toBeVisible();
  await field.fill(String(LIVE_OPACITY));
  await expect(field).toHaveValue(String(LIVE_OPACITY));

  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    const row = rows.find((item) => item.id === rect.id);
    return strokeAlpha(row);
  }, { message: '390 rect Border Opacity 40 must write stroke 0.4' }).toBeCloseTo(0.4, 2);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0);
  await dismissMobileSheet(page);
  await closePagesOverlay(page);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Open stroke color picker', exact: true }).count(), 'hubPreview Open stroke color picker must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  await openEditor(page, { width: 1440, height: 900, url: LINK_PDF });
  expect(await page.getByRole('button', { name: 'Open stroke color picker', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count(), 'do not invent a create-poly tool').toBe(0);

  console.log('MOBILE_STROKE_MIN_OPACITY_390_RECT_PROOF', JSON.stringify({
    rectId: rect.id,
    field: LIVE_OPACITY,
    sliderMin: 0,
    viewBox,
    fileId: null,
  }));
});

test('390 imported polygon Border Opacity can leave 100', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844, url: POLY_PDF });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);

  const polyA = await waitImportedPolygon(page);
  await selectPoly(page, polyA.id);
  await openStrokePickerFromSheet(page);

  const slider = opacitySlider(page);
  await expect(slider).toBeVisible();
  expect(await slider.getAttribute('min'), 'imported polygon slider min must be 0').toBe('0');

  const field = opacityField(page);
  await expect(field).toBeVisible();
  await field.fill(String(LIVE_OPACITY));
  await expect(field).toHaveValue(String(LIVE_OPACITY));

  await expect.poll(async () => {
    const rows = await polySnapshot(page);
    const row = rows.find((item) => item.id === polyA.id);
    return parseAlpha(row?.stroke) ?? parseAlpha(row?.visualStroke);
  }, { message: '390 imported polygon Border Opacity 40 must write stroke 0.4' }).toBeCloseTo(0.4, 2);

  await page.keyboard.press('Escape');
  await dismissMobileSheet(page);

  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count(), 'do not invent a create-poly tool').toBe(0);
  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('MOBILE_STROKE_MIN_OPACITY_390_POLY_PROOF', JSON.stringify({
    polyId: polyA.id,
    field: LIVE_OPACITY,
    sliderMin: 0,
    viewBox,
    fileId: null,
  }));
});
