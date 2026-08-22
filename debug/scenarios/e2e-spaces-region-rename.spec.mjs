import { test, expect } from '@playwright/test';

// Unique leftover after Spaces Edit region areas:
// region-row "Click to rename" / commitRegionRename.
// Distinct from space-name rename (Hunt Space / Rename Space) and from
// Edit region areas. Reuses the draw path only as setup — does not replay
// overlay / last-space asserts. Not leftover-18. UL-31 Continue pin parked.
// No file.id. Do not invent Print / stamp / measure / Group / Extract /
// Note-Link / Copy-to-Spaces / checklist items.

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

function regionRenameButtons(page) {
  return page.locator('.space-region-row').getByRole('button', { name: 'Click to rename' });
}

function regionRenameInput(page) {
  return page.locator('.space-region-row input.region-name-inline');
}

function regionDisplayLabels(page) {
  return page.locator('.space-region-row .region-name-display');
}

function spaceCard(page, spaceName) {
  return page.locator('[data-space-sortable-row-id]').filter({
    has: page.getByRole('textbox', { name: `Rename ${spaceName}` }),
  });
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
  await expect.poll(async () => page.locator('.space-region-row').count(), {
    timeout: 8_000,
    message: 'expected a space-region row after Add pages',
  }).toBeGreaterThan(0);
}

async function enterRegionEdit(page) {
  await expect(editRegionBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await editRegionBtn(page).first().click();
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

async function startRegionRename(page, currentLabel) {
  const btn = page.locator('.space-region-row').filter({ hasText: currentLabel }).getByRole('button', { name: 'Click to rename' }).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  await btn.click();
  const input = regionRenameInput(page);
  await expect(input).toBeVisible({ timeout: 8_000 });
  await expect(input).toBeFocused();
  return input;
}

async function commitRegionRename(page, nextName) {
  const input = regionRenameInput(page);
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(nextName);
  await input.press('Enter');
  await expect(input).toHaveCount(0, { timeout: 8_000 });
}

async function labelsOf(page) {
  return regionDisplayLabels(page).allTextContents();
}

test('U-02 region-row Click to rename / commitRegionRename', async ({ page }) => {
  const toasts = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/already exists/i.test(text)) toasts.push(text);
  });

  await openEditor(page);
  await openSpaces(page);

  // Setup: reuse the edit-region draw path. Do not replay overlay asserts.
  await createSpaceWithPages(page, '1');
  await expect(regionRenameButtons(page).first()).toBeVisible();
  await expect(regionDisplayLabels(page).first()).toHaveText('Region 1');
  await enterRegionEdit(page);
  await dragAndConfirmRegion(page);
  await expect(regionDisplayLabels(page).first()).toHaveText('Region 1');

  // Break: empty / whitespace name falls back to Region {pageId}, not reject.
  await startRegionRename(page, 'Region 1');
  await commitRegionRename(page, '   ');
  await expect(regionDisplayLabels(page).first()).toHaveText('Region 1');

  // Break: Escape cancels — typed text is discarded, no store write.
  const escInput = await startRegionRename(page, 'Region 1');
  await escInput.fill('Temp-Esc');
  await escInput.press('Escape');
  await expect(regionRenameInput(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(regionDisplayLabels(page).first()).toHaveText('Region 1');

  // Intended: type a new name, Enter commits. Stored + rail label update.
  await startRegionRename(page, 'Region 1');
  await commitRegionRename(page, 'Kitchen');
  await expect(regionDisplayLabels(page).first()).toHaveText('Kitchen');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await openSpaces(page);
  await expect(regionDisplayLabels(page).first()).toHaveText('Kitchen');

  // Break: Pen-armed still commits.
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  await openSpaces(page);
  await startRegionRename(page, 'Kitchen');
  await commitRegionRename(page, 'Pantry');
  await expect(regionDisplayLabels(page).first()).toHaveText('Pantry');
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after region rename').toBe(true);

  // Edge: undo rewinds only the rename (region row stays; label restores).
  await page.keyboard.press('Control+z');
  await expect(regionDisplayLabels(page).first()).toHaveText('Kitchen', { timeout: 8_000 });
  await page.keyboard.press('Control+Shift+z');
  await expect(regionDisplayLabels(page).first()).toHaveText('Pantry', { timeout: 8_000 });

  // Edge: two regions — rename one, the other stays.
  await createSpaceWithPages(page, '1');
  await expect(spaceCard(page, 'Space 1').locator('.region-name-display')).toHaveText('Pantry');
  await expect(spaceCard(page, 'Space 2').locator('.region-name-display')).toHaveText('Region 1');
  const space2Rename = spaceCard(page, 'Space 2').getByRole('button', { name: 'Click to rename' });
  await space2Rename.click();
  await commitRegionRename(page, 'Hall');
  await expect(spaceCard(page, 'Space 2').locator('.region-name-display')).toHaveText('Hall');
  await expect(spaceCard(page, 'Space 1').locator('.region-name-display')).toHaveText('Pantry');

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Break: duplicate name in the same space is rejected (needs two page-rows).
  await openEditor(page, { url: MULTI_PDF });
  await openSpaces(page);
  await createSpaceWithPages(page, '1,2');
  await expect(regionDisplayLabels(page)).toHaveCount(2);
  expect(await labelsOf(page)).toEqual(['Region 1', 'Region 2']);
  await startRegionRename(page, 'Region 1');
  await commitRegionRename(page, 'Kitchen');
  expect(await labelsOf(page)).toEqual(['Kitchen', 'Region 2']);
  await startRegionRename(page, 'Region 2');
  await commitRegionRename(page, 'Kitchen');
  await expect(page.getByText(/already exists in this space/i).first()).toBeVisible({ timeout: 8_000 });
  expect(await labelsOf(page)).toEqual(['Kitchen', 'Region 2']);

  await assertNoErrorBoundary(page);

  // Edge: 390 — Click to rename if the page-row exists after Create + Add pages.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const create390 = page.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobilePageRows = 0;
  let mobileRename = 0;
  let mobileEdit = 0;
  let mobileRenamed = false;
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
    mobilePageRows = await page.locator('.space-region-row').count();
    mobileRename = await regionRenameButtons(page).count();
    mobileEdit = await editRegionBtn(page).count();
    if (mobileRename > 0) {
      await regionRenameButtons(page).first().evaluate((el) => el.click());
      const mobileInput = regionRenameInput(page);
      if (await mobileInput.count()) {
        await mobileInput.fill('Mobile-Kitchen');
        await mobileInput.press('Enter');
        await expect(regionDisplayLabels(page).first()).toHaveText('Mobile-Kitchen', { timeout: 8_000 });
        mobileRenamed = true;
      }
    }
    if (mobileEdit > 0) {
      await editRegionBtn(page).first().evaluate((el) => el.click());
      const mobileToolbar = page.getByRole('toolbar', { name: 'Region editing' });
      if (await mobileToolbar.count()) {
        await expect(mobileToolbar).toBeVisible({ timeout: 8_000 });
        // Sheet backdrop intercepts Playwright pointer; DOM click matches
        // the 390 Keep-active leftover proof.
        await mobileToolbar.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => el.click());
        await expect(mobileToolbar).toHaveCount(0, { timeout: 8_000 });
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_REGION_RENAME_PROOF', JSON.stringify({
    persist,
    emptyFallback: 'Region 1',
    escapeCancel: true,
    intendedKitchen: true,
    penArmed: true,
    undoRewound: true,
    twoRegionIsolation: true,
    duplicateRejected: true,
    mobileCreate,
    mobilePageRows,
    mobileRename,
    mobileEdit,
    mobileRenamed,
    toasts: toasts.length,
  }));
});
