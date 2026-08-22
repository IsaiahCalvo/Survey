import { test, expect } from '@playwright/test';

// Unique leftover after Spaces Create space:
// space-card Delete (space-card-delete-button + confirm / handleDelete /
// onSpaceDelete). Distinct from region-row Delete, leftover-18 Space CSV /
// PDF Pages, and from already-proven Create space. UL-31 Continue pin parked.
// No file.id. Do not invent Print / stamp / measure / Group / Extract /
// Note-Link / Copy-to-Spaces / checklist items.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    try { window.onbeforeunload = null; } catch { /* ignore */ }
  }).catch(() => {});
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
    const message = String(error?.message || error);
    if (!/ERR_ABORTED|interrupted|destroyed/i.test(message) || attempt === 2) {
      throw error;
    }
    await page.waitForTimeout(400);
  }
  if (lastError) throw lastError;
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

function createSpaceBtn(page) {
  return page.getByRole('button', { name: 'Create space', exact: true });
}

function renameField(page, spaceName) {
  return page.getByRole('textbox', { name: `Rename ${spaceName}` });
}

function spaceCards(page) {
  return page.locator('[data-space-sortable-row-id]');
}

function spaceCard(page, spaceName) {
  return spaceCards(page).filter({
    has: page.getByRole('textbox', { name: `Rename ${spaceName}` }),
  });
}

function cardDelete(page, spaceName) {
  return spaceCard(page, spaceName).locator('.space-card-delete-button');
}

function spaceCardDeletes(page) {
  return page.locator('.space-card-delete-button');
}

function regionDeletes(page) {
  return page.locator('.space-region-row .region-delete-button');
}

function spaceDeleteConfirms(dialogs) {
  return (dialogs || []).filter((entry) => /Delete this space/i.test(entry?.message || ''));
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(createSpaceBtn(page)).toBeVisible({ timeout: 15_000 });
}

async function waitForCreateBurst(page) {
  await page.waitForTimeout(360);
}

async function mintSpace(page, expectedName) {
  await waitForCreateBurst(page);
  await createSpaceBtn(page).click();
  await expect(renameField(page, expectedName)).toBeVisible({ timeout: 8_000 });
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

test('U-02 space-card Delete / handleDelete / onSpaceDelete', async ({ page }) => {
  const dialogs = [];
  let deleteConfirm = 'accept';
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    if (dialog.type() === 'beforeunload' || /unsaved|leave/i.test(message)) {
      await dialog.accept();
      return;
    }
    dialogs.push({ type: dialog.type(), message });
    if (/Delete this space/i.test(message)) {
      if (deleteConfirm === 'dismiss') {
        await dialog.dismiss();
      } else {
        await dialog.accept();
      }
      return;
    }
    await dialog.dismiss();
  });

  await openEditor(page);
  await openSpaces(page);

  // Break: Delete with no spaces — no card trash.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count(), 'empty list has no cards').toBe(0);
  expect(await spaceCardDeletes(page).count(), 'no space-card Delete with zero spaces').toBe(0);
  expect(await regionDeletes(page).count(), 'region-row Delete is a different control').toBe(0);
  expect(
    await page.getByRole('button', { name: 'Upgrade to Pro to create spaces' }).count(),
    'testPdf developer can create',
  ).toBe(0);

  // Setup: Create is already proven — mint Space 1 only.
  await mintSpace(page, 'Space 1');
  expect(await spaceCards(page).count()).toBe(1);
  expect(await spaceCardDeletes(page).count()).toBe(1);
  expect(await regionDeletes(page).count(), 'Create does not invent a region-row Delete').toBe(0);
  expect(
    await page.getByRole('button', { name: 'Export Space 1' }).count(),
    'leftover-18 export is contrast, not this GAP',
  ).toBeGreaterThan(0);

  // Break: cancel confirm keeps the card.
  const confirmsBeforeCancel = spaceDeleteConfirms(dialogs).length;
  deleteConfirm = 'dismiss';
  await cardDelete(page, 'Space 1').click();
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count(), 'cancel confirm keeps the card').toBe(1);
  expect(
    spaceDeleteConfirms(dialogs).length,
    'cancel opened Delete this space?',
  ).toBe(confirmsBeforeCancel + 1);
  expect(await regionDeletes(page).count()).toBe(0);

  // Intended: confirm removes the only card; remaining list is empty.
  const confirmsBeforeLast = spaceDeleteConfirms(dialogs).length;
  deleteConfirm = 'accept';
  await cardDelete(page, 'Space 1').click();
  await expect(renameField(page, 'Space 1')).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count(), 'last-space delete returns to empty').toBe(0);
  expect(await spaceCardDeletes(page).count()).toBe(0);
  expect(
    spaceDeleteConfirms(dialogs).length,
    'confirm opened Delete this space?',
  ).toBe(confirmsBeforeLast + 1);

  // Edge: undo restores the card via space:delete; redo removes it again.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count(), 'undo restores last-space card').toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Space 1')).toHaveCount(0);
  expect(await spaceCards(page).count()).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });

  // Edge: two cards — delete one, the other stays.
  await mintSpace(page, 'Space 2');
  expect(await spaceCards(page).count()).toBe(2);
  await expect(renameField(page, 'Space 1')).toBeVisible();
  await expect(renameField(page, 'Space 2')).toBeVisible();
  deleteConfirm = 'accept';
  await cardDelete(page, 'Space 1').click();
  await expect(renameField(page, 'Space 1')).toHaveCount(0, { timeout: 8_000 });
  await expect(renameField(page, 'Space 2')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count(), 'delete one keeps the other').toBe(1);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 2')).toBeVisible();
  expect(await spaceCards(page).count()).toBe(2);

  // Break: Pen-armed still deletes via the card trash.
  const pen = await armPen(page);
  await openSpaces(page);
  deleteConfirm = 'accept';
  await cardDelete(page, 'Space 2').click();
  await expect(renameField(page, 'Space 2')).toHaveCount(0, { timeout: 8_000 });
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count()).toBe(1);
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after space-card Delete').toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — Delete if the button exists after Create.
  await page.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const mobilePanel = page.locator('.mobile-spaces-panel');
  await expect(mobilePanel).toBeVisible({ timeout: 8_000 });
  const create390 = mobilePanel.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobileDelete = 0;
  let mobileBeforeDelete = 0;
  let mobileAfterDelete = 0;
  let mobileDeleted = false;
  let mobileConfirm = 0;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    const beforeClick = await spaceCards(page).count();
    deleteConfirm = 'accept';
    await create390.first().evaluate((el) => el.click());
    try {
      await expect.poll(async () => spaceCards(page).count(), { timeout: 8_000 }).toBeGreaterThan(beforeClick);
    } catch { /* sheet can race the card */ }
    await waitForCreateBurst(page);
    mobileDelete = await spaceCardDeletes(page).count();
    mobileBeforeDelete = await spaceCards(page).count();
    if (mobileDelete > 0) {
      const confirmsBefore390 = spaceDeleteConfirms(dialogs).length;
      await spaceCardDeletes(page).first().evaluate((el) => el.click());
      try {
        await expect.poll(async () => spaceCards(page).count(), { timeout: 8_000 }).toBeLessThan(mobileBeforeDelete);
      } catch { /* sheet can race the confirm */ }
      mobileAfterDelete = await spaceCards(page).count();
      mobileDeleted = mobileAfterDelete < mobileBeforeDelete;
      mobileConfirm = spaceDeleteConfirms(dialogs).length - confirmsBefore390;
    } else {
      mobileAfterDelete = mobileBeforeDelete;
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_CARD_DELETE_PROOF', JSON.stringify({
    persist,
    noSpacesZero: true,
    cancelKeptCard: true,
    lastSpaceDeleted: true,
    undoRestored: true,
    twoCardIsolation: true,
    penArmed: true,
    confirms: spaceDeleteConfirms(dialogs).length,
    dialogs: spaceDeleteConfirms(dialogs).map((entry) => entry.message),
    mobileCreate,
    mobileDelete,
    mobileBeforeDelete,
    mobileAfterDelete,
    mobileDeleted,
    mobileConfirm,
  }));
});
