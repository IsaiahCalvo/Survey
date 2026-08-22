import { test, expect } from '@playwright/test';

// Poly / Cloud Style dash — every discrete Solid / Dashed / Dotted
// on imported polygon + polyline, plus Cloud on polygon
// (`cloud-polygon`). Distinct from Rect/Ellipse/Text every-style,
// Line/Arrow/Callout every-style, Cloud bump 1–20, and Poly every-swatch.
// No create-poly tool (selected-patch only). Leftover-18 / X-01 parked.
// No file.id.

const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
const HUB = '/?hubPreview=1';

const DASH_STYLES = [
  { value: 'solid', label: 'Solid', dash: null },
  { value: 'dashed', label: 'Dashed', dash: [6, 4] },
  { value: 'dotted', label: 'Dotted', dash: [2, 4] },
];

const POLY_STYLES = [
  ...DASH_STYLES,
  { value: 'cloud', label: 'Cloud', dash: null, cloud: true },
];

function dashKey(value) {
  if (value == null) return 'solid';
  const arr = Array.isArray(value)
    ? value.map(Number)
    : String(value).split(/[,\s]+/).filter(Boolean).map(Number);
  if (!arr.length || arr.every((n) => !n)) return 'solid';
  if (arr[0] === 6 && arr[1] === 4) return 'dashed';
  if (arr[0] === 2 && arr[1] === 4) return 'dotted';
  return arr.join(',');
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
      const data = object.data || {};
      const raw = shape?.getAttribute('points') || '';
      const storedPoints = Array.isArray(object.points) ? object.points.length : 0;
      return {
        id: pdfId || annoId,
        annoId,
        type,
        imported: object.isPdfImported === true || Boolean(pdfId),
        points: storedPoints || raw.trim().split(/\s+/).filter(Boolean).length,
        strokeDashArray: object.strokeDashArray ?? data.strokeDashArray ?? null,
        pdfCloudIntensity: data.pdfCloudIntensity ?? object.pdfCloudIntensity ?? null,
        shapeKind: shape?.getAttribute('data-shape-kind') || null,
        visualDash: shape?.getAttribute('stroke-dasharray') || null,
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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  });
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function vertexHandlesOn(page, id) {
  const handles = page.locator('circle[data-handle^="vertex-"]');
  const count = await handles.count();
  const rows = await listPolyGeom(page);
  const geom = rows.find((row) => row.id === id);
  if (!geom || count < 3) return false;
  const xs = geom.world.map((p) => p.x);
  const ys = geom.world.map((p) => p.y);
  const topLeft = await pageToScreen(page, Math.min(...xs), Math.min(...ys));
  const bottomRight = await pageToScreen(page, Math.max(...xs), Math.max(...ys));
  const points = await handles.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }));
  const near = points.filter((point) => (
    point.x >= topLeft.x - 28 && point.x <= bottomRight.x + 28
    && point.y >= topLeft.y - 28 && point.y <= bottomRight.y + 28
  ));
  if (near.length < 3) return false;
  return page.getByRole('button', { name: 'Style', exact: true }).first().isVisible()
    .catch(async () => page.getByRole('button', { name: /^Border style:/ }).first().isVisible().catch(() => false));
}

async function styleVisible(page) {
  if (await page.getByRole('button', { name: 'Style', exact: true }).first().isVisible().catch(() => false)) return true;
  return page.getByRole('button', { name: /^Border style:/ }).first().isVisible().catch(() => false);
}

async function selectPoly(page, id) {
  await selectMode(page);
  if (await vertexHandlesOn(page, id) && await styleVisible(page)) return;
  const handles = page.locator('circle[data-handle^="vertex-"]');
  await expect.poll(async () => {
    const rows = await listPolyGeom(page);
    const geom = rows.find((row) => row.id === id);
    if (!geom) return 0;
    if (geom.type === 'polyline') await clickPolylineStroke(page, geom);
    else await clickCentroid(page, geom);
    return handles.count();
  }, { timeout: 12_000 }).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => styleVisible(page), {
    message: `expected Style on selected poly ${id}`,
    timeout: 8_000,
  }).toBeTruthy();
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

async function waitImported(page) {
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
  return { polyA, polyLine, polyB };
}

function desktopStyleTrigger(page) {
  return page.getByRole('button', { name: 'Style', exact: true }).first();
}

async function listDesktopOptions(page, trigger, listboxName) {
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: listboxName })).toBeVisible({ timeout: 5_000 });
  const values = (await popover.getByRole('option').allTextContents()).map((text) => text.trim());
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  return values;
}

async function pickDesktopOption(page, trigger, listboxName, label) {
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: listboxName })).toBeVisible({ timeout: 5_000 });
  await popover.getByRole('option', { name: label, exact: true }).click();
  await expect(popover).toHaveCount(0);
}

async function listMobileOptions(page, ariaLabel) {
  const trigger = page.getByRole('button', { name: new RegExp(`^${ariaLabel}:`) }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const listbox = page.getByRole('listbox', { name: ariaLabel });
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  const values = (await listbox.getByRole('option').allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  await listbox.press('Escape').catch(() => {});
  if (await listbox.count()) await trigger.click();
  await expect(listbox).toHaveCount(0);
  return values;
}

async function pickMobileOption(page, ariaLabel, label) {
  const trigger = page.getByRole('button', { name: new RegExp(`^${ariaLabel}:`) }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const listbox = page.getByRole('listbox', { name: ariaLabel });
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  await listbox.getByRole('option', { name: label, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}

function expectDash(row, style, label) {
  expect(dashKey(row.strokeDashArray), `${label} stored dash`).toBe(style.value === 'cloud' ? 'solid' : style.value);
  expect(dashKey(row.visualDash), `${label} SVG stroke-dasharray`).toBe(style.value === 'cloud' ? 'solid' : style.value);
}

function expectCloud(row, on, label) {
  if (on) {
    expect(Number.isFinite(Number(row.pdfCloudIntensity)), `${label} stores pdfCloudIntensity`).toBe(true);
    expect(row.shapeKind, `${label} SVG kind`).toBe('cloud-polygon');
    expect(dashKey(row.strokeDashArray), `${label} cloud stored dash`).toBe('solid');
  } else {
    expect(row.pdfCloudIntensity == null || row.pdfCloudIntensity === '', `${label} clears cloud`).toBe(true);
    expect(row.shapeKind, `${label} not a cloud path`).not.toBe('cloud-polygon');
  }
}

function expectPolyStyle(row, style, label) {
  if (style.cloud || style.value === 'cloud') {
    expectCloud(row, true, label);
    return;
  }
  expectCloud(row, false, label);
  expectDash(row, style, label);
  expect(row.shapeKind, `${label} stays a polygon`).toBe('polygon');
}

async function patchPolyEveryStyle(page, id, styles, pick) {
  const proof = [];
  for (const style of styles) {
    await pick(style.label);
    await expect.poll(async () => {
      const row = await annotationById(page, id);
      if (style.value === 'cloud') return row?.shapeKind === 'cloud-polygon' ? 'cloud' : `pending:${row?.shapeKind}`;
      return `${dashKey(row?.strokeDashArray)}|${row?.shapeKind}`;
    }).toBe(style.value === 'cloud' ? 'cloud' : `${style.value}|${styles === POLY_STYLES ? 'polygon' : 'polyline'}`);
    const row = await annotationById(page, id);
    if (styles === POLY_STYLES) expectPolyStyle(row, style, `selected-patch ${id} ${style.label}`);
    else {
      expectCloud(row, false, `selected-patch ${id} ${style.label}`);
      expectDash(row, style, `selected-patch ${id} ${style.label}`);
      expect(row.shapeKind).toBe('polyline');
    }
    proof.push(style.value);
  }
  return proof;
}

test('catalog: Poly Style is Solid/Dashed/Dotted/Cloud; polyline omits Cloud', () => {
  expect(POLY_STYLES.map((row) => row.value)).toEqual(['solid', 'dashed', 'dotted', 'cloud']);
  expect(DASH_STYLES.map((row) => row.value)).toEqual(['solid', 'dashed', 'dotted']);
});

test('desktop Poly / Cloud Style every discrete value intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const { polyA, polyLine, polyB } = await waitImported(page);
  expect(polyA.shapeKind).toBe('polygon');
  expect(polyLine.shapeKind).toBe('polyline');
  expect(polyB.shapeKind).toBe('polygon');

  await selectPoly(page, polyA.id);
  const polyStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(polyStyles, 'selected polygon Style catalog is Solid / Dashed / Dotted / Cloud')
    .toEqual(POLY_STYLES.map((row) => row.label));

  const selectedPolyProof = await patchPolyEveryStyle(
    page,
    polyA.id,
    POLY_STYLES,
    (label) => pickDesktopOption(page, desktopStyleTrigger(page), 'Style', label),
  );
  expect(selectedPolyProof).toEqual(POLY_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dashed');
  await expect.poll(async () => dashKey((await annotationById(page, polyA.id))?.strokeDashArray)).toBe('dashed');
  expectCloud(await annotationById(page, polyA.id), false, 'polygon Cloud→Dashed clears cloud');
  expectDash(await annotationById(page, polyA.id), DASH_STYLES[1], 'polygon Cloud→Dashed');

  await selectPoly(page, polyLine.id);
  const lineStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(lineStyles, 'selected polyline Style catalog is Solid / Dashed / Dotted')
    .toEqual(DASH_STYLES.map((row) => row.label));
  expect(lineStyles.join(' | ')).not.toMatch(/cloud/i);

  const selectedLineProof = await patchPolyEveryStyle(
    page,
    polyLine.id,
    DASH_STYLES,
    (label) => pickDesktopOption(page, desktopStyleTrigger(page), 'Style', label),
  );
  expect(selectedLineProof).toEqual(DASH_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  await expect.poll(async () => dashKey((await annotationById(page, polyLine.id))?.strokeDashArray)).toBe('dotted');

  await activateTool(page, 'Shapes', 'Rectangle');
  expect(await page.getByRole('button', { name: 'Polygon', exact: true }).count(), 'no create-poly tool').toBe(0);
  expect(await page.getByRole('button', { name: 'Polyline', exact: true }).count()).toBe(0);
  expect((await polySnapshot(page)).length).toBe(3);

  await activateTool(page, 'Draw', 'Pen');
  expect(await desktopStyleTrigger(page).count(), 'Pen-armed Style must hide').toBe(0);
  expectDash(await annotationById(page, polyA.id), DASH_STYLES[1], 'Pen-armed must not rewrite first dashed polygon');
  expectDash(await annotationById(page, polyLine.id), DASH_STYLES[2], 'Pen-armed must not rewrite first dotted polyline');

  await selectPoly(page, polyB.id);
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  await expect.poll(async () => dashKey((await annotationById(page, polyB.id))?.strokeDashArray)).toBe('dotted');
  expectDash(await annotationById(page, polyA.id), DASH_STYLES[1], 'first dashed polygon held');
  expectDash(await annotationById(page, polyLine.id), DASH_STYLES[2], 'first dotted polyline held');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => dashKey((await annotationById(page, polyB.id))?.strokeDashArray)).toBe('solid');
  expectDash(await annotationById(page, polyA.id), DASH_STYLES[1], 'undo keeps first dashed polygon');
  expectDash(await annotationById(page, polyLine.id), DASH_STYLES[2], 'undo keeps first dotted polyline');
  expect((await annotationById(page, polyB.id)).shapeKind).toBe('polygon');

  const beforeSelect = (await polySnapshot(page)).length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 16, empty.y + 16);
  expect((await polySnapshot(page)).length, 'Select / empty page invents 0').toBe(beforeSelect);

  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('POLY_CLOUD_DASH_DESKTOP_PROOF', JSON.stringify({
    polyStyles,
    lineStyles,
    polyA: polyA.id,
    polyB: polyB.id,
    polyLine: polyLine.id,
    selectedPolyProof,
    selectedLineProof,
    viewBox,
    fileId,
  }));
});

test('390 Poly / Cloud Style every discrete value intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const { polyA, polyLine, polyB } = await waitImported(page);

  await selectPoly(page, polyA.id);
  const polyStyles = await listMobileOptions(page, 'Border style');
  expect(polyStyles, '390 polygon Border style catalog').toEqual(POLY_STYLES.map((row) => row.label));

  const selectedPolyProof = await patchPolyEveryStyle(
    page,
    polyA.id,
    POLY_STYLES,
    (label) => pickMobileOption(page, 'Border style', label),
  );
  expect(selectedPolyProof).toEqual(POLY_STYLES.map((row) => row.value));
  await pickMobileOption(page, 'Border style', 'Dashed');
  await expect.poll(async () => dashKey((await annotationById(page, polyA.id))?.strokeDashArray)).toBe('dashed');
  expectCloud(await annotationById(page, polyA.id), false, '390 polygon Cloud→Dashed clears cloud');

  await selectPoly(page, polyLine.id);
  const lineStyles = await listMobileOptions(page, 'Border style');
  expect(lineStyles).toEqual(DASH_STYLES.map((row) => row.label));
  expect(lineStyles.join(' | ')).not.toMatch(/cloud/i);

  const selectedLineProof = await patchPolyEveryStyle(
    page,
    polyLine.id,
    DASH_STYLES,
    (label) => pickMobileOption(page, 'Border style', label),
  );
  expect(selectedLineProof).toEqual(DASH_STYLES.map((row) => row.value));

  await selectPoly(page, polyB.id);
  await pickMobileOption(page, 'Border style', 'Dotted');
  await expect.poll(async () => dashKey((await annotationById(page, polyB.id))?.strokeDashArray)).toBe('dotted');
  expectDash(await annotationById(page, polyA.id), DASH_STYLES[1], '390 first dashed polygon held');
  expectDash(await annotationById(page, polyLine.id), DASH_STYLES[2], '390 first dotted polyline held');

  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: /^Border style:/ }).count()).toBe(0);

  console.log('POLY_CLOUD_DASH_390_PROOF', JSON.stringify({
    polyStyles,
    lineStyles,
    polyA: polyA.id,
    polyB: polyB.id,
    polyLine: polyLine.id,
    selectedPolyProof,
    selectedLineProof,
    viewBox,
    fileId,
  }));
});
