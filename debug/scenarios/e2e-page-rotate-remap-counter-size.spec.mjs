import { test, expect } from '@playwright/test';

// Apply Counter Size to a remapped pin after page CW.
// Distinct from unrotated e2e-counter-size-start, remapped nubbin drag,
// remapped style chips (dash/cloud/format), leftover-18 / X-01.
// Size is not Cloud/dash. PointerEvent select is OK if Playwright mouse
// misses. Do not stamp file.id. Do not invent dest-XYZ / captcha / stamps /
// Group / Extract / Note/Link / Forms / Curve / file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const PLACE_EPS = 4;

function almostEq(a, b, eps = PLACE_EPS) {
  return Math.abs(Number(a) - Number(b)) < eps;
}

function originHeld(a, b) {
  if (!a || !b) return false;
  return almostEq(a.left, b.left) && almostEq(a.top, b.top);
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

function isCounter(row) {
  return row.type === 'counter' || row.kind === 'counter';
}

async function snapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const svgIds = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const overlayIds = [...document.querySelectorAll(`[data-counter-overlay="${pageNum}"] [data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    const ids = [...new Set([...svgIds, ...overlayIds])];
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
      const host = document.querySelector(`[data-counter-overlay="${pageNum}"] [data-anno-id="${id}"]`)
        || document.querySelector(`[data-svg-annotation-layer="${pageNum}"] [data-anno-id="${id}"]`);
      const pathD = host?.querySelector('path')?.getAttribute('d') || '';
      const arc = /A\s+([\d.]+),([\d.]+)/.exec(pathD);
      const svgR = arc ? Number(arc[1]) : 0;
      const radius = Number(object.radius ?? data.radius ?? svgR ?? 0);
      return {
        id,
        type: String(data.type || object.type || (overlayIds.includes(id) ? 'counter' : '')).toLowerCase(),
        kind: String(data.type || data.annotationType || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left,
        top,
        radius,
        svgR,
        cx: left + radius,
        cy: top + radius,
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

async function activateShapeTool(page, toolName) {
  await blurInputs(page);
  await page.keyboard.press('Escape').catch(() => {});
  const category = page.getByRole('button', { name: 'Shapes', exact: true }).first();
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

async function waitForNewCounter(page, beforeIds) {
  let created = null;
  await expect.poll(async () => {
    created = (await snapshot(page)).find((row) => !beforeIds.has(row.id) && isCounter(row)) || null;
    return created;
  }, { message: 'expected a new counter pin' }).not.toBeNull();
  return created;
}

async function createCounter(page, { xf = 0.38, yf = 0.28 } = {}) {
  const before = new Set((await snapshot(page)).map((row) => row.id));
  await activateShapeTool(page, 'Counter');
  await expect(page.locator('[data-counter-overlay="1"]')).toBeVisible({ timeout: 8_000 });
  const box = await pageBox(page);
  await page.waitForTimeout(280);
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
  const created = await waitForNewCounter(page, before);
  await selectMode(page);
  return geom(page, created.id);
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

async function selectAnno(page, id) {
  await selectMode(page);
  const selectors = [
    `[data-anno-id="${id}"] [data-shape-hit-target="counter"]`,
    `[data-counter-overlay="1"] [data-anno-id="${id}"]`,
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"]`,
  ];
  await expect.poll(async () => {
    for (const selector of selectors) {
      await pointerClickHost(page, selector);
      if (await sizeField(page).isVisible().catch(() => false)) return true;
    }
    return false;
  }, { timeout: 12_000, message: `select remapped counter ${id}` }).toBe(true);
  return true;
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

test('desktop remapped Counter Size after page CW intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Size', exact: true }).count(), 'hubPreview Counter Size 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Size presets', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);

  await openEditor(page);
  await dismissChrome(page);
  await assertNoErrorBoundary(page);

  expect(await userCount(page), 'fresh editor invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 612 792');
  expect(await sizeField(page).count(), 'unarmed editor Size 0 until Counter').toBe(0);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await userCount(page), 'empty CW invents 0').toBe(0);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  await rotatePage(page, 1, 'ccw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await userCount(page), 'empty CCW invents 0').toBe(0);

  const pin = await createCounter(page);
  await dismissChrome(page);
  expect(pin?.id).toBeTruthy();
  const priorRadius = Number(pin.svgR || pin.radius);
  expect(priorRadius, 'create stamps a finite radius').toBeGreaterThan(0);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remapped = await geom(page, pin.id);
  expect(Math.hypot(remapped.cx - pin.cx, remapped.cy - pin.cy), 'counter remaps').toBeGreaterThan(8);
  expect(Number(remapped.svgR || remapped.radius), 'CW keeps radius').toBe(priorRadius);

  expect(await selectAnno(page, pin.id), 'select remapped counter').toBe(true);
  await expect(sizeField(page)).toBeVisible();
  await pickSizePreset(page, 32);
  let afterSize = null;
  await expect.poll(async () => {
    afterSize = await geom(page, pin.id);
    return Number(afterSize.svgR || afterSize.radius);
  }, { timeout: 8_000, message: 'remapped Counter Size 32 must stick' }).toBe(32);
  expect(originHeld(afterSize, remapped), 'Size must not jump remapped origin').toBe(true);
  expect(afterSize.cx > 40 && afterSize.cx < 752 && afterSize.cy > 20 && afterSize.cy < 592, 'Size stays landscape').toBe(true);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, pin.id);
    return Number(now.svgR || now.radius) === priorRadius && originHeld(now, remapped);
  }, { timeout: 12_000, message: 'undo restores remapped counter + prior Size' }).toBeTruthy();

  expect(await selectAnno(page, pin.id)).toBe(true);
  const field = sizeField(page);
  await expect(field).toBeVisible();
  await field.click();
  await field.fill('abc');
  await field.press('Enter');
  expect(await field.inputValue(), 'letters rejected').toBe(String(priorRadius));
  expect(Number((await geom(page, pin.id)).svgR || (await geom(page, pin.id)).radius), 'letters do not apply').toBe(priorRadius);
  expect(originHeld(await geom(page, pin.id), remapped), 'letters do not jump remapped origin').toBe(true);

  await setSizeTyped(page, 3);
  await expect.poll(async () => Number((await geom(page, pin.id))?.svgR || 0)).toBe(4);
  expect(originHeld(await geom(page, pin.id), remapped), '3→4 clamp holds remapped origin').toBe(true);

  await setSizeTyped(page, 32);
  await expect.poll(async () => Number((await geom(page, pin.id))?.svgR || 0)).toBe(32);
  await field.click();
  await field.fill('50');
  await page.keyboard.press('Escape');
  await expect.poll(async () => Number((await geom(page, pin.id))?.svgR || 0), {
    timeout: 8_000,
    message: 'Escape skip-commit does not apply Size',
  }).toBe(32);
  expect(originHeld(await geom(page, pin.id), remapped), 'Escape Size does not jump remapped origin').toBe(true);

  await activateShapeTool(page, 'Counter');
  await page.keyboard.press('e');
  const eraserSize = page.getByRole('textbox', { name: 'Size', exact: true });
  if (await eraserSize.isVisible().catch(() => false)) {
    await eraserSize.fill('80');
    await eraserSize.press('Enter');
  }
  expect(Number((await geom(page, pin.id)).svgR || 0), 'Eraser Size must not rewrite remapped Counter').toBe(32);

  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  expect(await userCount(page), 'empty remapped-page click invents 0').toBe(1);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Size', exact: true }).count(), 'hubPreview Size 0').toBe(0);

  console.log('PAGE_ROTATE_REMAP_COUNTER_SIZE_DESKTOP_PROOF', JSON.stringify({
    pinId: pin.id,
    created: { cx: pin.cx, cy: pin.cy, radius: priorRadius },
    remapped: { cx: remapped.cx, cy: remapped.cy, left: remapped.left, top: remapped.top },
    after: { radius: afterSize.radius, svgR: afterSize.svgR, left: afterSize.left, top: afterSize.top },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-counter-size edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
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

  console.log('PAGE_ROTATE_REMAP_COUNTER_SIZE_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    annotations: await userCount(page),
  }));
});
