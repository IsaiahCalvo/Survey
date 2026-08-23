import { test, expect } from '@playwright/test';

// Product bug leftover the 43cefd4f inspect missed: Width / Size numeric
// field had Enter+blur commit but no Escape skip-commit. Zoom % / page # /
// rotation already restore. Distinct from D-05 every-preset catalogs,
// leftover-18 / X-01. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

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

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function widthField(page) {
  return page.getByRole('textbox', { name: 'Width', exact: true }).first();
}

async function sizeField(page) {
  return page.getByRole('textbox', { name: 'Size', exact: true }).first();
}

async function typeDraft(field, raw) {
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill('');
  await field.fill(String(raw));
}

async function userInkSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      if (object.isPdfImported === true) return null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || '').toLowerCase(),
        sourceWidth: object.sourceWidth ?? null,
        strokeWidth: object.strokeWidth ?? data.strokeWidth ?? null,
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function waitForNewInk(page, beforeIds, predicate = () => true) {
  let created = null;
  await expect.poll(async () => {
    const rows = await userInkSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && predicate(row)) || null;
    return created;
  }, { message: 'expected a new user ink path' }).not.toBeNull();
  return created;
}

async function drawInk(page, { yFraction = 0.28, x0 = 0.16, x1 = 0.42 } = {}) {
  const before = new Set((await userInkSnapshot(page)).map((row) => row.id));
  const box = await pageBox(page);
  const y = box.y + box.height * yFraction;
  await page.mouse.move(box.x + box.width * x0, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((x0 + x1) / 2), y - 2, { steps: 4 });
  await page.mouse.move(box.x + box.width * x1, y + 2, { steps: 4 });
  await page.mouse.up();
  return waitForNewInk(page, before, (row) => row.type === 'path');
}

async function userShapeSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      if (object.isPdfImported === true) return null;
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || '').toLowerCase(),
        strokeWidth: object.strokeWidth ?? data.strokeWidth ?? null,
      };
    }).filter(Boolean);
  }, pageNumber);
}

async function createRect(page, { x0 = 0.18, y0 = 0.22, x1 = 0.42, y1 = 0.38 } = {}) {
  const before = new Set((await userShapeSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  const box = await pageBox(page);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 6 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const rows = await userShapeSnapshot(page);
    created = rows.find((row) => (
      !before.has(row.id) && (row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect')
    )) || null;
    return created;
  }, { message: 'expected a new rect' }).not.toBeNull();
  return created;
}

async function clickShape(page, id) {
  const handle = page.locator(`[data-shape-id="${id}"]`).first();
  if (await handle.count()) {
    await handle.click({ force: true });
    return;
  }
  await page.locator(`[data-anno-id="${id}"]`).first().click({ force: true });
}

test('Width Escape skip-commit intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await activateTool(page, 'Draw', 'Pen');
  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  const baseline = await field.inputValue();
  expect(Number(baseline), 'Pen Width must start at a committed whole number').toBeGreaterThan(0);

  await typeDraft(field, '32');
  await expect(field).toHaveValue('32');
  await field.press('Escape');
  await expect(field).toHaveValue(baseline);
  const escapedInk = await drawInk(page, { yFraction: 0.24, x0: 0.14, x1: 0.40 });
  expect(escapedInk.tool).toBe('pen');
  expect(escapedInk.sourceWidth, 'Escape must not leave the typed Width live for next-draw').toBe(Number(baseline));

  await typeDraft(field, '32');
  await field.press('Enter');
  await expect(field).toHaveValue('32');
  const committedInk = await drawInk(page, { yFraction: 0.32, x0: 0.14, x1: 0.40 });
  expect(committedInk.sourceWidth, 'Enter still commits').toBe(32);

  await typeDraft(field, '999');
  await field.press('Escape');
  await expect(field).toHaveValue('32');
  const afterCeilEscape = await drawInk(page, { yFraction: 0.40, x0: 0.14, x1: 0.40 });
  expect(afterCeilEscape.sourceWidth, 'Escape must not clamp-commit 999→50').toBe(32);

  await typeDraft(field, '');
  await field.press('Escape');
  await expect(field).toHaveValue('32');

  await typeDraft(field, '8');
  await field.press('Escape');
  await expect(field).toHaveValue('32');
  await page.mouse.click(16, 180);
  await expect(field).toHaveValue('32');
  const afterBlur = await drawInk(page, { yFraction: 0.48, x0: 0.14, x1: 0.40 });
  expect(afterBlur.sourceWidth, 'blur after Escape must not persist the cancelled draft').toBe(32);

  const rect = await createRect(page);
  expect(rect.strokeWidth).toBe(2);
  await clickVisible(page, 'Select');
  await clickShape(page, rect.id);
  const rectField = await widthField(page);
  await expect(rectField).toBeVisible({ timeout: 8_000 });
  await expect(rectField).toHaveValue('2');
  await typeDraft(rectField, '16');
  await rectField.press('Escape');
  await expect(rectField).toHaveValue('2');
  await expect.poll(async () => {
    const row = (await userShapeSnapshot(page)).find((item) => item.id === rect.id);
    return row?.strokeWidth ?? null;
  }, { message: 'selected rect must keep strokeWidth 2 after Escape' }).toBe(2);

  await typeDraft(rectField, '16');
  await rectField.press('Enter');
  await expect.poll(async () => {
    const row = (await userShapeSnapshot(page)).find((item) => item.id === rect.id);
    return row?.strokeWidth ?? null;
  }, { message: 'Enter still patches the selected rect' }).toBe(16);

  await activateTool(page, 'Draw', 'Partial erase');
  const size = await sizeField(page);
  await expect(size).toBeVisible({ timeout: 8_000 });
  const eraserBaseline = await size.inputValue();
  expect(eraserBaseline, 'Eraser Size is not the Pen Width store').not.toBe('32');
  await typeDraft(size, '80');
  await size.press('Escape');
  await expect(size).toHaveValue(eraserBaseline);
  await typeDraft(size, '24');
  await size.press('Enter');
  await expect(size).toHaveValue('24');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('SIZE_ESCAPE_DESKTOP_PROOF', JSON.stringify({
    baseline: Number(baseline),
    escapedInk: escapedInk.id,
    committedInk: committedInk.id,
    afterCeilEscape: afterCeilEscape.id,
    afterBlur: afterBlur.id,
    rect: { id: rect.id, kept: 2, entered: 16 },
    eraserBaseline,
    viewBox,
    fileId,
  }));
});

test('390 Width Escape skip-commit intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);
  await ensurePageDrawTarget(page);
  await activateTool(page, 'Draw', 'Pen');

  const field = await widthField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  const baseline = await field.inputValue();
  await typeDraft(field, '32');
  await field.press('Escape');
  await expect(field).toHaveValue(baseline);
  const escapedInk = await drawInk(page, { yFraction: 0.34, x0: 0.16, x1: 0.62 });
  expect(escapedInk.sourceWidth).toBe(Number(baseline));

  await typeDraft(field, '12');
  await field.press('Enter');
  await expect(field).toHaveValue('12');
  const committedInk = await drawInk(page, { yFraction: 0.46, x0: 0.16, x1: 0.62 });
  expect(committedInk.sourceWidth).toBe(12);

  await typeDraft(field, '999');
  await field.press('Escape');
  await expect(field).toHaveValue('12');

  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  await openEditor(page, { width: 1440, height: 900 });
  expect(await page.getByRole('button', { name: 'Open fill color picker', exact: true }).count()).toBe(0);

  console.log('SIZE_ESCAPE_390_PROOF', JSON.stringify({
    baseline: Number(baseline),
    escapedInk: escapedInk.id,
    committedInk: committedInk.id,
    viewBox,
    fileId,
  }));
});
