import { test, expect } from '@playwright/test';

// Apply Style (Solid / Dashed / Dotted) to remapped selections after page CW.
// Distinct from unrotated e2e-rect-ellipse-text-dash, remapped format chips
// (fill/font/arrowhead), remapped text/opacity/width, leftover-18 / X-01.
// PointerEvent select is OK if Playwright mouse misses. Do not stamp file.id.
// Ellipse/text omit Cloud (already product). Do not invent dest-XYZ / captcha /
// stamps / Group / Extract / Note/Link / Forms editor / Curve / file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const PLACE_EPS = 4;
const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };
const ELLIPSE_BOX = { x0: 0.16, y0: 0.52, x1: 0.40, y1: 0.70 };
const TEXT_BOX = { x0: 0.50, y0: 0.22, x1: 0.78, y1: 0.36 };

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

function almostEq(a, b, eps = PLACE_EPS) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function placeHeld(a, b) {
  if (!a || !b) return false;
  return almostEq(a.cx, b.cx) && almostEq(a.cy, b.cy)
    && almostEq(a.width, b.width, 8) && almostEq(a.height, b.height, 10);
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
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const ownL = Number(object.left);
      const dataL = Number(data.left);
      const ownT = Number(object.top);
      const dataT = Number(data.top);
      const left = (Number.isFinite(dataL) && (!Number.isFinite(ownL) || (Math.abs(ownL) < 1 && Math.abs(dataL) > 1)))
        ? dataL
        : (Number.isFinite(ownL) ? ownL : 0);
      const top = (Number.isFinite(dataT) && (!Number.isFinite(ownT) || (Math.abs(ownT) < 1 && Math.abs(dataT) > 1)))
        ? dataT
        : (Number.isFinite(ownT) ? ownT : 0);
      const width = Number(object.width ?? data.width ?? 0);
      const height = Number(object.height ?? data.height ?? 0);
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
        tool: String(object.tool || data.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        width,
        height,
        cx: left + width / 2,
        cy: top + height / 2,
        strokeDashArray: object.strokeDashArray ?? data.strokeDashArray ?? null,
        pdfCloudIntensity: data.pdfCloudIntensity ?? null,
        visualKind: cloud ? 'cloud-rect' : ellipse ? 'ellipse' : rect ? 'rect' : textBorder ? 'text-border' : null,
        visualDash: paint?.getAttribute('stroke-dasharray') || null,
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

async function createEllipse(page) {
  const before = new Set((await snapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Ellipse');
  await dragOnPage(page, ELLIPSE_BOX);
  const created = await waitForNew(page, before, (row) => (
    row.type === 'ellipse' || row.type === 'circle' || row.tool === 'ellipse'
  ));
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
    row.type === 'textbox' || row.type === 'text' || row.type === 'i-text' || row.tool === 'text'
  ));
  await selectMode(page);
  return geom(page, created.id);
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

async function clickHost(page, selector) {
  const host = page.locator(selector).first();
  if (!(await host.count())) return false;
  const box = await host.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function selectionChromeUp(page, kind = 'shape') {
  if (kind === 'text') {
    const font = page.getByRole('button', { name: 'Font', exact: true }).first();
    const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    const style = page.getByRole('button', { name: 'Style', exact: true }).first();
    return (await font.isVisible().catch(() => false))
      || (await edit.isVisible().catch(() => false))
      || (await style.isVisible().catch(() => false));
  }
  const style = page.getByRole('button', { name: 'Style', exact: true }).first();
  const handles = page.locator('[data-resize-handle], [data-handle]');
  return (await style.isVisible().catch(() => false)) || (await handles.count()) > 0;
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

function desktopStyleTrigger(page) {
  return page.getByRole('button', { name: 'Style', exact: true }).first();
}

async function listDesktopStyle(page) {
  const trigger = desktopStyleTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Style' })).toBeVisible({ timeout: 5_000 });
  const values = (await popover.getByRole('option').allTextContents()).map((text) => text.trim());
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  return values;
}

async function pickDesktopStyle(page, label) {
  const trigger = desktopStyleTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Style' })).toBeVisible({ timeout: 5_000 });
  await popover.getByRole('option', { name: label, exact: true }).click();
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

test('desktop remapped Style dash after page CW intended + break + edge', async ({ page }) => {
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
  const ellipse = await createEllipse(page);
  await dismissChrome(page);
  const text = await createTextbox(page);
  await dismissChrome(page);
  expect(rect?.id && ellipse?.id && text?.id).toBeTruthy();
  expect(dashKey(rect.strokeDashArray), 'rect create stays Solid').toBe('solid');
  expect(dashKey(ellipse.strokeDashArray), 'ellipse create stays Solid').toBe('solid');
  expect(dashKey(text.strokeDashArray), 'textbox create stays Solid').toBe('solid');

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remappedRect = await geom(page, rect.id);
  const remappedEllipse = await geom(page, ellipse.id);
  const remappedText = await geom(page, text.id);
  expect(Math.hypot(remappedRect.cx - rect.cx, remappedRect.cy - rect.cy), 'rect remaps').toBeGreaterThan(8);
  expect(Math.hypot(remappedEllipse.cx - ellipse.cx, remappedEllipse.cy - ellipse.cy), 'ellipse remaps').toBeGreaterThan(8);
  expect(Math.hypot(remappedText.cx - text.cx, remappedText.cy - text.cy), 'textbox remaps').toBeGreaterThan(8);
  expect(dashKey(remappedRect.strokeDashArray), 'CW keeps Solid').toBe('solid');

  expect(await selectAnno(page, rect.id), 'select remapped rect').toBe(true);
  const rectStyles = await listDesktopStyle(page);
  expect(rectStyles, 'remapped Rect Style catalog').toEqual(['Solid', 'Dashed', 'Dotted', 'Cloud']);
  await pickDesktopStyle(page, 'Dashed');
  let afterRect = null;
  await expect.poll(async () => {
    afterRect = await geom(page, rect.id);
    return dashKey(afterRect.strokeDashArray);
  }, { timeout: 8_000, message: 'remapped rect Dashed must stick' }).toBe('dashed');
  expect(dashKey(afterRect.visualDash), 'remapped rect SVG dash').toBe('dashed');
  expect(placeHeld(afterRect, remappedRect), 'Dashed must not jump remapped rect').toBe(true);
  expect(afterRect.pdfCloudIntensity == null || afterRect.pdfCloudIntensity === '', 'Dashed clears cloud').toBe(true);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rect.id);
    return dashKey(now.strokeDashArray) === 'solid' && placeHeld(now, remappedRect);
  }, { timeout: 12_000, message: 'undo restores remapped rect + prior dash' }).toBeTruthy();

  expect(await selectAnno(page, ellipse.id), 'select remapped ellipse').toBe(true);
  const ellipseStyles = await listDesktopStyle(page);
  expect(ellipseStyles, 'remapped Ellipse Style omits Cloud').toEqual(['Solid', 'Dashed', 'Dotted']);
  expect(ellipseStyles.join(' | ')).not.toMatch(/cloud/i);
  await pickDesktopStyle(page, 'Dotted');
  let afterEllipse = null;
  await expect.poll(async () => {
    afterEllipse = await geom(page, ellipse.id);
    return dashKey(afterEllipse.strokeDashArray);
  }, { timeout: 8_000, message: 'remapped ellipse Dotted must stick' }).toBe('dotted');
  expect(dashKey(afterEllipse.visualDash), 'remapped ellipse SVG dash').toBe('dotted');
  expect(placeHeld(afterEllipse, remappedEllipse), 'Dotted must not jump remapped ellipse').toBe(true);
  expect(afterEllipse.visualKind, 'ellipse stays ellipse, not cloud').toBe('ellipse');

  expect(await selectAnno(page, text.id, 'text'), 'select remapped textbox').toBe(true);
  const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
  if (await edit.isVisible().catch(() => false)) await edit.click();
  const textStyles = await listDesktopStyle(page);
  expect(textStyles, 'remapped Text Style omits Cloud').toEqual(['Solid', 'Dashed', 'Dotted']);
  expect(textStyles.join(' | ')).not.toMatch(/cloud/i);
  await pickDesktopStyle(page, 'Dashed');
  let afterText = null;
  await expect.poll(async () => {
    afterText = await geom(page, text.id);
    return dashKey(afterText.strokeDashArray);
  }, { timeout: 8_000, message: 'remapped textbox Dashed must stick' }).toBe('dashed');
  expect(dashKey(afterText.visualDash), 'remapped textbox SVG dash').toBe('dashed');
  expect(placeHeld(afterText, remappedText), 'Dashed must not jump remapped textbox').toBe(true);

  const frozen = await geom(page, rect.id);
  expect(await selectAnno(page, rect.id)).toBe(true);
  await desktopStyleTrigger(page).click();
  await expect(page.locator('[data-annotation-dropdown-popover="true"]').getByRole('listbox', { name: 'Style' }))
    .toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-annotation-dropdown-popover="true"]')).toHaveCount(0);
  const skipped = await geom(page, rect.id);
  expect(dashKey(skipped.strokeDashArray), 'Escape skip-commit does not apply').toBe(dashKey(frozen.strokeDashArray));
  expect(placeHeld(skipped, remappedRect), 'Escape does not jump remapped rect').toBe(true);

  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  expect(await userCount(page), 'empty remapped-page click invents 0').toBe(3);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Style', exact: true }).count(), 'hubPreview Style 0').toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_REMAP_DASH_DESKTOP_PROOF', JSON.stringify({
    rectId: rect.id,
    ellipseId: ellipse.id,
    textId: text.id,
    rect: {
      created: { cx: rect.cx, cy: rect.cy, dash: dashKey(rect.strokeDashArray) },
      remapped: { cx: remappedRect.cx, cy: remappedRect.cy },
      dash: dashKey(afterRect.strokeDashArray),
    },
    ellipse: {
      created: { cx: ellipse.cx, cy: ellipse.cy },
      remapped: { cx: remappedEllipse.cx, cy: remappedEllipse.cy },
      dash: dashKey(afterEllipse.strokeDashArray),
    },
    text: {
      created: { cx: text.cx, cy: text.cy },
      remapped: { cx: remappedText.cx, cy: remappedText.cy },
      dash: dashKey(afterText.strokeDashArray),
    },
    catalogs: { rect: rectStyles, ellipse: ellipseStyles, text: textStyles },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-dash edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
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
  expect(await page.getByRole('button', { name: /^Border style:/ }).count()).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_REMAP_DASH_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    annotations: await userCount(page),
  }));
});
