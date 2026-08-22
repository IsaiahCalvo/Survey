import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail Entity picker:
// place-time Entity dialog — pendingEntitySelection after a Walls
// (or other) draw when the template has entities.
// Not rail survey-marker-entity-trigger. Not Jump / Set location.
// Not Create category. Not item Delete. Not Rename. Not overlay Delete.
// UL-31 Continue pin stays parked. Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const EMPTY_PDF = '/?testPdf=text-search-glyph-lab.pdf&surveyTransitionE2E=1';
const EMPTY_TEMPLATE = /KAL-436 Preservation Template/;
const ENTITIES_TEMPLATE = /Survey Entities Template/;

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

function entityHeading(page) {
  return page.getByRole('heading', { name: 'Entity', exact: true });
}

function entityHint(page) {
  return page.getByText('Select the entity responsible for this highlight:');
}

function nameField(page) {
  return page.getByPlaceholder('Enter name');
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

async function finishMarkerName(page, name) {
  const field = nameField(page);
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

async function waitCreatedMarker(page, before) {
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: 'expected committed survey-marker' }).not.toBeNull();
  return created;
}

async function waitEntityDialog(page) {
  await expect(entityHeading(page)).toBeVisible({ timeout: 8_000 });
  await expect(entityHint(page)).toBeVisible();
}

async function entityOptionNames(page) {
  await waitEntityDialog(page);
  return page.locator('button').filter({
    has: page.locator('span', { hasText: /^(GC|Subcontractor|100% Complete|None)$/ }),
  }).evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()).filter(Boolean));
}

async function dismissEntityViaX(page) {
  const header = entityHeading(page).locator('..');
  await header.getByRole('button').click();
  await expect(entityHeading(page)).toHaveCount(0, { timeout: 8_000 });
}

test('place-time Entity dialog intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyTemplate(page, ENTITIES_TEMPLATE);
  await waitSurveyMarkerSeam(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  // Intended: place on a template with entities → dialog appears → pick stores.
  const beforeA = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, { x0: 0.20, y0: 0.32, x1: 0.42, y1: 0.50 });
  const firstNames = await entityOptionNames(page);
  expect(firstNames.includes('None'), 'place-time dialog has no None option').toBe(false);
  expect(firstNames, 'template entities').toEqual(
    expect.arrayContaining(['GC', 'Subcontractor', '100% Complete']),
  );
  await page.getByRole('button', { name: 'GC', exact: true }).click();
  await expect(entityHeading(page)).toHaveCount(0, { timeout: 8_000 });
  await finishMarkerName(page, 'place-gc');
  const markerA = await waitCreatedMarker(page, beforeA);
  await expect.poll(async () => (await storedMarker(page, markerA))?.entityId, {
    message: 'picked GC stored on A',
  }).toBe('kal436-entity-gc');
  const storedA = await storedMarker(page, markerA);
  expect(storedA.entityName).toBe('GC');
  expect(storedA.entityColor).toBeTruthy();

  // Intended + Keep-active edge: next place still shows the dialog; pick a different entity.
  const beforeB = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, { x0: 0.50, y0: 0.34, x1: 0.72, y1: 0.52 });
  await waitEntityDialog(page);
  await page.getByRole('button', { name: 'Subcontractor', exact: true }).click();
  await finishMarkerName(page, 'place-sub');
  const markerB = await waitCreatedMarker(page, beforeB);
  await expect.poll(async () => (await storedMarker(page, markerB))?.entityId, {
    message: 'picked Subcontractor stored on B',
  }).toBe('kal436-entity-sub');
  expect((await storedMarker(page, markerA))?.entityId, 'A stays GC').toBe('kal436-entity-gc');

  // Edge: undo after pick pops highlight:create (the place), not a later entity write.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerB), {
    timeout: 10_000,
    message: 'undo removes the just-placed B',
  }).toBe(false);
  expect((await markerIds(page)).includes(markerA), 'undo leaves picked A').toBe(true);
  expect((await storedMarker(page, markerA))?.entityId, 'A entity survives undo of B').toBe('kal436-entity-gc');

  // Break: X without pick — not required; proceeds to name with no entity (None).
  const beforeX = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, { x0: 0.22, y0: 0.54, x1: 0.40, y1: 0.68 });
  await waitEntityDialog(page);
  await dismissEntityViaX(page);
  await finishMarkerName(page, 'place-x');
  const markerX = await waitCreatedMarker(page, beforeX);
  expect((await storedMarker(page, markerX))?.entityId, 'X skip stores no entity').toBeFalsy();

  // Break: overlay dismiss without pick — same skip, not required.
  const beforeOverlay = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, { x0: 0.46, y0: 0.54, x1: 0.64, y1: 0.68 });
  await waitEntityDialog(page);
  await page.mouse.click(8, 8);
  await expect(entityHeading(page)).toHaveCount(0, { timeout: 8_000 });
  await finishMarkerName(page, 'place-overlay');
  const markerOverlay = await waitCreatedMarker(page, beforeOverlay);
  expect((await storedMarker(page, markerOverlay))?.entityId, 'overlay skip stores no entity').toBeFalsy();

  // Break: Esc without pick — assert actual (skip vs stay).
  const beforeEsc = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, { x0: 0.68, y0: 0.54, x1: 0.86, y1: 0.68 });
  await waitEntityDialog(page);
  await page.keyboard.press('Escape');
  const escDismissed = !(await entityHeading(page).isVisible().catch(() => false));
  if (!escDismissed) {
    await dismissEntityViaX(page);
  }
  await finishMarkerName(page, 'place-esc');
  const markerEsc = await waitCreatedMarker(page, beforeEsc);
  expect((await storedMarker(page, markerEsc))?.entityId, 'Esc/skip stores no entity').toBeFalsy();

  // Break: Pen-armed after dismiss — marker stays; no extra survey-marker.
  const idsAfterDismiss = await markerIds(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await page.waitForTimeout(400);
  const idsAfterPen = await markerIds(page);
  expect(idsAfterPen, 'Pen after dismiss does not add/remove markers').toEqual(idsAfterDismiss);
  expect(idsAfterPen.includes(markerEsc), 'dismissed marker survives Pen').toBe(true);
  await expect(entityHeading(page)).toHaveCount(0);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);
  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Break: zero-entity template — dialog must not appear.
  await openEditor(page, { url: EMPTY_PDF });
  await enterSurveyTemplate(page, EMPTY_TEMPLATE);
  await waitSurveyMarkerSeam(page);
  const emptyKeep = keepCheckbox(page);
  if (!(await emptyKeep.isChecked())) await emptyKeep.click();
  const beforeEmpty = new Set(await markerIds(page));
  await armWalls(page, EMPTY_TEMPLATE);
  await dragOnLayer(page, { x0: 0.24, y0: 0.32, x1: 0.44, y1: 0.50 });
  await expect(entityHeading(page)).toHaveCount(0);
  await expect(entityHint(page)).toHaveCount(0);
  await finishMarkerName(page, 'empty-a');
  const emptyMarker = await waitCreatedMarker(page, beforeEmpty);
  expect((await storedMarker(page, emptyMarker))?.entityId, 'empty template stores no entity').toBeFalsy();
  await assertNoErrorBoundary(page);

  // Edge: 390 — desktop place-time dialog is mobileMode-gated (detail sheet instead).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: ENTITIES_TEMPLATE }).click();
  await expect(page.getByRole('button', { name: /Walls/ }).first()).toBeVisible({ timeout: 15_000 });
  await expect(entityHeading(page)).toHaveCount(0);
  await expect(entityHint(page)).toHaveCount(0);
  const mobile = {
    entityHeading: await entityHeading(page).count(),
    entityHint: await entityHint(page).count(),
    desktopDialogCopy: await page.getByText('Select the entity responsible for this highlight:').count(),
  };
  expect(mobile.entityHeading, '390 hides desktop Entity dialog').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_PLACE_ENTITY_DIALOG_PROOF', JSON.stringify({
    placedA: markerA,
    placedB: markerB,
    intended: { a: 'kal436-entity-gc', b: 'kal436-entity-sub' },
    keepActiveShowsAgain: true,
    undoRemovedB: true,
    xSkipNone: !(await storedMarker(page, markerX))?.entityId,
    overlaySkipNone: !(await storedMarker(page, markerOverlay))?.entityId,
    escDismissed,
    escStoredEntity: (await storedMarker(page, markerEsc))?.entityId || null,
    penArmedAfterDismiss: true,
    emptyTemplateDialog: 0,
    persist,
    mobile,
  }));
});
