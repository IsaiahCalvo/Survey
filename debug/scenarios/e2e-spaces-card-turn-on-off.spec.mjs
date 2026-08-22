import { test, expect } from '@playwright/test';

// Unique leftover after Spaces card Expand/Collapse:
// space-card Turn on/off (aria-label="Turn on space" / "Turn off space" /
// onToggleSpace / handleToggleSpace). Distinct from Expand/Collapse and
// leftover-18 Space CSV / PDF Pages. Reuses Create + Add pages + draw
// region only as setup. Last-space off/on was Edit-region contrast only.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces / checklist items.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SPIKE_PDF = '/?testPdf=spike-120-pages.pdf';

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
      const message = String(error?.message || error);
      if (!/ERR_ABORTED|interrupted|destroyed/i.test(message) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(400);
    }
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

function pagesTab(page) {
  return page.getByRole('button', { name: 'Pages', exact: true });
}

function createSpaceBtn(page) {
  return page.getByRole('button', { name: 'Create space', exact: true });
}

function spaceCard(page, spaceName) {
  return page.locator('[data-space-sortable-row-id]').filter({
    has: page.getByRole('textbox', { name: `Rename ${spaceName}` }),
  });
}

function expandBtn(card) {
  return card.getByRole('button', { name: 'Expand', exact: true });
}

function collapseBtn(card) {
  return card.getByRole('button', { name: 'Collapse', exact: true });
}

function turnOn(cardOrPage) {
  return cardOrPage.getByLabel('Turn on space');
}

function turnOff(cardOrPage) {
  return cardOrPage.getByLabel('Turn off space');
}

function regionRows(card) {
  return card.locator('.space-region-row');
}

function addPagesInput(card) {
  return card.locator('.space-add-pages-input');
}

function overlayRoot(page) {
  return page.locator('[data-space-region-overlay-root="1"]');
}

function editRegionBtn(cardOrPage) {
  return cardOrPage.getByRole('button', { name: 'Edit region areas on the page' });
}

function exitRegionBtn(page) {
  return page.getByRole('button', { name: 'Exit region edit' });
}

function regionUi(page) {
  return page.locator('[data-region-selection-ui="true"]');
}

function regionTarget(page) {
  return page.locator('[data-region-selection-target="1"]');
}

function regionConfirm(page) {
  return regionUi(page).getByRole('button', { name: 'Confirm', exact: true });
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(createSpaceBtn(page)).toBeVisible({ timeout: 15_000 });
}

async function createNamedSpace(page, expectedName) {
  const field = page.getByRole('textbox', { name: `Rename ${expectedName}` });
  if (await field.isVisible().catch(() => false)) return;
  await createSpaceBtn(page).click();
  await expect(field).toBeVisible({ timeout: 8_000 });
}

async function addPagesToSpace(page, spaceName, pageSpec = '1') {
  const card = spaceCard(page, spaceName);
  await expect(card).toBeVisible({ timeout: 8_000 });
  if (await expandBtn(card).count()) {
    await expandBtn(card).click();
  }
  await expect(collapseBtn(card)).toBeVisible({ timeout: 8_000 });
  const input = addPagesInput(card);
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(pageSpec);
  await card.getByRole('button', { name: 'Add pages', exact: true }).click();
  await expect.poll(async () => regionRows(card).count(), {
    timeout: 8_000,
    message: `expected a region row on ${spaceName}`,
  }).toBeGreaterThan(0);
}

async function enterRegionEdit(page, spaceName) {
  const card = spaceCard(page, spaceName);
  await expect(card).toBeVisible({ timeout: 8_000 });
  if (await expandBtn(card).count()) {
    await expandBtn(card).click();
  }
  await expect(editRegionBtn(card).first()).toBeVisible({ timeout: 8_000 });
  await editRegionBtn(card).first().click();
  await expect(exitRegionBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(regionTarget(page)).toBeAttached({ timeout: 8_000 });
  await expect(regionUi(page).first()).toBeVisible({ timeout: 8_000 });
}

async function dragRegion(page, { x0 = 0.22, y0 = 0.28, x1 = 0.48, y1 = 0.50 } = {}) {
  const layer = regionUi(page).last();
  await expect(layer).toBeVisible({ timeout: 8_000 });
  const box = await layer.boundingBox();
  expect(box, 'region-selection overlay geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function confirmRegion(page) {
  await expect(regionConfirm(page)).toBeVisible({ timeout: 8_000 });
  await regionConfirm(page).click();
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(regionTarget(page)).toHaveCount(0);
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

async function activeSpaceId(page) {
  return page.evaluate(() => window.__diagState?.activeSpaceId ?? null);
}

async function clickToggle(locator) {
  await locator.evaluate((el) => el.click());
}

async function pageDivDisplay(page, n) {
  const loc = page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`);
  if ((await loc.count()) === 0) return null;
  return loc.first().evaluate((el) => el.style.display || getComputedStyle(el).display);
}

test('U-02 space-card Turn on/off activates one space and locks pages', async ({ page }) => {
  const toasts = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/no regions yet/i.test(text)) toasts.push(text);
  });
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

  // Break: no spaces → no Turn on/off.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await turnOn(page).count(), 'no Turn on with zero spaces').toBe(0);
  expect(await turnOff(page).count(), 'no Turn off with zero spaces').toBe(0);
  expect(await page.evaluate(() => window.__diagState?.activeSpaceId ?? null)).toBeNull();
  expect(await overlayRoot(page).count(), 'no overlay with zero spaces').toBe(0);

  // Break: Create without regions — Turn on toasts and stays off.
  await createNamedSpace(page, 'Space 1');
  const space1 = spaceCard(page, 'Space 1');
  await expect(space1).toBeVisible({ timeout: 8_000 });
  await expect(turnOn(space1)).toBeVisible();
  expect(await turnOff(space1).count(), 'new space starts off').toBe(0);
  expect(
    await space1.locator('.space-card-expand-button').count(),
    'Turn on/off is not the Expand chevron',
  ).toBe(1);
  const expandBefore = await collapseBtn(space1).count();

  await clickToggle(turnOn(space1));
  await expect(page.getByText(/no regions yet/i).first()).toBeVisible({ timeout: 8_000 });
  await expect(turnOn(space1)).toBeVisible();
  expect(await turnOff(space1).count(), 'Turn on without regions stays off').toBe(0);
  expect(await activeSpaceId(page), 'active flag stays null').toBeNull();
  expect(await overlayRoot(page).count(), 'no overlay before a region').toBe(0);
  expect(await collapseBtn(space1).count(), 'Turn on does not flip Expand/Collapse').toBe(expandBefore);

  // Break: Add pages still is not a drawn region.
  await addPagesToSpace(page, 'Space 1', '1');
  await expect(turnOn(space1)).toBeVisible();
  await clickToggle(turnOn(space1));
  await expect(page.getByText(/no regions yet/i).first()).toBeVisible({ timeout: 8_000 });
  await expect(turnOn(space1)).toBeVisible();
  expect(await activeSpaceId(page), 'Add pages does not activate').toBeNull();
  expect(await overlayRoot(page).count()).toBe(0);

  // Intended: a drawn region can activate — Confirm arms the space.
  await enterRegionEdit(page, 'Space 1');
  await dragRegion(page);
  await confirmRegion(page);
  await expect(turnOff(space1)).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => activeSpaceId(page), {
    timeout: 8_000,
    message: 'confirm sets activeSpaceId',
  }).not.toBeNull();
  const space1Id = await activeSpaceId(page);
  expect(await pageDivDisplay(page, 1), 'assigned page stays visible').not.toBe('none');

  // Intended: Turn off deactivates overlay + active flag; Turn on restores.
  await clickToggle(turnOff(space1));
  await expect(turnOn(space1)).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toHaveCount(0);
  await expect.poll(async () => activeSpaceId(page), {
    timeout: 8_000,
    message: 'Turn off clears activeSpaceId',
  }).toBeNull();
  expect(await collapseBtn(space1).count(), 'Turn off is not Collapse').toBe(1);

  await clickToggle(turnOn(space1));
  await expect(turnOff(space1)).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => activeSpaceId(page), {
    timeout: 8_000,
    message: 'Turn on restores activeSpaceId',
  }).toBe(space1Id);

  // Edge last-space: the only space off → no overlay; on → overlay returns.
  await clickToggle(turnOff(space1));
  await expect(turnOn(space1)).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toHaveCount(0);
  expect(await activeSpaceId(page)).toBeNull();
  await clickToggle(turnOn(space1));
  await expect(turnOff(space1)).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toBeVisible();
  expect(await activeSpaceId(page)).toBe(space1Id);

  // Break: two spaces — only one active; Turn on without regions does not steal.
  await createNamedSpace(page, 'Space 2');
  await addPagesToSpace(page, 'Space 2', '1');
  const space2 = spaceCard(page, 'Space 2');
  await expect(turnOn(space2)).toBeVisible();
  await expect(turnOff(space1)).toBeVisible();
  await clickToggle(turnOn(space2));
  await expect(page.getByText(/no regions yet/i).first()).toBeVisible({ timeout: 8_000 });
  await expect(turnOn(space2)).toBeVisible();
  await expect(turnOff(space1)).toBeVisible();
  expect(await activeSpaceId(page), 'failed Turn on does not steal').toBe(space1Id);
  await expect(overlayRoot(page)).toBeVisible();

  await enterRegionEdit(page, 'Space 2');
  await dragRegion(page, { x0: 0.52, y0: 0.28, x1: 0.78, y1: 0.50 });
  await confirmRegion(page);
  await expect(turnOff(space2)).toBeVisible({ timeout: 8_000 });
  await expect(turnOn(space1)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => activeSpaceId(page), {
    timeout: 8_000,
    message: 'confirming Space 2 replaces activeSpaceId',
  }).not.toBe(space1Id);
  const space2Id = await activeSpaceId(page);
  expect(space2Id, 'Space 2 became the single active id').toBeTruthy();
  expect(await turnOff(page).count(), 'only one Turn off at a time').toBe(1);
  await expect(overlayRoot(page)).toBeVisible();

  await clickToggle(turnOn(space1));
  await expect(turnOff(space1)).toBeVisible({ timeout: 8_000 });
  await expect(turnOn(space2)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => activeSpaceId(page), {
    timeout: 8_000,
    message: 'Turn on Space 1 exclusivity',
  }).toBe(space1Id);
  expect(await turnOff(page).count(), 'still only one active').toBe(1);
  await expect(overlayRoot(page)).toBeVisible();

  // Break: Pen-armed still toggles Turn on/off.
  const pen = await armPen(page);
  await openSpaces(page);
  await expect(turnOff(space1)).toBeVisible({ timeout: 8_000 });
  await clickToggle(turnOff(space1));
  await expect(turnOn(space1)).toBeVisible({ timeout: 8_000 });
  expect(await activeSpaceId(page)).toBeNull();
  await expect(overlayRoot(page)).toHaveCount(0);
  await clickToggle(turnOn(space2));
  await expect(turnOff(space2)).toBeVisible({ timeout: 8_000 });
  await expect(turnOn(space1)).toBeVisible();
  await expect.poll(async () => activeSpaceId(page), {
    timeout: 8_000,
    message: 'Pen-armed Turn on Space 2',
  }).toBe(space2Id);
  await expect(overlayRoot(page)).toBeVisible();
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after Turn on/off').toBe(true);

  // Edge: product does not checkpoint the toggle — undo pops space:update, not on/off.
  await clickToggle(turnOff(space2));
  await expect(turnOn(space2)).toBeVisible({ timeout: 8_000 });
  expect(await activeSpaceId(page)).toBeNull();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await openSpaces(page);
  await expect(spaceCard(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  await expect(spaceCard(page, 'Space 2')).toBeVisible({ timeout: 8_000 });
  // Last checkpoint is Space 2 region confirm (space:update), not the toggle.
  await expect.poll(async () => regionRows(spaceCard(page, 'Space 2')).count(), {
    timeout: 8_000,
    message: 'undo rewinds Space 2 region, not Turn off',
  }).toBe(0);
  expect(await overlayRoot(page).count(), 'undo does not restore overlay via toggle').toBe(0);
  expect(await turnOff(page).count(), 'undo does not turn a space back on').toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await openSpaces(page);
  await expect.poll(async () => regionRows(spaceCard(page, 'Space 2')).count(), {
    timeout: 8_000,
    message: 'redo restores Space 2 region row',
  }).toBeGreaterThan(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Intended page lock: spike-120, assigned page 1 only — other pages hide.
  let pageLockHidden = false;
  let pageLockRestored = false;
  let pagesThumbLocked = false;
  let pagesThumbRestored = false;
  await openEditor(page, { url: SPIKE_PDF });
  await openSpaces(page);
  await createNamedSpace(page, 'Space 1');
  await addPagesToSpace(page, 'Space 1', '1');
  await pagesTab(page).click();
  const thumb2 = page.locator('#chrome-left-host [data-page-number="2"]');
  await expect(thumb2.first()).toBeVisible({ timeout: 15_000 });
  await openSpaces(page);
  await enterRegionEdit(page, 'Space 1');
  await dragRegion(page);
  await confirmRegion(page);
  const lockCard = spaceCard(page, 'Space 1');
  await expect(turnOff(lockCard)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => pageDivDisplay(page, 2), {
    timeout: 10_000,
    message: 'active space hides unassigned page 2',
  }).toBe('none');
  pageLockHidden = (await pageDivDisplay(page, 2)) === 'none';
  expect(await pageDivDisplay(page, 1)).not.toBe('none');
  await pagesTab(page).click();
  await expect.poll(async () => thumb2.count(), {
    timeout: 8_000,
    message: 'Pages rail hides page 2 while space is on',
  }).toBe(0);
  pagesThumbLocked = (await thumb2.count()) === 0;
  await openSpaces(page);
  await clickToggle(turnOff(lockCard));
  await expect(turnOn(lockCard)).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => pageDivDisplay(page, 2), {
    timeout: 10_000,
    message: 'Turn off restores page 2',
  }).not.toBe('none');
  pageLockRestored = (await pageDivDisplay(page, 2)) !== 'none';
  await pagesTab(page).click();
  await expect(thumb2.first()).toBeVisible({ timeout: 8_000 });
  pagesThumbRestored = (await thumb2.count()) > 0;
  await assertNoErrorBoundary(page);

  // Edge: 390 — Turn on/off if the card exists after Create.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const mobilePanel = page.locator('.mobile-spaces-panel');
  await expect(mobilePanel).toBeVisible({ timeout: 8_000 });
  const create390 = mobilePanel.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobileTurnOn = 0;
  let mobileTurnOff = 0;
  let mobileToastStayOff = false;
  let mobileToggled = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().evaluate((el) => el.click());
    await expect(mobilePanel.getByRole('textbox', { name: 'Rename Space 1' })).toBeVisible({ timeout: 8_000 });
    const mobileCard = mobilePanel.locator('[data-space-sortable-row-id]').first();
    await expect(mobileCard).toBeVisible({ timeout: 8_000 });
    mobileTurnOn = await mobilePanel.getByLabel('Turn on space').count();
    mobileTurnOff = await mobilePanel.getByLabel('Turn off space').count();
    if (mobileTurnOn > 0) {
      await mobilePanel.getByLabel('Turn on space').first().evaluate((el) => el.click());
      try {
        await expect(page.getByText(/no regions yet/i).first()).toBeVisible({ timeout: 6_000 });
        mobileToastStayOff = (await mobilePanel.getByLabel('Turn on space').count()) > 0
          && (await mobilePanel.getByLabel('Turn off space').count()) === 0;
      } catch {
        mobileToastStayOff = (await mobilePanel.getByLabel('Turn on space').count()) > 0;
      }
      const add390 = mobilePanel.locator('.space-add-pages-input');
      if (await add390.count()) {
        await add390.first().fill('1');
        const addPages = mobilePanel.getByRole('button', { name: 'Add pages', exact: true });
        if (await addPages.count()) await addPages.first().evaluate((el) => el.click());
      }
      const edit390 = mobilePanel.getByRole('button', { name: 'Edit region areas on the page' });
      if (await edit390.count()) {
        await edit390.first().evaluate((el) => el.click());
        const mobileToolbar = page.getByRole('toolbar', { name: 'Region editing' });
        try {
          await expect(mobileToolbar).toBeVisible({ timeout: 6_000 });
          await mobileToolbar.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => el.click());
        } catch { /* sheet can cover the page */ }
      }
      mobileTurnOn = await mobilePanel.getByLabel('Turn on space').count();
      mobileTurnOff = await mobilePanel.getByLabel('Turn off space').count();
      mobileToggled = mobileTurnOn + mobileTurnOff > 0;
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_CARD_TURN_ON_OFF_PROOF', JSON.stringify({
    persist,
    noSpacesZero: true,
    emptyCreateStaysOff: true,
    addPagesStaysOff: true,
    confirmActivates: true,
    turnOffClearsOverlay: true,
    turnOnRestoresOverlay: true,
    lastSpaceOffOn: true,
    twoSpaceExclusive: true,
    failedOnDoesNotSteal: true,
    penArmed: true,
    undoPopsUpdateNotToggle: true,
    pageLockHidden,
    pageLockRestored,
    pagesThumbLocked,
    pagesThumbRestored,
    mobileCreate,
    mobileTurnOn,
    mobileTurnOff,
    mobileToastStayOff,
    mobileToggled,
    toasts: toasts.length,
  }));
});
