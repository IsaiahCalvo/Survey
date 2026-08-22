import { test, expect } from '@playwright/test';

// 390 checklist Y/N/N-A is parked: no compiled-in / surveyTransitionE2E
// template has items, and there is no DEV seed hook for them.
// Next unique leftover: notes Photo/Video attach
// (desktop "Upload photos" / "Upload videos" + 390 Photo / Video).
// Distinct from text notes Save/Cancel (already proven).
// Not leftover-18 unplaced-rows. Not category Move/Copy stub.
// UL-31 Continue pin stays parked. No file.id.
// Place on desktop (sheet backdrop intercepts 390 place clicks),
// then prove desktop attach and 390 attach.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const KAL436 = /KAL-436 Preservation Template/;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
  await expect.poll(() => page.evaluate(() => typeof window.__e2eSurveyMarkers?.get), {
    timeout: 10_000,
    message: 'DEV survey-marker seam',
  }).toBe('function');
}

async function storedNote(page, id) {
  return page.evaluate((annoId) => window.__e2eSurveyMarkers?.get()?.[annoId]?.note || null, id);
}

async function expandWallsMarkers(page) {
  const notes = page.getByRole('button', { name: /item notes/ });
  if (await notes.count() && await notes.first().isVisible().catch(() => false)) return;
  const arrow = rightRail(page).locator('.survey-marker-category-arrow').first();
  await expect(arrow).toBeVisible({ timeout: 10_000 });
  await arrow.click();
  await expect(page.getByRole('button', { name: /item notes/ }).first()).toBeVisible({ timeout: 8_000 });
}

async function openDesktopNotes(page, { edit = false } = {}) {
  await expandWallsMarkers(page);
  const btn = edit
    ? page.getByRole('button', { name: 'Edit item notes' }).first()
    : page.getByRole('button', { name: /item notes/ }).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  await btn.click({ force: true });
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible({ timeout: 8_000 });
}

function desktopPhotoInput(page, id) {
  return page.locator(`#photo-upload-${id}`);
}

function desktopVideoInput(page, id) {
  return page.locator(`#video-upload-${id}`);
}

async function attachDesktopPhoto(page, id, name = 'e2e-note.png') {
  await desktopPhotoInput(page, id).setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 8_000 });
}

async function attachDesktopVideo(page, id, name = 'e2e-note.webm') {
  await desktopVideoInput(page, id).setInputFiles({
    name,
    mimeType: 'video/webm',
    buffer: PNG_1X1,
  });
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 8_000 });
}

async function saveDesktopNotes(page) {
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((el) => (el.textContent || '').trim() === 'Note');
    const dialog = heading?.parentElement?.parentElement;
    const save = [...(dialog?.querySelectorAll('button') || [])].find((el) => (el.textContent || '').trim() === 'Save');
    if (!save) throw new Error('Note dialog Save missing');
    save.click();
  });
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toHaveCount(0, { timeout: 8_000 });
}

async function cancelDesktopNotes(page) {
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toHaveCount(0, { timeout: 8_000 });
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

function detailName(page, name) {
  return page.getByRole('textbox', { name: `Rename ${name}` });
}

async function open390Detail(page, name) {
  await openSurveySheet(page);
  if (await detailName(page, name).count()) {
    await expect(detailName(page, name)).toBeVisible({ timeout: 8_000 });
    return;
  }
  const openRow = page.getByRole('button', { name: `Open ${name}` });
  if (!(await openRow.count())) {
    const arrow = page.locator('.survey-marker-category-arrow').first();
    await expect(arrow).toBeVisible({ timeout: 10_000 });
    await arrow.evaluate((el) => el.click());
  }
  await expect(openRow).toBeVisible({ timeout: 10_000 });
  await openRow.evaluate((el) => el.click());
  await expect(detailName(page, name)).toBeVisible({ timeout: 8_000 });
}

async function open390Notes(page) {
  const add = page.getByRole('button', { name: /Survey Marker notes/ });
  await expect(add).toBeVisible({ timeout: 8_000 });
  await add.evaluate((el) => el.click());
  await expect(page.getByRole('textbox', { name: 'Survey Marker notes' })).toBeVisible({ timeout: 8_000 });
}

async function attach390Photo(page, id, name = 'e2e-390.png') {
  await page.locator(`#mobile-note-photos-${id}`).setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible({ timeout: 8_000 });
}

async function save390Notes(page) {
  await page.locator('.mobile-survey-notes-save').evaluate((el) => el.click());
  await expect(page.getByRole('textbox', { name: 'Survey Marker notes' })).toHaveCount(0, { timeout: 8_000 });
}

test('notes Photo/Video attach intended + break + edge; checklist stays parked', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await enterSurveyWalls(page);
  const keep = keepCheckbox(page);
  await expect(keep).toBeVisible({ timeout: 8_000 });
  if (!(await keep.isChecked())) await keep.click();
  await expect(keep).toBeChecked();

  const markerA = await placeMarker(page, 'attach-a', {
    x0: 0.20, y0: 0.32, x1: 0.42, y1: 0.50, pageNumber: 1,
  });
  const markerB = await placeMarker(page, 'attach-b', {
    x0: 0.52, y0: 0.34, x1: 0.74, y1: 0.52, pageNumber: 1,
  });
  expect(markerA).toBeTruthy();
  expect(markerB).toBeTruthy();
  await waitSurveyMarkerSeam(page);

  await expandWallsMarkers(page);
  await expect(page.getByText('No checklist items')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Y$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^N\/A$/ })).toHaveCount(0);

  await openDesktopNotes(page);
  await expect(page.getByText('Upload photos', { exact: true })).toBeVisible();
  await expect(page.getByText('Upload videos', { exact: true })).toBeVisible();

  // Break: Cancel after a draft attach writes nothing.
  await attachDesktopPhoto(page, markerA, 'draft-should-die.png');
  await cancelDesktopNotes(page);
  expect((await storedNote(page, markerA))?.photos || []).toEqual([]);

  // Break: empty dialog Save writes empty arrays, not a phantom file.
  await openDesktopNotes(page);
  await saveDesktopNotes(page);
  const emptyNote = await storedNote(page, markerA);
  expect(emptyNote?.photos || []).toEqual([]);
  expect(emptyNote?.videos || []).toEqual([]);

  // Intended: photo + video persist on A; B stays empty.
  // Attachments-only Save must flip the chrome to Edit (not stay Add).
  await openDesktopNotes(page);
  await attachDesktopPhoto(page, markerA, 'keep-photo.png');
  await attachDesktopVideo(page, markerA, 'keep-video.webm');
  await saveDesktopNotes(page);
  await expect.poll(async () => (await storedNote(page, markerA))?.photos?.[0]?.name).toBe('keep-photo.png');
  expect((await storedNote(page, markerA))?.videos?.[0]?.name).toBe('keep-video.webm');
  expect((await storedNote(page, markerA))?.photos?.[0]?.dataUrl || '').toMatch(/^data:image\/png;base64,/);
  expect((await storedNote(page, markerB))?.photos || []).toEqual([]);
  await expect(page.getByRole('button', { name: 'Edit item notes' }).first()).toBeVisible();

  // Break: remove before Save drops the draft photo.
  await openDesktopNotes(page, { edit: true });
  await expect(page.getByText('keep-photo.png', { exact: true })).toBeVisible();
  await attachDesktopPhoto(page, markerA, 'remove-me.png');
  const removeDraft = page.getByText('remove-me.png', { exact: true }).locator('..').locator('button');
  await removeDraft.click();
  await expect(page.getByText('remove-me.png', { exact: true })).toHaveCount(0);
  await saveDesktopNotes(page);
  await expect.poll(async () => ((await storedNote(page, markerA))?.photos || []).map((photo) => photo.name)).toEqual([
    'keep-photo.png',
  ]);

  // Break: Pen-armed still attaches.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await openDesktopNotes(page, { edit: true });
  await attachDesktopPhoto(page, markerA, 'pen-armed.png');
  await saveDesktopNotes(page);
  await expect.poll(async () => ((await storedNote(page, markerA))?.photos || []).map((photo) => photo.name)).toEqual([
    'keep-photo.png',
    'pen-armed.png',
  ]);
  expect(await markerIds(page)).toEqual(expect.arrayContaining([markerA, markerB]));

  // Edge: notes have no history checkpoint. Ctrl+Z rewinds the last place
  // (B) and restores the pre-note snapshot of A.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await markerIds(page)).includes(markerB)).toBe(false);
  await expect.poll(async () => ((await storedNote(page, markerA))?.photos || []).length).toBe(0);
  expect((await storedNote(page, markerA))?.videos || []).toEqual([]);

  await openDesktopNotes(page);
  await attachDesktopPhoto(page, markerA, 'keep-photo.png');
  await attachDesktopVideo(page, markerA, 'keep-video.webm');
  await saveDesktopNotes(page);
  await expect.poll(async () => (await storedNote(page, markerA))?.photos?.[0]?.name).toBe('keep-photo.png');
  await expect(page.getByRole('button', { name: 'Edit item notes' }).first()).toBeVisible();

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);

  // 390: same chrome. Checklist empty-state is visible; Photo/Video attach works.
  await switchTo390(page);
  await open390Detail(page, 'attach-a');
  await expect(page.getByText('No checklist items')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Y$/ })).toHaveCount(0);
  await expect.poll(async () => (await storedNote(page, markerA))?.photos?.[0]?.name).toBe('keep-photo.png');
  await expect(page.getByRole('button', { name: /Survey Marker notes/ })).toBeVisible();
  await open390Notes(page);
  await expect(page.getByText('Photo', { exact: true })).toBeVisible();
  await expect(page.getByText('Video', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove keep-photo.png' })).toBeVisible();
  await attach390Photo(page, markerA, 'mobile-extra.png');
  await save390Notes(page);
  await expect.poll(async () => ((await storedNote(page, markerA))?.photos || []).map((photo) => photo.name)).toEqual([
    'keep-photo.png',
    'mobile-extra.png',
  ]);

  await open390Notes(page);
  await page.getByRole('button', { name: 'Remove mobile-extra.png' }).evaluate((el) => el.click());
  await expect(page.getByRole('button', { name: 'Remove mobile-extra.png' })).toHaveCount(0);
  await page.locator('.mobile-survey-notes-cancel').evaluate((el) => el.click());
  await expect.poll(async () => ((await storedNote(page, markerA))?.photos || []).map((photo) => photo.name)).toEqual([
    'keep-photo.png',
    'mobile-extra.png',
  ]);

  await assertNoErrorBoundary(page);
  expect(persist, 'no file.id').toBeNull();

  await page.evaluate((receipt) => {
    window.__SURVEY_CHECKLIST_OR_NEXT_PROOF = receipt;
  }, {
    persist,
    checklistButtons: 0,
    desktop: { photos: ['keep-photo.png', 'pen-armed.png'], videos: ['keep-video.webm'] },
    mobile: { photos: ['keep-photo.png', 'pen-armed.png', 'mobile-extra.png'] },
    parked: '390 checklist Y/N/N-A — no compiled-in template items',
  });
});
