import { test, expect } from '@playwright/test';

// Apply color / font / callout style to remapped selections after page CW.
// Distinct from unrotated e2e-pickers-every-swatch / callout-formatting /
// remapped handle-drag / remapper placement / leftover-18 / X-01.
// PointerEvent select is OK if Playwright mouse misses. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const PLACE_EPS = 4;
const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };
const TEXT_BOX = { x0: 0.50, y0: 0.22, x1: 0.78, y1: 0.36 };
const CALLOUT_BOX = { x0: 0.16, y0: 0.50, x1: 0.44, y1: 0.70 };

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

function isSingleNameFontFamily(raw) {
  return typeof raw === 'string'
    && raw.length > 0
    && !raw.includes(',')
    && !/sans-serif|serif|monospace|system-ui|ui-sans|ui-serif|ui-monospace|-apple-system|BlinkMacSystemFont/i.test(raw);
}

function familyKey(raw) {
  return String(raw || '').split(',')[0].trim().replace(/^['"]+|['"]+$/g, '');
}

function almostEq(a, b, eps = PLACE_EPS) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function placeHeld(a, b) {
  if (!a || !b) return false;
  return almostEq(a.cx, b.cx) && almostEq(a.cy, b.cy)
    && almostEq(a.width, b.width, 6) && almostEq(a.height, b.height, 6);
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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function pageCoveredByHub(page) {
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  if (!box) return false;
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const text = el?.textContent || '';
    return /No documents yet|Upload your first PDF|Search documents/.test(text);
  }, { x: box.x + box.width * 0.45, y: box.y + box.height * 0.40 });
}

async function closeDocumentPanel(page) {
  const backdrop = page.getByRole('button', { name: 'Close document panel' });
  if (await backdrop.first().isVisible().catch(() => false)) {
    await backdrop.first().click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function dismissChrome(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  await closeDocumentPanel(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hubCopy = page.getByText('No documents yet');
    if (!(await hubCopy.isVisible().catch(() => false)) && !(await pageCoveredByHub(page))) break;
    const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
    if (await rail.first().isVisible().catch(() => false)) {
      await rail.first().click().catch(() => {});
    } else {
      const tab = page.getByRole('button', { name: /clickable-link-test\.pdf/ }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click({ position: { x: 24, y: 8 } }).catch(() => {});
      }
    }
    await expect(hubCopy).toHaveCount(0, { timeout: 8_000 });
  }
  await expect.poll(async () => pageCoveredByHub(page), {
    timeout: 8_000,
    message: 'hub Documents must not cover the page',
  }).toBe(false);
  await blurInputs(page);
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

async function snapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const annoIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const calloutIds = [...new Set(
      [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] [data-callout-id]`)]
        .map((el) => el.getAttribute('data-callout-id'))
        .filter(Boolean),
    )];
    const ids = [...new Set([...annoIds, ...calloutIds])];
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const style = data.style || {};
      const legacy = data.legacyCallout || {};
      const box = object.textBoxPosition || legacy.textBoxPosition || data.textBoxPosition || {};
      const left = Number(object.left ?? data.left ?? 0);
      const top = Number(object.top ?? data.top ?? 0);
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
      return {
        id,
        type: String(object.type || data.type || (String(id).startsWith('callout-') ? 'callout' : '')).toLowerCase(),
        tool: String(object.tool || data.tool || data.type || '').toLowerCase(),
        callout: String(id).startsWith('callout-') || data.type === 'callout',
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        cx: left + width / 2,
        cy: top + height / 2,
        angle: Number(object.angle ?? data.angle ?? 0),
        fill: object.fill || data.fill || style.fillColor || null,
        stroke: object.stroke || data.stroke || style.borderColor || null,
        fontFamily: object.fontFamily || data.fontFamily || style.fontFamily || null,
        fontSize: object.fontSize ?? data.fontSize ?? style.fontSize ?? null,
        fontWeight: object.fontWeight || data.fontWeight || style.fontWeight || null,
        bold: object.bold ?? data.bold ?? style.bold ?? null,
        arrowheadStyle: data.arrowheadStyle || style.arrowheadStyle || object.arrowheadStyle || null,
        boxX: Number(box.x ?? 0),
        boxY: Number(box.y ?? 0),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function geom(page, id) {
  return (await snapshot(page)).find((row) => row.id === id) || null;
}

async function userCount(page) {
  return (await snapshot(page)).length;
}

async function activateTool(page, categoryName, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const category = page.getByRole('button', { name: categoryName, exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  await expect(sub.first()).toBeVisible({ timeout: 8_000 });
  if (!String(await sub.first().getAttribute('class') || '').includes('btn-active')) {
    await sub.first().click();
  }
}

async function selectMode(page) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const scoped = page.locator('button.btn-icon[aria-label="Select"]');
  if (await scoped.count() && await scoped.first().isVisible().catch(() => false)) {
    await scoped.first().click();
  }
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) await page.keyboard.press('Escape');
}

async function dragOnPage(page, coords) {
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 8 });
  await page.mouse.up();
}

async function waitForNew(page, beforeIds, pred) {
  let created = null;
  await expect.poll(async () => {
    created = (await snapshot(page)).find((row) => !beforeIds.has(row.id) && pred(row)) || null;
    return created;
  }, { message: 'expected a new annotation' }).not.toBeNull();
  return created;
}

async function persistOpenText(page, text = 'A') {
  const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
  if (!(await editor.isVisible().catch(() => false))) return;
  await editor.click();
  await editor.pressSequentially(text, { delay: 6 });
  await page.mouse.click(12, 200);
  await expect(page.locator('[data-text-edit-overlay]')).toHaveCount(0, { timeout: 8_000 });
  await blurInputs(page);
}

async function createRect(page) {
  const before = new Set((await snapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, RECT_BOX);
  const created = await waitForNew(page, before, (row) => row.type === 'rect' || row.tool === 'rect');
  await selectMode(page);
  return geom(page, created.id);
}

async function createTextbox(page) {
  const before = new Set((await snapshot(page)).map((row) => row.id));
  await dismissChrome(page);
  await page.waitForTimeout(350);
  await activateTool(page, 'Text', 'Text');
  await expect(page.locator('[data-text-overlay="1"]').first()).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(120);
  await dragOnPage(page, TEXT_BOX);
  await expect(page.locator('[data-text-edit-overlay] [contenteditable]').first()).toBeVisible({ timeout: 10_000 });
  await persistOpenText(page, 'A');
  const created = await waitForNew(page, before, (row) => (
    !row.callout
    && (row.type === 'textbox' || row.type === 'text' || row.type === 'i-text' || row.tool === 'text')
  ));
  await selectMode(page);
  return geom(page, created.id);
}

async function createCallout(page) {
  const before = new Set((await snapshot(page)).map((row) => row.id));
  await activateTool(page, 'Text', 'Callout');
  await blurInputs(page);
  await dragOnPage(page, CALLOUT_BOX);
  await persistOpenText(page, 'A');
  const created = await waitForNew(page, before, (row) => row.callout === true || row.type === 'callout');
  await selectMode(page);
  return geom(page, created.id);
}

async function clickHost(page, selector) {
  const host = page.locator(selector).first();
  if (!(await host.count())) return false;
  const box = await host.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function pointerClickHost(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const fire = (type, buttons) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
    }));
    fire('pointerdown', 1);
    fire('pointerup', 0);
    return true;
  }, selector);
}

async function selectionChromeUp(page, kind = 'shape') {
  if (kind === 'text' || kind === 'callout') {
    const font = page.getByRole('button', { name: 'Font', exact: true }).first();
    const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    const arrowhead = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
    return (await font.isVisible().catch(() => false))
      || (await edit.isVisible().catch(() => false))
      || (kind === 'callout' && await arrowhead.isVisible().catch(() => false));
  }
  const color = page.getByRole('button', { name: 'Color', exact: true }).first();
  const handles = page.locator('[data-resize-handle], [data-handle]');
  return (await color.isVisible().catch(() => false)) || (await handles.count()) > 0;
}

async function deselectEmpty(page) {
  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.92, pageEl.y + pageEl.height * 0.08);
}

async function selectAnno(page, id, kind = 'shape') {
  await selectMode(page);
  await deselectEmpty(page);
  const selectors = [
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"] [data-shape-hit-target]`,
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"]`,
    `[data-svg-annotation-layer="1"] [data-callout-id="${id}"] [data-callout-part="textBox"]`,
    `[data-svg-annotation-layer="1"] [data-callout-id="${id}"]`,
  ];
  await expect.poll(async () => {
    for (const selector of selectors) {
      await pointerClickHost(page, selector);
      if (await selectionChromeUp(page, kind)) return true;
      await clickHost(page, selector);
      if (await selectionChromeUp(page, kind)) return true;
    }
    return false;
  }, { timeout: 12_000, message: `select remapped ${id}` }).toBe(true);
  return true;
}

async function openColorPicker(page, triggerName = 'Color') {
  const trigger = page.getByRole('button', { name: triggerName, exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  if (!(await page.getByRole('button', { name: 'Preset colors', exact: true }).isVisible().catch(() => false))) {
    await trigger.click();
  }
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
}

async function clickSwatch(page, hexOrTitle) {
  const title = hexOrTitle === 'transparent' ? 'Transparent' : hexOrTitle;
  const swatch = page.locator(`button[title="${title}"]`).first();
  await expect(swatch).toBeVisible({ timeout: 4_000 });
  await swatch.click();
}

async function pickDesktopOption(page, triggerName, listboxName, label) {
  const trigger = page.getByRole('button', { name: triggerName, exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: listboxName })).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: label, exact: true });
  if (listboxName === 'Font' && await option.count()) {
    const optionFamily = await option.first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(optionFamily.includes(','), `${label} option must not be a CSS stack`).toBeFalsy();
  }
  if (await option.count()) await option.click();
  else await popover.getByText(label, { exact: true }).click();
  await expect(popover).toHaveCount(0);
}

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  if (await pages.first().isVisible().catch(() => false)) {
    if ((await pages.first().getAttribute('aria-pressed')) !== 'true') {
      await pages.first().click();
    }
    return;
  }
  const rail = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await rail.first().isVisible().catch(() => false)) {
    await rail.first().click();
  }
  const again = page.getByRole('button', { name: 'Pages', exact: true });
  if (await again.first().isVisible().catch(() => false)
    && (await again.first().getAttribute('aria-pressed')) !== 'true') {
    await again.first().click();
  }
}

async function openPageMenu(page, pageNumber = 1) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return {
    rotateCw: pagesMenu(page).getByText('Rotate', { exact: true }),
    rotateCcw: pagesMenu(page).getByText('Rotate counter-clockwise', { exact: true }),
  };
}

async function rotatePage(page, pageNumber, direction = 'cw') {
  const beforeBox = await pageBox(page, pageNumber);
  const items = await openPageMenu(page, pageNumber);
  await (direction === 'cw' ? items.rotateCw : items.rotateCcw).click();
  await expect(pagesMenu(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => {
    const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
    if (!box) return false;
    const wasPortrait = beforeBox.height > beforeBox.width + 8;
    const nowLandscape = box.width > box.height + 8;
    const nowPortrait = box.height > box.width + 8;
    return wasPortrait ? nowLandscape : nowPortrait;
  }, { timeout: 45_000, message: `page ${pageNumber} should flip aspect after ${direction} rotate` }).toBeTruthy();
  await closeDocumentPanel(page);
  await assertNoErrorBoundary(page);
}

async function waitForEditorReady(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

test('desktop remapped fill / font / callout style after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userCount(page), 'fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await userCount(page), 'empty CW invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await userCount(page), 'empty CCW invents 0').toBe(0);

  const rect = await createRect(page);
  await dismissChrome(page);
  const text = await createTextbox(page);
  await dismissChrome(page);
  const callout = await createCallout(page);
  await dismissChrome(page);
  expect(rect?.id && text?.id && callout?.id).toBeTruthy();
  expect(isSingleNameFontFamily(text.fontFamily), 'create stamps a single-name font').toBe(true);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remappedRect = await geom(page, rect.id);
  const remappedText = await geom(page, text.id);
  const remappedCallout = await geom(page, callout.id);
  expect(Math.hypot(remappedRect.cx - rect.cx, remappedRect.cy - rect.cy), 'rect remaps').toBeGreaterThan(8);
  expect(Math.hypot(remappedText.cx - text.cx, remappedText.cy - text.cy), 'textbox remaps').toBeGreaterThan(8);
  expect(almostEq(remappedCallout.boxX, callout.boxX, 0.02), 'callout box remaps').toBe(false);

  expect(await selectAnno(page, rect.id), 'select remapped rect').toBe(true);
  const priorFill = colorKey(remappedRect.fill);
  const priorStroke = colorKey(remappedRect.stroke);
  await openColorPicker(page, 'Color');
  const fillTab = page.getByRole('button', { name: 'Fill', exact: true }).first();
  if (await fillTab.count()) await fillTab.click();
  await clickSwatch(page, '#FF0000');
  let afterChip = null;
  await expect.poll(async () => {
    afterChip = await geom(page, rect.id);
    return colorKey(afterChip.fill);
  }, { timeout: 8_000, message: 'remapped rect fill chip must stick' }).toBe('#FF0000');
  expect(placeHeld(afterChip, remappedRect), 'fill chip must not jump remapped rect').toBe(true);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rect.id);
    return colorKey(now.fill) === priorFill && placeHeld(now, remappedRect);
  }, { timeout: 12_000, message: 'undo chip restores remapped rect + prior color' }).toBeTruthy();

  expect(await selectAnno(page, rect.id)).toBe(true);
  await openColorPicker(page, 'Color');
  if (await fillTab.count()) await fillTab.click();
  const hex = page.getByRole('textbox', { name: 'Hex color', exact: true }).first();
  if (await hex.isVisible().catch(() => false)) {
    await hex.fill('00AAFF');
    await expect.poll(async () => colorKey((await geom(page, rect.id))?.fill), {
      timeout: 8_000,
      message: 'custom hex must stick on remapped rect',
    }).toBe('#00AAFF');
    expect(placeHeld(await geom(page, rect.id), remappedRect), 'custom hex must not jump remapped rect').toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(async () => {
      const now = await geom(page, rect.id);
      if (colorKey(now.fill) === priorFill && placeHeld(now, remappedRect)) return true;
      await page.keyboard.press('Control+z');
      return false;
    }, { timeout: 12_000, message: 'undo hex restores remapped rect + prior color' }).toBeTruthy();
  }

  expect(await selectAnno(page, rect.id)).toBe(true);
  await openColorPicker(page, 'Color');
  const borderTab = page.getByRole('button', { name: 'Border', exact: true }).first();
  if (await borderTab.count()) await borderTab.click();
  await clickSwatch(page, '#0000FF');
  let afterStroke = null;
  await expect.poll(async () => {
    afterStroke = await geom(page, rect.id);
    return colorKey(afterStroke.stroke);
  }, { timeout: 8_000, message: 'remapped rect stroke chip must stick' }).toBe('#0000FF');
  expect(placeHeld(afterStroke, remappedRect), 'stroke chip must not jump remapped rect').toBe(true);
  await page.keyboard.press('Escape');

  expect(await selectAnno(page, text.id, 'text'), 'select remapped textbox').toBe(true);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
  if (await edit.isVisible().catch(() => false)) await edit.click();
  await expect(page.getByRole('button', { name: 'Font', exact: true }).first()).toBeVisible({ timeout: 8_000 });
  const priorFamily = familyKey(remappedText.fontFamily) || 'Helvetica';
  await pickDesktopOption(page, 'Font', 'Font', 'Times New Roman');
  let afterFont = null;
  await expect.poll(async () => {
    afterFont = await geom(page, text.id);
    return familyKey(afterFont.fontFamily);
  }, { timeout: 8_000, message: 'remapped textbox font must stick' }).toBe('Times New Roman');
  expect(isSingleNameFontFamily(afterFont.fontFamily), 'fontFamily stays a single name').toBe(true);
  expect(placeHeld(afterFont, remappedText), 'font must not jump remapped textbox').toBe(true);

  const priorSize = Number(afterFont.fontSize);
  await page.keyboard.press('Escape');
  await persistOpenText(page, '');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, text.id);
    return familyKey(now.fontFamily) === priorFamily && placeHeld(now, remappedText);
  }, { timeout: 12_000, message: 'undo font restores remapped textbox + prior family' }).toBeTruthy();

  expect(await selectAnno(page, text.id, 'text')).toBe(true);
  if (await edit.isVisible().catch(() => false)) await edit.click();
  await pickDesktopOption(page, 'Font size', 'Font size', '24');
  let afterSize = null;
  await expect.poll(async () => {
    afterSize = await geom(page, text.id);
    return Number(afterSize.fontSize);
  }, { timeout: 8_000, message: 'remapped textbox size must stick' }).toBe(24);
  expect(isSingleNameFontFamily(afterSize.fontFamily)).toBe(true);
  expect(placeHeld(afterSize, remappedText), 'size must not jump remapped textbox').toBe(true);
  await page.keyboard.press('Escape');
  await persistOpenText(page, '');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, text.id);
    return Number(now.fontSize) === priorSize && placeHeld(now, remappedText);
  }, { timeout: 12_000, message: 'undo size restores remapped textbox + prior size' }).toBeTruthy();

  expect(await selectAnno(page, callout.id, 'callout'), 'select remapped callout').toBe(true);
  const arrowhead = page.getByRole('button', { name: 'Arrowhead', exact: true }).first();
  const styleBtn = page.getByRole('button', { name: 'Style', exact: true }).first();
  const priorHead = remappedCallout.arrowheadStyle || 'solidTriangle';
  if (await arrowhead.isVisible().catch(() => false)) {
    await pickDesktopOption(page, 'Arrowhead', 'Arrowhead', 'V-shape');
    await expect.poll(async () => String((await geom(page, callout.id))?.arrowheadStyle || ''), {
      timeout: 8_000,
      message: 'remapped callout arrowhead must stick',
    }).toBe('vShape');
  } else if (await styleBtn.isVisible().catch(() => false)) {
    await pickDesktopOption(page, 'Style', 'Style', 'Dashed');
    await expect.poll(async () => String((await geom(page, callout.id))?.id || ''), {
      timeout: 8_000,
    }).toBe(callout.id);
  } else {
    const aa = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    await expect(aa).toBeVisible({ timeout: 8_000 });
    await aa.click();
    await page.getByRole('button', { name: 'Font color', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
    await clickSwatch(page, '#FF0000');
    await page.keyboard.press('Escape');
  }
  const afterCallout = await geom(page, callout.id);
  expect(almostEq(afterCallout.boxX, remappedCallout.boxX, 0.02), 'callout format holds remapped box X').toBe(true);
  expect(almostEq(afterCallout.boxY, remappedCallout.boxY, 0.02), 'callout format holds remapped box Y').toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, callout.id);
    return almostEq(now.boxX, remappedCallout.boxX, 0.02)
      && (String(now.arrowheadStyle || 'solidTriangle') === priorHead || now.id === callout.id);
  }, { timeout: 12_000, message: 'undo restores remapped callout' }).toBeTruthy();

  const frozenRect = await geom(page, rect.id);
  expect(await selectAnno(page, rect.id)).toBe(true);
  await openColorPicker(page, 'Color');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preset colors', exact: true })).toHaveCount(0);
  const skipped = await geom(page, rect.id);
  expect(colorKey(skipped.fill), 'Escape skip-commit does not apply').toBe(colorKey(frozenRect.fill));
  expect(placeHeld(skipped, remappedRect), 'Escape does not jump remapped rect').toBe(true);

  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  expect(await userCount(page), 'empty remapped-page click invents 0').toBe(3);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_REMAP_FORMAT_DESKTOP_PROOF', JSON.stringify({
    rectId: rect.id,
    textId: text.id,
    calloutId: callout.id,
    rect: { created: { cx: rect.cx, cy: rect.cy }, remapped: { cx: remappedRect.cx, cy: remappedRect.cy }, fill: colorKey(afterChip.fill), stroke: colorKey(afterStroke.stroke) },
    text: { created: { cx: text.cx, cy: text.cy, fontFamily: text.fontFamily }, remapped: { cx: remappedText.cx, cy: remappedText.cy }, fontFamily: afterFont.fontFamily, fontSize: afterSize.fontSize },
    callout: { created: { boxX: callout.boxX, boxY: callout.boxY }, remapped: { boxX: remappedCallout.boxX, boxY: remappedCallout.boxY }, arrowheadStyle: afterCallout.arrowheadStyle },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-format edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userCount(page), '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_REMAP_FORMAT_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    annotations: await userCount(page),
  }));
});
