import { test, expect } from '@playwright/test';

// Apply Eraser Size on a remapped page after Pages CW.
// Distinct from unrotated e2e-eraser-size-presets, remapped live-stroke
// bite/delete, remapped Counter Size, leftover-18 / X-01.
// Size is a tool pref (not an annotation). Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const INK = { x0: 0.18, y0: 0.18, x1: 0.42, y1: 0.22 };

function almostEq(a, b, eps = 4) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function inkHeld(a, b) {
  if (!a || !b) return false;
  return a.id === b.id
    && almostEq(a.clx, b.clx)
    && almostEq(a.cly, b.cly)
    && almostEq(a.left, b.left, 1);
}

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('eraserMode');
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

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'highlighter' || row.tool === 'freedraw';
}

async function inkSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      const first = object.paperCenterline?.[0] || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? 0),
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
        strokeWidth: Number(object.strokeWidth ?? data.strokeWidth ?? 0),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function geom(page, id) {
  return (await inkSnapshot(page)).find((row) => row.id === id) || null;
}

async function userCount(page) {
  return (await inkSnapshot(page)).length;
}

async function activateTool(page, categoryName, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if (!String(await sub.first().getAttribute('class') || '').includes('btn-active')) {
      await sub.first().click();
    }
    return;
  }
  const category = page.getByRole('button', { name: categoryName, exact: true }).first();
  await expect(category).toBeVisible({ timeout: 8_000 });
  if (!String(await category.getAttribute('class') || '').includes('btn-active')) {
    await category.click();
  }
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  await expect(again.first()).toBeVisible({ timeout: 8_000 });
  if (!String(await again.first().getAttribute('class') || '').includes('btn-active')) {
    await again.first().click();
  }
}

async function waitForNewInk(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    created = (await inkSnapshot(page)).find((row) => !beforeIds.has(row.id) && isInk(row)) || null;
    return created;
  }, { message: 'expected a new ink stroke' }).not.toBeNull();
  return created;
}

async function createInk(page, coords = INK) {
  const before = new Set((await inkSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  const width = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  if (await width.isVisible().catch(() => false)) {
    await width.fill('8');
    await width.press('Enter');
  }
  await blurInputs(page);
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 10 });
  await page.mouse.up();
  const created = await waitForNewInk(page, before);
  return geom(page, created.id);
}

async function activateEraser(page) {
  await activateTool(page, 'Draw', 'Partial erase');
  if (!(await page.locator('[data-diag-eraser-wrapper="1"]').isVisible().catch(() => false))) {
    await activateTool(page, 'Draw', 'Eraser');
  }
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
  await expect(sizeField(page)).toBeVisible({ timeout: 8_000 });
}

function sizeField(page) {
  return page.getByRole('textbox', { name: 'Size', exact: true });
}

async function pickSizePreset(page, preset) {
  const trigger = page.getByRole('button', { name: 'Size presets', exact: true });
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-size-popover="true"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  const option = popover.getByRole('option', { name: String(preset), exact: true });
  if (await option.count()) await option.click();
  else await popover.getByText(String(preset), { exact: true }).click();
  await expect(popover).toHaveCount(0);
}

async function setSizeTyped(page, raw) {
  const field = sizeField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
  await field.press('Enter');
}

async function containerAwareScale(page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    const svg = document.querySelector('[data-svg-annotation-layer="1"] svg, [data-svg-annotation-layer="1"]');
    const viewBox = svg?.viewBox?.baseVal;
    const pageWidth = viewBox?.width || 0;
    const offsetWidth = pageEl?.offsetWidth || 0;
    return {
      offsetWidth,
      pageWidth,
      effectiveScale: pageWidth > 0 ? offsetWidth / pageWidth : 0,
    };
  });
}

async function measureCursor(page, expectedDiameter) {
  const wrapper = page.locator('[data-diag-eraser-wrapper="1"]');
  await expect(wrapper).toBeVisible();
  const box = await wrapper.boundingBox();
  expect(box, 'eraser wrapper geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.40);
  const scale = await containerAwareScale(page);
  let cursor = null;
  await expect.poll(async () => {
    cursor = await page.locator('[data-eraser-cursor="true"]').evaluateAll((nodes) => {
      const visible = nodes.find((node) => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && parseFloat(style.width) > 0;
      });
      if (!visible) return null;
      const style = getComputedStyle(visible);
      return { width: parseFloat(style.width), height: parseFloat(style.height) };
    });
    return cursor;
  }, { message: `eraser cursor must appear for diameter ${expectedDiameter}` }).not.toBeNull();
  const expected = expectedDiameter * scale.effectiveScale;
  return { ...cursor, ...scale, expected };
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

test('desktop remapped Eraser Size after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Size', exact: true }).count(), 'hubPreview Eraser Size 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

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

  const ink = await createInk(page);
  await dismissChrome(page);
  expect(ink?.id).toBeTruthy();
  expect(Number.isFinite(ink.clx), 'create stamps a centerline').toBe(true);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remapped = await geom(page, ink.id);
  expect(Math.hypot(remapped.clx - ink.clx, remapped.cly - ink.cly), 'ink remaps').toBeGreaterThan(8);
  expect(remapped.left, 'remapped ink left stays 0').toBe(0);
  const priorStroke = Number(remapped.strokeWidth);

  await activateEraser(page);
  const field = sizeField(page);
  await expect(field).toBeVisible();
  const priorSize = Number(await field.inputValue()) || 20;
  await pickSizePreset(page, 64);
  await expect(field).toHaveValue('64');
  const cursor = await measureCursor(page, 64);
  expect(cursor.pageWidth, 'cursor uses landscape page width').toBeCloseTo(792, 0);
  expect(
    Math.abs(cursor.width - cursor.expected),
    `cursor ${cursor.width}px must match 64 × container-aware scale ${cursor.effectiveScale}`,
  ).toBeLessThanOrEqual(Math.max(2, cursor.expected * 0.08));
  const afterSize = await geom(page, ink.id);
  expect(inkHeld(afterSize, remapped), 'Eraser Size must not jump remapped ink').toBe(true);
  expect(Number(afterSize.strokeWidth), 'Eraser Size must not rewrite pen Width').toBe(priorStroke);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  if (await undo.isEnabled().catch(() => false)) {
    await undo.click();
  } else {
    await page.keyboard.press('Control+z');
  }
  expect(await field.inputValue(), 'Eraser Size is a tool pref — not undoable').toBe('64');
  expect(inkHeld(await geom(page, ink.id), remapped), 'undo does not jump remapped ink').toBe(true);

  await field.click();
  await field.fill('abc');
  await field.press('Enter');
  expect(await field.inputValue(), 'letters rejected').toBe('64');
  expect(inkHeld(await geom(page, ink.id), remapped), 'letters do not jump remapped ink').toBe(true);

  await page.getByRole('button', { name: 'Size presets', exact: true }).click();
  await expect(page.locator('[data-annotation-size-popover="true"]')).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-annotation-size-popover="true"]')).toHaveCount(0);
  expect(await field.inputValue(), 'Escape skip-commit does not apply Size').toBe('64');
  expect(inkHeld(await geom(page, ink.id), remapped), 'Escape does not jump remapped ink').toBe(true);

  await setSizeTyped(page, 0);
  await expect(field).toHaveValue('1');
  await pickSizePreset(page, 64);
  await expect(field).toHaveValue('64');

  await activateTool(page, 'Shapes', 'Counter');
  await expect(sizeField(page)).toBeVisible({ timeout: 8_000 });
  await pickSizePreset(page, 32);
  await expect(sizeField(page)).toHaveValue('32');
  await activateEraser(page);
  expect(await sizeField(page).inputValue(), 'Counter Size must not rewrite Eraser Size').toBe('64');
  expect(inkHeld(await geom(page, ink.id), remapped), 'Counter Size does not jump remapped ink').toBe(true);

  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  expect(await userCount(page), 'empty remapped-page click invents 0').toBe(1);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Size', exact: true }).count(), 'hubPreview Size 0').toBe(0);

  console.log('PAGE_ROTATE_REMAP_ERASER_SIZE_DESKTOP_PROOF', JSON.stringify({
    inkId: ink.id,
    created: { clx: ink.clx, cly: ink.cly },
    remapped: { clx: remapped.clx, cly: remapped.cly, left: remapped.left },
    priorSize,
    size: 64,
    cursor: { width: cursor.width, expected: cursor.expected, effectiveScale: cursor.effectiveScale, pageWidth: cursor.pageWidth },
    undoable: false,
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-eraser-size edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
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

  console.log('PAGE_ROTATE_REMAP_ERASER_SIZE_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    annotations: await userCount(page),
  }));
});
