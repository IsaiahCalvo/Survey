import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail item reorder:
// item toolbar Copy → setShowSpaceSelection. Distinct compiled-in
// control from dead copyModeActive ("Copy to Spaces" never entered —
// setCopyModeActive(true) has zero callers). Not category Move/Copy
// stub. Not checklist Y/N/N-A. Not item reorder. UL-31 Continue pin
// stays parked. Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const KAL436 = /KAL-436 Preservation Template/;
const SOURCE_MODULE = 'kal436-module';
const DEST_MODULE = 'kal436-two-category-module';
const DEST_WALLS = 'kal436-two-cat-walls';

async function openEditor(page, { width = 1440, height = 900 } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(SURVEY_PDF);
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

function itemCopyBtn(page) {
  return rightRail(page).locator('[aria-label="Item selection actions"]').getByRole('button', { name: 'Copy', exact: true });
}

function spacePicker(page) {
  return page.getByRole('heading', { name: 'Select space' });
}

function destSpaceBtn(page, name) {
  return page.getByRole('button', { name: new RegExp(name) });
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
  const notes = page.getByRole('button', { name: /item notes/ });
  if (await notes.count() && await notes.first().isVisible().catch(() => false)) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
  await expect(rightRail(page).locator('[id^="highlight-item-"]').first()).toBeVisible({ timeout: 8_000 });
}

async function enterItemSelectMode(page) {
  await expandWallsMarkers(page);
  const done = rightRail(page).locator('.survey-marker-inline-select-row').getByRole('button', { name: 'Done', exact: true });
  if (await done.count() && await done.first().isVisible().catch(() => false)) return;
  const select = rightRail(page).locator('.survey-marker-inline-select-row').getByRole('button', { name: 'Select', exact: true });
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(itemCopyBtn(page)).toBeVisible({ timeout: 8_000 });
}

async function selectRailItem(page, name) {
  const deselect = page.getByRole('button', { name: `Deselect ${name}` });
  if (await deselect.count() && await deselect.first().isVisible().catch(() => false)) return;
  const select = page.getByRole('button', { name: `Select ${name}` });
  await expect(select).toBeVisible({ timeout: 8_000 });
  await select.click();
  await expect(page.getByRole('button', { name: `Deselect ${name}` })).toBeVisible({ timeout: 8_000 });
}

async function markersInModule(page, moduleId) {
  return page.evaluate((id) => {
    const all = window.__e2eSurveyMarkers?.get?.() || {};
    return Object.entries(all)
      .filter(([, marker]) => marker.moduleId === id)
      .map(([mid, marker]) => ({
        id: mid,
        name: marker.name,
        moduleId: marker.moduleId,
        categoryId: marker.categoryId,
      }));
  }, moduleId);
}

async function closeSpacePicker(page) {
  const heading = spacePicker(page);
  await expect(heading).toBeVisible({ timeout: 8_000 });
  await heading.locator('..').getByRole('button').click();
  await expect(spacePicker(page)).toHaveCount(0, { timeout: 8_000 });
}

test('survey-rail item Copy → space selection intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerA = await placeMarker(page, 'copy-a', { x0: 0.22, y0: 0.34, x1: 0.46, y1: 0.54 });
  expect((await markerIds(page)).includes(markerA), 'source placed').toBe(true);

  await enterItemSelectMode(page);

  // Break: none selected — Copy is present and disabled.
  await expect(itemCopyBtn(page)).toBeVisible();
  await expect(itemCopyBtn(page)).toBeDisabled();
  expect((await markersInModule(page, DEST_MODULE)).length, 'disabled Copy writes nothing').toBe(0);

  await selectRailItem(page, 'copy-a');
  await expect(itemCopyBtn(page)).toBeEnabled();

  // Break: cancel space picker — no dest copy.
  await itemCopyBtn(page).click();
  await expect(spacePicker(page)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('No spaces available in any template.')).toHaveCount(0);
  await expect(destSpaceBtn(page, 'Two Category Survey')).toBeVisible();
  await expect(destSpaceBtn(page, 'Other Survey Data').first()).toBeVisible();
  await expect(destSpaceBtn(page, 'Empty Survey Data')).toBeVisible();
  await closeSpacePicker(page);
  expect((await markersInModule(page, SOURCE_MODULE)).map((row) => row.id), 'cancel keeps source').toEqual([markerA]);
  expect((await markersInModule(page, DEST_MODULE)).length, 'cancel writes no dest').toBe(0);

  // Break: dest without Walls (Other) — toast, no copy.
  await expect(itemCopyBtn(page)).toBeEnabled();
  await itemCopyBtn(page).click();
  await expect(spacePicker(page)).toBeVisible({ timeout: 8_000 });
  await destSpaceBtn(page, 'Other Survey Data').first().click();
  await expect(page.getByRole('status').filter({ hasText: /don't exist in the destination space/ })).toBeVisible({ timeout: 8_000 });
  await expect(spacePicker(page)).toBeVisible();
  expect((await markersInModule(page, DEST_MODULE)).length, 'missing-category dest writes nothing').toBe(0);
  expect((await markersInModule(page, SOURCE_MODULE)).map((row) => row.id)).toEqual([markerA]);
  await closeSpacePicker(page);

  // Intended: pick Two Category Survey (has Walls) — dest copy exists; source stays.
  await itemCopyBtn(page).click();
  await expect(spacePicker(page)).toBeVisible({ timeout: 8_000 });
  await destSpaceBtn(page, 'Two Category Survey').click();
  await expect(spacePicker(page)).toHaveCount(0, { timeout: 8_000 });
  let destCopy = null;
  await expect.poll(async () => {
    const dest = await markersInModule(page, DEST_MODULE);
    destCopy = dest.find((row) => row.name === 'copy-a' && row.id !== markerA) || null;
    return destCopy;
  }, { message: 'expected dest copy of copy-a' }).not.toBeNull();
  expect(destCopy.categoryId, 'dest Walls category').toBe(DEST_WALLS);
  expect((await markersInModule(page, SOURCE_MODULE)).map((row) => row.id), 'source stays').toEqual([markerA]);
  expect((await markerIds(page)).includes(destCopy.id), 'dest overlay shows the copy').toBe(true);
  expect((await markerIds(page)).includes(markerA), 'source overlay hidden after dest switch').toBe(false);

  // Edge: undo drops the dest copy; source stays in the source module.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await expect.poll(async () => ({
    dest: (await markersInModule(page, DEST_MODULE)).length,
    source: (await markersInModule(page, SOURCE_MODULE)).map((row) => row.id),
    overlayDest: (await markerIds(page)).includes(destCopy.id),
  }), { message: 'undo drops dest copy and keeps source' }).toEqual({
    dest: 0,
    source: [markerA],
    overlayDest: false,
  });

  // Break: Pen-armed still copies via the rail. Stay on Two Category
  // (Survey-tool click after the dest switch opens Home). Place on dest
  // Walls, arm Pen, then Copy back to Existing (has Walls).
  const destWalls = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  if (await destWalls.count() && await destWalls.first().isVisible().catch(() => false)) {
    if (!String(await destWalls.first().getAttribute('class') || '').includes('btn-active')) {
      await destWalls.first().click();
    }
  } else {
    await page.getByRole('button', { name: /^Walls/ }).first().click();
  }
  const beforePen = new Set(await markerIds(page));
  await dragOnLayer(page, { x0: 0.28, y0: 0.58, x1: 0.50, y1: 0.76 });
  await finishMarkerName(page, 'copy-pen');
  let penId = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    penId = ids.find((id) => !beforePen.has(id)) || null;
    return penId;
  }, { message: 'expected Pen-armed dest Walls place' }).not.toBeNull();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await enterItemSelectMode(page);
  await selectRailItem(page, 'copy-pen');
  await itemCopyBtn(page).click();
  await expect(spacePicker(page)).toBeVisible({ timeout: 8_000 });
  await destSpaceBtn(page, 'Existing Survey Data').first().click();
  await expect.poll(async () => {
    const src = await markersInModule(page, SOURCE_MODULE);
    return src.some((row) => row.name === 'copy-pen' && row.id !== penId) && src.some((row) => row.id === markerA);
  }, { message: 'Pen-armed Copy writes Existing and keeps source' }).toBe(true);

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — item Select / Copy toolbar is desktop-only.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: KAL436 }).click();
  const mobile = {
    itemToolbar: await page.locator('[aria-label="Item selection actions"]').count(),
    copyBtn: await page.getByRole('button', { name: 'Copy', exact: true }).count(),
    spacePicker: await page.getByRole('heading', { name: 'Select space' }).count(),
  };
  expect(mobile.itemToolbar, '390 has no item Copy toolbar').toBe(0);
  expect(mobile.copyBtn, '390 has no item Copy').toBe(0);
  expect(mobile.spacePicker, '390 does not open space picker').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_ITEM_COPY_SPACE_PROOF', JSON.stringify({
    sourceId: markerA,
    destModule: DEST_MODULE,
    destCategory: DEST_WALLS,
    cancelKeptSource: true,
    missingCategoryBlocked: true,
    intendedDestCopy: true,
    undoDroppedDest: true,
    penArmedCopied: true,
    persist,
    mobile,
  }));
});
