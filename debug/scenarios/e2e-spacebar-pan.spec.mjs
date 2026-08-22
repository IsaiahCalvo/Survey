import { test, expect } from '@playwright/test';

// V-01 leftover: Spacebar temporary pan (hold Space overrides the armed
// tool without switching the toolbar; release restores). Prior V-01 was
// named-Pan overflow + narrow sample only (e2e-unblocked-followup).
// Distinct from leftover-18, UL-06 Zoom %, V-04 keyboard / Fit width,
// W4-02 pinch, toolbar Pan sample, color / Match Fill / page-field /
// rotation / textbox-create catalogs.
// Do not stamp file.id.

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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

async function dismissChrome(page) {
  await blurInputs(page);
  const search = page.getByPlaceholder('Search text in PDF...');
  if (await search.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Search text', exact: true }).click().catch(() => {});
    await blurInputs(page);
  }
  const pagesToggle = page.getByRole('button', { name: /Open pages, search, and bookmarks/i });
  if (await pagesToggle.isVisible().catch(() => false)) {
    const expanded = await page.getByText('No documents yet').isVisible().catch(() => false);
    if (expanded) {
      await pagesToggle.click();
      await expect(page.getByText('No documents yet')).toHaveCount(0);
    }
  }
  await blurInputs(page);
}

async function pageViewBox(page) {
  const layer = page.locator('[data-svg-annotation-layer]').first();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  return (await layer.getAttribute('viewBox')) || '';
}

async function fileId(page) {
  return page.evaluate(() => window.__devTestPdf?.id ?? null);
}

async function viewerState(page) {
  return page.locator('.survey-pdfjs-viewer').first().evaluate((el) => ({
    left: el.scrollLeft,
    top: el.scrollTop,
    overflowX: el.scrollWidth - el.clientWidth,
    overflowY: el.scrollHeight - el.clientHeight,
    spacePan: el.dataset.spacePan || 'off',
    htmlPan: document.documentElement.dataset.surveyPdfjsPanActive === 'true',
  }));
}

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      const data = object.data || {};
      return {
        id,
        type: String(object.type || data.type || '').toLowerCase(),
        tool: String(data.tool || object.tool || data.type || '').toLowerCase(),
        imported: object.isPdfImported === true,
        left: Number(object.left ?? data.left ?? 0),
        top: Number(object.top ?? data.top ?? 0),
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

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    return button;
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click();
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

async function panButtonActive(page) {
  const buttons = page.getByRole('button', { name: 'Pan', exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const cls = String(await button.getAttribute('class') || '');
    return cls.includes('btn-active') || cls.includes('is-active');
  }
  return false;
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

async function createRect(page, coords = { x0: 0.22, y0: 0.28, x1: 0.42, y1: 0.46 }) {
  const before = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, coords);
  return waitForNewUserAnnotation(page, before, (row) => (
    row.type === 'rect' || row.type === 'rectangle' || row.tool === 'rect'
  ));
}

async function commitZoomPercent(page, value) {
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  if (!(await zoomBtn.isVisible().catch(() => false))) return false;
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  await zoomInput.press('Control+A');
  await zoomInput.press('Backspace');
  await zoomInput.pressSequentially(String(value), { delay: 20 });
  await expect(zoomInput).toHaveValue(String(value));
  await zoomInput.press('Enter');
  await blurInputs(page);
  return true;
}

async function zoomUntilOverflow(page) {
  const typed = await commitZoomPercent(page, 250);
  if (!typed) {
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Control+=');
      const state = await viewerState(page);
      if (state.overflowX > 8 || state.overflowY > 8) break;
    }
  }
  await expect.poll(async () => {
    const state = await viewerState(page);
    return state.overflowX > 8 || state.overflowY > 8;
  }, { timeout: 12_000, message: 'overflow zoom must leave scroll room' }).toBeTruthy();
}

async function holdSpace(page) {
  await blurInputs(page);
  await page.keyboard.down('Space');
}

async function releaseSpace(page) {
  await page.keyboard.up('Space');
}

test('desktop Spacebar pan intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page);
  const rectBefore = { left: rect.left, top: rect.top };
  const marksAtStart = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();

  await activateTool(page, 'Draw', 'Pen');
  expect(await panButtonActive(page), 'Pen must not activate toolbar Pan').toBe(false);
  expect((await viewerState(page)).spacePan, 'Pen idle space-pan').toBe('off');

  await zoomUntilOverflow(page);
  await dismissChrome(page);
  await activateTool(page, 'Draw', 'Pen');

  // Intended — hold Space arms grab without switching the toolbar tool.
  await holdSpace(page);
  await expect.poll(async () => (await viewerState(page)).spacePan, {
    message: 'Space must arm data-space-pan',
  }).toBe('armed');
  expect(await panButtonActive(page), 'Space must not switch toolbar Pan').toBe(false);
  expect((await viewerState(page)).htmlPan, 'html pan-active while Space held').toBe(true);

  // Intended — drag while Space pans the overflow scroller and invents 0 ink.
  const beforePan = await viewerState(page);
  await dragOnPage(page, { x0: 0.55, y0: 0.55, x1: 0.20, y1: 0.20 });
  const afterPan = await viewerState(page);
  expect(
    afterPan.left !== beforePan.left || afterPan.top !== beforePan.top,
    'Space+drag must move overflow scroll',
  ).toBeTruthy();
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort(), 'Space+drag invents 0').toEqual(marksAtStart);

  // Intended — release Space disarms and leaves Pen armed.
  await releaseSpace(page);
  await expect.poll(async () => (await viewerState(page)).spacePan, {
    message: 'keyup Space must set data-space-pan=off',
  }).toBe('off');
  expect(await panButtonActive(page), 'release must not leave toolbar Pan').toBe(false);
  expect((await viewerState(page)).htmlPan, 'html pan-active after release').toBe(false);

  const beforeInk = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await dragOnPage(page, { x0: 0.18, y0: 0.62, x1: 0.38, y1: 0.78 });
  const ink = await waitForNewUserAnnotation(page, beforeInk, (row) => (
    row.tool === 'pen' || row.type === 'path' || row.type === 'ink'
  ));
  expect(ink.id, 'Pen must still draw after Space release').toBeTruthy();

  // Break — Space in Search INPUT types a space and does not arm pan.
  await page.getByRole('button', { name: 'Search text', exact: true }).click();
  const search = page.getByPlaceholder('Search text in PDF...');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.click();
  await search.fill('ab');
  await search.press('Space');
  await expect(search, 'Search INPUT Space must type a space').toHaveValue('ab ');
  expect((await viewerState(page)).spacePan, 'Search INPUT Space must not arm pan').toBe('off');
  await page.getByRole('button', { name: 'Search text', exact: true }).click();
  await dismissChrome(page);

  // Break — Space in Zoom % INPUT does not arm pan (digits-only field).
  const zoomBtn = page.getByRole('button', { name: 'Edit zoom percentage', exact: true });
  await expect(zoomBtn).toBeVisible();
  await zoomBtn.click();
  const zoomInput = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await expect(zoomInput).toBeVisible();
  await zoomInput.click();
  const zoomBefore = await zoomInput.inputValue();
  await zoomInput.press('Space');
  expect((await viewerState(page)).spacePan, 'zoom INPUT Space must not arm pan').toBe('off');
  expect(await zoomInput.inputValue(), 'zoom INPUT Space must not rewrite %').toBe(zoomBefore);
  await zoomInput.press('Escape');
  await dismissChrome(page);

  // Break — click without drag while Space invents 0.
  const beforeClick = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();
  await holdSpace(page);
  await expect.poll(async () => (await viewerState(page)).spacePan).toBe('armed');
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.12);
  await releaseSpace(page);
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort(), 'Space click invents 0').toEqual(beforeClick);

  // Edge — existing rect geometry is isolated (scroll, not move).
  const afterRect = (await userAnnotationSnapshot(page)).find((row) => row.id === rect.id);
  expect(afterRect, 'rect still present').toBeTruthy();
  expect(afterRect.left, 'Space pan must not move rect left').toBe(rectBefore.left);
  expect(afterRect.top, 'Space pan must not move rect top').toBe(rectBefore.top);

  // Edge — toolbar Pan contrast: named Pan does switch the tool.
  await clickVisible(page, 'Pan');
  expect(await panButtonActive(page), 'toolbar Pan must be active').toBe(true);
  await expect.poll(async () => (await viewerState(page)).spacePan, {
    message: 'toolbar Pan arms data-space-pan via interactionMode',
  }).toBe('armed');
  const beforeToolbar = await viewerState(page);
  await dragOnPage(page, { x0: 0.60, y0: 0.30, x1: 0.30, y1: 0.55 });
  const afterToolbar = await viewerState(page);
  expect(
    afterToolbar.left !== beforeToolbar.left || afterToolbar.top !== beforeToolbar.top,
    'toolbar Pan drag must move overflow scroll',
  ).toBeTruthy();
  await page.keyboard.press('v');
  await expect.poll(async () => (await viewerState(page)).spacePan, {
    message: 'Select must drop toolbar-Pan space-pan',
  }).toBe('off');

  const viewBox = await pageViewBox(page);
  expect(viewBox, 'SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page), 'file.id must stay null on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('button', { name: 'Draw', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Pan', exact: true }).count()).toBe(0);
  expect(await page.locator('.survey-pdfjs-viewer').count()).toBe(0);

  console.log('SPACEBAR_PAN_DESKTOP_PROOF', JSON.stringify({
    rectId: rect.id,
    inkId: ink.id,
    afterPan: { left: afterPan.left, top: afterPan.top },
    viewBox,
    fileId: null,
  }));
});

test('390 Spacebar pan intended + break + edge', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);
  await dismissChrome(page);

  const rect = await createRect(page, { x0: 0.22, y0: 0.28, x1: 0.52, y1: 0.48 });
  const marksAtStart = (await userAnnotationSnapshot(page)).map((row) => row.id).sort();
  await activateTool(page, 'Draw', 'Pen');
  expect(await panButtonActive(page), '390 Pen must not activate Pan').toBe(false);

  await zoomUntilOverflow(page);
  await dismissChrome(page);
  await activateTool(page, 'Draw', 'Pen');

  await holdSpace(page);
  await expect.poll(async () => (await viewerState(page)).spacePan, {
    message: '390 Space must arm data-space-pan',
  }).toBe('armed');
  expect(await panButtonActive(page), '390 Space must not switch toolbar Pan').toBe(false);

  const beforePan = await viewerState(page);
  await dragOnPage(page, { x0: 0.70, y0: 0.55, x1: 0.25, y1: 0.25 });
  const afterPan = await viewerState(page);
  expect(
    afterPan.left !== beforePan.left || afterPan.top !== beforePan.top,
    '390 Space+drag must move overflow scroll',
  ).toBeTruthy();
  expect((await userAnnotationSnapshot(page)).map((row) => row.id).sort(), '390 Space+drag invents 0').toEqual(marksAtStart);

  await releaseSpace(page);
  await expect.poll(async () => (await viewerState(page)).spacePan, {
    message: '390 keyup Space must set data-space-pan=off',
  }).toBe('off');

  const beforeInk = new Set((await userAnnotationSnapshot(page)).map((row) => row.id));
  await dragOnPage(page, { x0: 0.20, y0: 0.60, x1: 0.45, y1: 0.78 });
  const ink = await waitForNewUserAnnotation(page, beforeInk, (row) => (
    row.tool === 'pen' || row.type === 'path' || row.type === 'ink'
  ));
  expect(ink.id, '390 Pen must still draw after Space release').toBeTruthy();

  const afterRect = (await userAnnotationSnapshot(page)).find((row) => row.id === rect.id);
  expect(afterRect.left, '390 Space pan must not move rect left').toBe(rect.left);
  expect(afterRect.top, '390 Space pan must not move rect top').toBe(rect.top);

  const viewBox = await pageViewBox(page);
  expect(viewBox, '390 SVG viewBox owns zoom').toBe('0 0 612 792');
  expect(await fileId(page)).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SPACEBAR_PAN_390_PROOF', JSON.stringify({
    rectId: rect.id,
    inkId: ink.id,
    afterPan: { left: afterPan.left, top: afterPan.top },
    viewBox,
    fileId: null,
  }));
});
