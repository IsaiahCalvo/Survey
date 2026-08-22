import { test, expect } from '@playwright/test';

// Callout leader dash + arrowhead — every discrete Style and every discrete
// Arrowhead. Distinct from Line/Arrow every-style (e2e-line-arrow-dash-arrowhead),
// UL-33 catalog smoke, T-02 handles / Width / Fill+Border every-swatch.
// Leftover-18 / X-01 parked. No file.id.

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
  if (value == null || value === '') return 'solid';
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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || typeof el.blur === 'function')) {
      el.blur();
    }
  });
}

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await closePagesOverlay(page);
  await blurInputs(page);
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape');
  const selectBtn = page.getByRole('button', { name: 'Selection mode', exact: true }).first();
  if (await selectBtn.isVisible().catch(() => false)) {
    await selectBtn.click();
  } else {
    await page.keyboard.press('v');
  }
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
      const style = legacy.style || data.style || object.style || {};
      if (object.isPdfImported === true || legacy.isPdfImported === true) return null;
      const group = document.querySelector(
        `[data-svg-annotation-layer="${pageNum}"] [data-callout-id="${id}"]`,
      );
      const paint = (el) => el
        && el.getAttribute('stroke') !== '#4a90e2'
        && !el.hasAttribute('data-handle');
      const line1 = group?.querySelector('[data-callout-part="line1"]');
      const line2 = group?.querySelector('[data-callout-part="line2"]');
      const box = group?.querySelector('[data-callout-part="textBox"]');
      const polygon = [...(group?.querySelectorAll('polygon') || [])].find(paint);
      const circle = [...(group?.querySelectorAll('circle') || [])]
        .find((el) => paint(el) && !el.hasAttribute('data-callout-part'));
      const polyline = [...(group?.querySelectorAll('polyline') || [])].find(paint);
      const extraLine = [...(group?.querySelectorAll('line') || [])]
        .find((el) => paint(el) && !el.getAttribute('data-callout-part'));
      return {
        id,
        type: String(object.type || data.type || 'callout').toLowerCase(),
        tool: String(data.tool || data.type || 'callout').toLowerCase(),
        callout: true,
        lineStyle: style.lineStyle || null,
        arrowheadStyle: style.arrowheadStyle || null,
        visualDash: line2?.getAttribute('stroke-dasharray')
          || line1?.getAttribute('stroke-dasharray')
          || null,
        visualBoxDash: box?.getAttribute('stroke-dasharray') || null,
        visualPolygon: !!polygon,
        visualPolygonFill: polygon?.getAttribute('fill') || null,
        visualCircle: !!circle,
        visualPolyline: !!polyline,
        visualTick: !!extraLine,
      };
    }).filter(Boolean);
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

async function createCallout(page, text, coords) {
  const before = new Set((await calloutSnapshot(page)).map((row) => row.id));
  await blurInputs(page);
  await activateTool(page, 'Text', 'Callout');
  await dragOnPage(page, coords);
  const created = await waitForNewCallout(page, before);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (await editor.isVisible().catch(() => false)) {
    await editor.click();
    await editor.pressSequentially(text, { delay: 6 });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  }
  await blurInputs(page);
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
    const styleBtn = page.getByRole('button', { name: 'Style', exact: true }).first();
    const mobile = page.getByRole('button', { name: /^Border style:/ }).first();
    if (await styleBtn.isVisible().catch(() => false)) return;
    if (await mobile.isVisible().catch(() => false)) return;
  }
  await expect(page.getByRole('button', { name: 'Style', exact: true }).first()).toBeVisible({ timeout: 8_000 });
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

function storedLineStyle(row) {
  return row?.lineStyle === 'dashed' || row?.lineStyle === 'dotted'
    ? row.lineStyle
    : 'solid';
}

function expectDash(row, style, label) {
  expect(storedLineStyle(row), `${label} stored lineStyle`).toBe(style.value);
  expect(dashKey(row.visualDash), `${label} leader stroke-dasharray`).toBe(style.value);
  expect(dashKey(row.visualBoxDash), `${label} text-box stroke-dasharray`).toBe(style.value);
}

function expectArrowhead(row, style, label) {
  const stored = row.arrowheadStyle || 'solidTriangle';
  expect(stored, `${label} stored arrowhead`).toBe(style.value);
  expect(visualArrowheadKind(row), `${label} SVG arrowhead`).toBe(style.value);
}

async function armCallout(page) {
  await deselectEmpty(page);
  await activateTool(page, 'Text', 'Callout');
}

test('Callout dash + arrowhead every discrete style intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  await activateTool(page, 'Text', 'Callout');
  const calloutStyles = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(calloutStyles, 'Callout Style catalog is Solid / Dashed / Dotted').toEqual(DASH_STYLES.map((row) => row.label));
  expect(calloutStyles.join(' | ')).not.toMatch(/cloud/i);
  const calloutHeads = await listDesktopOptions(page, desktopArrowheadTrigger(page), 'Arrowhead');
  expect(calloutHeads, 'Callout Arrowhead catalog is all 6 styles').toEqual(ARROWHEAD_STYLES.map((row) => row.label));

  const dashProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await armCallout(page);
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', 'Solid triangle');
    await expect(desktopStyleTrigger(page)).toContainText(style.label);
    const row = await createCallout(page, `d${i}`, {
      x0: 0.12,
      y0: 0.16 + i * 0.14,
      x1: 0.30,
      y1: 0.24 + i * 0.14,
    });
    await expect.poll(async () => storedLineStyle(await annotationById(page, row.id)))
      .toBe(style.value);
    const settled = await annotationById(page, row.id);
    expectDash(settled, style, `Callout next-draw ${style.label}`);
    expectArrowhead(settled, ARROWHEAD_STYLES[1], `Callout ${style.label} default head`);
    dashProof.push({ style: style.value, id: row.id });
  }
  expect(dashProof.map((row) => row.style)).toEqual(DASH_STYLES.map((row) => row.value));

  const headProof = [];
  for (let i = 0; i < ARROWHEAD_STYLES.length; i += 1) {
    const style = ARROWHEAD_STYLES[i];
    await armCallout(page);
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Solid');
    await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', style.label);
    await expect(desktopArrowheadTrigger(page)).toContainText(style.label);
    const created = await createCallout(page, `h${i}`, {
      x0: 0.52,
      y0: 0.14 + i * 0.10,
      x1: 0.74,
      y1: 0.22 + i * 0.10,
    });
    await expect.poll(async () => String((await annotationById(page, created.id))?.arrowheadStyle || ''))
      .toBe(style.value);
    const row = await annotationById(page, created.id);
    expectArrowhead(row, style, `Callout next-draw ${style.label}`);
    expectDash(row, DASH_STYLES[0], `Callout ${style.label} leader stays Solid`);
    headProof.push({ style: style.value, id: row.id });
  }
  expect(headProof.map((row) => row.style)).toEqual(ARROWHEAD_STYLES.map((row) => row.value));

  const firstDash = dashProof[1];
  expect(firstDash.style).toBe('dashed');
  await selectCallout(page, firstDash.id);
  const selectedDashProof = [];
  for (const style of DASH_STYLES) {
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect.poll(async () => storedLineStyle(await annotationById(page, firstDash.id)))
      .toBe(style.value);
    const row = await annotationById(page, firstDash.id);
    expectDash(row, style, `Callout selected-patch ${style.label}`);
    selectedDashProof.push(style.value);
  }
  expect(selectedDashProof).toEqual(DASH_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dashed');
  await expect.poll(async () => storedLineStyle(await annotationById(page, firstDash.id))).toBe('dashed');

  const firstHead = headProof[1];
  expect(firstHead.style).toBe('solidTriangle');
  await selectCallout(page, firstHead.id);
  const selectedHeadProof = [];
  for (const style of ARROWHEAD_STYLES) {
    await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', style.label);
    await expect.poll(async () => String((await annotationById(page, firstHead.id))?.arrowheadStyle || 'solidTriangle'))
      .toBe(style.value);
    const row = await annotationById(page, firstHead.id);
    expectArrowhead(row, style, `Callout selected-patch ${style.label}`);
    selectedHeadProof.push(style.value);
  }
  expect(selectedHeadProof).toEqual(ARROWHEAD_STYLES.map((row) => row.value));
  const selectedCalloutDashProof = [];
  for (const style of DASH_STYLES) {
    await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', style.label);
    await expect.poll(async () => storedLineStyle(await annotationById(page, firstHead.id)))
      .toBe(style.value);
    selectedCalloutDashProof.push(style.value);
  }
  expect(selectedCalloutDashProof).toEqual(DASH_STYLES.map((row) => row.value));
  await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', 'V-shape');
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  await expect.poll(async () => {
    const row = await annotationById(page, firstHead.id);
    return `${storedLineStyle(row)}|${row.arrowheadStyle}`;
  }).toBe('dotted|vShape');

  await activateTool(page, 'Shapes', 'Rectangle');
  await page.getByRole('button', { name: 'Style', exact: true }).first().click();
  const rectPopover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(rectPopover.getByRole('option', { name: 'Cloud', exact: true })).toBeVisible();
  await rectPopover.getByRole('option', { name: 'Cloud', exact: true }).click();
  await armCallout(page);
  const afterCloud = await listDesktopOptions(page, desktopStyleTrigger(page), 'Style');
  expect(afterCloud.join(' | ')).not.toMatch(/cloud/i);
  const cloudArmed = await createCallout(page, 'cloud', { x0: 0.12, y0: 0.62, x1: 0.30, y1: 0.74 });
  expect(isCalloutRow(cloudArmed)).toBe(true);
  expect(storedLineStyle(cloudArmed), 'Cloud-armed Callout create stays solid (cloud is rect-only)')
    .toBe('solid');

  await activateTool(page, 'Draw', 'Pen');
  expect(await desktopStyleTrigger(page).count(), 'Pen-armed Style must hide').toBe(0);
  expect(await desktopArrowheadTrigger(page).count(), 'Pen-armed Arrowhead must hide').toBe(0);
  expectDash(await annotationById(page, firstDash.id), DASH_STYLES[1], 'Pen-armed must not rewrite first dashed Callout');
  const isolatedHead = await annotationById(page, firstHead.id);
  expect(isolatedHead.arrowheadStyle, 'Pen-armed must not rewrite first Callout head').toBe('vShape');
  expect(storedLineStyle(isolatedHead), 'Pen-armed must not rewrite first Callout dash').toBe('dotted');

  await armCallout(page);
  await pickDesktopOption(page, desktopStyleTrigger(page), 'Style', 'Dotted');
  await pickDesktopOption(page, desktopArrowheadTrigger(page), 'Arrowhead', 'Solid triangle');
  const isolation = await createCallout(page, 'iso', { x0: 0.52, y0: 0.78, x1: 0.74, y1: 0.88 });
  expectDash(isolation, DASH_STYLES[2], 'isolation Callout dotted');
  expectDash(await annotationById(page, firstDash.id), DASH_STYLES[1], 'first dashed Callout held');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  for (let i = 0; i < 8; i += 1) {
    const stillThere = (await calloutSnapshot(page)).some((row) => row.id === isolation.id);
    if (!stillThere) break;
    await undo.click();
  }
  await expect.poll(async () => {
    const rows = await calloutSnapshot(page);
    return rows.some((row) => row.id === isolation.id);
  }).toBe(false);
  expectDash(await annotationById(page, firstDash.id), DASH_STYLES[1], 'undo keeps first dashed Callout');
  const afterUndoHead = await annotationById(page, firstHead.id);
  expect(afterUndoHead.arrowheadStyle).toBe('vShape');
  expect(storedLineStyle(afterUndoHead)).toBe('dotted');

  const beforeSelect = (await calloutSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await calloutSnapshot(page)).length, 'Select / empty page invents 0').toBe(beforeSelect);

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

  console.log('CALLOUT_DASH_ARROWHEAD_DESKTOP_PROOF', JSON.stringify({
    calloutStyles,
    calloutHeads,
    dashProof,
    headProof,
    selectedDashProof,
    selectedHeadProof,
    selectedCalloutDashProof,
    cloudArmed: cloudArmed.id,
    isolationUndone: isolation.id,
    viewBox,
    fileId,
  }));
});

test('390 Callout dash + arrowhead every discrete style intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);

  await activateTool(page, 'Text', 'Callout');
  const calloutStyles = await listMobileOptions(page, 'Border style');
  expect(calloutStyles, '390 Callout Border style catalog').toEqual(DASH_STYLES.map((row) => row.label));
  expect(calloutStyles.join(' | ')).not.toMatch(/cloud/i);
  const calloutHeads = await listMobileOptions(page, 'Arrowhead style');
  expect(calloutHeads, '390 Callout Arrowhead catalog is all 6 styles')
    .toEqual(ARROWHEAD_STYLES.map((row) => row.mobileLabel));

  const dashProof = [];
  for (let i = 0; i < DASH_STYLES.length; i += 1) {
    const style = DASH_STYLES[i];
    await armCallout(page);
    await pickMobileOption(page, 'Border style', style.label);
    await pickMobileOption(page, 'Arrowhead style', 'Solid Triangle');
    await dismissChrome(page);
    await ensurePageDrawTarget(page);
    const created = await createCallout(page, `m${i}`, {
      x0: 0.20,
      y0: 0.28 + i * 0.12,
      x1: 0.68,
      y1: 0.38 + i * 0.12,
    });
    await expect.poll(async () => storedLineStyle(await annotationById(page, created.id)))
      .toBe(style.value);
    const row = await annotationById(page, created.id);
    expectDash(row, style, `390 Callout ${style.label}`);
    dashProof.push({ style: style.value, id: row.id });
  }
  expect(dashProof.map((row) => row.style)).toEqual(DASH_STYLES.map((row) => row.value));

  const headProof = [];
  for (let i = 0; i < ARROWHEAD_STYLES.length; i += 1) {
    const style = ARROWHEAD_STYLES[i];
    await armCallout(page);
    await pickMobileOption(page, 'Border style', 'Solid');
    await pickMobileOption(page, 'Arrowhead style', style.mobileLabel);
    await dismissChrome(page);
    await ensurePageDrawTarget(page);
    const created = await createCallout(page, `mh${i}`, {
      x0: 0.22,
      y0: 0.30 + (i % 3) * 0.14,
      x1: 0.70,
      y1: 0.42 + (i % 3) * 0.14,
    });
    await expect.poll(async () => String((await annotationById(page, created.id))?.arrowheadStyle || ''))
      .toBe(style.value);
    const row = await annotationById(page, created.id);
    expectArrowhead(row, style, `390 Callout ${style.mobileLabel}`);
    headProof.push({ style: style.value, id: row.id });
  }
  expect(headProof.map((row) => row.style)).toEqual(ARROWHEAD_STYLES.map((row) => row.value));

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

  console.log('CALLOUT_DASH_ARROWHEAD_390_PROOF', JSON.stringify({
    calloutStyles,
    calloutHeads,
    dashProof,
    headProof,
    viewBox,
    fileId,
  }));
});
