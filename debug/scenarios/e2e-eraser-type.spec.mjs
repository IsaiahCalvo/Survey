import { test, expect } from '@playwright/test';

// D-03 / D-04 leftover: Eraser type (Partial erase vs Full stroke erase).
// Prior D-03 was window entire-on-topmost. Prior D-04 was window bite +
// every Size. The type dropdown / caret flyout / E vs Shift+E / 390
// Eraser mode were cluster-only. Distinct from Size presets, leftover-18,
// and the 96 proved IDs. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

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

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
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

function isRect(row) {
  return row.type === 'rect' || row.type === 'rectangle';
}

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen';
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        tool: String(object.data?.tool || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
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

async function dragOnPage(page, { pageNumber = 1, x0, y0, x1, y1 }) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function createRect(page, coords) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, isRect);
}

async function createPenStroke(page, { yFraction = 0.62, x0 = 0.18, x1 = 0.78 } = {}) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  const width = page.getByRole('textbox', { name: 'Width', exact: true }).first();
  if (await width.isVisible().catch(() => false)) {
    await width.fill('8');
    await width.press('Enter');
  }
  await dragOnPage(page, { x0, y0: yFraction, x1, y1: yFraction });
  return waitForNewUserAnnotation(page, before, isInk);
}

async function userInkMetric(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => {
        const id = group.getAttribute('data-anno-id');
        const object = window.__phase35GetAnnotationById?.(id) || {};
        if (!id || object.isPdfImported === true) return null;
        const type = String(object.type || '').toLowerCase();
        const tool = String(object.data?.tool || object.tool || '').toLowerCase();
        if (type !== 'path' && tool !== 'pen') return null;
        const d = group.querySelector('path')?.getAttribute('d') || '';
        return { id, dLen: d.length };
      })
      .filter(Boolean);
    return {
      ids: rows.map((row) => row.id),
      dLen: rows.reduce((sum, row) => sum + row.dLen, 0),
      count: rows.length,
    };
  });
}

async function activateEraser(page, { mode = 'partial' } = {}) {
  await activateTool(page, 'Draw', mode === 'entire' ? 'Full stroke erase' : 'Partial erase');
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  await expect(typeBtn).toBeVisible({ timeout: 8_000 });
  const current = (await typeBtn.innerText()).replace(/\s+/g, ' ').trim();
  const wanted = mode === 'entire' ? 'Full stroke erase' : 'Partial erase';
  if (!current.includes(wanted)) {
    await setEraserType(page, wanted);
  }
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
}

async function setEraserType(page, label) {
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  await expect(typeBtn).toBeVisible({ timeout: 8_000 });
  await typeBtn.click();
  const pop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(pop).toBeVisible({ timeout: 5_000 });
  await expect(pop.locator('.annotation-dropdown__heading')).toHaveText('Eraser type');
  const option = pop.getByRole('option', { name: label, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(pop).toHaveCount(0);
  await expect.poll(async () => (
    (await typeBtn.innerText()).replace(/\s+/g, ' ').trim()
  ), { message: `Eraser type must read ${label}` }).toContain(label);
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
}

async function eraserTypeLabels(page) {
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  await typeBtn.click();
  const pop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(pop).toBeVisible({ timeout: 5_000 });
  const labels = await pop.getByRole('option').evaluateAll((nodes) => (
    nodes.map((node) => (node.textContent || '').trim())
  ));
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  return labels;
}

async function eraseThroughRegion(page, coords) {
  const wrapper = page.locator('[data-diag-eraser-wrapper="1"]');
  await expect(wrapper).toBeVisible({ timeout: 8_000 });
  const box = await wrapper.boundingBox();
  expect(box, 'eraser wrapper geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * coords.x0, box.y + box.height * coords.y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * coords.x1, box.y + box.height * coords.y1, { steps: 8 });
  await page.mouse.up();
}

async function eraseAcrossId(page, id) {
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
  const points = await page.evaluate((annotationId) => {
    const object = window.__phase35GetAnnotationById?.(annotationId);
    const wrapper = document.querySelector('[data-diag-eraser-wrapper="1"]');
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const rect = wrapper?.getBoundingClientRect();
    const viewBox = svg?.viewBox?.baseVal;
    if (!object || !rect || !viewBox?.width || !viewBox?.height) return [];
    const toClient = (x, y) => ({
      x: rect.left + (x / viewBox.width) * rect.width,
      y: rect.top + (y / viewBox.height) * rect.height,
    });
    const type = String(object.type || object.data?.type || '').toLowerCase();
    const tool = String(object.tool || object.data?.tool || '').toLowerCase();
    const samples = [];
    if (type === 'path' || tool === 'pen' || tool === 'highlighter') {
      for (const cmd of object.path || []) {
        const x = Number(cmd[cmd.length - 2]);
        const y = Number(cmd[cmd.length - 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) samples.push(toClient(x, y));
      }
    }
    if (samples.length >= 2) {
      const i0 = Math.floor((samples.length - 1) * 0.35);
      const i1 = Math.max(i0 + 1, Math.floor((samples.length - 1) * 0.55));
      return samples.slice(i0, i1 + 1);
    }
    const left = Number(object.left ?? object.x ?? NaN);
    const top = Number(object.top ?? object.y ?? NaN);
    const width = Number(object.width ?? NaN);
    const height = Number(object.height ?? NaN);
    if ([left, top, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      return [
        toClient(left + width * 0.2, top + height * 0.5),
        toClient(left + width * 0.8, top + height * 0.5),
      ];
    }
    return [];
  }, id);
  if (points.length >= 2) {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const point of points.slice(1)) {
      await page.mouse.move(point.x, point.y, { steps: 3 });
    }
    await page.mouse.up();
    return;
  }
  const box = await page.locator(`[data-anno-id="${id}"]`).first().boundingBox();
  expect(box, `fallback bbox ${id}`).toBeTruthy();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
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
}

function mobileEraserMode(page) {
  return page.getByRole('button', { name: /Eraser mode:/ });
}

test('desktop Eraser type intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);

  const rectA = await createRect(page, { x0: 0.18, y0: 0.20, x1: 0.36, y1: 0.34 });
  const rectB = await createRect(page, { x0: 0.60, y0: 0.20, x1: 0.78, y1: 0.34 });
  const ink = await createPenStroke(page, { yFraction: 0.58, x0: 0.16, x1: 0.82 });
  expect(rectA.id).toBeTruthy();
  expect(rectB.id).toBeTruthy();
  expect(ink.id).toBeTruthy();

  // Intended — default type is Partial erase; catalog is the two modes.
  await activateEraser(page, { mode: 'partial' });
  const catalog = await eraserTypeLabels(page);
  expect(catalog, 'desktop Eraser type catalog').toEqual(['Partial erase', 'Full stroke erase']);
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  expect((await typeBtn.innerText()).trim()).toContain('Partial erase');
  await expect(page.getByRole('textbox', { name: 'Size', exact: true })).toBeVisible();

  await eraseThroughRegion(page, { x0: 0.20, y0: 0.27, x1: 0.34, y1: 0.27 });
  await expect.poll(async () => (
    (await userAnnotationSnapshot(page)).some((row) => row.id === rectA.id)
  ), { message: 'partial must skip a rect' }).toBe(true);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rectB.id), 'isolation rect B').toBe(true);

  const inkBefore = await userInkMetric(page);
  await eraseAcrossId(page, ink.id);
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== inkBefore.dLen || after.count !== inkBefore.count || after.ids.join('|') !== inkBefore.ids.join('|');
  }, { message: 'partial must bite ink' }).toBe(true);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rectA.id), 'partial ink bite must leave rect A').toBe(true);

  // Intended — Full stroke erase deletes the hit object, not its sibling.
  await setEraserType(page, 'Full stroke erase');
  expect(await page.evaluate(() => localStorage.getItem('eraserMode'))).toBe('entire');
  await eraseAcrossId(page, rectA.id);
  await expect.poll(async () => (
    (await userAnnotationSnapshot(page)).some((row) => row.id === rectA.id)
  ), { message: 'full stroke must delete rect A' }).toBe(false);
  expect((await userAnnotationSnapshot(page)).some((row) => row.id === rectB.id), 'full stroke isolates rect B').toBe(true);

  // Break — already-entire reselect is a no-op; empty swipe invents 0.
  const afterEntire = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();
  await setEraserType(page, 'Full stroke erase');
  const empty = await pageBox(page);
  await page.mouse.move(empty.x + empty.width * 0.08, empty.y + empty.height * 0.86);
  await page.mouse.down();
  await page.mouse.move(empty.x + empty.width * 0.14, empty.y + empty.height * 0.90, { steps: 4 });
  await page.mouse.up();
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort()).toEqual(afterEntire);

  // Break — Pen / Select hide Eraser type.
  await activateTool(page, 'Draw', 'Pen');
  await expect(page.getByRole('button', { name: 'Eraser type', exact: true }), 'Pen hides Eraser type').toHaveCount(0);
  await clickVisible(page, 'Select');
  await expect(page.getByRole('button', { name: 'Eraser type', exact: true }), 'Select hides Eraser type').toHaveCount(0);

  // Intended — E keeps the stored entire mode; Shift+E forces partial.
  await blurInputs(page);
  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: 'Eraser type', exact: true })).toBeVisible({ timeout: 8_000 });
  expect((await page.getByRole('button', { name: 'Eraser type', exact: true }).innerText()).trim()).toContain('Full stroke erase');
  await blurInputs(page);
  await page.keyboard.press('Shift+E');
  await expect.poll(async () => (
    (await page.getByRole('button', { name: 'Eraser type', exact: true }).innerText()).trim()
  ), { message: 'Shift+E forces Partial erase' }).toContain('Partial erase');
  expect(await page.evaluate(() => localStorage.getItem('eraserMode'))).toBe('partial');

  // Break — zoom % INPUT does not steal E.
  await setEraserType(page, 'Full stroke erase');
  const zoom = page.getByRole('textbox', { name: 'Edit zoom percentage', exact: true });
  await expect(zoom).toBeVisible();
  await zoom.click();
  await page.keyboard.press('e');
  expect((await page.getByRole('button', { name: 'Eraser type', exact: true }).innerText()).trim()).toContain('Full stroke erase');
  await blurInputs(page);

  // Intended — caret flyout can set Partial erase.
  const caret = page.locator('[data-eraser-caret-button="true"]').first();
  await expect(caret).toBeVisible();
  await caret.click();
  const flyout = page.locator('[data-eraser-caret-popup="true"]');
  await expect(flyout).toBeVisible({ timeout: 5_000 });
  await flyout.getByText('Partial erase', { exact: true }).click();
  await expect(flyout).toHaveCount(0);
  expect((await page.getByRole('button', { name: 'Eraser type', exact: true }).innerText()).trim()).toContain('Partial erase');

  // Edge — undo restores the full-stroke delete; Pen-armed invents 0.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (
    (await userAnnotationSnapshot(page)).some((row) => row.id === rectA.id)
  ), { message: 'undo restores rect A' }).toBe(true);
  const beforePen = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();
  await activateTool(page, 'Draw', 'Pen');
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort()).toEqual(beforePen);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Eraser type', exact: true }).count(), 'hubPreview Eraser type must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  console.log('ERASER_TYPE_DESKTOP_PROOF', JSON.stringify({
    catalog,
    rectA: rectA.id,
    rectB: rectB.id,
    ink: ink.id,
    viewBox,
    fileId: await fileId(page),
  }));
});

test('390 Eraser mode intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await page.keyboard.press('Escape');
  await closePagesOverlay(page);
  await ensurePageDrawTarget(page);

  const rect = await createRect(page, { x0: 0.22, y0: 0.24, x1: 0.52, y1: 0.40 });
  await activateTool(page, 'Draw', 'Eraser');
  const mode = mobileEraserMode(page);
  await expect(mode, '390 Eraser mode trigger').toBeVisible({ timeout: 8_000 });
  await expect(mode).toHaveAttribute('aria-label', /Eraser mode: Partial Erase/);

  await eraseThroughRegion(page, { x0: 0.28, y0: 0.32, x1: 0.46, y1: 0.32 });
  await expect.poll(async () => (
    (await userAnnotationSnapshot(page)).some((row) => row.id === rect.id)
  ), { message: '390 partial must skip a rect' }).toBe(true);

  await mode.click();
  const list = page.getByRole('listbox', { name: 'Eraser mode' });
  await expect(list).toBeVisible({ timeout: 5_000 });
  const labels = await list.getByRole('option').evaluateAll((nodes) => (
    nodes.map((node) => (node.textContent || '').trim())
  ));
  expect(labels).toEqual(['Partial Erase', 'Full Stroke']);
  await list.getByRole('option', { name: 'Full Stroke', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(mode).toHaveAttribute('aria-label', /Eraser mode: Full Stroke/);
  expect(await page.evaluate(() => localStorage.getItem('eraserMode'))).toBe('entire');

  await eraseAcrossId(page, rect.id);
  await expect.poll(async () => (
    (await userAnnotationSnapshot(page)).some((row) => row.id === rect.id)
  ), { message: '390 full stroke must delete the rect' }).toBe(false);

  await activateTool(page, 'Draw', 'Pen');
  await expect(mobileEraserMode(page), '390 Pen hides Eraser mode').toHaveCount(0);

  const viewBox = await pageViewBox(page);
  expect(viewBox).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('ERASER_TYPE_390_PROOF', JSON.stringify({
    labels,
    rect: rect.id,
    viewBox,
    fileId: await fileId(page),
  }));
});
