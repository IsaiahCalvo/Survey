import { test, expect } from '@playwright/test';

// Unique leftover after Excel actions fail-closed:
// survey-rail Choose survey template re-pick after already in a template.
// Distinct from first-entry KAL-436 pick. Not checklist Y/N/N-A.
// Not category Move/Copy stub. Not leftover-18 unplaced-rows.
// UL-31 Continue pin stays parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const KAL436 = /KAL-436 Preservation Template/;
const ENTITIES = /Survey Entities Template/;
const TWO_CAT = /Two Category Template/;
const EMPTY_TPL = /Empty Module Template/;

async function openEditor(page, { width = 1440, height = 900, url = SURVEY_PDF } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function chooseTemplateBtn(page) {
  return page.getByRole('button', { name: 'Choose survey template' });
}

function templateListbox(page) {
  return page.getByRole('listbox', { name: 'Choose survey template' });
}

function templateOption(page, name) {
  return templateListbox(page).getByRole('option', { name });
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

async function openTemplatePicker(page) {
  const btn = chooseTemplateBtn(page);
  await expect(btn).toBeVisible({ timeout: 8_000 });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') {
    await btn.click();
  }
  await expect(templateListbox(page)).toBeVisible({ timeout: 8_000 });
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
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0, { timeout: 8_000 });
}

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

async function waitSurveyMarkerSeam(page) {
  await expect.poll(() => page.evaluate(() => typeof window.__e2eSurveyMarkers?.get), {
    timeout: 10_000,
    message: 'DEV survey-marker seam',
  }).toBe('function');
}

async function storedMarker(page, id) {
  return page.evaluate((annoId) => window.__e2eSurveyMarkers?.get()?.[annoId] || null, id);
}

async function placeMarker(page, name, coords) {
  const before = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name}` }).not.toBeNull();
  return created;
}

async function expandWallsMarkers(page) {
  const notes = page.getByRole('button', { name: /item notes/ });
  if (await notes.count() && await notes.first().isVisible().catch(() => false)) return true;
  const toggle = rightRail(page).locator('.survey-marker-expand-toggle').first();
  if (await toggle.count() && await toggle.isVisible().catch(() => false)) {
    await toggle.click();
  } else {
    const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
    await expect(arrow).toBeVisible({ timeout: 10_000 });
    await arrow.click();
  }
  await expect(notes.first()).toBeVisible({ timeout: 8_000 });
  return true;
}

test('Choose survey template re-pick after already in a template', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  await waitSurveyMarkerSeam(page);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();

  const markerId = await placeMarker(page, 'repick-a', { x0: 0.22, y0: 0.32, x1: 0.44, y1: 0.50 });
  await expect.poll(async () => (await storedMarker(page, markerId))?.categoryId, {
    message: 'placed marker stores KAL-436 Walls category',
  }).toBe('kal436-category');
  const storedBefore = await storedMarker(page, markerId);
  expect(storedBefore?.moduleId).toBe('kal436-module');

  await expect(rightRail(page).getByRole('heading', { name: KAL436 })).toBeVisible();
  await expect(chooseTemplateBtn(page)).toBeVisible();

  // Intended: picker opens with compiled-in templates.
  await openTemplatePicker(page);
  await expect(templateOption(page, KAL436)).toHaveAttribute('aria-selected', 'true');
  await expect(templateOption(page, ENTITIES)).toBeVisible();
  await expect(templateOption(page, TWO_CAT)).toBeVisible();
  await expect(templateOption(page, EMPTY_TPL)).toBeVisible();
  await expect(templateListbox(page).getByText('No templates available')).toHaveCount(0);

  // Break: re-pick the same template is a no-op.
  await templateOption(page, KAL436).click();
  await expect(templateListbox(page)).toHaveCount(0);
  await expect(rightRail(page).getByRole('heading', { name: KAL436 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  expect(await markerIds(page)).toEqual([markerId]);
  const storedSame = await storedMarker(page, markerId);
  expect(storedSame?.categoryId).toBe('kal436-category');
  expect(storedSame?.moduleId).toBe('kal436-module');

  // Break: cancel via Escape — picker closes; template + marker stay.
  await openTemplatePicker(page);
  await page.keyboard.press('Escape');
  await expect(templateListbox(page)).toHaveCount(0);
  await expect(rightRail(page).getByRole('heading', { name: KAL436 })).toBeVisible();
  expect(await markerIds(page)).toEqual([markerId]);

  // Break: cancel via click-outside (body mousedown, not a chrome control).
  await openTemplatePicker(page);
  await page.evaluate(() => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await expect(templateListbox(page)).toHaveCount(0);
  await expect(rightRail(page).getByRole('heading', { name: KAL436 })).toBeVisible();
  expect(await markerIds(page)).toEqual([markerId]);

  // Intended: re-pick Two Category — rail updates; markers stay (not wipe / not migrate).
  await openTemplatePicker(page);
  await templateOption(page, TWO_CAT).click();
  await expect(templateListbox(page)).toHaveCount(0);
  await expect(rightRail(page).getByRole('heading', { name: TWO_CAT })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Two Category Survey' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Windows', exact: true })).toBeVisible();
  expect(await markerIds(page), 'overlay hides foreign-module markers (not wipe)').toEqual([]);
  const storedTwoCat = await storedMarker(page, markerId);
  expect(storedTwoCat, 'store keeps the marker across re-pick').toBeTruthy();
  expect(storedTwoCat?.categoryId, 'marker does not migrate category').toBe('kal436-category');
  expect(storedTwoCat?.moduleId, 'marker does not migrate module').toBe('kal436-module');

  // Intended: re-pick Survey Entities — same kal436 module so overlay + rail return.
  await openTemplatePicker(page);
  await templateOption(page, ENTITIES).click();
  await expect(rightRail(page).getByRole('heading', { name: ENTITIES })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Existing Survey Data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Windows', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await expect.poll(async () => markerIds(page), {
    message: 'same-module re-pick shows the stayed marker again',
  }).toEqual([markerId]);
  const storedEntities = await storedMarker(page, markerId);
  expect(storedEntities?.categoryId).toBe('kal436-category');
  expect(storedEntities?.moduleId).toBe('kal436-module');
  await expandWallsMarkers(page);
  await expect(page.getByRole('button', { name: /item notes/ }).first()).toBeVisible();
  const expandDetails = rightRail(page).getByRole('button', { name: 'Expand marker details' });
  if (await expandDetails.count()) await expandDetails.click();
  await expect(page.locator('.survey-marker-entity-trigger').first()).toBeVisible({ timeout: 8_000 });

  // Edge: template switch is not a history checkpoint — undo pops the place, template stays.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect(rightRail(page).getByRole('heading', { name: ENTITIES })).toBeVisible();
  await expect.poll(async () => (await markerIds(page)).includes(markerId), {
    message: 'undo after re-pick pops the place (no template checkpoint)',
  }).toBe(false);

  // Break: Pen-armed still re-picks via the rail.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await openTemplatePicker(page);
  await templateOption(page, TWO_CAT).click();
  await expect(rightRail(page).getByRole('heading', { name: TWO_CAT })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Windows', exact: true })).toBeVisible();
  expect(await page.locator('[data-survey-marker-id]').count(), 'Pen-armed re-pick adds no mark').toBe(0);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);
  await assertNoErrorBoundary(page);

  // Edge: 390 — in-session picker exists; re-pick updates the sheet.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  await expect(chooseTemplateBtn(page)).toBeVisible({ timeout: 8_000 });
  await openTemplatePicker(page);
  await expect(templateOption(page, KAL436)).toHaveAttribute('aria-selected', 'true');
  await templateOption(page, TWO_CAT).click();
  await expect(templateListbox(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(chooseTemplateBtn(page)).toContainText('Two Category Template');
  await expect(page.getByText('Select category')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.survey-marker-category-main-label').filter({ hasText: /^Windows$/ })).toBeVisible({ timeout: 8_000 });
  const mobile = {
    chooseTemplate: await chooseTemplateBtn(page).count(),
    windows: await page.locator('.survey-marker-category-main-label').filter({ hasText: /^Windows$/ }).count(),
  };
  expect(mobile.chooseTemplate, '390 has in-session Choose survey template').toBe(1);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_CHOOSE_TEMPLATE_REPICK_PROOF', JSON.stringify({
    persist,
    sameTemplateNoop: true,
    escapeCancelKeptKal436: true,
    clickOutsideCancelKeptKal436: true,
    twoCatRailUpdated: true,
    markerStayInStoreHiddenOnForeignModule: true,
    entitiesOverlayReturnedMarker: true,
    undoDidNotRewindTemplate: true,
    penArmedStillRepicks: true,
    emptyPickerLive: 'source-only on surveyTransitionE2E (4 compiled-in templates)',
    mobile,
  }));
});
