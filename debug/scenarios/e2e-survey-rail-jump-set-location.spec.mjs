import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail Create category:
// rail Jump / Set location — same search button,
// aria-label="Jump to this Survey Marker" when bounds+pageNumber exist,
// aria-label="Set location on PDF" when they do not.
// Not Create category. Not category Delete. Not item Delete. Not Rename.
// Not overlay Delete. Not U-01 Walls stamp-create as the GAP.
// UL-31 Continue pin stays parked. Leftover-18 parked. No file.id.

const MULTI_PDF = '/?testPdf=spike-120-pages.pdf&surveyTransitionE2E=1';
const UNLOCATED_ID = 'e2e-unlocated';
const UNLOCATED_NAME = 'unlocated-a';

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
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

function keepCheckbox(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function jumpBtn(page) {
  return rightRail(page).getByRole('button', { name: 'Jump to this Survey Marker' });
}

function setLocationBtn(page) {
  return rightRail(page).getByRole('button', { name: 'Set location on PDF' });
}

function locateBanner(page) {
  return page.getByText(/Draw a box on the PDF to locate/);
}

async function currentPageNumber(page) {
  return page.evaluate(() => Number(window.__currentPageNumber) || 1);
}

async function goToPage(page, n) {
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(String(n));
  await input.press('Enter');
  await expect.poll(() => currentPageNumber(page), {
    timeout: 20_000,
    message: `expected page ${n}`,
  }).toBe(n);
  await expect(page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`)).toBeVisible({ timeout: 20_000 });
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
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
      await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
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

async function expandWallsMarkers(page) {
  if (await jumpBtn(page).count() || await setLocationBtn(page).count()) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
}

async function waitSurveyMarkerSeam(page) {
  await expect.poll(() => page.evaluate(() => typeof window.__e2eSurveyMarkers?.patch), {
    timeout: 10_000,
    message: 'DEV survey-marker seam',
  }).toBe('function');
}

async function seedUnlocated(page) {
  await waitSurveyMarkerSeam(page);
  await page.evaluate(({ id, name }) => {
    window.__e2eSurveyMarkers.patch((prev) => ({
      ...prev,
      [id]: {
        id,
        name,
        categoryId: 'kal436-category',
        moduleId: 'kal436-module',
      },
    }));
  }, { id: UNLOCATED_ID, name: UNLOCATED_NAME });
  await expect.poll(async () => page.evaluate((id) => {
    const marker = window.__e2eSurveyMarkers?.get()?.[id];
    return Boolean(marker && !marker.bounds && !marker.pageNumber);
  }, UNLOCATED_ID)).toBe(true);
}

async function storedMarker(page, id) {
  return page.evaluate((annoId) => window.__e2eSurveyMarkers?.get()?.[annoId] || null, id);
}

async function markerViewport(page, id) {
  return page.evaluate((annoId) => {
    const container = document.querySelector('[data-testid="pdf-container"]');
    const group = document.querySelector(`[data-survey-marker-id="${annoId}"]`);
    const rect = group?.querySelector('rect:not([data-survey-marker-hit-target])')
      || group?.querySelector('rect');
    if (!container || !rect) return { inView: false, page: window.__currentPageNumber || null };
    const c = container.getBoundingClientRect();
    const r = rect.getBoundingClientRect();
    const overlapX = Math.min(c.right, r.right) - Math.max(c.left, r.left);
    const overlapY = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
    return {
      inView: overlapX > 8 && overlapY > 8,
      page: window.__currentPageNumber || null,
    };
  }, id);
}

test('survey-rail Jump / Set location intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  // Break: none placed / none selected — neither control exists.
  await expect(jumpBtn(page)).toHaveCount(0);
  await expect(setLocationBtn(page)).toHaveCount(0);

  const markerA = await placeMarker(page, 'jump-a', { x0: 0.22, y0: 0.34, x1: 0.46, y1: 0.54, pageNumber: 1 });
  await expandWallsMarkers(page);
  await expect(jumpBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect(setLocationBtn(page)).toHaveCount(0);

  const geomA = await storedMarker(page, markerA);
  expect(geomA?.pageNumber, 'placed marker stores page 1').toBe(1);
  expect(Number(geomA?.bounds?.width) > 2, 'placed marker stores width').toBe(true);

  // Intended Jump: leave page 1, click Jump, viewer returns to the marker.
  await goToPage(page, 4);
  expect(await currentPageNumber(page)).toBe(4);
  await expandWallsMarkers(page);
  await jumpBtn(page).click();
  await expect.poll(async () => currentPageNumber(page), {
    timeout: 15_000,
    message: 'Jump returns to marker page',
  }).toBe(1);
  await expect.poll(async () => (await markerViewport(page, markerA)).inView, {
    timeout: 15_000,
    message: 'Jump centers the placed marker',
  }).toBe(true);

  // Break: Jump with no location is the other label on the same search button.
  await seedUnlocated(page);
  await expandWallsMarkers(page);
  await expect(setLocationBtn(page)).toBeVisible({ timeout: 8_000 });
  await expect(jumpBtn(page)).toBeVisible();
  const beforeUnlocated = await storedMarker(page, UNLOCATED_ID);
  expect(beforeUnlocated?.bounds || beforeUnlocated?.pageNumber, 'seed has no location').toBeFalsy();

  // Break: Set location then Esc — banner gone, still unlocated.
  await setLocationBtn(page).click();
  await expect(locateBanner(page)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  await expect(locateBanner(page)).toHaveCount(0, { timeout: 8_000 });
  expect((await storedMarker(page, UNLOCATED_ID))?.bounds, 'Esc keeps unlocated').toBeFalsy();

  // Break: Set location then banner X cancel.
  await setLocationBtn(page).click();
  await expect(locateBanner(page)).toBeVisible({ timeout: 8_000 });
  const cancel = page.locator('div').filter({ hasText: /Draw a box on the PDF to locate/ }).locator('button').last();
  if (await cancel.count()) {
    await cancel.click();
    await expect(locateBanner(page)).toHaveCount(0, { timeout: 8_000 });
  } else {
    await page.keyboard.press('Escape');
    await expect(locateBanner(page)).toHaveCount(0, { timeout: 8_000 });
  }
  expect((await storedMarker(page, UNLOCATED_ID))?.bounds, 'cancel keeps unlocated').toBeFalsy();

  // Break: Pen-armed still lets Set location assign geometry (tool re-arms).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await setLocationBtn(page).click();
  await expect(locateBanner(page)).toBeVisible({ timeout: 8_000 });
  await dragOnLayer(page, { x0: 0.18, y0: 0.22, x1: 0.36, y1: 0.38, pageNumber: 1 });
  await expect.poll(async () => {
    const marker = await storedMarker(page, UNLOCATED_ID);
    return Number(marker?.pageNumber) === 1 && Number(marker?.bounds?.width) > 2;
  }, { timeout: 10_000, message: 'Pen-armed Set location stores page-1 geometry' }).toBe(true);
  await expect(locateBanner(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set location on PDF' })).toHaveCount(0);
  await expect(jumpBtn(page)).toHaveCount(2, { timeout: 8_000 });

  const locatedOnPage1 = await storedMarker(page, UNLOCATED_ID);
  expect(locatedOnPage1.pageNumber).toBe(1);
  expect(locatedOnPage1.bounds.width).toBeGreaterThan(2);
  expect(locatedOnPage1.bounds.height).toBeGreaterThan(2);

  // Edge: undo after Set location restores the unlocated row.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const marker = await storedMarker(page, UNLOCATED_ID);
    return Boolean(marker && !marker.bounds && !marker.pageNumber);
  }, { timeout: 10_000, message: 'undo restores unlocated' }).toBe(true);
  await expandWallsMarkers(page);
  await expect(setLocationBtn(page)).toBeVisible({ timeout: 8_000 });
  expect((await markerIds(page)).includes(markerA), 'undo leaves placed A').toBe(true);

  // Edge: Set location on a different page, then Jump from page 1.
  await goToPage(page, 3);
  await expandWallsMarkers(page);
  await setLocationBtn(page).click();
  await expect(locateBanner(page)).toBeVisible({ timeout: 8_000 });
  await dragOnLayer(page, { x0: 0.28, y0: 0.30, x1: 0.52, y1: 0.48, pageNumber: 3 });
  await expect.poll(async () => {
    const marker = await storedMarker(page, UNLOCATED_ID);
    return Number(marker?.pageNumber) === 3 && Number(marker?.bounds?.width) > 2;
  }, { timeout: 12_000, message: 'Set location stores page-3 geometry' }).toBe(true);
  const page3Geom = await storedMarker(page, UNLOCATED_ID);
  expect(page3Geom.pageNumber).toBe(3);
  expect(page3Geom.bounds.x).toBeGreaterThan(0);
  expect(page3Geom.bounds.y).toBeGreaterThan(0);
  await expect(page.locator(`[data-survey-marker-id="${UNLOCATED_ID}"]`)).toHaveCount(1);

  await goToPage(page, 1);
  await expandWallsMarkers(page);
  const jumpUnlocated = rightRail(page).locator('.survey-marker-name-inline, [id^="highlight-item-"]')
    .filter({ hasText: UNLOCATED_NAME })
    .locator('xpath=ancestor::*[starts-with(@id,"highlight-item-")][1]')
    .getByRole('button', { name: 'Jump to this Survey Marker' });
  if (await jumpUnlocated.count()) {
    await jumpUnlocated.click();
  } else {
    await jumpBtn(page).nth(1).click();
  }
  await expect.poll(async () => currentPageNumber(page), {
    timeout: 15_000,
    message: 'Jump after Set location goes to page 3',
  }).toBe(3);
  await expect.poll(async () => (await markerViewport(page, UNLOCATED_ID)).inView, {
    timeout: 15_000,
    message: 'Jump centers the relocated marker',
  }).toBe(true);

  // Break: Pen-armed Jump still navigates.
  await goToPage(page, 2);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await expandWallsMarkers(page);
  await jumpBtn(page).first().click();
  await expect.poll(async () => currentPageNumber(page), {
    timeout: 15_000,
    message: 'Pen-armed Jump still leaves page 2',
  }).not.toBe(2);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — same search control lives on the mobile detail header.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  await waitSurveyMarkerSeam(page);
  await seedUnlocated(page);
  const wallsCat = page.getByRole('button', { name: /Walls/ }).first();
  await wallsCat.evaluate((el) => el.click());
  const unlocatedRow = page.getByText(UNLOCATED_NAME).first();
  if (await unlocatedRow.count()) {
    await unlocatedRow.evaluate((el) => el.click());
  }
  const mobileJump = page.getByRole('button', { name: 'Jump to this Survey Marker' });
  const mobile = {
    jumpCount: await mobileJump.count(),
    setLocationCount: await page.getByRole('button', { name: 'Set location on PDF' }).count(),
  };
  expect(mobile.jumpCount, '390 detail Jump exists after seed').toBeGreaterThan(0);
  expect(mobile.setLocationCount, '390 keeps the Jump label even when unlocated').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_JUMP_SET_LOCATION_PROOF', JSON.stringify({
    placedId: markerA,
    placedPage: geomA?.pageNumber,
    jumpReturnedToPage1: true,
    unlocatedLabel: 'Set location on PDF',
    escCanceled: true,
    penArmedSetLocationPage: 1,
    undoRestoredUnlocated: true,
    setLocationPage3: page3Geom.pageNumber,
    setLocationBounds: page3Geom.bounds,
    persist,
    mobile,
  }));
});
