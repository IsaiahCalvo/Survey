import { test, expect } from '@playwright/test';

// Unique leftover after Choose survey template re-pick:
// 390 detail Choose Survey Marker sibling switcher
// (aria-label="Choose Survey Marker" / listbox "Survey Markers in this category").
// Distinct from Entity ("Choose Survey Marker entity"). Not checklist Y/N/N-A.
// Not category Move/Copy stub. Not leftover-18 unplaced-rows.
// UL-31 Continue pin stays parked. No file.id.
// Place siblings on desktop (sheet backdrop intercepts 390 place clicks),
// then switch viewport to 390×844. One-marker break seeds via __e2eSurveyMarkers.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const KAL436 = /KAL-436 Preservation Template/;
const SEEDED_ID = 'e2e-choose-marker-solo';
const SEEDED_NAME = 'solo-seed';

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

function chooseMarkerBtn(page) {
  return page.getByRole('button', { name: 'Choose Survey Marker', exact: true });
}

function markerListbox(page) {
  return page.getByRole('listbox', { name: 'Survey Markers in this category' });
}

function markerOption(page, name) {
  return markerListbox(page).getByRole('option', { name, exact: true });
}

function jumpBtn(page) {
  return page.getByRole('button', { name: 'Jump to this Survey Marker' });
}

function detailName(page, name) {
  return page.getByRole('textbox', { name: `Rename ${name}` });
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

async function waitSurveyMarkerSeam(page) {
  await expect.poll(() => page.evaluate(() => typeof window.__e2eSurveyMarkers?.patch), {
    timeout: 10_000,
    message: 'DEV survey-marker seam',
  }).toBe('function');
}

async function storedMarker(page, id) {
  return page.evaluate((annoId) => window.__e2eSurveyMarkers?.get()?.[annoId] || null, id);
}

async function seedSoloMarker(page) {
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
  }, { markerId: SEEDED_ID, markerName: SEEDED_NAME });
  await expect.poll(async () => Boolean((await storedMarker(page, SEEDED_ID))?.name)).toBe(true);
}

async function switchTo390(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
}

async function openSurveySheet(page) {
  const inSheet = page.getByRole('button', { name: 'Choose survey template' });
  if (await inSheet.count() && await inSheet.isVisible().catch(() => false)) return;
  const openSurvey = page.getByRole('button', { name: 'Open survey' });
  if (await openSurvey.count()) {
    await openSurvey.evaluate((el) => el.click());
  }
  await expect(inSheet).toBeVisible({ timeout: 15_000 });
}

async function open390Detail(page, name) {
  await openSurveySheet(page);
  if (await detailName(page, name).count()) {
    await expect(detailName(page, name)).toBeVisible({ timeout: 8_000 });
    return;
  }
  if (await chooseMarkerBtn(page).count() && !(await chooseMarkerBtn(page).isDisabled().catch(() => false))) {
    await chooseMarkerBtn(page).evaluate((el) => el.click());
    const opt = markerOption(page, name);
    if (await opt.count()) {
      await opt.evaluate((el) => el.click());
      await expect(detailName(page, name)).toBeVisible({ timeout: 8_000 });
      return;
    }
    await page.keyboard.press('Escape');
  }
  const arrow = page.locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  const openRow = page.getByRole('button', { name: `Open ${name}` });
  if (!(await openRow.count())) {
    await arrow.evaluate((el) => el.click());
  }
  await expect(openRow).toBeVisible({ timeout: 10_000 });
  await openRow.evaluate((el) => el.click());
  await expect(detailName(page, name)).toBeVisible({ timeout: 8_000 });
}

async function openSwitcher(page) {
  const btn = chooseMarkerBtn(page);
  await expect(btn).toBeVisible({ timeout: 8_000 });
  expect(await btn.isDisabled(), 'switcher enabled with siblings').toBe(false);
  if ((await btn.getAttribute('aria-expanded')) !== 'true') {
    await btn.evaluate((el) => el.click());
  }
  await expect(markerListbox(page)).toBeVisible({ timeout: 8_000 });
}

async function selectedOverlayId(page) {
  return page.evaluate(() => {
    const selected = [...document.querySelectorAll('[data-survey-marker-id]')].find((node) => (
      node.querySelector('[data-resize-handle]')
    ));
    return selected?.getAttribute('data-survey-marker-id') || null;
  });
}

test('390 detail Choose Survey Marker sibling switcher intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerA = await placeMarker(page, 'switch-a', {
    x0: 0.20, y0: 0.32, x1: 0.42, y1: 0.50, pageNumber: 1,
  });
  const markerB = await placeMarker(page, 'switch-b', {
    x0: 0.52, y0: 0.34, x1: 0.74, y1: 0.52, pageNumber: 1,
  });
  expect(markerA).toBeTruthy();
  expect(markerB).toBeTruthy();
  expect(markerA).not.toBe(markerB);

  // Place on desktop, then switch viewport — 390 sheet backdrop intercepts place.
  await switchTo390(page);
  await open390Detail(page, 'switch-a');
  await expect(chooseMarkerBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Choose Survey Marker entity' })).toBeVisible();
  await expect(jumpBtn(page)).toBeVisible();
  expect(await chooseMarkerBtn(page).isDisabled(), 'two siblings enable the switcher').toBe(false);

  // Break: cancel / close list — Escape keeps A.
  await openSwitcher(page);
  const openNames = await markerListbox(page).getByRole('option').evaluateAll(
    (nodes) => nodes.map((node) => (node.textContent || '').trim()),
  );
  expect(openNames, 'same-category siblings').toEqual(['switch-a', 'switch-b']);
  await expect(markerOption(page, 'switch-a')).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
  await expect(markerListbox(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(detailName(page, 'switch-a')).toBeVisible();
  expect((await storedMarker(page, markerA))?.name).toBe('switch-a');
  expect((await storedMarker(page, markerB))?.name).toBe('switch-b');

  // Break: click-outside cancel keeps A.
  await openSwitcher(page);
  await page.locator('.mobile-survey-detail-label').first().evaluate((el) => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await expect(markerListbox(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(detailName(page, 'switch-a')).toBeVisible();

  // Break: same-id re-pick is a no-op.
  await openSwitcher(page);
  await markerOption(page, 'switch-a').evaluate((el) => el.click());
  await expect(markerListbox(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(detailName(page, 'switch-a')).toBeVisible();

  // Intended: A → B updates detail name + selection.
  await openSwitcher(page);
  await markerOption(page, 'switch-b').evaluate((el) => el.click());
  await expect(markerListbox(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(detailName(page, 'switch-b')).toBeVisible({ timeout: 8_000 });
  await expect(detailName(page, 'switch-a')).toHaveCount(0);
  expect((await storedMarker(page, markerA))?.name, 'switch does not rename A').toBe('switch-a');
  expect((await storedMarker(page, markerB))?.name, 'switch does not rename B').toBe('switch-b');

  // Break: Pen-armed still switches back to A.
  await page.evaluate(() => document.activeElement?.blur?.());
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count()) {
    await pen.evaluate((el) => el.click());
  } else {
    await page.keyboard.press('p');
  }
  await open390Detail(page, 'switch-b');
  await openSwitcher(page);
  await markerOption(page, 'switch-a').evaluate((el) => el.click());
  await expect(detailName(page, 'switch-a')).toBeVisible({ timeout: 8_000 });
  expect((await markerIds(page)).includes(markerA), 'Pen-armed switch leaves A').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'Pen-armed switch leaves B').toBe(true);

  // Edge: switch then Jump — overlay selection follows B.
  await openSwitcher(page);
  await markerOption(page, 'switch-b').evaluate((el) => el.click());
  await expect(detailName(page, 'switch-b')).toBeVisible({ timeout: 8_000 });
  await jumpBtn(page).evaluate((el) => el.click());
  await expect.poll(async () => selectedOverlayId(page), {
    timeout: 12_000,
    message: 'Jump after switch selects overlay B',
  }).toBe(markerB);
  expect(await page.locator(`[data-survey-marker-id="${markerA}"] [data-resize-handle]`).count())
    .toBe(0);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);
  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Break: one marker only — switcher disabled. Seed via existing seam
  // (390 place is blocked by the sheet backdrop).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  await expect(page.getByRole('button', { name: /Walls/ }).first()).toBeVisible({ timeout: 15_000 });
  await seedSoloMarker(page);
  const arrow390 = page.locator('.survey-marker-category-arrow').first();
  await expect(arrow390).toBeVisible({ timeout: 8_000 });
  await arrow390.evaluate((el) => el.click());
  const openRow = page.getByRole('button', { name: `Open ${SEEDED_NAME}` });
  await expect(openRow).toBeVisible({ timeout: 8_000 });
  await openRow.evaluate((el) => el.click());
  const solo = chooseMarkerBtn(page);
  await expect(solo).toBeVisible({ timeout: 8_000 });
  expect(await solo.isDisabled(), 'one marker disables the sibling switcher').toBe(true);
  await expect(solo).toHaveAttribute('aria-disabled', 'true');
  await solo.evaluate((el) => el.click());
  await expect(markerListbox(page)).toHaveCount(0);
  await expect(detailName(page, SEEDED_NAME)).toBeVisible();
  const mobile = {
    switcher: await solo.count(),
    disabled: await solo.isDisabled(),
    jump: await jumpBtn(page).count(),
    entity: await page.getByRole('button', { name: 'Choose Survey Marker entity' }).count(),
  };
  expect(mobile.switcher, '390 detail Choose Survey Marker exists').toBe(1);
  expect(mobile.jump, '390 detail Jump exists').toBeGreaterThan(0);
  expect(mobile.entity, 'Entity swatch is a different control').toBe(1);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_390_CHOOSE_MARKER_PROOF', JSON.stringify({
    placedA: markerA,
    placedB: markerB,
    intended: { from: 'switch-a', to: 'switch-b' },
    escapeCancelKeptA: true,
    clickOutsideCancelKeptA: true,
    sameIdNoop: true,
    penArmedSwitchedToA: true,
    jumpSelectedB: markerB,
    persist,
    mobile,
  }));
});
