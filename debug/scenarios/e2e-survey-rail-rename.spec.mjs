import { test, expect } from '@playwright/test';

// Unique leftover after survey-rail Delete selected items:
// rail `aria-label={`Rename ${name}`}` → commitSurveyMarkerName.
// Not overlay Delete. Not rail Delete. Not E-04 rect. Not counter-series
// Delete. Not Keep / notes / module nav as the GAP (notes only as a
// rename-blur conflict). UL-31 Continue pin stays parked.
// Leftover-18 parked. No file.id.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

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

function renameField(page, name) {
  return page.getByRole('textbox', { name: `Rename ${name}` });
}

function desktopRenameInputs(page) {
  return rightRail(page).locator('input.survey-marker-name-inline');
}

function mobileDetailRename(page) {
  return page.locator('input.mobile-survey-detail-name');
}

async function markerRenameSnapshot(page, name) {
  const field = renameField(page, name).first();
  if (!(await field.count()) || !(await field.isVisible().catch(() => false))) {
    return { present: false, name };
  }
  return {
    present: true,
    name,
    ariaLabel: await field.getAttribute('aria-label'),
    value: await field.inputValue(),
    dataValue: await field.evaluate((el) => el.parentElement?.dataset?.value || ''),
  };
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
  if (await desktopRenameInputs(page).count()) return;
  const notes = page.getByRole('button', { name: /item notes/ });
  if (await notes.count() && await notes.first().isVisible().catch(() => false)) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
  await expect(desktopRenameInputs(page).first()).toBeVisible({ timeout: 8_000 });
}

async function commitRenameEnter(page, fromName, toName, expectedName = toName) {
  const field = renameField(page, fromName);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(toName);
  await field.press('Enter');
  await expect(renameField(page, expectedName)).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, expectedName)).toHaveValue(expectedName);
}

async function commitRenameBlur(page, fromName, toName, blurWith) {
  const field = renameField(page, fromName);
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.click();
  await field.fill(toName);
  await blurWith.click();
  await expect(renameField(page, toName)).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, toName)).toHaveValue(toName);
}

test('survey-rail Rename intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  // Break: rename with none selected / none placed — no marker rename field.
  expect(await desktopRenameInputs(page).count(), 'no marker rename before place').toBe(0);
  expect(await renameField(page, 'rail-a').count(), 'no Rename rail-a before place').toBe(0);

  const markerA = await placeMarker(page, 'rail-a', { x0: 0.22, y0: 0.34, x1: 0.46, y1: 0.54 });
  const markerB = await placeMarker(page, 'rail-b', { x0: 0.56, y0: 0.28, x1: 0.78, y1: 0.46 });
  expect((await markerIds(page)).length, 'A+B placed').toBe(2);

  await expandWallsMarkers(page);
  await expect(renameField(page, 'rail-a')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'rail-b')).toBeVisible({ timeout: 8_000 });

  // Break: none selected (not in item Select) — per-row field still commits.
  expect(await page.getByRole('button', { name: 'Delete selected items' }).count(), 'not in item Select').toBe(0);

  // Intended: Enter commits stored name + rail label.
  await commitRenameEnter(page, 'rail-a', 'renamed-a');
  const afterEnter = await markerRenameSnapshot(page, 'renamed-a');
  expect(afterEnter.present, 'Enter remounts Rename renamed-a').toBe(true);
  expect(afterEnter.ariaLabel).toBe('Rename renamed-a');
  expect(afterEnter.value).toBe('renamed-a');
  expect(afterEnter.dataValue).toBe('renamed-a');
  const otherAfterEnter = await markerRenameSnapshot(page, 'rail-b');
  expect(otherAfterEnter.value, 'B unchanged after A Enter').toBe('rail-b');

  // Intended: blur commits (click the other field).
  await commitRenameBlur(page, 'renamed-a', 'renamed-blur', renameField(page, 'rail-b'));
  const afterBlur = await markerRenameSnapshot(page, 'renamed-blur');
  expect(afterBlur.ariaLabel).toBe('Rename renamed-blur');
  expect(afterBlur.value).toBe('renamed-blur');
  expect((await markerRenameSnapshot(page, 'rail-b')).value, 'B unchanged after A blur').toBe('rail-b');

  // Break: Escape restores the previous name and does not commit.
  const escapeField = renameField(page, 'rail-b');
  await escapeField.click();
  await escapeField.fill('escaped-nope');
  await escapeField.press('Escape');
  await expect(renameField(page, 'rail-b')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'rail-b')).toHaveValue('rail-b');
  expect(await renameField(page, 'escaped-nope').count(), 'Escape does not commit').toBe(0);

  // Break: empty name falls back to Walls N (index in the category list),
  // not rejected and not left blank.
  const emptyField = renameField(page, 'renamed-blur');
  await emptyField.click();
  await emptyField.fill('');
  await emptyField.press('Enter');
  let emptyFallback = null;
  await expect.poll(async () => {
    const rows = await desktopRenameInputs(page).evaluateAll((nodes) => nodes.map((node) => ({
      aria: node.getAttribute('aria-label') || '',
      value: node.value,
    })));
    const hit = rows.find((row) => /^Rename Walls \d+$/.test(row.aria));
    emptyFallback = hit?.value || null;
    return emptyFallback;
  }, { message: 'empty name remounts as Rename Walls N' }).toBeTruthy();
  const emptySnap = await markerRenameSnapshot(page, emptyFallback);
  expect(emptySnap.present, `empty commits fallback ${emptyFallback}`).toBe(true);
  expect(emptySnap.value).toBe(emptyFallback);
  expect(emptySnap.ariaLabel).toBe(`Rename ${emptyFallback}`);
  expect((await markerRenameSnapshot(page, 'rail-b')).value, 'B unchanged after empty fallback').toBe('rail-b');

  // Edge: Pen-armed still commits when the field is focused.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await commitRenameEnter(page, emptyFallback, 'pen-renamed');
  expect((await markerRenameSnapshot(page, 'pen-renamed')).value).toBe('pen-renamed');
  expect((await markerRenameSnapshot(page, 'rail-b')).value, 'B unchanged after Pen-armed rename').toBe('rail-b');

  // Notes only as rename-blur conflict: clicking notes blurs and commits.
  const notesBtn = page.getByRole('button', { name: 'Add item notes' }).first();
  await expect(notesBtn).toBeVisible({ timeout: 8_000 });
  const notesField = renameField(page, 'pen-renamed');
  await notesField.click();
  await notesField.fill('notes-commit');
  await notesBtn.click();
  await expect(renameField(page, 'notes-commit')).toBeVisible({ timeout: 8_000 });
  expect((await markerRenameSnapshot(page, 'notes-commit')).value).toBe('notes-commit');
  if (await page.getByRole('heading', { name: 'Note', exact: true }).count()) {
    const notesCancel = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await notesCancel.count()) await notesCancel.click();
  }
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toHaveCount(0);
  expect((await markerRenameSnapshot(page, 'rail-b')).value, 'B unchanged after notes-blur commit').toBe('rail-b');

  // Break: duplicate name is allowed (product does not reject).
  const dupSource = renameField(page, 'notes-commit');
  await expect(dupSource).toBeVisible({ timeout: 8_000 });
  await dupSource.click();
  await dupSource.fill('rail-b');
  await dupSource.press('Enter');
  await expect(renameField(page, 'rail-b')).toHaveCount(2, { timeout: 8_000 });
  const dupValues = await renameField(page, 'rail-b').evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(dupValues, 'both rows store rail-b').toEqual(['rail-b', 'rail-b']);

  // Edge: undo after a further unique rename. Product has no rename checkpoint
  // in commitSurveyMarkerName — record whether Z restores the name or pops
  // the last place/bounds checkpoint.
  const undoSource = renameField(page, 'rail-b').first();
  await undoSource.click();
  await undoSource.fill('after-undo');
  await undoSource.press('Enter');
  await expect(renameField(page, 'after-undo')).toHaveCount(1, { timeout: 8_000 });
  await page.evaluate(() => document.activeElement?.blur?.());
  const idsBeforeUndo = await markerIds(page);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const idsAfterUndo = await markerIds(page);
  const undoNameAfter = (await renameField(page, 'after-undo').count())
    ? 'after-undo'
    : (await renameField(page, 'rail-b').count())
      ? 'rail-b'
      : (await desktopRenameInputs(page).evaluateAll((nodes) => nodes.map((node) => node.value)));
  const undoProof = {
    idsBefore: idsBeforeUndo,
    idsAfter: idsAfterUndo,
    markerAStill: idsAfterUndo.includes(markerA),
    markerBStill: idsAfterUndo.includes(markerB),
    undoNameAfter,
    nameRestored: undoNameAfter === 'rail-b' && idsAfterUndo.includes(markerA),
  };

  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — desktop inline rename is `!mobileMode`. Mobile detail field
  // exists only after a placed marker is opened.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  await walls390.evaluate((el) => el.click());
  const mobile = {
    desktopInlineCount: await desktopRenameInputs(page).count(),
    mobileDetailCount: await mobileDetailRename(page).count(),
    renameRailA: await renameField(page, 'rail-a').count(),
    openRowCount: await page.getByRole('button', { name: /^Open / }).count(),
  };
  expect(mobile.desktopInlineCount, '390 list has no desktop inline rename').toBe(0);
  await assertNoErrorBoundary(page);

  console.log('SURVEY_RAIL_RENAME_PROOF', JSON.stringify({
    markerA,
    markerB,
    afterEnter,
    afterBlur,
    emptySnap,
    undoProof,
    persist,
    mobile,
  }));
});
