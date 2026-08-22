import { test, expect } from '@playwright/test';

// Line / Arrow dash + arrowhead — every discrete Style and every discrete
// Arrowhead. Distinct from UL-33 catalog smoke (rect Dashed/Dotted + ellipse
// omits Cloud), S-04 selected-arrow sample (vShape / Open circle / None),
// color every-swatch, and Width every-preset. Leftover-18 / X-01 parked.
// No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const DASH_STYLES = [
  { value: 'solid', label: 'Solid', dash: null },
  { value: 'dashed', label: 'Dashed', dash: [6, 4] },
  { value: 'dotted', label: 'Dotted', dash: [2, 4] },
];

const ARROWHEAD_STYLES = [
  { value: 'none', label: 'None', mobileLabel: 'None' },
  { value: 'solidTriangle', label: 'Solid triangle', mobileLabel: 'Solid Triangle' },
  { value: 'vShape', label: 'V-shape', mobileLabel: 'V-Shape' },
  { value: 'openCircle', label: 'Open circle', mobileLabel: 'Open Circle' },
  { value: 'openTriangle', label: 'Open triangle', mobileLabel: 'Open Triangle' },
  { value: 'horizontalLine', label: 'Horizontal line', mobileLabel: 'Horizontal Line' },
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

function visualArrowheadKind(row) {
  if (row.visualCircle) return 'openCircle';
  if (row.visualPolyline) return 'vShape';
  if (row.visualPolygon && row.visualPolygonFill === 'none') return 'openTriangle';
  if (row.visualPolygon) return 'solidTriangle';
  if (row.visualTick) return 'horizontalLine';
  return 'none';
}

function isLineRow(row) {
  return row.tool === 'line' || (row.type === 'line' && row.tool !== 'arrow');
}

function isArrowRow(row) {
  return row.tool === 'arrow' || row.type === 'arrow';
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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  });
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
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

async function deselectEmpty(page) {
  await page.keyboard.press('Escape');
  const box = await pageBox(page);
  await page.mouse.click(box.x + 10, box.y + 10);
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
      if (object.isPdfImported === true) return null;
      const group = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const shaft = group?.querySelector('line, path');
      const polygon = group?.querySelector('polygon');
      const circle = group?.querySelector('circle:not([data-handle])');
      const polyline = group?.querySelector('polyline');
      const lines = [...(group?.querySelectorAll('line') || [])];
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        strokeDashArray: object.strokeDashArray ?? data.strokeDashArray ?? style.strokeDashArray ?? null,
        arrowheadStyle: data.arrowheadStyle || style.arrowheadStyle || object.arrowheadStyle || null,
        visualDash: shaft?.getAttribute('stroke-dasharray') || null,
        visualPolygon: !!polygon,
        visualPolygonFill: polygon?.getAttribute('fill') || null,
        visualCircle: !!circle,
        visualPolyline: !!polyline,
        visualTick: lines.length > 1,
      };
    }).filter(Boolean);
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

async function lineGeom(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    const cx = (object.left ?? 0) + (object.width ?? 0) / 2;
    const cy = (object.top ?? 0) + (object.height ?? 0) / 2;
    return {
      id: annoId,
      x1: cx + (object.x1 ?? 0),
      y1: cy + (object.y1 ?? 0),
      x2: cx + (object.x2 ?? 0),
      y2: cy + (object.y2 ?? 0),
      midpoint: object.data?.midpoint ? { x: object.data.midpoint.x, y: object.data.midpoint.y } : null,
    };
  }, id);
}

async function clickLineStroke(page, id) {
  const geom = await lineGeom(page, id);
  const x = geom.midpoint?.x ?? (geom.x1 + (geom.x2 - geom.x1) * 0.38);
  const y = geom.midpoint?.y ?? (geom.y1 + (geom.y2 - geom.y1) * 0.38);
  const screen = await pageToScreen(page, x, y);
  await page.mouse.click(screen.x, screen.y);
}

async function selectStroke(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    await clickLineStroke(page, id);
    const mid = await page.locator('circle[data-handle="midpoint"]').count();
    if (mid > 0) return mid;
    const target = page.locator(`[data-shape-id="${id}"], [data-svg-annotation-layer] [data-anno-id="${id}"]`).first();
    const box = await target.boundingBox();
    if (box) await page.mouse.click(box.x + box.width * 0.38, box.y + box.height * 0.5);
    return page.locator('circle[data-handle="midpoint"]').count();
  }, { timeout: 12_000, message: `line/arrow midpoint handle for ${id}` }).toBeGreaterThan(0);
}

function desktopStyleTrigger(page) {
  return page.getByRole('button', { name: 'Style', exact: true }).first();
}

function desktopArrowheadTrigger(page) {
  return page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
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
  const values = (await listbox.getByRole('option').allTextContents()).map((text) => text.trim());
  await page.keyboard.press('Escape');
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

async function createLine(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Line');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isLineRow);
}

async function createArrow(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Arrow');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isArrowRow);
}

function expectDash(row, style, label) {
  expect(dashKey(row.strokeDashArray), `${label} stored dash`).toBe(style.value);
  expect(dashKey(row.visualDash), `${label} SVG stroke-dasharray`).toBe(style.value);
}

function expectArrowhead(row, style, label) {
  const stored = row.arrowheadStyle || (row.tool === 'arrow' ? 'solidTriangle' : 'none');
  expect(stored, `${label} stored arrowhead`).toBe(style.value);
  expect(visualArrowheadKind(row), `${label} SVG arrowhead`).toBe(style.value);
}

test('Line/Arrow dash + arrowhead every discrete style intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);

  await activateTool(page, 'Shapes', 'Line');
  const lineStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(lineStyles, 'Line Style catalog is Solid / Dashed / Dotted').toEqual(DASH_STYLES.map((row) => row.label));
  expect(lineStyles.join(' | ')).not.toMatch(/cloud/i);
  expect(await desktopArrowheadTrigger(page).count(), 'Line has no Arrowhead picker').toBe(0);

  await activateTool(page, 'Shapes', 'Arrow');
  const arrowStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(arrowStyles, 'Arrow Style catalog is Solid / Dashed / Dotted').toEqual(DASH_STYLES.map((row) => row.label));
  expect(arrowStyles.join(' | ')).not.toMatch(/cloud/i);
  const arrowheads = await listDesktopOptions(page, desktopArrowheadTrigger(page), 'Arrowhead');
  expect(arrowheads, 'Arrow Arrowhead catalog is all 6 styles').toEqual(ARROWHEAD_STYLES.map((row) => row.label));

  const lineDashProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await activateTool(page, 'Shapes', 'Line');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Line');
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect(desktopStyleTrigger(page)).toContainText(style.label);
    const row = await createLine(page, {
      x0: 0.12,
      y0: 0.18 + i * 0.08,
      x1: 0.38,
      y1: 0.22 + i * 0.08,
    });
    expect(row.tool).toBe('line');
    expect(row.arrowheadStyle, `Line ${style.label} must not inherit an arrowhead`).toBeNull();
    expect(visualArrowheadKind(row), `Line ${style.label} SVG has no head`).toBe('none');
    expectDash(row, style, `Line next-draw ${style.label}`);
    lineDashProof.push({ style: style.value, id: row.id });
  }
  expect(lineDashProof.map((row) => row.style)).toEqual(DASH_STYLES.map((row) => row.value));

  const arrowDashProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await activateTool(page, 'Shapes', 'Arrow');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Arrow');
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    const row = await createArrow(page, {
      x0: 0.52,
      y0: 0.18 + i * 0.08,
      x1: 0.82,
      y1: 0.22 + i * 0.08,
    });
    expect(row.tool).toBe('arrow');
    expectDash(row, style, `Arrow next-draw ${style.label}`);
    arrowDashProof.push({ style: style.value, id: row.id, arrowhead: row.arrowheadStyle });
  }
  expect(arrowDashProof.map((row) => row.style)).toEqual(DASH_STYLES.map((row) => row.value));

  const arrowHeadProof = [];
  for (let i = 0; i < ARROWHEAD_STYLES.length; i += 1) {
    const style = ARROWHEAD_STYLES[i];
    await activateTool(page, 'Shapes', 'Arrow');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Arrow');
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Solid');
    await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', style.label);
    await expect(desktopArrowheadTrigger(page)).toContainText(style.label);
    const row = await createArrow(page, {
      x0: 0.14,
      y0: 0.46 + i * 0.055,
      x1: 0.40,
      y1: 0.50 + i * 0.055,
    });
    expect(row.tool).toBe('arrow');
    expectArrowhead(row, style, `Arrow next-draw ${style.label}`);
    expectDash(row, DASH_STYLES[0], `Arrow ${style.label} shaft stays Solid`);
    arrowHeadProof.push({ style: style.value, id: row.id });
  }
  expect(arrowHeadProof.map((row) => row.style)).toEqual(ARROWHEAD_STYLES.map((row) => row.value));

  const firstLine = lineDashProof[1];
  expect(firstLine.style).toBe('dashed');
  await selectStroke(page, firstLine.id);
  const selectedDashProof = [];
  for (const style of DASH_STYLES) {
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect.poll(async () => dashKey((await annotationById(page, firstLine.id))?.strokeDashArray))
      .toBe(style.value);
    const row = await annotationById(page, firstLine.id);
    expectDash(row, style, `Line selected-patch ${style.label}`);
    selectedDashProof.push(style.value);
  }
  expect(selectedDashProof).toEqual(DASH_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dashed');
  await expect.poll(async () => dashKey((await annotationById(page, firstLine.id))?.strokeDashArray)).toBe('dashed');

  const firstArrow = arrowHeadProof[1];
  expect(firstArrow.style).toBe('solidTriangle');
  await selectStroke(page, firstArrow.id);
  const selectedHeadProof = [];
  for (const style of ARROWHEAD_STYLES) {
    await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', style.label);
    await expect.poll(async () => String((await annotationById(page, firstArrow.id))?.arrowheadStyle || 'none'))
      .toBe(style.value);
    const row = await annotationById(page, firstArrow.id);
    expectArrowhead(row, style, `Arrow selected-patch ${style.label}`);
    selectedHeadProof.push(style.value);
  }
  expect(selectedHeadProof).toEqual(ARROWHEAD_STYLES.map((row) => row.value));
  const selectedArrowDashProof = [];
  for (const style of DASH_STYLES) {
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect.poll(async () => dashKey((await annotationById(page, firstArrow.id))?.strokeDashArray))
      .toBe(style.value);
    selectedArrowDashProof.push(style.value);
  }
  expect(selectedArrowDashProof).toEqual(DASH_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', 'V-shape');
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  await expect.poll(async () => {
    const row = await annotationById(page, firstArrow.id);
    return `${dashKey(row.strokeDashArray)}|${row.arrowheadStyle}`;
  }).toBe('dotted|vShape');

  await activateTool(page, 'Shapes', 'Line');
  expect(await desktopArrowheadTrigger(page).count(), 'Line still has no Arrowhead after Arrow walk').toBe(0);
  await activateTool(page, 'Shapes', 'Rectangle');
  await page.getByRole('button', { name: 'Style', exact: true }).first().click();
  const rectPopover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(rectPopover.getByRole('option', { name: 'Cloud', exact: true })).toBeVisible();
  await rectPopover.getByRole('option', { name: 'Cloud', exact: true }).click();
  await activateTool(page, 'Shapes', 'Line');
  const afterCloud = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(afterCloud.join(' | ')).not.toMatch(/cloud/i);
  await deselectEmpty(page);
  await activateTool(page, 'Shapes', 'Line');
  const cloudArmedLine = await createLine(page, { x0: 0.56, y0: 0.48, x1: 0.84, y1: 0.54 });
  expect(cloudArmedLine.tool).toBe('line');
  expect(cloudArmedLine.arrowheadStyle).toBeNull();
  expect(dashKey(cloudArmedLine.strokeDashArray), 'Cloud-armed Line create stays solid (cloud is rect-only)')
    .toBe('solid');

  await activateTool(page, 'Draw', 'Pen');
  expect(await desktopStyleTrigger(page).count(), 'Pen-armed Style must hide').toBe(0);
  expect(await desktopArrowheadTrigger(page).count(), 'Pen-armed Arrowhead must hide').toBe(0);
  const isolatedLine = await annotationById(page, firstLine.id);
  expectDash(isolatedLine, DASH_STYLES[1], 'Pen-armed must not rewrite first dashed Line');
  const isolatedArrow = await annotationById(page, firstArrow.id);
  expect(isolatedArrow.arrowheadStyle, 'Pen-armed must not rewrite first Arrow head').toBe('vShape');
  expect(dashKey(isolatedArrow.strokeDashArray), 'Pen-armed must not rewrite first Arrow dash').toBe('dotted');

  await activateTool(page, 'Shapes', 'Line');
  await deselectEmpty(page);
  await activateTool(page, 'Shapes', 'Line');
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  const isolation = await createLine(page, { x0: 0.56, y0: 0.60, x1: 0.84, y1: 0.66 });
  expectDash(isolation, DASH_STYLES[2], 'isolation Line dotted');
  expectDash(await annotationById(page, firstLine.id), DASH_STYLES[1], 'first dashed Line held');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === isolation.id);
  }).toBe(false);
  expectDash(await annotationById(page, firstLine.id), DASH_STYLES[1], 'undo keeps first dashed Line');
  const afterUndoArrow = await annotationById(page, firstArrow.id);
  expect(afterUndoArrow.arrowheadStyle).toBe('vShape');
  expect(dashKey(afterUndoArrow.strokeDashArray)).toBe('dotted');

  const beforeSelect = (await userAnnotationSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await userAnnotationSnapshot(page)).length, 'Select / empty page invents 0').toBe(beforeSelect);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Arrowhead', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('LINE_ARROW_DASH_ARROWHEAD_DESKTOP_PROOF', JSON.stringify({
    lineStyles,
    arrowStyles,
    arrowheads,
    lineDashProof,
    arrowDashProof,
    arrowHeadProof,
    selectedDashProof,
    selectedHeadProof,
    selectedArrowDashProof,
    cloudArmedLine: cloudArmedLine.id,
    isolationUndone: isolation.id,
    viewBox,
    fileId,
  }));
});

test('390 Line/Arrow dash + arrowhead every discrete style intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);

  await activateTool(page, 'Shapes', 'Line');
  const lineStyles = await listMobileOptions(page, 'Border style');
  expect(lineStyles, '390 Line Border style catalog').toEqual(DASH_STYLES.map((row) => row.label));
  expect(lineStyles.join(' | ')).not.toMatch(/cloud/i);
  expect(await page.getByRole('button', { name: /^Arrowhead style:/ }).count(), '390 Line has no Arrowhead').toBe(0);

  await activateTool(page, 'Shapes', 'Arrow');
  const arrowStyles = await listMobileOptions(page, 'Border style');
  expect(arrowStyles).toEqual(DASH_STYLES.map((row) => row.label));
  expect(arrowStyles.join(' | ')).not.toMatch(/cloud/i);
  const arrowheads = await listMobileOptions(page, 'Arrowhead style');
  expect(arrowheads, '390 Arrowhead catalog is all 6 styles').toEqual(ARROWHEAD_STYLES.map((row) => row.mobileLabel));

  const lineDashProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await activateTool(page, 'Shapes', 'Line');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Line');
    await pickMobileOption(page, 'Border style', style.label);
    const row = await createLine(page, {
      x0: 0.16,
      y0: 0.20 + i * 0.10,
      x1: 0.72,
      y1: 0.26 + i * 0.10,
    });
    expect(row.tool).toBe('line');
    expect(row.arrowheadStyle).toBeNull();
    expectDash(row, style, `390 Line ${style.label}`);
    lineDashProof.push({ style: style.value, id: row.id });
  }
  expect(lineDashProof.map((row) => row.style)).toEqual(DASH_STYLES.map((row) => row.value));

  const arrowDashProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await activateTool(page, 'Shapes', 'Arrow');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Arrow');
    await pickMobileOption(page, 'Border style', style.label);
    const row = await createArrow(page, {
      x0: 0.18,
      y0: 0.52 + i * 0.07,
      x1: 0.78,
      y1: 0.56 + i * 0.07,
    });
    expect(row.tool).toBe('arrow');
    expectDash(row, style, `390 Arrow ${style.label}`);
    arrowDashProof.push({ style: style.value, id: row.id });
  }

  const arrowHeadProof = [];
  for (let i = 0; i < ARROWHEAD_STYLES.length; i += 1) {
    const style = ARROWHEAD_STYLES[i];
    await activateTool(page, 'Shapes', 'Arrow');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Arrow');
    await pickMobileOption(page, 'Border style', 'Solid');
    await pickMobileOption(page, 'Arrowhead style', style.mobileLabel);
    const row = await createArrow(page, {
      x0: 0.16,
      y0: 0.22 + (i % 3) * 0.08,
      x1: 0.46,
      y1: 0.28 + (i % 3) * 0.08,
    });
    expect(row.tool).toBe('arrow');
    expectArrowhead(row, style, `390 Arrow ${style.mobileLabel}`);
    arrowHeadProof.push({ style: style.value, id: row.id });
  }
  expect(arrowHeadProof.map((row) => row.style)).toEqual(ARROWHEAD_STYLES.map((row) => row.value));

  await activateTool(page, 'Shapes', 'Rectangle');
  await page.getByRole('button', { name: /^Border style:/ }).first().click();
  const rectList = page.getByRole('listbox', { name: 'Border style' });
  await expect(rectList.getByRole('option', { name: 'Cloud', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: /^Border style:/ }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /^Arrowhead style:/ }).count()).toBe(0);

  console.log('LINE_ARROW_DASH_ARROWHEAD_390_PROOF', JSON.stringify({
    lineStyles,
    arrowStyles,
    arrowheads,
    lineDashProof,
    arrowDashProof,
    arrowHeadProof,
    viewBox,
    fileId,
  }));
});
