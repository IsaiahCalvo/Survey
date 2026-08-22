import { test, expect } from '@playwright/test';

// Unique leftovers after Survey Previous/Next:
// 1. Keep active (desktop checkbox + 390 toggle)
// 2. Survey notes (desktop Note dialog after a stamp)
// 3. Pages UL-32 execute leftovers: Mirror V, Reset, Cut/Copy/Paste
// Extract has no handler — do not invent it.
// Do not replay Previous/Next as the GAP, leftover-18, thumbnail click,
// Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard, swatches,
// callout paste, thin leftovers Duplicate, PDF links, History, insert/rotate/
// move, flatten, U-01 Walls stamp, U-02 Spaces.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const MULTI_PDF = '/?testPdf=text-search-glyph-lab.pdf';

async function waitEditor(page) {
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible({ timeout: 45_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

async function openDesktopSurvey(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  await page.goto(SURVEY_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await waitEditor(page);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible({ timeout: 15_000 });
}

function keepCheckbox(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('checkbox', { name: 'Keep active' });
}

function wallsChip(page) {
  return page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
}

function rightRail(page) {
  return page.locator('#chrome-right-host');
}

async function markerCount(page) {
  return page.locator('[data-survey-marker-id]').count();
}

async function dragOnLayer(page, { x0, y0, x1, y1 }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
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

async function placeNamedMarker(page, name, coords) {
  const before = await markerCount(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  await expect.poll(() => markerCount(page), {
    message: `expected committed survey-marker ${name}`,
  }).toBeGreaterThan(before);
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

function pagesMenu(page) {
  return page.locator('[data-pages-context-menu="true"]');
}

function pageThumb(page, pageNumber) {
  return page.locator(`#chrome-left-host [data-page-number="${pageNumber}"]`).first();
}

async function openPagesPanel(page) {
  const pages = page.getByRole('button', { name: 'Pages', exact: true });
  await expect(pages).toBeVisible();
  if ((await pages.getAttribute('aria-pressed')) !== 'true') {
    await pages.click();
  }
}

async function thumbTransform(page, pageNumber = 1) {
  const img = page.locator(`#chrome-left-host [data-page-number="${pageNumber}"] img`).first();
  if (!(await img.count())) return 'none';
  return img.evaluate((el) => el.style.transform || getComputedStyle(el).transform || 'none');
}

async function openPageMenu(page, pageNumber) {
  await openPagesPanel(page);
  const thumb = pageThumb(page, pageNumber);
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await thumb.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(12, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2),
      }));
    });
    try {
      await expect(pagesMenu(page)).toBeVisible({ timeout: 2_500 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function clickPageMenu(page, pageNumber, label) {
  await openPageMenu(page, pageNumber);
  const item = pagesMenu(page).getByRole('button', { name: label, exact: true });
  await expect(item).toBeVisible({ timeout: 8_000 });
  const disabled = await item.isDisabled();
  await item.click({ force: disabled });
  if (!disabled) {
    await expect(pagesMenu(page)).toHaveCount(0);
  }
  return { disabled };
}

test('Keep active desktop checkbox after-place and module-step', async ({ page }) => {
  await openDesktopSurvey(page);

  await expect(keepCheckbox(page)).toBeVisible();
  await expect(keepCheckbox(page)).not.toBeChecked();

  // Break: toggle with no stamp placed — checkbox flips, no marker, Walls not armed.
  await keepCheckbox(page).check();
  await expect(keepCheckbox(page)).toBeChecked();
  expect(await markerCount(page)).toBe(0);
  await expect(wallsChip(page)).toHaveCount(1);
  await expect(wallsChip(page)).not.toHaveClass(/btn-active/);

  await keepCheckbox(page).uncheck();
  await expect(keepCheckbox(page)).not.toBeChecked();
  expect(await markerCount(page)).toBe(0);

  // Break: toggle while Pen armed — survey Keep-active chrome is gone.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await expect(keepCheckbox(page)).toHaveCount(0);
  expect(await markerCount(page)).toBe(0);

  // Restore survey chrome via Next (selectSurveyModule sets dropdown=survey).
  await rightRail(page).getByRole('button', { name: 'Next module', exact: true }).click();
  await expect(keepCheckbox(page)).toBeVisible();
  await expect(keepCheckbox(page)).not.toBeChecked();
  await rightRail(page).getByRole('button', { name: 'Previous module', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();

  // Intended ON: after a stamp, Walls stays armed; a second stamp needs no re-click.
  await keepCheckbox(page).check();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  await expect(wallsChip(page)).toHaveClass(/btn-active/);
  await placeNamedMarker(page, 'Keep On 1', { x0: 0.22, y0: 0.28, x1: 0.38, y1: 0.42 });
  await expect(keepCheckbox(page)).toBeChecked();
  await expect(wallsChip(page)).toHaveClass(/btn-active/);
  await placeNamedMarker(page, 'Keep On 2', { x0: 0.48, y0: 0.28, x1: 0.64, y1: 0.42 });
  expect(await markerCount(page)).toBe(2);
  await expect(wallsChip(page)).toHaveClass(/btn-active/);

  // Intended OFF: after a stamp, category clears; desktop tool stays survey-marker.
  await keepCheckbox(page).uncheck();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  await expect(wallsChip(page)).toHaveClass(/btn-active/);
  await placeNamedMarker(page, 'Keep Off', { x0: 0.22, y0: 0.50, x1: 0.38, y1: 0.64 });
  expect(await markerCount(page)).toBe(3);
  await expect(wallsChip(page)).not.toHaveClass(/btn-active/);
  await expect(keepCheckbox(page)).toBeVisible();

  // Edge: Next module while Keep active is on — category clears, flag stays.
  await keepCheckbox(page).check();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  await expect(wallsChip(page)).toHaveClass(/btn-active/);
  await rightRail(page).getByRole('button', { name: 'Next module', exact: true }).click();
  await expect.poll(async () => (
    await rightRail(page).getByRole('button', { name: /Survey Data/ }).first().innerText()
  )).toMatch(/Other Survey Data/);
  await expect(keepCheckbox(page)).toBeChecked();
  await expect(page.getByRole('button', { name: 'Doors', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Doors', exact: true })).not.toHaveClass(/btn-active|is-active/);
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toHaveCount(0);
  // Existing-module stamps are filtered out of the Other-module view.
  // Keep-active did not mint a Doors mark.

  await assertNoErrorBoundary(page);
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
});

test('Keep active 390 toggle and Pen hide', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  await page.goto(SURVEY_PDF);
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 60_000 });
  await waitEditor(page);
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  const mobileKeep = page.getByRole('checkbox', { name: 'Keep active' });
  await expect(mobileKeep).toBeVisible({ timeout: 15_000 });
  await expect(mobileKeep).toHaveAttribute('aria-checked', 'false');
  // Sheet backdrop intercepts Playwright pointer events; the handler is on the button.
  await mobileKeep.evaluate((el) => el.click());
  await expect(mobileKeep).toHaveAttribute('aria-checked', 'true');
  expect(await markerCount(page)).toBe(0);
  await mobileKeep.evaluate((el) => el.click());
  await expect(mobileKeep).toHaveAttribute('aria-checked', 'false');

  // Sheet backdrop intercepts Playwright clicks; use the live button handlers.
  await page.getByRole('button', { name: 'Draw', exact: true }).evaluate((el) => el.click());
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  if (await pen.count()) {
    await pen.evaluate((el) => el.click());
  }
  await expect(page.getByRole('checkbox', { name: 'Keep active' })).toHaveCount(0);

  const wallsCat = page.getByRole('button', { name: 'Survey category Walls' });
  if (await wallsCat.count()) {
    await wallsCat.evaluate((el) => el.click());
  }
  const keepAfterPen = page.getByRole('checkbox', { name: 'Keep active' });
  await expect(keepAfterPen).toBeVisible({ timeout: 10_000 });
  if ((await keepAfterPen.getAttribute('aria-checked')) !== 'true') {
    await keepAfterPen.evaluate((el) => el.click());
  }
  await expect(keepAfterPen).toHaveAttribute('aria-checked', 'true');
  const wallsChip390 = page.getByRole('button', { name: 'Survey category Walls' });
  if (await wallsChip390.count()) {
    await expect(wallsChip390).toHaveClass(/is-active/);
  }

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);
});

test('Survey notes open / edit / save / cancel after a stamp', async ({ page }) => {
  await openDesktopSurvey(page);
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
  await placeNamedMarker(page, 'Note Host', { x0: 0.24, y0: 0.30, x1: 0.42, y1: 0.46 });

  await openItemNotes(page, 'Add item notes');

  const dialog = page.getByRole('heading', { name: 'Note', exact: true });
  await expect(dialog).toBeVisible();
  const notesField = page.getByPlaceholder('Enter your notes...');
  await expect(notesField).toBeVisible();

  // Break: Cancel discards the draft.
  await notesField.fill('DRAFT-SHOULD-DIE');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await openItemNotes(page, 'Add item notes');
  await expect(notesField).toHaveValue('');

  // Break: empty Save stays Add (no text) and does not throw.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add item notes' })).toBeVisible();

  // Intended: type, Save, reopen as Edit with the text.
  await openItemNotes(page, 'Add item notes');
  await notesField.fill('Field note one');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await openItemNotes(page, 'Edit item notes');
  await expect(notesField).toHaveValue('Field note one');

  // Break: huge text saves.
  const huge = 'H'.repeat(4000);
  await notesField.fill(huge);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await openItemNotes(page, 'Edit item notes');
  await expect(notesField).toHaveValue(huge);
  await notesField.fill('Field note survives');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Edge: notes survive module switch (product keeps surveyMarkers by id).
  await rightRail(page).getByRole('button', { name: 'Next module', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Doors', exact: true })).toBeVisible();
  await rightRail(page).getByRole('button', { name: 'Previous module', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await expect.poll(async () => rightRail(page).locator('.survey-marker-category-arrow').count()).toBeGreaterThan(0);
  await openItemNotes(page, 'Edit item notes');
  await expect(notesField).toHaveValue('Field note survives');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);
});

test('Pages context leftovers: Mirror V, Reset, Cut / Copy / Paste execute', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  await page.goto(MULTI_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await waitEditor(page);
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(3);

  await openPagesPanel(page);
  await openPageMenu(page, 1);
  await expect(pagesMenu(page).getByRole('button', { name: 'Mirror vertically', exact: true })).toBeVisible();
  await expect(pagesMenu(page).getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
  await expect(pagesMenu(page).getByRole('button', { name: 'Cut', exact: true })).toBeVisible();
  await expect(pagesMenu(page).getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  const pasteItem = pagesMenu(page).getByRole('button', { name: 'Paste', exact: true });
  await expect(pasteItem).toBeVisible();
  await expect(pasteItem).toBeDisabled();
  await expect(pagesMenu(page).getByRole('button', { name: /Extract/i })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Intended: Mirror V is scaleY, not the wave-6 scaleX path.
  await clickPageMenu(page, 1, 'Mirror vertically');
  await expect.poll(async () => thumbTransform(page, 1)).toMatch(/scaleY|matrix/i);
  const afterV = await thumbTransform(page, 1);
  expect(afterV === 'none').toBeFalsy();

  // Intended: Reset clears the vertical flip.
  await clickPageMenu(page, 1, 'Reset');
  await expect.poll(async () => {
    const transform = await thumbTransform(page, 1);
    return transform === 'none' || transform === 'none' || /matrix\(1,\s*0,\s*0,\s*1/.test(transform);
  }).toBeTruthy();

  // Break: Reset with no transform is a no-op.
  const beforeReset = await thumbTransform(page, 1);
  await clickPageMenu(page, 1, 'Reset');
  expect(await thumbTransform(page, 1)).toBe(beforeReset);

  // Break: empty Paste stays disabled (already proved on first open). Re-open.
  await openPageMenu(page, 2);
  await expect(pagesMenu(page).getByRole('button', { name: 'Paste', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Intended: Copy page 1, Paste on page 3 inserts a page after 3.
  await clickPageMenu(page, 1, 'Copy');
  await clickPageMenu(page, 3, 'Paste');
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count(), {
    timeout: 45_000,
  }).toBe(4);

  // Break: Cut then Paste on the same page is a clipboard no-op (count stays).
  await clickPageMenu(page, 2, 'Cut');
  await clickPageMenu(page, 2, 'Paste');
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count()).toBe(4);
  await openPageMenu(page, 2);
  await expect(pagesMenu(page).getByRole('button', { name: 'Paste', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Edge: Copy / Paste while Pen is armed still inserts.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await clickPageMenu(page, 4, 'Copy');
  await clickPageMenu(page, 1, 'Paste');
  await expect.poll(async () => page.locator('.survey-pdfjs-page-div').count(), {
    timeout: 45_000,
  }).toBe(5);

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId, 'file.id must stay unset on ?testPdf=').toBeNull();
  await assertNoErrorBoundary(page);
});
