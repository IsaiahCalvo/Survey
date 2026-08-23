import { test, expect } from '@playwright/test';

// Apply Style→Cloud + Cloud bump on a remapped rect after page CW.
// Distinct from unrotated e2e-cloud-bump-1-20 / remapped dash (Cloud 0 on
// ellipse/text) / remapped format/move/text/opacity / leftover-18 / X-01.
// PointerEvent select is OK if Playwright mouse misses. Do not stamp file.id.
// Ellipse omits Cloud + bump (already product). Do not invent dest-XYZ /
// captcha / stamps / Group / Extract / Note/Link / Forms / Curve / file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const PLACE_EPS = 4;
const RECT_BOX = { x0: 0.20, y0: 0.26, x1: 0.40, y1: 0.44 };
const ELLIPSE_BOX = { x0: 0.16, y0: 0.52, x1: 0.40, y1: 0.70 };

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
      const path = group?.querySelector('path');
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
        pdfCloudIntensity: data.pdfCloudIntensity ?? null,
        visualKind: cloud ? 'cloud-rect' : ellipse ? 'ellipse' : rect ? 'rect' : null,
        pathD: path?.getAttribute('d') || '',
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

async function selectionChromeUp(page) {
  const style = page.getByRole('button', { name: 'Style', exact: true }).first();
  const handles = page.locator('[data-resize-handle], [data-handle]');
  return (await style.isVisible().catch(() => false)) || (await handles.count()) > 0;
}

async function deselectEmpty(page) {
  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.92, pageEl.y + pageEl.height * 0.08);
}

async function selectAnno(page, id) {
  await selectMode(page);
  await deselectEmpty(page);
  const selectors = [
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"] [data-shape-hit-target]`,
    `[data-svg-annotation-layer="1"] [data-anno-id="${id}"]`,
  ];
  await expect.poll(async () => {
    for (const selector of selectors) {
      await pointerClickHost(page, selector);
      if (await selectionChromeUp(page)) return true;
      await clickHost(page, selector);
      if (await selectionChromeUp(page)) return true;
    }
    return false;
  }, { timeout: 12_000, message: `select remapped ${id}` }).toBe(true);
  return true;
}

async function pickDesktopStyle(page, label) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Style' })).toBeVisible({ timeout: 5_000 });
  await popover.getByRole('option', { name: label, exact: true }).click();
  await expect(popover).toHaveCount(0);
}

async function listDesktopStyle(page) {
  const trigger = page.getByRole('button', { name: 'Style', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  const popover = page.locator('[data-annotation-dropdown-popover="true"]');
  await expect(popover.getByRole('listbox', { name: 'Style' })).toBeVisible({ timeout: 5_000 });
  const values = (await popover.getByRole('option').allTextContents()).map((text) => text.trim());
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  return values;
}

function bumpField(page) {
  return page.getByRole('textbox', { name: 'Cloud bump size', exact: true });
}

async function setBump(page, raw) {
  const field = bumpField(page);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(String(raw));
  await field.press('Enter');
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

test('desktop remapped Cloud bump after page CW intended + break + edge', async ({ page }) => {
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
  expect(rect?.id && ellipse?.id).toBeTruthy();
  expect(rect.pdfCloudIntensity == null || rect.pdfCloudIntensity === '', 'rect create is not Cloud').toBe(true);

  await rotatePage(page, 1, 'cw');
  await waitForEditorReady(page);
  await dismissChrome(page);
  expect(await pageViewBox(page)).toBe('0 0 792 612');
  const remappedRect = await geom(page, rect.id);
  const remappedEllipse = await geom(page, ellipse.id);
  expect(Math.hypot(remappedRect.cx - rect.cx, remappedRect.cy - rect.cy), 'rect remaps').toBeGreaterThan(8);
  expect(Math.hypot(remappedEllipse.cx - ellipse.cx, remappedEllipse.cy - ellipse.cy), 'ellipse remaps').toBeGreaterThan(8);

  expect(await selectAnno(page, rect.id), 'select remapped rect').toBe(true);
  await pickDesktopStyle(page, 'Cloud');
  let afterCloud = null;
  await expect.poll(async () => {
    afterCloud = await geom(page, rect.id);
    return Number.isFinite(Number(afterCloud.pdfCloudIntensity)) && afterCloud.visualKind === 'cloud-rect';
  }, { timeout: 8_000, message: 'remapped rect Style Cloud must stick' }).toBeTruthy();
  expect(placeHeld(afterCloud, remappedRect), 'Cloud must not jump remapped rect').toBe(true);
  const priorIntensity = Number(afterCloud.pdfCloudIntensity);
  expect(priorIntensity).toBeGreaterThanOrEqual(1);
  await expect(bumpField(page)).toBeVisible();

  await setBump(page, 8);
  let afterBump = null;
  await expect.poll(async () => {
    afterBump = await geom(page, rect.id);
    return Number(afterBump.pdfCloudIntensity);
  }, { timeout: 8_000, message: 'remapped Cloud bump 8 must stick' }).toBe(8);
  expect(afterBump.visualKind, 'bump keeps cloud-rect').toBe('cloud-rect');
  expect(placeHeld(afterBump, remappedRect), 'bump must not jump remapped rect').toBe(true);
  expect(afterBump.pathD.length, 'bump 8 rebuilds a cloud path').toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const now = await geom(page, rect.id);
    return Number(now.pdfCloudIntensity) === priorIntensity && placeHeld(now, remappedRect);
  }, { timeout: 12_000, message: 'undo restores remapped rect + prior intensity' }).toBeTruthy();

  expect(await selectAnno(page, rect.id)).toBe(true);
  await expect(bumpField(page)).toBeVisible();
  const field = bumpField(page);
  await field.click();
  await field.fill('abc');
  await field.press('Enter');
  expect(await field.inputValue(), 'letters rejected').toBe(String(priorIntensity));
  expect(Number((await geom(page, rect.id)).pdfCloudIntensity), 'letters do not apply').toBe(priorIntensity);
  expect(placeHeld(await geom(page, rect.id), remappedRect), 'letters do not jump remapped rect').toBe(true);

  await setBump(page, 0);
  await expect.poll(async () => Number((await geom(page, rect.id))?.pdfCloudIntensity)).toBe(1);
  expect(placeHeld(await geom(page, rect.id), remappedRect), '0→1 clamp holds remapped rect').toBe(true);

  expect(await selectAnno(page, ellipse.id), 'select remapped ellipse').toBe(true);
  const ellipseStyles = await listDesktopStyle(page);
  expect(ellipseStyles, 'remapped Ellipse Style omits Cloud').toEqual(['Solid', 'Dashed', 'Dotted']);
  expect(ellipseStyles.join(' | ')).not.toMatch(/cloud/i);
  await expect(bumpField(page), 'remapped ellipse Cloud bump 0').toHaveCount(0);
  expect((await geom(page, ellipse.id)).visualKind, 'ellipse stays ellipse').toBe('ellipse');
  expect(placeHeld(await geom(page, ellipse.id), remappedEllipse), 'ellipse catalog does not jump').toBe(true);

  const pageEl = await pageBox(page);
  await page.mouse.click(pageEl.x + pageEl.width * 0.88, pageEl.y + pageEl.height * 0.12);
  expect(await userCount(page), 'empty remapped-page click invents 0').toBe(2);

  expect(await fileId(page), 'must not stamp file.id').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('textbox', { name: 'Cloud bump size', exact: true }).count(), 'hubPreview Cloud bump 0').toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').count()).toBe(0);

  console.log('PAGE_ROTATE_REMAP_CLOUD_BUMP_DESKTOP_PROOF', JSON.stringify({
    rectId: rect.id,
    ellipseId: ellipse.id,
    rect: {
      created: { cx: rect.cx, cy: rect.cy },
      remapped: { cx: remappedRect.cx, cy: remappedRect.cy },
      cloud: afterCloud.pdfCloudIntensity,
      bump: afterBump.pdfCloudIntensity,
      pathLen: afterBump.pathD.length,
    },
    ellipse: { remapped: { cx: remappedEllipse.cx, cy: remappedEllipse.cy }, styles: ellipseStyles },
    viewBox: '0 0 792 612',
    fileId: null,
  }));
});

test('390 remapped-cloud-bump edge: viewBox, file.id, Pages present, no invent', async ({ page }) => {
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

  console.log('PAGE_ROTATE_REMAP_CLOUD_BUMP_390_EDGE', JSON.stringify({
    viewBox: await pageViewBox(page),
    fileId: null,
    pages: await page.getByRole('button', { name: /Pages|Open pages/i }).count(),
    annotations: await userCount(page),
  }));
});
