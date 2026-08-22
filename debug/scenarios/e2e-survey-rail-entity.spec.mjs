import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail Jump / Set location:
// rail Entity picker — `survey-marker-entity-trigger` /
// listbox aria-label="Entity" → applyEntitySelectionForMarker.
// Not Jump / Set location. Not Create category. Not category Delete.
// Not item Delete. Not Rename. Not overlay Delete. Not U-01 Walls stamp.
// UL-31 Continue pin stays parked. Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const EMPTY_PDF = '/?testPdf=text-search-glyph-lab.pdf&surveyTransitionE2E=1';
const EMPTY_TEMPLATE = /KAL-436 Preservation Template/;
const ENTITIES_TEMPLATE = /Survey Entities Template/;
const SEEDED_ID = 'e2e-entity-seed';
const SEEDED_NAME = 'entity-seed';

async function openEditor(page, { width = 1440, height = 900, url = SURVEY_PDF } = {}) {
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

function keepCheckbox(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function entityTrigger(page, markerId = null) {
  const root = markerId
    ? rightRail(page).locator(`#highlight-item-${markerId}`)
    : rightRail(page);
  return root.locator('.survey-marker-entity-trigger');
}

function entityListbox(page) {
  return page.getByRole('listbox', { name: 'Entity' });
}

function entityOption(page, name) {
  return entityListbox(page).getByRole('option', { name, exact: true });
}

async function enterSurveyTemplate(page, templateName = ENTITIES_TEMPLATE) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: templateName }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function armWalls(page, templateName = ENTITIES_TEMPLATE) {
  const hostWalls = () => page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (!(await hostWalls().count()) || !(await hostWalls().first().isVisible().catch(() => false))) {
    const survey = page.getByRole('button', { name: 'Survey', exact: true }).first();
    if (await survey.count()) await survey.click();
    const picker = page.getByRole('heading', { name: 'Choose survey template' });
    if (await picker.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: templateName }).click();
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

async function dragOnLayer(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const layer = page.locator(`[data-svg-annotation-layer="${pageNumber}"]`).last();
  await expect(layer).toBeVisible({ timeout: 20_000 });
  const box = await layer.boundingBox();
  expect(box, `annotation layer ${pageNumber} geometry`).toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  return box;
}

async function dismissPlaceEntityDialogIfPresent(page) {
  const heading = page.getByRole('heading', { name: 'Entity', exact: true });
  try {
    await heading.waitFor({ state: 'visible', timeout: 4_000 });
  } catch {
    return false;
  }
  await page.mouse.click(8, 8);
  await expect(heading).toHaveCount(0, { timeout: 8_000 });
  return true;
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

async function placeMarker(page, name, coords, { expectEntityDialog = false, templateName = ENTITIES_TEMPLATE } = {}) {
  const before = new Set(await markerIds(page));
  await armWalls(page, templateName);
  await dragOnLayer(page, coords);
  const sawDialog = await dismissPlaceEntityDialogIfPresent(page);
  if (expectEntityDialog) expect(sawDialog, 'place-time Entity dialog').toBe(true);
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
  if (await rightRail(page).locator('.survey-marker-expand-toggle').count()) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
}

function markerRowByName(page, name) {
  return rightRail(page).locator('[id^="highlight-item-"]').filter({
    has: page.getByRole('textbox', { name: `Rename ${name}` }),
  });
}

async function expandMarkerDetails(page, name) {
  await expandWallsMarkers(page);
  const row = markerRowByName(page, name);
  await expect(row).toBeVisible({ timeout: 10_000 });
  const expand = row.getByRole('button', { name: 'Expand marker details' });
  if (await expand.count()) {
    await expand.click();
  }
  await expect(row.locator('.survey-marker-entity-trigger')).toBeVisible({ timeout: 8_000 });
  return row;
}

async function waitSurveyMarkerSeam(page) {
  await expect.poll(() => page.evaluate(() => typeof window.__e2eSurveyMarkers?.patch), {
    timeout: 10_000,
    message: 'DEV survey-marker seam',
  }).toBe('function');
}

async function storedMarker(page, id) {
  return page.evaluate((annoId) => window.__e2eSurveyMarkers?.get()?.[annoId] || null, id);
}

async function optionNames(page) {
  return entityListbox(page).getByRole('option').evaluateAll(
    (nodes) => nodes.map((node) => (node.textContent || '').trim()),
  );
}

async function seedMarker(page, { id = SEEDED_ID, name = SEEDED_NAME } = {}) {
  await waitSurveyMarkerSeam(page);
  await page.evaluate(({ markerId, markerName }) => {
    window.__e2eSurveyMarkers.patch((prev) => ({
      ...prev,
      [markerId]: {
        id: markerId,
        name: markerName,
        categoryId: 'kal436-category',
        moduleId: 'kal436-module',
      },
    }));
  }, { markerId: id, markerName: name });
  await expect.poll(async () => Boolean((await storedMarker(page, id))?.name)).toBe(true);
}

test('survey-rail Entity picker intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyTemplate(page, ENTITIES_TEMPLATE);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  // Break: none placed / none selected — trigger lives on an expanded row.
  await expect(entityTrigger(page)).toHaveCount(0);
  await expect(entityListbox(page)).toHaveCount(0);

  const markerA = await placeMarker(page, 'entity-a', {
    x0: 0.22, y0: 0.34, x1: 0.46, y1: 0.54, pageNumber: 1,
  }, { expectEntityDialog: true });
  const markerB = await placeMarker(page, 'entity-b', {
    x0: 0.52, y0: 0.36, x1: 0.72, y1: 0.52, pageNumber: 1,
  }, { expectEntityDialog: true });

  await expandWallsMarkers(page);
  await expect(entityTrigger(page)).toHaveCount(0);
  await expect(rightRail(page).getByRole('button', { name: 'Expand marker details' })).toHaveCount(2);

  const rowA = await expandMarkerDetails(page, 'entity-a');
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('None');
  expect((await storedMarker(page, markerA))?.entityId, 'placed A has no entity').toBeFalsy();

  // Break: open / close without pick — Esc closes; stored entity stays empty.
  await rowA.locator('.survey-marker-entity-trigger').click();
  await expect(entityListbox(page)).toBeVisible({ timeout: 8_000 });
  const openNames = await optionNames(page);
  expect(openNames[0], 'None is the clear option').toBe('None');
  expect(openNames, 'single-select list of template entities').toEqual([
    'None', 'GC', 'Subcontractor', '100% Complete',
  ]);
  await page.keyboard.press('Escape');
  await expect(entityListbox(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('None');
  expect((await storedMarker(page, markerA))?.entityId, 'Esc keeps None').toBeFalsy();

  // Break: pick None while already None — no-op (same id, no write).
  await rowA.locator('.survey-marker-entity-trigger').click();
  await expect(entityListbox(page)).toBeVisible();
  await entityOption(page, 'None').click();
  await expect(entityListbox(page)).toHaveCount(0);
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('None');
  expect((await storedMarker(page, markerA))?.entityId, 're-pick None stays empty').toBeFalsy();

  // Intended: pick GC — stored id + trigger label update.
  await rowA.locator('.survey-marker-entity-trigger').click();
  await entityOption(page, 'GC').click();
  await expect(entityListbox(page)).toHaveCount(0);
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('GC');
  await expect.poll(async () => (await storedMarker(page, markerA))?.entityId, {
    message: 'stored entityId is GC',
  }).toBe('kal436-entity-gc');
  const afterGc = await storedMarker(page, markerA);
  expect(afterGc.entityName).toBe('GC');
  expect(afterGc.entityColor).toBeTruthy();
  expect((await storedMarker(page, markerB))?.entityId, 'B stays unassigned').toBeFalsy();

  // Edge: change entity.
  await rowA.locator('.survey-marker-entity-trigger').click();
  await entityOption(page, 'Subcontractor').click();
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('Subcontractor');
  await expect.poll(async () => (await storedMarker(page, markerA))?.entityId)
    .toBe('kal436-entity-sub');

  // Break: Pen-armed still picks.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await expandMarkerDetails(page, 'entity-a');
  await rowA.locator('.survey-marker-entity-trigger').click();
  await entityOption(page, '100% Complete').click();
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('100% Complete');
  await expect.poll(async () => (await storedMarker(page, markerA))?.entityId)
    .toBe('kal436-entity-complete');

  // Edge: clear via None.
  await rowA.locator('.survey-marker-entity-trigger').click();
  await entityOption(page, 'None').click();
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('None');
  await expect.poll(async () => (await storedMarker(page, markerA))?.entityId || null)
    .toBeNull();

  // Re-pick GC so undo has a real change (None→GC).
  await rowA.locator('.survey-marker-entity-trigger').click();
  await entityOption(page, 'GC').click();
  await expect.poll(async () => (await storedMarker(page, markerA))?.entityId)
    .toBe('kal436-entity-gc');

  // Edge: undo restores the prior entity; both markers stay.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await storedMarker(page, markerA))?.entityId || null, {
    timeout: 10_000,
    message: 'undo restores cleared entity',
  }).toBeNull();
  await expect(rowA.locator('.survey-marker-entity-trigger-label')).toHaveText('None');
  expect((await markerIds(page)).includes(markerA), 'undo leaves placed A').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'undo leaves placed B').toBe(true);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);
  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Break: empty entity list — KAL-436 has no template.entities; only None.
  // Separate PDF so y-indexeddb / local history from the entities session
  // cannot alias Walls rows.
  await openEditor(page, { url: EMPTY_PDF });
  await enterSurveyTemplate(page, EMPTY_TEMPLATE);
  const emptyKeep = keepCheckbox(page);
  if (!(await emptyKeep.isChecked())) await emptyKeep.click();
  const emptyMarker = await placeMarker(page, 'empty-a', {
    x0: 0.24, y0: 0.32, x1: 0.44, y1: 0.50, pageNumber: 1,
  }, { expectEntityDialog: false, templateName: EMPTY_TEMPLATE });
  const emptyRow = await expandMarkerDetails(page, 'empty-a');
  await emptyRow.locator('.survey-marker-entity-trigger').click();
  await expect(entityListbox(page)).toBeVisible();
  const emptyNames = await optionNames(page);
  expect(emptyNames, 'empty template list is None only').toEqual(['None']);
  await entityOption(page, 'None').click();
  await expect(emptyRow.locator('.survey-marker-entity-trigger-label')).toHaveText('None');
  expect((await storedMarker(page, emptyMarker))?.entityId, 'empty list cannot store an id').toBeFalsy();
  await assertNoErrorBoundary(page);

  // Edge: 390 — desktop trigger is hidden; detail swatch opens the same listbox.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: ENTITIES_TEMPLATE }).click();
  await expect(page.getByRole('button', { name: /Walls/ }).first()).toBeVisible({ timeout: 15_000 });
  await seedMarker(page);
  const arrow390 = page.locator('.survey-marker-category-arrow').first();
  await expect(arrow390).toBeVisible({ timeout: 8_000 });
  await arrow390.evaluate((el) => el.click());
  const openRow = page.getByRole('button', { name: `Open ${SEEDED_NAME}` });
  await expect(openRow).toBeVisible({ timeout: 8_000 });
  await openRow.evaluate((el) => el.click());
  const mobileTrigger = page.getByRole('button', { name: 'Choose Survey Marker entity' });
  await expect(mobileTrigger).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.survey-marker-entity-trigger')).toHaveCount(0);
  await mobileTrigger.evaluate((el) => el.click());
  await expect(entityListbox(page)).toBeVisible({ timeout: 8_000 });
  const mobileNames = await optionNames(page);
  expect(mobileNames).toEqual(['None', 'GC', 'Subcontractor', '100% Complete']);
  await entityOption(page, 'GC').evaluate((el) => el.click());
  await expect.poll(async () => (await storedMarker(page, SEEDED_ID))?.entityId)
    .toBe('kal436-entity-gc');
  await expect(page.getByText('Entity: GC')).toBeVisible();
  const mobile = {
    desktopTriggerCount: await page.locator('.survey-marker-entity-trigger').count(),
    mobileTriggerCount: await mobileTrigger.count(),
    storedId: (await storedMarker(page, SEEDED_ID))?.entityId || null,
  };
  expect(mobile.desktopTriggerCount, '390 hides desktop trigger').toBe(0);
  expect(mobile.mobileTriggerCount, '390 detail entity trigger exists').toBeGreaterThan(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_ENTITY_PROOF', JSON.stringify({
    placedA: markerA,
    placedB: markerB,
    intended: { entityId: 'kal436-entity-gc', label: 'GC' },
    changedTo: 'kal436-entity-sub',
    penArmed: 'kal436-entity-complete',
    cleared: true,
    undoRestoredNone: true,
    emptyList: emptyNames,
    persist,
    mobile,
  }));
});
