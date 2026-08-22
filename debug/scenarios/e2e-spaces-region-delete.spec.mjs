import { test, expect } from '@playwright/test';

// Unique leftover after Spaces region-row Hide/Show:
// region-row Delete (aria-label="Delete" / onRemovePage / region-delete-button).
// Distinct from last-space card delete (space-card-delete-button + confirm).
// Reuses the draw path only as setup. Not leftover-18.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces / checklist items.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
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

function spacesTab(page) {
  return page.getByRole('button', { name: 'Spaces', exact: true });
}

function editRegionBtn(page) {
  return page.getByRole('button', { name: 'Edit region areas on the page' });
}

function exitRegionBtn(page) {
  return page.getByRole('button', { name: 'Exit region edit' });
}

function regionUi(page) {
  return page.locator('[data-region-selection-ui="true"]');
}

function overlayRoot(page, pageNumber = 1) {
  return page.locator(`[data-space-region-overlay-root="${pageNumber}"]`);
}

function regionRows(page) {
  return page.locator('.space-region-row');
}

function regionDeleteButtons(page) {
  return page.locator('.space-region-row .region-delete-button');
}

function spaceCardDelete(page) {
  return page.locator('.space-card-delete-button');
}

function spaceCard(page, spaceName) {
  return page.locator('[data-space-sortable-row-id]').filter({
    has: page.getByRole('textbox', { name: `Rename ${spaceName}` }),
  });
}

function regionRowByLabel(page, label) {
  return page.locator('.space-region-row').filter({ hasText: label });
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible({ timeout: 15_000 });
}

async function createSpaceWithPages(page, pageSpec = '1') {
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  const name = page.getByRole('textbox', { name: /Rename Space/i }).first();
  await expect(name).toBeVisible({ timeout: 8_000 });
  const addInput = page.locator('.space-add-pages-input').last();
  await expect(addInput).toBeVisible({ timeout: 8_000 });
  await addInput.fill(pageSpec);
  await page.getByRole('button', { name: 'Add pages', exact: true }).last().click();
  await expect.poll(async () => regionRows(page).count(), {
    timeout: 8_000,
    message: 'expected a space-region row after Add pages',
  }).toBeGreaterThan(0);
}

async function enterRegionEdit(page, card = null) {
  const btn = card
    ? card.getByRole('button', { name: 'Edit region areas on the page' })
    : editRegionBtn(page).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  await btn.click();
  await expect(exitRegionBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(regionUi(page).first()).toBeVisible({ timeout: 8_000 });
}

async function dragAndConfirmRegion(page, { x0 = 0.22, y0 = 0.28, x1 = 0.48, y1 = 0.50 } = {}) {
  const layer = regionUi(page).last();
  await expect(layer).toBeVisible({ timeout: 8_000 });
  const box = await layer.boundingBox();
  expect(box, 'region-selection overlay geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  const confirm = regionUi(page).getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeVisible({ timeout: 8_000 });
  await confirm.click();
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
}

async function armPen(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  return pen;
}

test('U-02 region-row Delete removes the page from the space', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await openEditor(page);
  await openSpaces(page);

  // Break: no region row → no region-delete control.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await regionDeleteButtons(page).count(), 'no region Delete with zero spaces').toBe(0);

  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Rename Space/i }).first()).toBeVisible({ timeout: 8_000 });
  expect(await regionRows(page).count(), 'Create space does not invent a region row').toBe(0);
  expect(await regionDeleteButtons(page).count(), 'no region Delete before Add pages').toBe(0);
  expect(await spaceCardDelete(page).count(), 'space-card Delete is a different control').toBeGreaterThan(0);

  const addInput = page.locator('.space-add-pages-input').last();
  await addInput.fill('1');
  await page.getByRole('button', { name: 'Add pages', exact: true }).last().click();
  await expect(regionRows(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(regionDeleteButtons(page).first()).toBeVisible();
  expect(await overlayRoot(page).count(), 'Add pages alone does not draw an overlay').toBe(0);

  // Break: region-row Delete has no confirm (space-card Delete does).
  // Immediate click removes the page row; dismissing a stray dialog would keep it.
  await regionDeleteButtons(page).first().click();
  expect(dialogs, 'region-row Delete does not open window.confirm').toEqual([]);
  await expect(regionRows(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator('[data-space-sortable-row-id]')).toHaveCount(1);
  expect(await overlayRoot(page).count()).toBe(0);

  // Edge: undo restores the page row via space:update (last-region also
  // deactivates the space — overlay stays off until Turn on).
  await page.keyboard.press('Control+z');
  await expect(regionRows(page)).toHaveCount(1, { timeout: 8_000 });
  await expect(regionDeleteButtons(page).first()).toBeVisible();

  // Intended: drawn region + Delete removes the row and the overlay.
  const turnOn = page.getByLabel('Turn on space');
  if (await turnOn.count()) {
    await turnOn.first().click();
  }
  await enterRegionEdit(page);
  await dragAndConfirmRegion(page);
  await expect(overlayRoot(page)).toBeVisible({ timeout: 8_000 });
  await expect(regionDeleteButtons(page).first()).toBeVisible();
  await regionDeleteButtons(page).first().click();
  expect(dialogs, 'drawn-region Delete still has no confirm').toEqual([]);
  await expect(regionRows(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(overlayRoot(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator('[data-space-sortable-row-id]')).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(regionRows(page)).toHaveCount(1, { timeout: 8_000 });
  if (await page.getByLabel('Turn on space').count()) {
    await page.getByLabel('Turn on space').first().click();
  }
  await expect(overlayRoot(page)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Control+Shift+z');
  await expect(regionRows(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(overlayRoot(page)).toHaveCount(0, { timeout: 8_000 });
  await page.keyboard.press('Control+z');
  await expect(regionRows(page)).toHaveCount(1, { timeout: 8_000 });
  if (await page.getByLabel('Turn on space').count()) {
    await page.getByLabel('Turn on space').first().click();
  }
  await expect(overlayRoot(page)).toBeVisible({ timeout: 8_000 });

  // Break: Pen-armed still deletes via the region-row control.
  const pen = await armPen(page);
  await openSpaces(page);
  await regionDeleteButtons(page).first().click();
  await expect(regionRows(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(overlayRoot(page)).toHaveCount(0, { timeout: 8_000 });
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after region-row Delete').toBe(true);
  await expect(page.locator('[data-space-sortable-row-id]')).toHaveCount(1);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: two regions — delete one, the other stays.
  await openEditor(page, { url: MULTI_PDF });
  await openSpaces(page);
  await createSpaceWithPages(page, '1,2');
  await expect(regionRows(page)).toHaveCount(2, { timeout: 8_000 });
  await expect(regionRowByLabel(page, 'Region 1')).toBeVisible();
  await expect(regionRowByLabel(page, 'Region 2')).toBeVisible();
  await enterRegionEdit(page);
  await dragAndConfirmRegion(page);
  await expect(overlayRoot(page, 1)).toBeVisible({ timeout: 8_000 });
  await regionRowByLabel(page, 'Region 1').locator('.region-delete-button').click();
  expect(dialogs, 'two-region Delete has no confirm').toEqual([]);
  await expect(regionRowByLabel(page, 'Region 1')).toHaveCount(0, { timeout: 8_000 });
  await expect(regionRowByLabel(page, 'Region 2')).toBeVisible();
  await expect(regionRows(page)).toHaveCount(1);
  await expect(overlayRoot(page, 1)).toHaveCount(0, { timeout: 8_000 });
  await page.keyboard.press('Control+z');
  await expect(regionRows(page)).toHaveCount(2, { timeout: 8_000 });
  await expect(regionRowByLabel(page, 'Region 1')).toBeVisible();
  await expect(regionRowByLabel(page, 'Region 2')).toBeVisible();
  await expect(overlayRoot(page, 1)).toBeVisible({ timeout: 8_000 });

  await assertNoErrorBoundary(page);

  // Edge: 390 — region-row Delete if the page-row exists after Create + Add pages.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const create390 = page.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobilePageRows = 0;
  let mobileDelete = 0;
  let mobileDeleted = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().click();
    const add390 = page.locator('.space-add-pages-input');
    if (await add390.count()) {
      await add390.first().fill('1');
      const addPages = page.getByRole('button', { name: 'Add pages', exact: true });
      if (await addPages.count()) await addPages.first().click();
    }
    mobilePageRows = await regionRows(page).count();
    mobileDelete = await regionDeleteButtons(page).count();
    const edit390 = editRegionBtn(page);
    if (mobileDelete === 0 && await edit390.count()) {
      await edit390.first().evaluate((el) => el.click());
      const mobileToolbar = page.getByRole('toolbar', { name: 'Region editing' });
      if (await mobileToolbar.count()) {
        await mobileToolbar.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => el.click());
      }
      mobilePageRows = await regionRows(page).count();
      mobileDelete = await regionDeleteButtons(page).count();
    }
    if (mobileDelete > 0) {
      await regionDeleteButtons(page).first().evaluate((el) => el.click());
      mobileDeleted = (await regionRows(page).count()) === 0;
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_REGION_DELETE_PROOF', JSON.stringify({
    persist,
    noSpacesZero: true,
    noRegionZero: true,
    noConfirm: dialogs.length === 0,
    dialogs,
    lastRegionDeleted: true,
    undoRestored: true,
    penArmed: true,
    twoRegionIsolation: true,
    mobileCreate,
    mobilePageRows,
    mobileDelete,
    mobileDeleted,
  }));
});
