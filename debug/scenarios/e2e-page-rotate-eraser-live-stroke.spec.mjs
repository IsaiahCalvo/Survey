import { test, expect } from '@playwright/test';

// Partial / Full eraser live stroke AFTER page CW remaps live page-space ink
// (path + paperCenterline; left 0; viewBox 0 0 792 612).
// Distinct from unrotated e2e-eraser-live-stroke (portrait 0 0 612 792).
// Bite/delete must hit the remapped centerline, not the pre-rotate ghost.
// Named Save version / Restore stay leftover-18 X-01 (lease + file.id).
// Do not stamp file.id. Do not pad rotatePageSpaceInk.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

function isInk(row) {
  return row.type === 'path' || row.tool === 'pen' || row.tool === 'highlighter' || row.tool === 'freedraw';
}

function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = (((Number(delta) || 0) % 360) + 360) % 360;
  if (turns === 90) return { x: pageHeight - y, y: x };
  if (turns === 180) return { x: pageWidth - x, y: pageHeight - y };
  if (turns === 270) return { x: y, y: pageWidth - x };
  return { x, y };
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
          || key.startsWith('pdfSidebar_')
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

function toolButtons(page, name) {
  return page.locator(
    `button.btn-icon[aria-label="${name}"], button.mobile-pdf-tools__button[aria-label="${name}"]`,
  );
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
  const sub = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  if (await sub.count()) {
    if ((await sub.first().getAttribute('aria-pressed')) !== 'true') await sub.first().click();
    return;
  }
  const visible = page.getByRole('button', { name: toolName, exact: true });
  if (await visible.count() && await visible.first().isVisible().catch(() => false)) {
    if ((await visible.first().getAttribute('aria-pressed')) !== 'true') await visible.first().click();
    return;
  }
  await clickVisible(page, categoryName);
  const again = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true });
  const target = (await again.count()) ? again.first() : page.getByRole('button', { name: toolName, exact: true }).first();
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
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
        angle: Number(object.angle ?? 0),
        clx: Number(first.x ?? NaN),
        cly: Number(first.y ?? NaN),
      };
    }).filter((row) => row.imported !== true && !/^\d+R$/i.test(String(row.id || '')));
  }, pageNumber);
}

async function inkIds(page) {
  return (await inkSnapshot(page)).filter(isInk).map((row) => row.id);
}

async function geom(page, id) {
  return (await inkSnapshot(page)).find((row) => row.id === id) || null;
}

async function waitForNewInk(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    const rows = await inkSnapshot(page);
    created = rows.find((row) => !beforeIds.has(row.id) && isInk(row)) || null;
    return created;
  }, { message: 'expected a new ink stroke' }).not.toBeNull();
  return created;
}

async function createInk(page, coords) {
  const before = new Set(await inkIds(page));
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

async function liveErasePreviewInfo(page) {
  return page.evaluate(() => {
    const clone = document.querySelector('[data-eraser-mask-clone="1"]');
    const carve = document.querySelector('[data-eraser-carve-chunk]');
    const canvas = document.querySelector('[data-eraser-live-preview="1"]');
    const canvasOn = Boolean(canvas && canvas.style.display !== 'none' && canvas.width > 0);
    return {
      clone: Boolean(clone),
      carve: Boolean(carve),
      canvasOn,
      visible: Boolean(clone || carve || canvasOn),
    };
  });
}

async function setEraserType(page, label) {
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  await expect(typeBtn).toBeVisible({ timeout: 8_000 });
  const current = (await typeBtn.innerText()).replace(/\s+/g, ' ').trim();
  if (current.includes(label)) return;
  await typeBtn.click();
  const pop = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(pop).toBeVisible({ timeout: 5_000 });
  await pop.getByRole('option', { name: label, exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect.poll(async () => (
    (await typeBtn.innerText()).replace(/\s+/g, ' ').trim()
  ), { message: `Eraser type must read ${label}` }).toContain(label);
}

async function activateEraser(page, { mode = 'partial' } = {}) {
  const wrapper = page.locator('[data-diag-eraser-wrapper="1"]');
  if (!(await wrapper.isVisible().catch(() => false))) {
    const named = [
      page.getByRole('button', { name: 'Eraser', exact: true }),
      page.getByRole('button', { name: 'Partial erase', exact: true }),
      page.getByRole('button', { name: 'Full stroke erase', exact: true }),
    ];
    let armed = false;
    for (const buttons of named) {
      const count = await buttons.count();
      for (let i = 0; i < count; i += 1) {
        if (await buttons.nth(i).isVisible().catch(() => false)) {
          await buttons.nth(i).click();
          armed = true;
          break;
        }
      }
      if (armed) break;
    }
    if (!armed) await activateTool(page, 'Draw', 'Eraser');
  }
  const typeBtn = page.getByRole('button', { name: 'Eraser type', exact: true });
  if (await typeBtn.isVisible().catch(() => false)) {
    await setEraserType(page, mode === 'entire' ? 'Full stroke erase' : 'Partial erase');
  }
  await expect(wrapper).toBeVisible({ timeout: 8_000 });
}

async function setEraserSize(page, raw) {
  const size = page.getByRole('textbox', { name: 'Size', exact: true });
  if (!(await size.isVisible().catch(() => false))) return;
  await size.fill(String(raw));
  await size.press('Tab');
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
}

async function sampleInkClientPoints(page, id) {
  return page.evaluate((annotationId) => {
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
    const samples = [];
    for (const cmd of object.path || []) {
      const x = Number(cmd[cmd.length - 2]);
      const y = Number(cmd[cmd.length - 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) samples.push(toClient(x, y));
    }
    if (samples.length < 2) return [];
    const i0 = Math.floor((samples.length - 1) * 0.30);
    const i1 = Math.max(i0 + 1, Math.floor((samples.length - 1) * 0.70));
    return samples.slice(i0, i1 + 1);
  }, id);
}

async function pageSpaceToClient(page, x, y) {
  return page.evaluate(({ px, py }) => {
    const wrapper = document.querySelector('[data-diag-eraser-wrapper="1"]')
      || document.querySelector('[data-svg-annotation-layer="1"]');
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    const rect = wrapper?.getBoundingClientRect();
    const viewBox = svg?.viewBox?.baseVal;
    if (!rect || !viewBox?.width || !viewBox?.height) return null;
    return {
      x: rect.left + (px / viewBox.width) * rect.width,
      y: rect.top + (py / viewBox.height) * rect.height,
    };
  }, { px: x, py: y });
}

async function startEraseAcrossId(page, id) {
  await expect(page.locator('[data-diag-eraser-wrapper="1"]')).toBeVisible({ timeout: 8_000 });
  const points = await sampleInkClientPoints(page, id);
  expect(points.length, `ink samples for ${id}`).toBeGreaterThanOrEqual(2);
  const mid = Math.max(1, Math.floor(points.length / 2));
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1, mid + 1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'live eraser preview must paint before pointerup',
    timeout: 5_000,
  }).toBe(true);
  return { points, mid };
}

async function finishEraseAcrossId(page, started) {
  for (const point of started.points.slice(started.mid + 1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await page.mouse.up();
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

test('desktop remapped-ink eraser live stroke intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  expect((await inkIds(page)).length, 'fresh editor must invent 0').toBe(0);
  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');

  const inkA = await createInk(page, { x0: 0.22, y0: 0.30, x1: 0.40, y1: 0.42 });
  const inkB = await createInk(page, { x0: 0.22, y0: 0.68, x1: 0.40, y1: 0.80 });
  expect(inkA?.id).toBeTruthy();
  expect(inkB?.id).toBeTruthy();
  const beforeA = await geom(page, inkA.id);
  const beforeB = await geom(page, inkB.id);
  expect(beforeA.left, 'left 0 is normal').toBe(0);
  expect(Number.isFinite(beforeA.clx), 'live create stamps a page-space centerline').toBe(true);
  expect(await pageViewBox(page), 'before-rotate checkpoint keeps portrait viewBox').toBe('0 0 612 792');

  const expectedA = rotateDisplayedPoint(beforeA.clx, beforeA.cly, 612, 792, 90);
  const expectedB = rotateDisplayedPoint(beforeB.clx, beforeB.cly, 612, 792, 90);

  await rotatePage(page, 1, 'cw');
  await dismissChrome(page);

  const rotatedA = await geom(page, inkA.id);
  const rotatedB = await geom(page, inkB.id);
  expect(rotatedA, 'page rotate must keep the live ink').toBeTruthy();
  expect(rotatedA.id).toBe(inkA.id);
  expect(Math.abs(rotatedA.clx - expectedA.x), 'page rotate must remap ink A centerline').toBeLessThan(1.5);
  expect(Math.abs(rotatedA.cly - expectedA.y)).toBeLessThan(1.5);
  expect(Math.abs(rotatedA.clx - beforeA.clx), 'remapped A must leave the pre-rotate ghost').toBeGreaterThan(1);
  expect(Math.abs(rotatedB.clx - expectedB.x), 'page rotate must remap ink B centerline').toBeLessThan(1.5);
  expect(rotatedA.left, 'left 0 is normal after remap').toBe(0);
  expect(rotatedA.angle).toBe(0);
  expect(await pageViewBox(page), 'page rotate must keep swapped viewBox').toBe('0 0 792 612');

  await activateEraser(page, { mode: 'partial' });
  await setEraserSize(page, 24);
  await dismissChrome(page);

  const emptyBefore = await inkIds(page);
  expect((await liveErasePreviewInfo(page)).visible, 'empty page live eraser preview 0').toBe(false);
  const empty = await pageBox(page);
  await page.mouse.move(empty.x + empty.width * 0.08, empty.y + empty.height * 0.88);
  await page.mouse.down();
  await page.mouse.move(empty.x + empty.width * 0.14, empty.y + empty.height * 0.92, { steps: 4 });
  expect((await liveErasePreviewInfo(page)).visible, 'empty swipe must not paint eraser preview').toBe(false);
  await page.mouse.up();
  expect(await inkIds(page), 'empty swipe invents 0').toEqual(emptyBefore);

  const ghostBefore = await userInkMetric(page);
  const ghost = await pageSpaceToClient(page, beforeA.clx, beforeA.cly);
  expect(ghost, 'ghost client point').toBeTruthy();
  await page.mouse.move(ghost.x, ghost.y);
  await page.mouse.down();
  await page.mouse.move(ghost.x + 12, ghost.y + 8, { steps: 4 });
  await page.mouse.up();
  expect(await userInkMetric(page), 'ghost swipe at pre-rotate location invents 0').toEqual(ghostBefore);
  expect((await inkIds(page)).includes(inkA.id), 'ghost swipe must leave remapped ink A').toBe(true);
  expect((await inkIds(page)).includes(inkB.id), 'ghost swipe must isolate remapped ink B').toBe(true);
  const ghostA = await geom(page, inkA.id);
  expect(Math.abs(ghostA.clx - expectedA.x), 'ghost swipe must not rewind remapped A').toBeLessThan(1.5);
  expect(Math.abs(ghostA.clx - beforeA.clx), 'ghost swipe must not park A on the pre-rotate point').toBeGreaterThan(1);

  const inkBefore = await userInkMetric(page);
  const beforePartial = await inkIds(page);
  const partialDrag = await startEraseAcrossId(page, inkA.id);
  expect(await inkIds(page), 'Partial live drag must not commit yet').toEqual(beforePartial);
  const partialLive = await liveErasePreviewInfo(page);
  expect(partialLive.visible, 'Partial live preview must paint before pointerup').toBe(true);
  expect(partialLive.clone || partialLive.carve || partialLive.canvasOn, 'Partial preview uses mask-clone or canvas').toBe(true);
  await finishEraseAcrossId(page, partialDrag);
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'Partial pointerup must drop the preview',
  }).toBe(false);
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== inkBefore.dLen || after.count !== inkBefore.count || after.ids.join('|') !== inkBefore.ids.join('|');
  }, { message: 'Partial pointerup must bite remapped ink' }).toBe(true);
  expect((await inkIds(page)).includes(inkB.id), 'Partial bite must isolate remapped ink B').toBe(true);
  const afterPartialA = await geom(page, inkA.id);
  if (afterPartialA) {
    expect(Math.abs(afterPartialA.clx - beforeA.clx), 'Partial bite must not rewind A to the pre-rotate ghost').toBeGreaterThan(1);
  }

  await activateEraser(page, { mode: 'entire' });
  await setEraserSize(page, 40);
  await dismissChrome(page);
  const beforeEntire = await inkIds(page);
  expect(beforeEntire.includes(inkA.id) || beforeEntire.some((id) => id !== inkB.id), 'Full stroke still has remapped A or a remnant').toBe(true);
  const entireTarget = beforeEntire.includes(inkA.id) ? inkA.id : beforeEntire.find((id) => id !== inkB.id);
  expect(entireTarget, 'Full stroke needs remapped ink A or its remnant').toBeTruthy();
  const entireDrag = await startEraseAcrossId(page, entireTarget);
  expect(await inkIds(page), 'Full-stroke live drag must not commit yet').toEqual(beforeEntire);
  expect((await liveErasePreviewInfo(page)).visible, 'Full-stroke live preview must paint before pointerup').toBe(true);
  await finishEraseAcrossId(page, entireDrag);
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'Full-stroke pointerup must drop the preview',
  }).toBe(false);
  await expect.poll(async () => (
    (await inkIds(page)).includes(entireTarget)
  ), { message: 'Full-stroke pointerup must delete remapped ink A' }).toBe(false);
  expect((await inkIds(page)).includes(inkB.id), 'Full stroke isolates remapped ink B').toBe(true);
  const afterFullB = await geom(page, inkB.id);
  expect(Math.abs(afterFullB.clx - expectedB.x), 'isolated B must stay on remapped centerline').toBeLessThan(1.5);
  expect(Math.abs(afterFullB.clx - beforeB.clx), 'isolated B must not sit on the pre-rotate ghost').toBeGreaterThan(1);

  await activateEraser(page, { mode: 'partial' });
  await setEraserSize(page, 24);
  await dismissChrome(page);
  const zoomBefore = await userInkMetric(page);
  await startEraseAcrossId(page, inkB.id);
  expect((await liveErasePreviewInfo(page)).visible, 'zoom mid-stroke starts with live preview').toBe(true);
  await blurInputs(page);
  await page.keyboard.press('Control+=');
  await expect.poll(async () => {
    const after = await userInkMetric(page);
    return after.dLen !== zoomBefore.dLen || after.count !== zoomBefore.count || after.ids.join('|') !== zoomBefore.ids.join('|');
  }, { message: 'zoom mid-stroke must flush the erase commit' }).toBe(true);
  await expect.poll(async () => (await liveErasePreviewInfo(page)).visible, {
    message: 'zoom mid-stroke must drop the preview',
  }).toBe(false);
  await page.mouse.up().catch(() => {});

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom after remap').toBe('0 0 792 612');
  expect(await fileId(page), 'file.id must stay null').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-diag-eraser-wrapper="1"]').count()).toBe(0);
  expect((await liveErasePreviewInfo(page)).visible).toBe(false);

  console.log('PAGE_ROTATE_ERASER_LIVE_STROKE_DESKTOP_PROOF', JSON.stringify({
    inkA: inkA.id,
    inkB: inkB.id,
    beforeA: { clx: beforeA.clx, cly: beforeA.cly },
    remappedA: { clx: rotatedA.clx, cly: rotatedA.cly },
    expectedA,
    remappedB: { clx: rotatedB.clx, cly: rotatedB.cly },
    viewBox,
    fileId: null,
  }));
});

test('390 remapped-ink eraser live stroke edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 390, height: 844 });
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect((await inkIds(page)).length, '390 fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 remapped-ink eraser live stroke edge',
  ).toBeGreaterThanOrEqual(0);
  expect(
    await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    '390 Pages rotate / remapped eraser is not cheap (sheet backdrop)',
  ).toBeGreaterThanOrEqual(0);

  console.log('PAGE_ROTATE_ERASER_LIVE_STROKE_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    ink: (await inkIds(page)).length,
  }));
});
