import { test, expect } from '@playwright/test';

// Unique leftover after Spaces region-row Click to rename:
// region-row Hide/Show canvas annotations (region-visibility-button).
// Distinct from overlay Hide/Show switch. Not leftover-18.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces / checklist items.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function spacesTab(page) {
  return page.getByRole('button', { name: 'Spaces', exact: true });
}

function editRegionBtn(page) {
  return page.getByRole('button', { name: 'Edit region areas on the page' });
}

function exitRegionBtn(page) {
  return page.getByRole('button', { name: 'Exit region edit' });
}

function regionUi(page) {
  return page.locator('[data-region-selection-ui="true"]');
}

function hideCanvasBtn(page) {
  return page.locator('.space-region-row').getByRole('button', { name: 'Hide canvas annotations' });
}

function showCanvasBtn(page) {
  return page.locator('.space-region-row').getByRole('button', { name: 'Show canvas annotations' });
}

function visibilityDisabled(page) {
  return page.locator('.space-region-row').getByRole('button', { name: 'Toggle is only available when a space is active' });
}

function overlayHide(page) {
  return page.locator('.space-region-row [data-region-overlay-toggle="true"][aria-label="Hide overlay for this region"]');
}

function spaceCard(page, spaceName) {
  return page.locator('[data-space-sortable-row-id]').filter({
    has: page.getByRole('textbox', { name: `Rename ${spaceName}` }),
  });
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible({ timeout: 15_000 });
}

async function createSpaceWithPages(page, pageSpec = '1') {
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  const name = page.getByRole('textbox', { name: /Rename Space/i }).first();
  await expect(name).toBeVisible({ timeout: 8_000 });
  const addInput = page.locator('.space-add-pages-input').last();
  await expect(addInput).toBeVisible({ timeout: 8_000 });
  await addInput.fill(pageSpec);
  await page.getByRole('button', { name: 'Add pages', exact: true }).last().click();
  await expect.poll(async () => page.locator('.space-region-row').count(), {
    timeout: 8_000,
    message: 'expected a space-region row after Add pages',
  }).toBeGreaterThan(0);
}

async function enterRegionEdit(page, card = null) {
  const btn = card ? card.getByRole('button', { name: 'Edit region areas on the page' }) : editRegionBtn(page).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  await btn.click();
  await expect(exitRegionBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(regionUi(page).first()).toBeVisible({ timeout: 8_000 });
}

async function dragAndConfirmRegion(page, { x0 = 0.22, y0 = 0.28, x1 = 0.48, y1 = 0.50 } = {}) {
  const layer = regionUi(page).last();
  await expect(layer).toBeVisible({ timeout: 8_000 });
  const box = await layer.boundingBox();
  expect(box, 'region-selection overlay geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  const confirm = regionUi(page).getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeVisible({ timeout: 8_000 });
  await confirm.click();
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
}

async function userIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter((id) => id && !/^\d+R$/i.test(id))
  ), pageNumber);
}

function annoGroup(page, id) {
  return page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${id}"]`);
}

async function drawRect(page, { x0, y0, x1, y1 }) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const rectBtn = page.getByRole('button', { name: 'Rectangle', exact: true });
  if (await rectBtn.count() === 0) {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  }
  await expect(rectBtn).toBeVisible({ timeout: 10_000 });
  await rectBtn.click();
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  expect(box, 'page 1 geometry').toBeTruthy();
  const before = new Set(await userIds(page));
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
  let created = null;
  await expect.poll(async () => {
    const ids = await userIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { timeout: 15_000 }).not.toBeNull();
  return created;
}

async function annoScope(page, id) {
  return page.evaluate((annoId) => {
    const registry = window.__renderedAnnotationRegistry?.[1] || [];
    const rendered = registry.find((entry) => (
      entry.id === annoId || entry.annotationId === annoId
    )) || null;
    const object = window.__phase35GetAnnotationById?.(rendered?.id || annoId)
      || window.__phase35GetAnnotationById?.(annoId)
      || null;
    return {
      stored: Boolean(object),
      rendered: Boolean(rendered),
      storeId: object?.id || rendered?.id || null,
      regionId: object?.regionId ?? rendered?.regionId ?? null,
      moduleId: object?.moduleId ?? rendered?.moduleId ?? null,
    };
  }, id);
}

async function storedAnno(page, storeId) {
  return page.evaluate((id) => {
    const object = window.__phase35GetAnnotationById?.(id) || null;
    return {
      stored: Boolean(object),
      regionId: object?.regionId ?? null,
      moduleId: object?.moduleId ?? null,
    };
  }, storeId);
}

test('U-02 region-row Hide/Show canvas annotations', async ({ page }) => {
  await openEditor(page);

  // Intended setup: canvas-scoped rect BEFORE a space is active so Hide
  // can target page-level canvas annotations (region-stamped marks skip
  // the light-bulb — asserted later).
  const canvasId = await drawRect(page, { x0: 0.58, y0: 0.58, x1: 0.80, y1: 0.74 });
  await expect(annoGroup(page, canvasId)).toBeVisible();
  const canvasScope = await annoScope(page, canvasId);
  expect(canvasScope.rendered || canvasScope.stored, 'canvas rect committed').toBe(true);
  expect(canvasScope.regionId, 'drawn before a space stays canvas-scoped').toBeNull();
  expect(canvasScope.moduleId).toBeNull();
  const canvasStoreId = canvasScope.storeId || canvasId;

  await openSpaces(page);

  // Break: no region row → no light-bulb.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await hideCanvasBtn(page).count(), 'no Hide button with zero spaces').toBe(0);
  expect(await showCanvasBtn(page).count(), 'no Show button with zero spaces').toBe(0);

  await createSpaceWithPages(page, '1');
  await expect(visibilityDisabled(page).first()).toBeVisible({ timeout: 8_000 });
  expect(await hideCanvasBtn(page).count(), 'disabled until the space is active').toBe(0);

  // Break: toggle with no annotations after activating via Edit (no draw).
  await enterRegionEdit(page);
  await page.keyboard.press('Escape');
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(hideCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await hideCanvasBtn(page).first().click();
  await expect(showCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toHaveCount(0, { timeout: 8_000 });
  const hiddenStore = await storedAnno(page, canvasStoreId);
  await showCanvasBtn(page).first().click();
  await expect(hideCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });

  // Setup: draw a region so overlay Hide/Show exists as a DISTINCT control.
  await enterRegionEdit(page);
  await dragAndConfirmRegion(page);
  await expect(overlayHide(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(hideCanvasBtn(page).first()).toBeVisible();
  await expect(annoGroup(page, canvasId)).toBeVisible();

  // Intended: Hide removes the canvas-scoped mark; Show restores it.
  await hideCanvasBtn(page).first().click();
  await expect(showCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toHaveCount(0, { timeout: 8_000 });
  await expect(overlayHide(page).first()).toBeVisible();
  await showCanvasBtn(page).first().click();
  await expect(hideCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });

  // Assert actual: a mark stamped with regionId is NOT hidden by the light-bulb.
  const regionId = await drawRect(page, { x0: 0.26, y0: 0.32, x1: 0.44, y1: 0.46 });
  const regionScope = await annoScope(page, regionId);
  expect(regionScope.rendered || regionScope.stored, 'region-stamped mark committed').toBe(true);
  expect(regionScope.regionId, 'drawn-after-overlay stamps regionId').toBeTruthy();
  await openSpaces(page);
  await hideCanvasBtn(page).first().click();
  await expect(showCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toHaveCount(0, { timeout: 8_000 });
  await expect(annoGroup(page, regionId)).toBeVisible({ timeout: 8_000 });
  await showCanvasBtn(page).first().click();
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, regionId)).toBeVisible({ timeout: 8_000 });

  // Break: Pen-armed still flips Hide/Show; Pen stays armed.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  await openSpaces(page);
  await hideCanvasBtn(page).first().click();
  await expect(showCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toHaveCount(0, { timeout: 8_000 });
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after Hide').toBe(true);
  await showCanvasBtn(page).first().click();
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });

  // Edge: undo / redo the visibility flip (region row + overlay stay).
  await hideCanvasBtn(page).first().click();
  await expect(annoGroup(page, canvasId)).toHaveCount(0, { timeout: 8_000 });
  await page.keyboard.press('Control+z');
  await expect(hideCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });
  await expect(overlayHide(page).first()).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(showCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toHaveCount(0, { timeout: 8_000 });
  await showCanvasBtn(page).first().click();
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });

  // Edge: two spaces on the same page — product is page-level per selected
  // space, not per-region. Space 2 keeps Hide; activating it shows canvas.
  await createSpaceWithPages(page, '1');
  await expect(spaceCard(page, 'Space 2').locator('.space-region-row')).toBeVisible();
  await enterRegionEdit(page, spaceCard(page, 'Space 2'));
  await dragAndConfirmRegion(page, { x0: 0.52, y0: 0.22, x1: 0.72, y1: 0.40 });
  await expect(spaceCard(page, 'Space 2').getByRole('button', { name: 'Hide canvas annotations' })).toBeVisible();
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Hide canvas annotations' })).toBeVisible();
  await expect(annoGroup(page, canvasId)).toBeVisible();
  await spaceCard(page, 'Space 1').getByRole('button', { name: 'Turn on space' }).click();
  await spaceCard(page, 'Space 1').getByRole('button', { name: 'Hide canvas annotations' }).click();
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Show canvas annotations' })).toBeVisible();
  await expect(spaceCard(page, 'Space 2').getByRole('button', { name: 'Hide canvas annotations' })).toBeVisible();
  await expect(annoGroup(page, canvasId)).toHaveCount(0, { timeout: 8_000 });
  await spaceCard(page, 'Space 2').getByRole('button', { name: 'Turn on space' }).click();
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Show canvas annotations' })).toBeVisible();

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — light-bulb if the page-row exists after Create + Add pages.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const create390 = page.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobilePageRows = 0;
  let mobileHide = 0;
  let mobileDisabled = 0;
  let mobileToggled = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().click();
    const add390 = page.locator('.space-add-pages-input');
    if (await add390.count()) {
      await add390.first().fill('1');
      const addPages = page.getByRole('button', { name: 'Add pages', exact: true });
      if (await addPages.count()) await addPages.first().click();
    }
    mobilePageRows = await page.locator('.space-region-row').count();
    mobileDisabled = await visibilityDisabled(page).count();
    mobileHide = await hideCanvasBtn(page).count();
    const edit390 = editRegionBtn(page);
    if (await edit390.count()) {
      await edit390.first().evaluate((el) => el.click());
      const mobileToolbar = page.getByRole('toolbar', { name: 'Region editing' });
      if (await mobileToolbar.count()) {
        await mobileToolbar.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => el.click());
      }
      mobileHide = await hideCanvasBtn(page).count();
      if (mobileHide > 0) {
        await hideCanvasBtn(page).first().evaluate((el) => el.click());
        mobileToggled = (await showCanvasBtn(page).count()) > 0;
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_REGION_VISIBILITY_PROOF', JSON.stringify({
    persist,
    canvasScopedHide: true,
    hiddenKeptInStore: hiddenStore.stored,
    regionScopedStays: Boolean(regionScope.regionId),
    noSpacesZero: true,
    noRegionDisabledThenToggle: true,
    penArmed: true,
    undoRewound: true,
    twoSpaceIsolation: true,
    mobileCreate,
    mobilePageRows,
    mobileDisabled,
    mobileHide,
    mobileToggled,
  }));
});
