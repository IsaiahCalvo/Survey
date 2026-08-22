import { test, expect } from '@playwright/test';

// Unique leftover after Spaces space-card reorder:
// region-row Hide/Show survey annotations
// (aria-label="Hide survey annotations" / onToggleSurveyAnnotations).
// Sibling of already-proven canvas Hide/Show — do not replay that.
// Survey-context only. Not leftover-18.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces / checklist items.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const KAL436 = /KAL-436 Preservation Template/;

async function openEditor(page, { width = 1440, height = 900, url = SURVEY_PDF } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/ERR_ABORTED|interrupted|destroyed/i.test(message) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(400);
    }
  }
  if (lastError) throw lastError;
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

function hideSurveyBtn(page) {
  return page.locator('.space-region-row').getByRole('button', { name: 'Hide survey annotations' });
}

function showSurveyBtn(page) {
  return page.locator('.space-region-row').getByRole('button', { name: 'Show survey annotations' });
}

function hideCanvasBtn(page) {
  return page.locator('.space-region-row').getByRole('button', { name: 'Hide canvas annotations' });
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

async function clickVisibility(button) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await button.click({ delay: 20 });
  await button.page().waitForTimeout(350);
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
  const btn = card
    ? card.getByRole('button', { name: 'Edit region areas on the page' })
    : editRegionBtn(page).first();
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

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function armWalls(page) {
  const hostWalls = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (!(await hostWalls().count()) || !(await hostWalls().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: KAL436 }).click();
    }
  }
  const walls = (await hostWalls().count())
    ? hostWalls()
    : page.getByRole('button', { name: 'Walls', exact: true });
  await expect(walls.first()).toBeVisible({ timeout: 15_000 });
  if (!String(await walls.first().getAttribute('class') || '').includes('btn-active')) {
    await walls.first().click();
  }
}

async function dragOnLayer(page, { x0, y0, x1, y1 }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  return box;
}

async function finishMarkerName(page, name) {
  const field = page.getByPlaceholder('Enter name');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.fill(name);
  await field.press('Enter');
  await expect(field).toHaveCount(0, { timeout: 8_000 });
}

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

function markerGroup(page, id) {
  return page.locator(`[data-survey-marker-id="${id}"]`);
}

async function waitSurveyMarkerSeam(page) {
  await expect.poll(() => page.evaluate(() => typeof window.__e2eSurveyMarkers?.get), {
    timeout: 10_000,
    message: 'DEV survey-marker seam',
  }).toBe('function');
}

async function placeMarker(page, name, coords) {
  await waitSurveyMarkerSeam(page);
  const before = new Set(await markerIds(page));
  const beforeStore = await page.evaluate(() => Object.keys(window.__e2eSurveyMarkers?.get?.() || {}));
  await armWalls(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const store = await page.evaluate(() => window.__e2eSurveyMarkers?.get?.() || {});
    created = Object.keys(store).find((id) => !beforeStore.includes(id) && store[id]?.name === name)
      || Object.keys(store).find((id) => !beforeStore.includes(id))
      || null;
    if (!created) {
      const ids = await markerIds(page);
      created = ids.find((id) => !before.has(id) && store[id]) || null;
    }
    return created;
  }, { timeout: 15_000, message: `expected stored survey-marker ${name}` }).not.toBeNull();
  return created;
}

async function storedMarker(page, id) {
  await waitSurveyMarkerSeam(page);
  return page.evaluate((markerId) => {
    const all = window.__e2eSurveyMarkers?.get?.() || {};
    const marker = all[markerId] || null;
    return {
      stored: Boolean(marker),
      moduleId: marker?.moduleId ?? null,
      regionId: marker?.regionId ?? null,
      name: marker?.name ?? null,
      keys: Object.keys(all),
    };
  }, id);
}

test('U-02 region-row Hide/Show survey annotations', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);

  // Canvas-scoped rect BEFORE survey — isolation target. Survey hide must
  // not drop it. Survey mode itself hides canvas marks while the panel is
  // open; we re-check after Close Survey panel.
  const canvasId = await drawRect(page, { x0: 0.58, y0: 0.58, x1: 0.80, y1: 0.74 });
  await expect(annoGroup(page, canvasId)).toBeVisible();
  const canvasStore = await storedAnno(page, canvasId);
  expect(canvasStore.stored, 'canvas rect committed').toBe(true);
  expect(canvasStore.regionId, 'drawn before a space stays canvas-scoped').toBeNull();
  expect(canvasStore.moduleId).toBeNull();

  await openSpaces(page);

  // Break: button absent outside survey context (no spaces / no survey).
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await hideSurveyBtn(page).count(), 'no Hide survey with zero spaces').toBe(0);
  expect(await showSurveyBtn(page).count(), 'no Show survey with zero spaces').toBe(0);

  await createSpaceWithPages(page, '1');
  await expect(visibilityDisabled(page).first()).toBeVisible({ timeout: 8_000 });
  expect(await hideSurveyBtn(page).count(), 'survey Hide still absent outside survey').toBe(0);
  expect(await hideCanvasBtn(page).count(), 'outside survey the light-bulb is canvas').toBe(0);

  await enterRegionEdit(page);
  await page.keyboard.press('Escape');
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(hideCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  expect(await hideSurveyBtn(page).count(), 'active space still canvas-mode until Survey').toBe(0);

  // Place in the proven survey-first path (before Spaces steals the
  // name-prompt commit). Then create the space so Hide survey exists.
  await enterSurveyWalls(page);
  const keep = page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
  if (await keep.count() && !(await keep.isChecked())) await keep.click();
  const surveyId = await placeMarker(page, 'survey-vis-a', { x0: 0.18, y0: 0.20, x1: 0.38, y1: 0.36 });
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });
  const surveyStoreBefore = await storedMarker(page, surveyId);
  expect(surveyStoreBefore.stored, 'survey marker committed').toBe(true);
  expect(surveyStoreBefore.moduleId, 'survey-scoped has moduleId').toBeTruthy();
  expect(surveyStoreBefore.regionId, 'placed before overlay stays survey-scoped').toBeNull();

  await openSpaces(page);
  await expect(hideSurveyBtn(page).first()).toBeVisible({ timeout: 8_000 });
  expect(await hideCanvasBtn(page).count(), 'survey context swaps the light-bulb').toBe(0);

  await clickVisibility(hideSurveyBtn(page).first());
  await expect(showSurveyBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(markerGroup(page, surveyId)).toHaveCount(0, { timeout: 8_000 });
  const hiddenSurvey = await storedMarker(page, surveyId);
  expect(hiddenSurvey.stored, 'hide keeps the survey marker in store').toBe(true);
  const hiddenCanvas = await storedAnno(page, canvasId);
  expect(hiddenCanvas.stored, 'survey hide does not drop the canvas rect').toBe(true);

  await clickVisibility(showSurveyBtn(page).first());
  await expect(hideSurveyBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });

  // Setup: draw a region so overlay exists as a DISTINCT control, then place
  // a second marker that stamps regionId (survey-region scope).
  await enterRegionEdit(page);
  await dragAndConfirmRegion(page);
  await expect(overlayHide(page).first()).toBeVisible({ timeout: 8_000 });
  const regionSurveyId = await placeMarker(page, 'survey-vis-region', {
    x0: 0.26, y0: 0.32, x1: 0.44, y1: 0.46,
  });
  const regionSurvey = await storedMarker(page, regionSurveyId);
  expect(regionSurvey.stored, 'region-stamped survey marker committed').toBe(true);
  expect(regionSurvey.regionId, 'placed-after-overlay stamps regionId').toBeTruthy();
  expect(regionSurvey.moduleId).toBeTruthy();

  await openSpaces(page);
  await clickVisibility(hideSurveyBtn(page).first());
  await expect(showSurveyBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(markerGroup(page, surveyId)).toHaveCount(0, { timeout: 8_000 });
  await expect(markerGroup(page, regionSurveyId)).toBeVisible({ timeout: 8_000 });
  await expect(overlayHide(page).first()).toBeVisible();
  await clickVisibility(showSurveyBtn(page).first());
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });
  await expect(markerGroup(page, regionSurveyId)).toBeVisible({ timeout: 8_000 });

  // Break: Pen-armed still flips Hide/Show; Pen stays armed.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  await openSpaces(page);
  await clickVisibility(hideSurveyBtn(page).first());
  await expect(showSurveyBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(markerGroup(page, surveyId)).toHaveCount(0, { timeout: 8_000 });
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after Hide').toBe(true);
  await clickVisibility(showSurveyBtn(page).first());
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });

  // Edge: undo / redo the visibility flip (region row + overlay stay).
  await clickVisibility(hideSurveyBtn(page).first());
  await expect(markerGroup(page, surveyId)).toHaveCount(0, { timeout: 8_000 });
  await page.keyboard.press('Control+z');
  await expect(hideSurveyBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });
  await expect(overlayHide(page).first()).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(showSurveyBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(markerGroup(page, surveyId)).toHaveCount(0, { timeout: 8_000 });
  await clickVisibility(showSurveyBtn(page).first());
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });

  // Edge: two spaces — page-level per selected space, not per-region.
  await createSpaceWithPages(page, '1');
  await expect(spaceCard(page, 'Space 2').locator('.space-region-row')).toBeVisible();
  // Break: Space 2 has no survey marks — Hide/Show still flips the page flag.
  await enterRegionEdit(page, spaceCard(page, 'Space 2'));
  await page.keyboard.press('Escape');
  await expect(spaceCard(page, 'Space 2').getByRole('button', { name: 'Hide survey annotations' })).toBeVisible({ timeout: 8_000 });
  await clickVisibility(spaceCard(page, 'Space 2').getByRole('button', { name: 'Hide survey annotations' }));
  await expect(spaceCard(page, 'Space 2').getByRole('button', { name: 'Show survey annotations' })).toBeVisible({ timeout: 8_000 });
  await clickVisibility(spaceCard(page, 'Space 2').getByRole('button', { name: 'Show survey annotations' }));
  await enterRegionEdit(page, spaceCard(page, 'Space 2'));
  await dragAndConfirmRegion(page, { x0: 0.52, y0: 0.22, x1: 0.72, y1: 0.40 });
  await expect(spaceCard(page, 'Space 2').getByRole('button', { name: 'Hide survey annotations' })).toBeVisible();
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Toggle is only available when a space is active' })).toBeVisible();
  await expect(markerGroup(page, surveyId)).toBeVisible();
  await spaceCard(page, 'Space 1').getByLabel('Turn on space').click();
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Hide survey annotations' })).toBeVisible({ timeout: 8_000 });
  await clickVisibility(spaceCard(page, 'Space 1').getByRole('button', { name: 'Hide survey annotations' }));
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Show survey annotations' })).toBeVisible();
  await expect(markerGroup(page, surveyId)).toHaveCount(0, { timeout: 8_000 });
  await spaceCard(page, 'Space 2').getByLabel('Turn on space').click();
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });
  await expect(spaceCard(page, 'Space 2').getByRole('button', { name: 'Hide survey annotations' })).toBeVisible();
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Toggle is only available when a space is active' })).toBeVisible();
  await spaceCard(page, 'Space 1').getByLabel('Turn on space').click();
  await expect(spaceCard(page, 'Space 1').getByRole('button', { name: 'Show survey annotations' })).toBeVisible({ timeout: 8_000 });
  await clickVisibility(spaceCard(page, 'Space 1').getByRole('button', { name: 'Show survey annotations' }));
  await expect(markerGroup(page, surveyId)).toBeVisible({ timeout: 8_000 });

  // Isolation after leaving survey: canvas-scoped rect returns; survey button gone.
  const closeSurvey = page.getByRole('button', { name: 'Close Survey panel' });
  if (await closeSurvey.count()) {
    await closeSurvey.first().click();
  }
  await openSpaces(page);
  expect(await hideSurveyBtn(page).count(), 'Hide survey gone outside survey').toBe(0);
  await expect(hideCanvasBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(annoGroup(page, canvasId)).toBeVisible({ timeout: 8_000 });
  const canvasAfter = await storedAnno(page, canvasId);
  expect(canvasAfter.stored, 'canvas rect still stored after survey hide + exit').toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — survey icon if the page-row exists after Create + survey.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSurvey = page.getByRole('button', { name: 'Open survey' });
  if (await openSurvey.count()) {
    await openSurvey.first().click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: KAL436 }).click();
    }
    const walls390 = page.getByRole('button', { name: 'Walls', exact: true });
    if (await walls390.count()) await walls390.first().click();
  }
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
    mobileHide = await hideSurveyBtn(page).count();
    const edit390 = editRegionBtn(page);
    if (await edit390.count()) {
      await edit390.first().evaluate((el) => el.click());
      const mobileToolbar = page.getByRole('toolbar', { name: 'Region editing' });
      if (await mobileToolbar.count()) {
        await mobileToolbar.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => el.click());
      }
      mobileHide = await hideSurveyBtn(page).count();
      if (mobileHide > 0) {
        await hideSurveyBtn(page).first().evaluate((el) => el.click());
        mobileToggled = (await showSurveyBtn(page).count()) > 0;
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_SURVEY_ANNOTATION_VISIBILITY_PROOF', JSON.stringify({
    persist,
    surveyScopedHide: true,
    hiddenKeptInStore: hiddenSurvey.stored,
    regionScopedStays: Boolean(regionSurvey.regionId),
    canvasIsolation: hiddenCanvas.stored && canvasAfter.stored,
    noSpacesZero: true,
    absentOutsideSurvey: true,
    noMarksToggle: true,
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
