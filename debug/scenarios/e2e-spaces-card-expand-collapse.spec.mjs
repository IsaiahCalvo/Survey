import { test, expect } from '@playwright/test';

// Unique leftover after Spaces region-row Go to page:
// space-card Expand/Collapse (aria-label="Expand" / "Collapse" /
// onToggleExpand). Distinct from Turn on/off and leftover-18 Space CSV /
// PDF Pages. Reuses Create + Add pages only as setup.
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces / checklist items.

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

function regionRows(card) {
  return card.locator('.space-region-row');
}

function addPagesInput(card) {
  return card.locator('.space-add-pages-input');
}

function turnOn(card) {
  return card.getByLabel('Turn on space');
}

function turnOff(card) {
  return card.getByLabel('Turn off space');
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

async function armPen(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  return pen;
}

test('U-02 space-card Expand/Collapse hides and shows inner rows', async ({ page }) => {
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

  // Break: no spaces → no Expand/Collapse.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await page.getByRole('button', { name: 'Expand', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Collapse', exact: true }).count()).toBe(0);

  // Break: Create without Add pages — auto-expanded Add-pages row, no region.
  await createNamedSpace(page, 'Space 1');
  const empty = spaceCard(page, 'Space 1');
  await expect(empty).toBeVisible({ timeout: 8_000 });
  await expect(collapseBtn(empty)).toBeVisible();
  expect(await expandBtn(empty).count(), 'new space auto-expands').toBe(0);
  expect(await regionRows(empty).count(), 'Create does not invent a region').toBe(0);
  await expect(addPagesInput(empty)).toBeVisible();
  expect(
    await empty.locator('.space-card-expand-button').count(),
    'chevron is not Turn on/off',
  ).toBe(1);
  expect(await turnOn(empty).count() + await turnOff(empty).count(), 'Turn on/off is a different control').toBe(1);
  const turnBeforeEmpty = await turnOn(empty).count();

  await collapseBtn(empty).click();
  await expect(expandBtn(empty)).toBeVisible({ timeout: 8_000 });
  expect(await addPagesInput(empty).count(), 'Collapse hides Add pages with no region').toBe(0);
  expect(await regionRows(empty).count()).toBe(0);
  expect(await turnOn(empty).count(), 'Collapse does not flip Turn on/off').toBe(turnBeforeEmpty);

  await expandBtn(empty).click();
  await expect(collapseBtn(empty)).toBeVisible({ timeout: 8_000 });
  await expect(addPagesInput(empty)).toBeVisible();
  expect(await regionRows(empty).count()).toBe(0);

  // Intended: a space with a region/page row; Collapse hides it; Expand shows it.
  await addPagesToSpace(page, 'Space 1', '1');
  await expect(regionRows(empty)).toHaveCount(1);
  await expect(empty.getByRole('button', { name: 'Go to page 1', exact: true })).toBeVisible();
  const turnBeforePages = await turnOn(empty).count();

  await collapseBtn(empty).click();
  await expect(expandBtn(empty)).toBeVisible({ timeout: 8_000 });
  expect(await regionRows(empty).count(), 'Collapse hides the inner region row').toBe(0);
  expect(await addPagesInput(empty).count(), 'Collapse hides Add pages').toBe(0);
  expect(await empty.getByRole('button', { name: 'Go to page 1', exact: true }).count()).toBe(0);
  expect(await turnOn(empty).count(), 'Collapse is not Turn off').toBe(turnBeforePages);

  await expandBtn(empty).click();
  await expect(collapseBtn(empty)).toBeVisible({ timeout: 8_000 });
  await expect(regionRows(empty)).toHaveCount(1);
  await expect(empty.getByRole('button', { name: 'Go to page 1', exact: true })).toBeVisible();
  await expect(addPagesInput(empty)).toBeVisible();

  // Break: two cards — collapse one, the other stays expanded.
  await createNamedSpace(page, 'Space 2');
  await addPagesToSpace(page, 'Space 2', '1');
  const space2 = spaceCard(page, 'Space 2');
  await expect(collapseBtn(empty)).toBeVisible();
  await expect(collapseBtn(space2)).toBeVisible();
  await expect(regionRows(empty)).toHaveCount(1);
  await expect(regionRows(space2)).toHaveCount(1);

  await collapseBtn(empty).click();
  await expect(expandBtn(empty)).toBeVisible({ timeout: 8_000 });
  expect(await regionRows(empty).count(), 'Space 1 rows hidden').toBe(0);
  await expect(collapseBtn(space2)).toBeVisible();
  await expect(regionRows(space2)).toHaveCount(1);
  await expect(space2.getByRole('button', { name: 'Go to page 1', exact: true })).toBeVisible();

  // Break: Pen-armed still toggles Expand/Collapse.
  const pen = await armPen(page);
  await openSpaces(page);
  await expect(expandBtn(empty)).toBeVisible({ timeout: 8_000 });
  await expandBtn(empty).click();
  await expect(collapseBtn(empty)).toBeVisible({ timeout: 8_000 });
  await expect(regionRows(empty)).toHaveCount(1);
  await collapseBtn(space2).click();
  await expect(expandBtn(space2)).toBeVisible({ timeout: 8_000 });
  expect(await regionRows(space2).count(), 'Pen-armed Collapse hides Space 2 rows').toBe(0);
  await expect(regionRows(empty)).toHaveCount(1);
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after Expand/Collapse').toBe(true);

  // Edge: product does not checkpoint expand — undo pops space:create, not the chevron.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await openSpaces(page);
  await expect(spaceCard(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCard(page, 'Space 2').count(), 'undo rewinds Space 2 create, not collapse').toBe(0);
  await expect(collapseBtn(spaceCard(page, 'Space 1'))).toBeVisible();
  await expect(regionRows(spaceCard(page, 'Space 1'))).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await openSpaces(page);
  await expect(spaceCard(page, 'Space 2')).toBeVisible({ timeout: 8_000 });
  // Newly re-added ids auto-expand (Set add on create), not a collapse checkpoint.
  // Add pages is not on that create checkpoint, so the restored card may have 0 rows.
  await expect(collapseBtn(spaceCard(page, 'Space 2'))).toBeVisible();

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — Expand/Collapse if the card exists after Create.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const mobilePanel = page.locator('.mobile-spaces-panel');
  await expect(mobilePanel).toBeVisible({ timeout: 8_000 });
  const create390 = mobilePanel.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobileCollapse = 0;
  let mobileExpand = 0;
  let mobileHidRows = false;
  let mobileShowedRows = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().click();
    const add390 = mobilePanel.locator('.space-add-pages-input');
    if (await add390.count()) {
      await add390.first().fill('1');
      const addPages = mobilePanel.getByRole('button', { name: 'Add pages', exact: true });
      if (await addPages.count()) await addPages.first().click();
    }
    const mobileCard = mobilePanel.locator('[data-space-sortable-row-id]').first();
    mobileCollapse = await mobileCard.getByRole('button', { name: 'Collapse', exact: true }).count();
    if (mobileCollapse > 0) {
      await mobileCard.getByRole('button', { name: 'Collapse', exact: true }).first().evaluate((el) => el.click());
      mobileExpand = await mobileCard.getByRole('button', { name: 'Expand', exact: true }).count();
      mobileHidRows = (await mobileCard.locator('.space-region-row').count()) === 0;
      if (mobileExpand > 0) {
        await mobileCard.getByRole('button', { name: 'Expand', exact: true }).first().evaluate((el) => el.click());
        mobileShowedRows = (await mobileCard.locator('.space-region-row').count()) > 0
          || (await mobileCard.locator('.space-add-pages-input').count()) > 0;
        mobileCollapse = await mobileCard.getByRole('button', { name: 'Collapse', exact: true }).count();
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_CARD_EXPAND_COLLAPSE_PROOF', JSON.stringify({
    persist,
    noSpacesZero: true,
    emptyCreateHidesAddPages: true,
    collapseHidesRegion: true,
    expandShowsRegion: true,
    twoCardIsolation: true,
    penArmed: true,
    undoPopsCreateNotChevron: true,
    turnOnOffUnchanged: true,
    mobileCreate,
    mobileCollapse,
    mobileExpand,
    mobileHidRows,
    mobileShowedRows,
  }));
});
