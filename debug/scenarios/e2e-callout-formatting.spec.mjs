import { test, expect } from '@playwright/test';

// Callout remaining formatting — every reachable font / size / align
// (+ B/I/U/S). Distinct from T-03…T-06 pickers-every-swatch (Text target),
// Callout Fill+Border, dash+arrowhead, and leader Width.
// Leftover-18 / X-01 parked. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

const FONT_FAMILIES = [
  'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
];
const FONT_SIZE_PRESETS = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72,
];
const TEXT_ALIGN_HORIZONTAL = ['left', 'center', 'right'];
const TEXT_ALIGN_VERTICAL = ['top', 'middle', 'bottom'];
const ALIGN_CELLS = TEXT_ALIGN_VERTICAL.flatMap((v) => (
  TEXT_ALIGN_HORIZONTAL.map((h) => ({ v, h, label: `${v} ${h}` }))
));

function isSingleNameFontFamily(raw) {
  return typeof raw === 'string'
    && raw.length > 0
    && !raw.includes(',')
    && !/sans-serif|serif|monospace|system-ui|ui-sans|ui-serif|ui-monospace|-apple-system|BlinkMacSystemFont/i.test(raw);
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
      const fo = group?.querySelector('foreignObject div');
      const computed = fo ? getComputedStyle(fo) : null;
      return {
        id,
        type: String(object.type || data.type || 'callout').toLowerCase(),
        tool: String(data.tool || data.type || 'callout').toLowerCase(),
        callout: true,
        fontFamily: style.fontFamily || null,
        fontSize: style.fontSize ?? null,
        textAlign: style.textAlign || null,
        verticalAlign: style.verticalAlign || null,
        bold: style.bold === true,
        italic: style.italic === true,
        underline: style.underline === true,
        strikethrough: style.strikethrough === true,
        visualFamily: computed?.fontFamily || null,
        visualSize: computed?.fontSize || null,
        visualAlign: computed?.textAlign || null,
        visualWeight: computed?.fontWeight || null,
        visualStyle: computed?.fontStyle || null,
        visualDecoration: computed?.textDecorationLine || computed?.textDecoration || null,
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

async function createCalloutKeepEdit(page, text, coords = { x0: 0.18, y0: 0.24, x1: 0.44, y1: 0.40 }) {
  const before = new Set((await calloutSnapshot(page)).map((row) => row.id));
  await blurInputs(page);
  await activateTool(page, 'Text', 'Callout');
  await dragOnPage(page, coords);
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  return waitForNewCallout(page, before);
}

async function commitEdit(page) {
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function createCallout(page, text, coords) {
  const created = await createCalloutKeepEdit(page, text, coords);
  await commitEdit(page);
  await selectMode(page);
  return annotationById(page, created.id);
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
    const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    const styleBtn = page.getByRole('button', { name: 'Style', exact: true }).first();
    const mobile = page.getByRole('button', { name: /^Border style:/ }).first();
    const aa = page.getByRole('button', { name: 'Text formatting', exact: true }).first();
    if (await edit.isVisible().catch(() => false)) return;
    if (await styleBtn.isVisible().catch(() => false)) return;
    if (await mobile.isVisible().catch(() => false)) return;
    if (await aa.isVisible().catch(() => false)) return;
  }
  await expect(page.getByRole('button', { name: 'Edit text', exact: true }).first()).toBeVisible({ timeout: 8_000 });
}

async function enterCalloutEdit(page, id) {
  await selectCallout(page, id);
  const desktop = page.getByRole('button', { name: 'Edit text', exact: true }).first();
  if (await desktop.isVisible().catch(() => false)) {
    await desktop.click();
  } else {
    const aa = page.getByRole('button', { name: 'Text formatting', exact: true }).first();
    await expect(aa).toBeVisible({ timeout: 8_000 });
    await aa.click();
  }
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 8_000 });
}

function desktopTrigger(page, name) {
  return page.getByRole('button', { name, exact: true }).first();
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
  const option = popover.getByRole('option', { name: label, exact: true });
  if (await option.count()) {
    const optionFamily = await option.first().evaluate((el) => getComputedStyle(el).fontFamily);
    if (listboxName === 'Font') {
      expect(optionFamily.includes(','), `${label} option must not be a CSS stack`).toBeFalsy();
    }
    await option.click();
  } else {
    await popover.getByText(label, { exact: true }).click();
  }
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
  const option = listbox.getByRole('option', { name: label, exact: true });
  if (ariaLabel === 'Font') {
    const optionFamily = await option.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(optionFamily.includes(','), `${label} option must not be a CSS stack`).toBeFalsy();
  }
  await option.click();
  await expect(listbox).toHaveCount(0);
}

function familyKey(raw) {
  const first = String(raw || '').split(',')[0].trim().replace(/^['"]+|['"]+$/g, '');
  return first;
}

function expectFormat(row, { family, size, align, vertical, bold, italic, underline, strike }, label) {
  expect(isSingleNameFontFamily(row.fontFamily), `${label} stored fontFamily`).toBeTruthy();
  expect(familyKey(row.fontFamily)).toBe(family);
  expect(Number(row.fontSize)).toBe(size);
  expect(row.textAlign).toBe(align);
  if (vertical != null) expect(row.verticalAlign || 'top').toBe(vertical);
  expect(row.bold).toBe(!!bold);
  expect(row.italic).toBe(!!italic);
  expect(row.underline).toBe(!!underline);
  expect(row.strikethrough).toBe(!!strike);
  expect(familyKey(row.visualFamily)).toBe(family);
  expect(Number.parseFloat(row.visualSize)).toBe(size);
  expect(String(row.visualAlign || '').toLowerCase()).toBe(align);
  const weight = String(row.visualWeight || '');
  if (bold) expect(['bold', '700'].includes(weight) || Number(weight) >= 600).toBeTruthy();
  if (italic) expect(String(row.visualStyle || '')).toContain('italic');
  if (underline) expect(String(row.visualDecoration || '')).toContain('underline');
  if (strike) expect(String(row.visualDecoration || '')).toContain('line-through');
}

test('catalog: Callout formatting catalogs match FONT_FAMILIES / sizes / 3x3', () => {
  expect(FONT_FAMILIES).toEqual([
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
  ]);
  expect(FONT_SIZE_PRESETS).toEqual([
    8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72,
  ]);
  expect(ALIGN_CELLS).toHaveLength(9);
  for (const family of FONT_FAMILIES) {
    expect(isSingleNameFontFamily(family)).toBeTruthy();
  }
});

test('desktop Callout every font / size / align + B/I/U/S intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  expect((await calloutSnapshot(page)).length).toBe(0);

  const first = await createCalloutKeepEdit(page, 'fmt-1', { x0: 0.16, y0: 0.20, x1: 0.46, y1: 0.38 });
  await expect(desktopTrigger(page, 'Font')).toBeVisible();
  await expect(desktopTrigger(page, 'Font size')).toBeVisible();
  await expect(desktopTrigger(page, 'Text alignment')).toBeVisible();

  const families = await listDesktopOptions(page, desktopTrigger(page, 'Font'), 'Font');
  expect(families, 'desktop Callout Font catalog').toEqual([...FONT_FAMILIES]);

  const sizes = await listDesktopOptions(page, desktopTrigger(page, 'Font size'), 'Font size');
  expect(sizes.map(Number), 'desktop Callout Font size catalog').toEqual([...FONT_SIZE_PRESETS]);

  await desktopTrigger(page, 'Text alignment').click();
  const alignPop = page.locator('[data-align-grid="true"], [data-annotation-dropdown-popover="true"]');
  await expect(alignPop).toBeVisible();
  const alignLabels = [];
  for (const cell of ALIGN_CELLS) {
    await expect(alignPop.getByRole('button', { name: cell.label, exact: true })).toBeVisible();
    alignLabels.push(cell.label);
  }
  expect(await alignPop.getByRole('button', { name: /justify/i }).count(), 'Justify not offered').toBe(0);
  await page.keyboard.press('Escape');
  expect(alignLabels).toEqual(ALIGN_CELLS.map((cell) => cell.label));

  const familyProof = [];
  for (const family of FONT_FAMILIES) {
    await pickDesktopOption(page, desktopTrigger(page, 'Font'), 'Font', family);
    await expect.poll(async () => familyKey((await annotationById(page, first.id))?.fontFamily))
      .toBe(family);
    const row = await annotationById(page, first.id);
    expect(isSingleNameFontFamily(row.fontFamily), `${family} stored`).toBeTruthy();
    expect(familyKey(row.visualFamily)).toBe(family);
    familyProof.push(family);
  }
  expect(familyProof).toEqual([...FONT_FAMILIES]);

  const sizeProof = [];
  for (const size of FONT_SIZE_PRESETS) {
    await pickDesktopOption(page, desktopTrigger(page, 'Font size'), 'Font size', String(size));
    await expect(desktopTrigger(page, 'Font size')).toContainText(String(size));
    await expect.poll(async () => Number((await annotationById(page, first.id))?.fontSize)).toBe(size);
    const row = await annotationById(page, first.id);
    expect(Number.parseFloat(row.visualSize)).toBe(size);
    sizeProof.push(size);
  }
  expect(sizeProof).toEqual([...FONT_SIZE_PRESETS]);

  const alignProof = [];
  for (const cell of ALIGN_CELLS) {
    await desktopTrigger(page, 'Text alignment').click();
    const pop = page.locator('[data-align-grid="true"], [data-annotation-dropdown-popover="true"]');
    await pop.getByRole('button', { name: cell.label, exact: true }).click();
    await expect.poll(async () => {
      const row = await annotationById(page, first.id);
      return `${row?.verticalAlign || 'top'} ${row?.textAlign || ''}`;
    }).toBe(`${cell.v} ${cell.h}`);
    const row = await annotationById(page, first.id);
    expect(String(row.visualAlign || '').toLowerCase()).toBe(cell.h);
    alignProof.push(cell.label);
  }
  expect(alignProof).toEqual(ALIGN_CELLS.map((cell) => cell.label));

  const formatProof = {};
  const bold = page.getByRole('button', { name: 'Bold', exact: true });
  const italic = page.getByRole('button', { name: 'Italic', exact: true });
  const underline = page.getByRole('button', { name: 'Underline', exact: true });
  const strike = page.getByRole('button', { name: 'Strikethrough', exact: true });
  await bold.click({ force: true });
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await annotationById(page, first.id))?.bold).toBe(true);
  formatProof.bold = true;
  await italic.click({ force: true });
  await expect(italic).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await annotationById(page, first.id))?.italic).toBe(true);
  formatProof.italic = true;
  await underline.click({ force: true });
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await annotationById(page, first.id))?.underline).toBe(true);
  formatProof.underline = true;
  await strike.click({ force: true });
  await expect(strike).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await annotationById(page, first.id))?.strikethrough).toBe(true);
  formatProof.strike = true;
  expect(Object.keys(formatProof)).toEqual(['bold', 'italic', 'underline', 'strike']);

  await commitEdit(page);
  const committed = await annotationById(page, first.id);
  expectFormat(committed, {
    family: 'Verdana',
    size: 72,
    align: 'right',
    vertical: 'bottom',
    bold: true,
    italic: true,
    underline: true,
    strike: true,
  }, 'first Callout commit');

  const second = await createCalloutKeepEdit(page, 'fmt-2', { x0: 0.52, y0: 0.20, x1: 0.82, y1: 0.38 });
  expect(familyKey((await annotationById(page, second.id))?.fontFamily) || 'Arial').toBe('Arial');
  expect(Number((await annotationById(page, second.id))?.fontSize) || 14).toBe(14);
  await pickDesktopOption(page, desktopTrigger(page, 'Font'), 'Font', 'Georgia');
  await pickDesktopOption(page, desktopTrigger(page, 'Font size'), 'Font size', '8');
  await desktopTrigger(page, 'Text alignment').click();
  await page.locator('[data-align-grid="true"], [data-annotation-dropdown-popover="true"]')
    .getByRole('button', { name: 'top left', exact: true }).click();
  await expect.poll(async () => familyKey((await annotationById(page, second.id))?.fontFamily)).toBe('Georgia');
  await commitEdit(page);
  expectFormat(await annotationById(page, second.id), {
    family: 'Georgia',
    size: 8,
    align: 'left',
    vertical: 'top',
  }, 'second Callout');
  expectFormat(await annotationById(page, first.id), {
    family: 'Verdana',
    size: 72,
    align: 'right',
    vertical: 'bottom',
    bold: true,
    italic: true,
    underline: true,
    strike: true,
  }, 'first Callout after second');

  await activateTool(page, 'Draw', 'Pen');
  expect(await desktopTrigger(page, 'Font').count(), 'Pen-armed Font must hide').toBe(0);
  expect(await desktopTrigger(page, 'Font size').count(), 'Pen-armed Font size must hide').toBe(0);
  expect(await desktopTrigger(page, 'Text alignment').count(), 'Pen-armed align must hide').toBe(0);
  expectFormat(await annotationById(page, first.id), {
    family: 'Verdana',
    size: 72,
    align: 'right',
    vertical: 'bottom',
    bold: true,
    italic: true,
    underline: true,
    strike: true,
  }, 'Pen-armed must not rewrite first');

  const beforeSelect = (await calloutSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 12, empty.y + 12);
  expect((await calloutSnapshot(page)).length, 'Select / empty page invents 0').toBe(beforeSelect);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  for (let i = 0; i < 10; i += 1) {
    if (!(await calloutSnapshot(page)).some((row) => row.id === second.id)) break;
    await undo.click();
  }
  await expect.poll(async () => (await calloutSnapshot(page)).some((row) => row.id === second.id)).toBe(false);
  expectFormat(await annotationById(page, first.id), {
    family: 'Verdana',
    size: 72,
    align: 'right',
    vertical: 'bottom',
    bold: true,
    italic: true,
    underline: true,
    strike: true,
  }, 'undo keeps first');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Font', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Font size', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Text alignment', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('CALLOUT_FORMATTING_DESKTOP_PROOF', JSON.stringify({
    families,
    sizes,
    alignProof,
    familyProof,
    sizeProof,
    formatProof,
    first: first.id,
    secondUndone: second.id,
    viewBox,
    fileId,
  }));
});

test('390 Callout every font / size / align + B/I/U/S intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);

  const first = await createCalloutKeepEdit(page, '390-fmt', { x0: 0.16, y0: 0.18, x1: 0.62, y1: 0.34 });
  await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible({ timeout: 8_000 });

  const families = await listMobileOptions(page, 'Font');
  expect(families, '390 Callout Font catalog').toEqual([...FONT_FAMILIES]);

  const aligns = await listMobileOptions(page, 'Text alignment');
  expect(aligns, '390 Callout align catalog').toEqual(ALIGN_CELLS.map((cell) => cell.label));
  expect(aligns.join(' | ')).not.toMatch(/justify/i);

  const familyProof = [];
  for (const family of FONT_FAMILIES) {
    await pickMobileOption(page, 'Font', family);
    await expect.poll(async () => familyKey((await annotationById(page, first.id))?.fontFamily))
      .toBe(family);
    familyProof.push(family);
  }
  expect(familyProof).toEqual([...FONT_FAMILIES]);

  const sizeField = page.getByRole('textbox', { name: 'Font size' }).first();
  await expect(sizeField).toBeVisible();
  const sizeProof = [];
  for (const size of FONT_SIZE_PRESETS) {
    await sizeField.fill(String(size));
    await expect.poll(async () => Number((await annotationById(page, first.id))?.fontSize)).toBe(size);
    sizeProof.push(size);
  }
  expect(sizeProof).toEqual([...FONT_SIZE_PRESETS]);

  await sizeField.fill('1');
  await expect.poll(async () => Number((await annotationById(page, first.id))?.fontSize)).toBe(6);
  await sizeField.fill('0');
  await expect.poll(async () => Number((await annotationById(page, first.id))?.fontSize)).toBe(6);
  await sizeField.fill('999');
  await expect.poll(async () => Number((await annotationById(page, first.id))?.fontSize)).toBe(200);
  await sizeField.fill('abc');
  await page.waitForTimeout(80);
  expect(Number((await annotationById(page, first.id))?.fontSize)).toBe(200);
  await sizeField.fill('24');
  await expect.poll(async () => Number((await annotationById(page, first.id))?.fontSize)).toBe(24);

  const alignProof = [];
  for (const cell of ALIGN_CELLS) {
    await pickMobileOption(page, 'Text alignment', cell.label);
    await expect.poll(async () => {
      const row = await annotationById(page, first.id);
      return `${row?.verticalAlign || 'top'} ${row?.textAlign || ''}`;
    }).toBe(`${cell.v} ${cell.h}`);
    alignProof.push(cell.label);
  }
  expect(alignProof).toEqual(ALIGN_CELLS.map((cell) => cell.label));

  const formatProof = {};
  for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
    const toggle = page.getByRole('button', { name, exact: true }).first();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    formatProof[name.toLowerCase()] = true;
  }
  await expect.poll(async () => (await annotationById(page, first.id))?.bold).toBe(true);
  await expect.poll(async () => (await annotationById(page, first.id))?.italic).toBe(true);
  await expect.poll(async () => (await annotationById(page, first.id))?.underline).toBe(true);
  await expect.poll(async () => (await annotationById(page, first.id))?.strikethrough).toBe(true);

  await commitEdit(page);
  const committed = await annotationById(page, first.id);
  expectFormat(committed, {
    family: 'Verdana',
    size: 24,
    align: 'right',
    vertical: 'bottom',
    bold: true,
    italic: true,
    underline: true,
    strike: true,
  }, '390 first commit');

  await activateTool(page, 'Text', 'Callout');
  const aa = page.getByRole('button', { name: 'Text formatting', exact: true }).first();
  await expect(aa).toBeVisible();
  if (!(await page.locator('[data-text-edit-overlay]').count())) {
    await aa.click();
  }
  const sheet = page.getByRole('region', { name: /Callout settings|Annotation settings/i })
    .or(page.locator('.mobile-pdf-text-defaults'));
  if (await page.getByRole('tab', { name: 'Text settings' }).isVisible().catch(() => false)) {
    await page.getByRole('tab', { name: 'Text settings' }).click();
    await page.getByRole('textbox', { name: 'Font size' }).last().fill('36');
    await page.getByRole('button', { name: 'Center horizontal alignment' }).click();
    await page.getByRole('button', { name: 'Close annotation settings' }).click().catch(() => {});
    await page.getByRole('button', { name: 'Close text formatting' }).click().catch(() => {});
  }

  const next = await createCallout(page, '390-next', { x0: 0.16, y0: 0.44, x1: 0.62, y1: 0.58 });
  expect(isSingleNameFontFamily(next.fontFamily)).toBeTruthy();
  expectFormat(await annotationById(page, first.id), {
    family: 'Verdana',
    size: 24,
    align: 'right',
    vertical: 'bottom',
    bold: true,
    italic: true,
    underline: true,
    strike: true,
  }, '390 isolation');

  const beforeSelect = (await calloutSnapshot(page)).length;
  await clickVisible(page, 'Select');
  const empty = await pageBox(page);
  await page.mouse.click(empty.x + 10, empty.y + 10);
  expect((await calloutSnapshot(page)).length, '390 Select invents 0').toBe(beforeSelect);

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: /^Font:/ }).count()).toBe(0);

  console.log('CALLOUT_FORMATTING_390_PROOF', JSON.stringify({
    families,
    aligns,
    familyProof,
    sizeProof,
    alignProof,
    formatProof,
    first: first.id,
    next: next.id,
    nextFamily: next.fontFamily,
    nextSize: next.fontSize,
    viewBox,
    fileId,
  }));
});
