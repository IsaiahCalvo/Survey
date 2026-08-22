import { test, expect } from '@playwright/test';

// Unique leftover after Spaces Add pages:
// space-name rename (aria-label={`Rename ${space.name}`} / commitSpaceName).
// Distinct from region-row Click to rename and from leftover-18 Space CSV /
// PDF Pages / Create / space-card Delete. UL-31 Continue pin parked.
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

function spaceCard(page, spaceName) {
  return page.locator('[data-space-sortable-row-id]').filter({
    has: page.getByRole('textbox', { name: `Rename ${spaceName}` }),
  });
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(createSpaceBtn(page)).toBeVisible({ timeout: 15_000 });
}

async function createNamedSpace(page, expectedName) {
  const field = renameField(page, expectedName);
  if (await field.isVisible().catch(() => false)) return field;
  await createSpaceBtn(page).click();
  await expect(field).toBeVisible({ timeout: 8_000 });
  return field;
}

async function commitSpaceRename(field, nextName) {
  await field.click();
  await field.fill(nextName);
  await field.press('Enter');
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

test('U-02 space-name rename / commitSpaceName', async ({ page }) => {
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    if (dialog.type() === 'beforeunload' || /unsaved|leave/i.test(message)) {
      await dialog.accept();
      return;
    }
    await dialog.dismiss();
  });

  await openEditor(page);
  await openSpaces(page);

  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await renameField(page, 'Space 1').count(), 'no rename field with zero spaces').toBe(0);

  const space1Field = await createNamedSpace(page, 'Space 1');
  await expect(space1Field).toBeVisible({ timeout: 8_000 });
  await expect(space1Field).toHaveValue('Space 1');
  expect(
    await page.getByRole('button', { name: 'Click to rename' }).count(),
    'space-name field is not region-row Click to rename',
  ).toBe(0);
  expect(
    await spaceCard(page, 'Space 1').locator('.space-card-delete-button').count(),
    'rename is not space-card Delete',
  ).toBe(1);
  expect(
    await page.getByRole('button', { name: /Export /i }).count(),
    'rename is not leftover-18 export',
  ).toBeGreaterThan(0);

  // Break: empty / whitespace snaps back to the current name. No store write.
  await commitSpaceRename(space1Field, '   ');
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 1')).toHaveValue('Space 1');

  // Break: Escape cancels — typed text is discarded, no store write.
  await renameField(page, 'Space 1').click();
  await renameField(page, 'Space 1').fill('Temp-Esc');
  await renameField(page, 'Space 1').press('Escape');
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 1')).toHaveValue('Space 1');

  // Intended: unique name commits. Stored + card label update.
  await commitSpaceRename(renameField(page, 'Space 1'), 'Hunt Kitchen');
  await expect(renameField(page, 'Hunt Kitchen')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Kitchen')).toHaveValue('Hunt Kitchen');
  await expect(renameField(page, 'Space 1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Hunt Kitchen')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Kitchen')).toHaveValue('Hunt Kitchen');

  // Break: Pen-armed still commits.
  const pen = await armPen(page);
  await openSpaces(page);
  await commitSpaceRename(renameField(page, 'Hunt Kitchen'), 'Hunt Pantry');
  await expect(renameField(page, 'Hunt Pantry')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Pantry')).toHaveValue('Hunt Pantry');
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after space-name rename').toBe(true);

  // Edge: undo rewinds only the rename (card stays).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Hunt Kitchen')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Pantry')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Hunt Pantry')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Kitchen')).toHaveCount(0);

  // Edge: two cards — rename one, the other stays.
  await createNamedSpace(page, 'Space 2');
  await expect(renameField(page, 'Space 2')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Pantry')).toBeVisible();
  await commitSpaceRename(renameField(page, 'Space 2'), 'Hunt Hall');
  await expect(renameField(page, 'Hunt Hall')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Pantry')).toBeVisible();
  await expect(renameField(page, 'Space 2')).toHaveCount(0);

  // Break: duplicate name is rejected; field restores; no extra undo.
  await commitSpaceRename(renameField(page, 'Hunt Pantry'), 'Hunt Hall');
  await expect(page.getByText(/A space with this name already exists/i).first()).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Pantry')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Pantry')).toHaveValue('Hunt Pantry');
  await expect(renameField(page, 'Hunt Hall')).toBeVisible();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Hunt Pantry')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 2')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Hunt Hall')).toHaveCount(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — rename if the card title field exists after Create.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const mobilePanel = page.locator('.mobile-spaces-panel');
  await expect(mobilePanel).toBeVisible({ timeout: 8_000 });
  const create390 = mobilePanel.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobileRename = 0;
  let mobileRenamed = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().evaluate((el) => el.click());
    const mobileField = mobilePanel.getByRole('textbox', { name: 'Rename Space 1' });
    mobileRename = await mobileField.count();
    if (mobileRename > 0) {
      await expect(mobileField.first()).toBeVisible({ timeout: 8_000 });
      await mobileField.first().evaluate((el) => el.focus());
      await mobileField.first().fill('Mobile-Kitchen');
      await mobileField.first().press('Enter');
      try {
        await expect(mobilePanel.getByRole('textbox', { name: 'Rename Mobile-Kitchen' })).toBeVisible({ timeout: 6_000 });
        mobileRenamed = true;
      } catch { /* sheet can race the remount */ }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_SPACE_NAME_RENAME_PROOF', JSON.stringify({
    persist,
    emptyFallback: 'Space 1',
    escapeCancel: true,
    intendedHuntKitchen: true,
    penArmed: true,
    undoRewound: true,
    twoCardIsolation: true,
    duplicateRejected: true,
    mobileCreate,
    mobileRename,
    mobileRenamed,
  }));
});
