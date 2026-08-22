import { test, expect } from '@playwright/test';

// Unique leftover after placed survey-marker handle drag:
// overlay delete chrome (`aria-label="Delete Survey Marker"`) +
// Select-mode Backspace/Delete on a *placed* marker.
// Not E-04 rect Backspace. Not counter-series Delete. Not U-01 stamp.
// Not handle drag. UL-31 Continue pin stays parked. Leftover-18 parked.
// No file.id.

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

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  const parts = String(raw || '0 0 612 792').trim().split(/\s+/).map(Number);
  return { raw, W: parts[2] || 612, H: parts[3] || 792 };
}

async function selectMode(page) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('v');
  const menu = page.locator('[data-select-mode-menu="true"]');
  if (await menu.count()) {
    await page.keyboard.press('Escape');
  }
}

function keepCheckbox(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

function deleteChrome(page) {
  return page.locator('[aria-label="Delete Survey Marker"]');
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

async function markerGeom(page, id) {
  return page.evaluate((annoId) => {
    const group = document.querySelector(`[data-survey-marker-id="${annoId}"]`);
    const rect = group?.querySelector('rect:not([data-survey-marker-hit-target])')
      || group?.querySelector('rect');
    return {
      id: annoId,
      present: !!group,
      x: Number(rect?.getAttribute('x')),
      y: Number(rect?.getAttribute('y')),
      width: Number(rect?.getAttribute('width')),
      height: Number(rect?.getAttribute('height')),
    };
  }, id);
}

async function selectUntilDeleteChrome(page, id) {
  await selectMode(page);
  await expect.poll(async () => {
    const geom = await markerGeom(page, id);
    const hit = page.locator(`[data-survey-marker-id="${id}"] [data-survey-marker-hit-target="true"]`).first();
    if (await hit.count()) {
      await hit.click({ force: true });
    } else if (geom.present) {
      const box = await pageBox(page);
      const { W, H } = await pageViewBox(page);
      await page.mouse.click(
        box.x + ((geom.x + geom.width / 2) / W) * box.width,
        box.y + ((geom.y + geom.height / 2) / H) * box.height,
      );
    }
    return deleteChrome(page).count();
  }, { timeout: 12_000 }).toBeGreaterThan(0);
  // SVG <g role="button"> has no CSS box; Playwright marks it hidden even
  // when the painted rect is on-page. Presence + a client rect is enough.
  await expect(deleteChrome(page)).toHaveCount(1);
}

async function clickDeleteChrome(page) {
  const chrome = deleteChrome(page).first();
  await expect(chrome).toHaveCount(1);
  const box = await chrome.boundingBox();
  if (box && box.width > 2 && box.height > 2) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return;
  }
  await chrome.dispatchEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
  });
}

async function clickEmpty(page) {
  const box = await pageBox(page);
  await page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.08);
}

async function expandWallsMarkers(page) {
  const notes = page.getByRole('button', { name: /item notes/ });
  if (await notes.count() && await notes.first().isVisible().catch(() => false)) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
  await expect(page.getByRole('button', { name: /item notes/ }).first()).toBeVisible({ timeout: 8_000 });
}

async function openItemNotes(page, label = /item notes/) {
  await expandWallsMarkers(page);
  const btn = page.getByRole('button', { name: label }).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  await btn.click({ force: true });
}

test('survey-marker delete chrome intended + break + edge', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerA = await placeMarker(page, 'delete-a', { x0: 0.24, y0: 0.36, x1: 0.48, y1: 0.56 });
  const markerB = await placeMarker(page, 'delete-b', { x0: 0.58, y0: 0.30, x1: 0.78, y1: 0.48 });
  expect((await markerIds(page)).length, 'A+B placed').toBe(2);

  // Break: none selected — overlay Delete is hidden; keys are a no-op.
  await selectMode(page);
  await clickEmpty(page);
  expect(await deleteChrome(page).count(), 'none selected hides Delete').toBe(0);
  const noneCount = (await markerIds(page)).length;
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  expect((await markerIds(page)).length, 'keys with none selected no-op').toBe(noneCount);

  // Intended: click Delete Survey Marker removes the selected marker.
  await selectUntilDeleteChrome(page, markerA);
  expect(await page.locator('[data-handle]').count(), 'no vertex-N seam').toBe(0);
  expect(await page.locator('[data-counter-nubbin-handle]').count(), 'nubbin untouched').toBe(0);
  await clickDeleteChrome(page);
  await expect.poll(async () => (await markerIds(page)).includes(markerA), {
    timeout: 8_000,
    message: 'Delete chrome removes marker A',
  }).toBe(false);
  expect((await markerIds(page)).includes(markerB), 'B stays after A chrome-delete').toBe(true);
  expect(await deleteChrome(page).count(), 'chrome hides after delete').toBe(0);

  // Undo restores A.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerA), {
    timeout: 8_000,
    message: 'undo restores chrome-deleted A',
  }).toBe(true);

  // Intended: Select-mode Backspace removes the selected marker.
  await selectUntilDeleteChrome(page, markerA);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await markerIds(page)).includes(markerA), {
    timeout: 8_000,
    message: 'Backspace removes selected marker A',
  }).toBe(false);
  expect((await markerIds(page)).includes(markerB), 'B stays after Backspace').toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerA)).toBe(true);

  // Intended: Select-mode Delete key removes the selected marker.
  await selectUntilDeleteChrome(page, markerA);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await markerIds(page)).includes(markerA), {
    timeout: 8_000,
    message: 'Delete key removes selected marker A',
  }).toBe(false);
  expect((await markerIds(page)).includes(markerB), 'B stays after Delete key').toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerA)).toBe(true);

  // Break: Pen-armed hides overlay Delete (selection cleared on tool leave).
  await selectUntilDeleteChrome(page, markerA);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('p');
  await expect.poll(async () => deleteChrome(page).count(), {
    timeout: 8_000,
    message: 'Pen-armed hides Delete chrome',
  }).toBe(0);
  expect((await markerIds(page)).includes(markerA), 'Pen-armed does not delete').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'Pen-armed leaves B').toBe(true);
  await selectMode(page);

  // Break: notes dialog focused — Backspace/Delete edit the draft, not the marker.
  await selectUntilDeleteChrome(page, markerA);
  await openItemNotes(page, 'Add item notes');
  const notesField = page.getByPlaceholder('Enter your notes...');
  await expect(notesField).toBeVisible({ timeout: 8_000 });
  await notesField.click();
  await notesField.fill('HELLO');
  await notesField.press('Backspace');
  await expect(notesField).toHaveValue('HELL');
  await notesField.press('Delete');
  await expect(notesField).toHaveValue('HELL');
  expect((await markerIds(page)).includes(markerA), 'notes Backspace does not eat marker').toBe(true);
  expect((await markerIds(page)).includes(markerB), 'notes keys leave B').toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toHaveCount(0);

  // Edge: zoom then overlay Delete still uses viewBox page-space.
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const viewBox = (await pageViewBox(page)).raw;
  expect(viewBox.startsWith('0 0 '), 'viewBox owns scale').toBe(true);
  await selectUntilDeleteChrome(page, markerB);
  await clickDeleteChrome(page);
  await expect.poll(async () => (await markerIds(page)).includes(markerB), {
    timeout: 8_000,
    message: 'zoom then Delete chrome removes B',
  }).toBe(false);
  expect((await markerIds(page)).includes(markerA), 'A stays after zoom-delete of B').toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerB)).toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 uses the same overlay Delete if a marker can be selected.
  // Sheet backdrop can eat Playwright mouse (same as handle-drag 390).
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const walls390 = page.getByRole('button', { name: /Walls/ }).first();
  await expect(walls390).toBeVisible({ timeout: 15_000 });
  await walls390.evaluate((el) => el.click());
  const before390 = new Set(await markerIds(page));
  await page.locator('[data-svg-annotation-layer="1"]').evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    const fire = (type, x, y, buttons) => {
      svg.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        buttons,
        button: 0,
      }));
    };
    const x0 = rect.x + rect.width * 0.24;
    const y0 = rect.y + rect.height * 0.22;
    const x1 = rect.x + rect.width * 0.62;
    const y1 = rect.y + rect.height * 0.40;
    fire('pointerdown', x0, y0, 1);
    fire('pointermove', (x0 + x1) / 2, (y0 + y1) / 2, 1);
    fire('pointermove', x1, y1, 1);
    fire('pointerup', x1, y1, 0);
  });
  if (await page.getByPlaceholder('Enter name').count()) {
    await finishMarkerName(page, 'delete-390');
  }
  const mobileId = (await markerIds(page)).find((id) => !before390.has(id)) || null;
  const mobile = {
    placed: !!mobileId,
    deleteVisible: 0,
    deleted: false,
  };
  if (mobileId) {
    await selectUntilDeleteChrome(page, mobileId);
    mobile.deleteVisible = await deleteChrome(page).count();
    expect(mobile.deleteVisible, '390 same overlay Delete').toBeGreaterThan(0);
    await clickDeleteChrome(page);
    await expect.poll(async () => (await markerIds(page)).includes(mobileId)).toBe(false);
    mobile.deleted = true;
  }
  await assertNoErrorBoundary(page);

  console.log('SURVEY_MARKER_DELETE_PROOF', JSON.stringify({
    markerA,
    markerB,
    mobileId,
    noneSelectedHidden: true,
    chromeDeletedA: true,
    backspaceDeletedA: true,
    deleteKeyDeletedA: true,
    penArmedHidden: true,
    notesKeptText: 'HELL',
    notesDidNotEatMarker: true,
    secondStayed: true,
    viewBox,
    mobile,
  }));
});
