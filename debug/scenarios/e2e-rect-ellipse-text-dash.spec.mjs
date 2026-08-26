import { test, expect } from '@playwright/test';

// Rect / Ellipse / Text Style — every discrete Solid / Dashed / Dotted
// (Cloud is Rect-only). Distinct from UL-33 catalog smoke (armed Rect
// Dashed/Dotted + ellipse omits Cloud), Line/Arrow/Callout every-style,
// Cloud bump 1–20, Cloud/Text every-swatch, and Width every-preset.
// Leftover-18 / X-01 parked. No file.id. No create-poly tool.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const DASH_STYLES = [
  { value: 'solid', label: 'Solid', dash: null },
  { value: 'dashed', label: 'Dashed', dash: [6, 4] },
  { value: 'dotted', label: 'Dotted', dash: [2, 4] },
];

const RECT_STYLES = [
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

function isRectRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  return type === 'rect' || type === 'rectangle' || tool === 'rect';
}

function isEllipseRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  return type === 'ellipse' || type === 'circle' || tool === 'ellipse';
}

function isTextRow(row) {
  const type = String(row?.type || '').toLowerCase();
  const tool = String(row?.tool || '').toLowerCase();
  if (row?.callout === true || type === 'callout' || tool === 'callout') return false;
  return type === 'textbox' || type === 'text' || tool === 'text';
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
  if (await page.locator('[data-text-edit-overlay]').count()) {
    const box = await pageBox(page);
    await page.mouse.click(box.x + 8, box.y + 8);
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  }
  const box = await pageBox(page);
  await page.mouse.click(box.x + 8, box.y + 8);
}

async function assertNoSelection(page) {
  await deselectEmpty(page);
  await selectMode(page);
  await deselectEmpty(page);
  await expect.poll(async () => {
    const overlay = await page.locator('[data-text-edit-overlay]').count();
    const handles = await page.locator('[data-resize-handle]').count();
    return overlay + handles;
  }, { message: 'expected no selected annotation before next-draw Style' }).toBe(0);
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      if (object.isPdfImported === true) return null;
      const group = document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const cloud = group?.querySelector('[data-shape-kind="cloud-rect"]');
      const ellipse = group?.querySelector('[data-shape-kind="ellipse"]');
      const rect = group?.querySelector('[data-shape-kind="rect"]');
      const textBorder = [...(group?.querySelectorAll('rect') || [])]
        .find((node) => node.getAttribute('fill') === 'none' && node.getAttribute('stroke'));
      const paint = cloud || ellipse || rect || textBorder || null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        strokeDashArray: object.strokeDashArray ?? data.strokeDashArray ?? null,
        pdfCloudIntensity: data.pdfCloudIntensity ?? null,
        visualKind: cloud ? 'cloud-rect' : ellipse ? 'ellipse' : rect ? 'rect' : textBorder ? 'text-border' : null,
        visualDash: paint?.getAttribute('stroke-dasharray') || null,
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

async function handlesBelongTo(page, id) {
  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  const handles = page.locator('[data-resize-handle]');
  if (!(await handles.count()) || !(await group.count())) return false;
  const box = await group.boundingBox();
  if (!box) return false;
  const points = await handles.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }));
  const near = points.filter((point) => (
    point.x >= box.x - 28 && point.x <= box.x + box.width + 28
    && point.y >= box.y - 28 && point.y <= box.y + box.height + 28
  ));
  return near.length >= 2;
}

async function selectShape(page, id) {
  await selectMode(page);
  if (await handlesBelongTo(page, id)) return;
  const group = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`).first();
  await expect(group).toBeVisible({ timeout: 8_000 });
  const box = await group.boundingBox();
  expect(box, `bbox for ${id}`).toBeTruthy();
  const points = [
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.min(8, Math.max(3, box.width / 2)), y: box.y + Math.max(3, box.height / 2) },
    { x: box.x + 4, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 4 },
    { x: box.x + box.width - 4, y: box.y + box.height / 2 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    if (await page.locator('[data-text-edit-overlay]').count()) {
      const pageGeom = await pageBox(page);
      await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
      await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
      await selectMode(page);
      continue;
    }
    if (await handlesBelongTo(page, id)) return;
  }
  await page.locator(`[data-shape-id="${id}"]`).first().click({ force: true, position: { x: 3, y: 3 } }).catch(() => {});
  await expect.poll(async () => handlesBelongTo(page, id), {
    message: `expected selection handles on ${id}`,
  }).toBeTruthy();
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

async function createRect(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRectRow);
}

async function createEllipse(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isEllipseRow);
}

async function createText(page, text, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).filter(isTextRow).map((row) => row.id));
  await blurInputs(page);
  await activateTool(page, 'Text', 'Text');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  const pageGeom = await pageBox(page);
  await page.mouse.click(pageGeom.x + 10, pageGeom.y + 10);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  return waitForNewUserAnnotation(page, before, isTextRow);
}

function expectDash(row, style, label) {
  expect(dashKey(row.strokeDashArray), `${label} stored dash`).toBe(style.value === 'cloud' ? 'solid' : style.value);
  expect(dashKey(row.visualDash), `${label} SVG stroke-dasharray`).toBe(style.value === 'cloud' ? 'solid' : style.value);
}

function expectCloud(row, on, label) {
  if (on) {
    expect(Number.isFinite(Number(row.pdfCloudIntensity)), `${label} stores pdfCloudIntensity`).toBe(true);
    expect(row.visualKind, `${label} SVG kind`).toBe('cloud-rect');
    expect(dashKey(row.strokeDashArray), `${label} cloud stored dash`).toBe('solid');
  } else {
    expect(row.pdfCloudIntensity == null || row.pdfCloudIntensity === '', `${label} clears cloud`).toBe(true);
    expect(row.visualKind, `${label} not a cloud path`).not.toBe('cloud-rect');
  }
}

function expectRectStyle(row, style, label) {
  if (style.cloud || style.value === 'cloud') {
    expectCloud(row, true, label);
    return;
  }
  expectCloud(row, false, label);
  expectDash(row, style, label);
}

test('Rect/Ellipse/Text Style every discrete value intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  const rectStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(rectStyles, 'Rect Style catalog is Solid / Dashed / Dotted / Cloud')
    .toEqual(RECT_STYLES.map((row) => row.label));

  await activateTool(page, 'Shapes', 'Ellipse');
  const ellipseStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(ellipseStyles, 'Ellipse Style catalog is Solid / Dashed / Dotted')
    .toEqual(DASH_STYLES.map((row) => row.label));
  expect(ellipseStyles.join(' | ')).not.toMatch(/cloud/i);

  await activateTool(page, 'Text', 'Text');
  const textStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(textStyles, 'Text Style catalog is Solid / Dashed / Dotted')
    .toEqual(DASH_STYLES.map((row) => row.label));
  expect(textStyles.join(' | ')).not.toMatch(/cloud/i);

  const rectProof = [];
  for (let i = 0; i < RECT_STYLES.length; i += 1) {
    const style = RECT_STYLES[i];
    await activateTool(page, 'Shapes', 'Rectangle');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Rectangle');
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect(desktopStyleTrigger(page)).toContainText(style.label);
    const row = await createRect(page, {
      x0: 0.12,
      y0: 0.16 + i * 0.10,
      x1: 0.30,
      y1: 0.24 + i * 0.10,
    });
    expectRectStyle(row, style, `Rect next-draw ${style.label}`);
    rectProof.push({ style: style.value, id: row.id });
  }
  expect(rectProof.map((row) => row.style)).toEqual(RECT_STYLES.map((row) => row.value));

  const ellipseProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await activateTool(page, 'Shapes', 'Ellipse');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Ellipse');
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    const row = await createEllipse(page, {
      x0: 0.56,
      y0: 0.16 + i * 0.12,
      x1: 0.78,
      y1: 0.26 + i * 0.12,
    });
    expect(isEllipseRow(row)).toBe(true);
    expectCloud(row, false, `Ellipse next-draw ${style.label}`);
    expectDash(row, style, `Ellipse next-draw ${style.label}`);
    ellipseProof.push({ style: style.value, id: row.id });
  }
  expect(ellipseProof.map((row) => row.style)).toEqual(DASH_STYLES.map((row) => row.value));

  const firstRect = rectProof[1];
  expect(firstRect.style).toBe('dashed');
  await selectShape(page, firstRect.id);
  const selectedRectProof = [];
  for (const style of RECT_STYLES) {
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect.poll(async () => {
      const row = await annotationById(page, firstRect.id);
      if (style.value === 'cloud') return row?.visualKind === 'cloud-rect' ? 'cloud' : 'pending';
      return `${dashKey(row?.strokeDashArray)}|${row?.visualKind}`;
    }).toBe(style.value === 'cloud' ? 'cloud' : `${style.value}|rect`);
    expectRectStyle(await annotationById(page, firstRect.id), style, `Rect selected-patch ${style.label}`);
    selectedRectProof.push(style.value);
  }
  expect(selectedRectProof).toEqual(RECT_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dashed');
  await expect.poll(async () => dashKey((await annotationById(page, firstRect.id))?.strokeDashArray)).toBe('dashed');
  expectCloud(await annotationById(page, firstRect.id), false, 'Rect Cloud→Dashed clears cloud');

  const firstEllipse = ellipseProof[1];
  expect(firstEllipse.style).toBe('dashed');
  await selectShape(page, firstEllipse.id);
  const selectedEllipseProof = [];
  for (const style of DASH_STYLES) {
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect.poll(async () => dashKey((await annotationById(page, firstEllipse.id))?.strokeDashArray))
      .toBe(style.value);
    const row = await annotationById(page, firstEllipse.id);
    expectDash(row, style, `Ellipse selected-patch ${style.label}`);
    expectCloud(row, false, `Ellipse selected-patch ${style.label}`);
    selectedEllipseProof.push(style.value);
  }
  expect(selectedEllipseProof).toEqual(DASH_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  await expect.poll(async () => dashKey((await annotationById(page, firstEllipse.id))?.strokeDashArray)).toBe('dotted');

  await activateTool(page, 'Text', 'Text');
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  const textBox = await createText(page, 'Style leftover', {
    x0: 0.34,
    y0: 0.62,
    x1: 0.54,
    y1: 0.74,
  });
  expect(isTextRow(textBox)).toBe(true);
  expectDash(textBox, DASH_STYLES[2], 'Text first-create stamps next-draw Dotted from Text Style');
  await selectShape(page, textBox.id);
  const selectedTextProof = [];
  for (const style of DASH_STYLES) {
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect.poll(async () => dashKey((await annotationById(page, textBox.id))?.strokeDashArray))
      .toBe(style.value);
    const row = await annotationById(page, textBox.id);
    expectDash(row, style, `Text selected-patch ${style.label}`);
    expect(row.visualKind, `Text ${style.label} paints the border rect`).toBe('text-border');
    selectedTextProof.push(style.value);
  }
  expect(selectedTextProof).toEqual(DASH_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dashed');
  await expect.poll(async () => dashKey((await annotationById(page, textBox.id))?.strokeDashArray)).toBe('dashed');
  await assertNoSelection(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Cloud');
  await activateTool(page, 'Shapes', 'Ellipse');
  const afterCloudEllipse = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(afterCloudEllipse.join(' | ')).not.toMatch(/cloud/i);
  await assertNoSelection(page);
  await activateTool(page, 'Shapes', 'Ellipse');
  const cloudArmedEllipse = await createEllipse(page, { x0: 0.58, y0: 0.56, x1: 0.80, y1: 0.70 });
  expectCloud(cloudArmedEllipse, false, 'Cloud-armed Ellipse create stays solid');
  expectDash(cloudArmedEllipse, DASH_STYLES[0], 'Cloud-armed Ellipse create stays solid');

  await activateTool(page, 'Text', 'Text');
  const afterCloudText = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(afterCloudText.join(' | ')).not.toMatch(/cloud/i);
  await assertNoSelection(page);
  await activateTool(page, 'Text', 'Text');
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dashed');
  const armedText = await createText(page, 'armed dash', {
    x0: 0.34,
    y0: 0.78,
    x1: 0.54,
    y1: 0.88,
  });
  expectDash(armedText, DASH_STYLES[1], 'Text first-create stamps next-draw Dashed');

  await activateTool(page, 'Draw', 'Pen');
  expect(await desktopStyleTrigger(page).count(), 'Pen-armed Style must hide').toBe(0);
  expectDash(await annotationById(page, firstRect.id), DASH_STYLES[1], 'Pen-armed must not rewrite first dashed Rect');
  expectDash(await annotationById(page, firstEllipse.id), DASH_STYLES[2], 'Pen-armed must not rewrite first dotted Ellipse');
  expectDash(await annotationById(page, textBox.id), DASH_STYLES[1], 'Pen-armed must not rewrite first dashed Text');

  await activateTool(page, 'Shapes', 'Rectangle');
  await assertNoSelection(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  const isolation = await createRect(page, { x0: 0.12, y0: 0.78, x1: 0.28, y1: 0.90 });
  expectRectStyle(isolation, DASH_STYLES[2], 'isolation Rect dotted');
  expectDash(await annotationById(page, firstRect.id), DASH_STYLES[1], 'first dashed Rect held');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => {
    const rows = await userAnnotationSnapshot(page);
    return rows.some((row) => row.id === isolation.id);
  }).toBe(false);
  expectDash(await annotationById(page, firstRect.id), DASH_STYLES[1], 'undo keeps first dashed Rect');
  expectDash(await annotationById(page, firstEllipse.id), DASH_STYLES[2], 'undo keeps first dotted Ellipse');
  expectDash(await annotationById(page, textBox.id), DASH_STYLES[1], 'undo keeps first dashed Text');

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
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('RECT_ELLIPSE_TEXT_DASH_DESKTOP_PROOF', JSON.stringify({
    rectStyles,
    ellipseStyles,
    textStyles,
    rectProof,
    ellipseProof,
    selectedRectProof,
    selectedEllipseProof,
    selectedTextProof,
    cloudArmedEllipse: cloudArmedEllipse.id,
    textNextDrawSolid: armedText.id,
    isolationUndone: isolation.id,
    viewBox,
    fileId,
  }));
});

test('390 Rect/Ellipse/Text Style every discrete value intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  const rectStyles = await listMobileOptions(page, 'Border style');
  expect(rectStyles, '390 Rect Border style catalog').toEqual(RECT_STYLES.map((row) => row.label));

  await activateTool(page, 'Shapes', 'Ellipse');
  const ellipseStyles = await listMobileOptions(page, 'Border style');
  expect(ellipseStyles).toEqual(DASH_STYLES.map((row) => row.label));
  expect(ellipseStyles.join(' | ')).not.toMatch(/cloud/i);

  await activateTool(page, 'Text', 'Text');
  const textStyles = await listMobileOptions(page, 'Border style');
  expect(textStyles).toEqual(DASH_STYLES.map((row) => row.label));
  expect(textStyles.join(' | ')).not.toMatch(/cloud/i);

  const rectProof = [];
  for (let i = 0; i < RECT_STYLES.length; i += 1) {
    const style = RECT_STYLES[i];
    await activateTool(page, 'Shapes', 'Rectangle');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Rectangle');
    await pickMobileOption(page, 'Border style', style.label);
    const row = await createRect(page, {
      x0: 0.14,
      y0: 0.16 + i * 0.10,
      x1: 0.42,
      y1: 0.24 + i * 0.10,
    });
    expectRectStyle(row, style, `390 Rect ${style.label}`);
    rectProof.push({ style: style.value, id: row.id });
  }
  expect(rectProof.map((row) => row.style)).toEqual(RECT_STYLES.map((row) => row.value));

  const ellipseProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await activateTool(page, 'Shapes', 'Ellipse');
    await deselectEmpty(page);
    await activateTool(page, 'Shapes', 'Ellipse');
    await pickMobileOption(page, 'Border style', style.label);
    const row = await createEllipse(page, {
      x0: 0.52,
      y0: 0.16 + i * 0.12,
      x1: 0.86,
      y1: 0.26 + i * 0.12,
    });
    expectDash(row, style, `390 Ellipse ${style.label}`);
    expectCloud(row, false, `390 Ellipse ${style.label}`);
    ellipseProof.push({ style: style.value, id: row.id });
  }

  const textBox = await createText(page, '390 style', {
    x0: 0.16,
    y0: 0.62,
    x1: 0.58,
    y1: 0.74,
  });
  await selectShape(page, textBox.id);
  const selectedTextProof = [];
  for (const style of DASH_STYLES) {
    await pickMobileOption(page, 'Border style', style.label);
    await expect.poll(async () => dashKey((await annotationById(page, textBox.id))?.strokeDashArray))
      .toBe(style.value);
    expectDash(await annotationById(page, textBox.id), style, `390 Text ${style.label}`);
    selectedTextProof.push(style.value);
  }

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: /^Border style:/ }).count()).toBe(0);

  console.log('RECT_ELLIPSE_TEXT_DASH_390_PROOF', JSON.stringify({
    rectStyles,
    ellipseStyles,
    textStyles,
    rectProof,
    ellipseProof,
    selectedTextProof,
    viewBox,
    fileId,
  }));
});
