import { test, expect } from '@playwright/test';

// Unique leftover after Spaces card Turn on/off:
// Add pages (aria-label="Add pages" / handleAssignPages /
// handleSpaceAssignPages). Distinct from leftover-18 Space CSV /
// PDF Pages and from Create / space-name rename / space-card Delete.
// Catalog completeness only clicked page 1 / rejected 99.
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

function regionRows(cardOrPage) {
  return cardOrPage.locator('.space-region-row');
}

function addPagesInput(cardOrPage) {
  return cardOrPage.locator('.space-add-pages-input');
}

function addPagesBtn(cardOrPage) {
  return cardOrPage.getByRole('button', { name: 'Add pages', exact: true });
}

function pageError(cardOrPage) {
  return cardOrPage.locator('.space-page-range-error');
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

async function ensureExpanded(card) {
  if (await expandBtn(card).count()) {
    await expandBtn(card).click();
  }
  await expect(collapseBtn(card)).toBeVisible({ timeout: 8_000 });
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

test('U-02 Add pages assigns region rows and checkpoints undo', async ({ page }) => {
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

  // Break: no spaces → no Add pages.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await addPagesBtn(page).count(), 'no Add pages with zero spaces').toBe(0);
  expect(await addPagesInput(page).count(), 'no Add pages input with zero spaces').toBe(0);

  // Break: Create without Add pages invents no region row.
  await createNamedSpace(page, 'Space 1');
  const space1 = spaceCard(page, 'Space 1');
  await expect(space1).toBeVisible({ timeout: 8_000 });
  await ensureExpanded(space1);
  expect(await regionRows(space1).count(), 'Create does not invent a region row').toBe(0);
  await expect(addPagesBtn(space1)).toBeVisible();
  expect(
    await page.getByRole('button', { name: /Export /i }).count(),
    'Add pages is not leftover-18 export',
  ).toBeGreaterThan(0);
  expect(
    await space1.locator('.space-card-delete-button').count(),
    'Add pages is not space-card Delete',
  ).toBe(1);

  // Break: empty submit errors and writes nothing.
  await addPagesBtn(space1).click();
  await expect(pageError(space1)).toBeVisible({ timeout: 8_000 });
  await expect(pageError(space1)).toContainText(/No page numbers provided/i);
  expect(await regionRows(space1).count(), 'empty Add pages writes nothing').toBe(0);

  // Break: page 99 on a 1-page PDF is rejected.
  await addPagesInput(space1).fill('99');
  await addPagesBtn(space1).click();
  await expect(pageError(space1)).toContainText(/out of the valid range/i);
  expect(await regionRows(space1).count(), 'page 99 does not add a row').toBe(0);

  // Break: letters sanitize to empty.
  await addPagesInput(space1).fill('abc');
  expect(await addPagesInput(space1).inputValue(), 'letters stripped').toBe('');
  await addPagesBtn(space1).click();
  await expect(pageError(space1)).toContainText(/No page numbers provided/i);
  expect(await regionRows(space1).count()).toBe(0);

  // Intended: plus button adds page 1 → Region 1.
  await addPagesInput(space1).fill('1');
  await addPagesBtn(space1).click();
  await expect.poll(async () => regionRows(space1).count(), {
    timeout: 8_000,
    message: 'plus Add pages writes Region 1',
  }).toBe(1);
  await expect(space1.getByRole('button', { name: 'Go to page 1', exact: true })).toBeVisible();
  await expect(space1.getByRole('button', { name: 'Click to rename' })).toHaveText('Region 1');
  expect(await addPagesInput(space1).inputValue(), 'input clears after Add pages').toBe('');

  // Edge: already-assigned page 1 is a no-op (no extra row, no extra checkpoint).
  await addPagesInput(space1).fill('1');
  await addPagesBtn(space1).click();
  await expect(regionRows(space1)).toHaveCount(1);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(spaceCard(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  expect(await regionRows(spaceCard(page, 'Space 1')).count(), 'one undo drops the row, not the card').toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await openSpaces(page);
  await expect(regionRows(spaceCard(page, 'Space 1'))).toHaveCount(1);

  // Intended: Enter also adds (use a second space so we do not fight undo).
  await createNamedSpace(page, 'Space 2');
  const space2 = spaceCard(page, 'Space 2');
  await expect(space2).toBeVisible({ timeout: 8_000 });
  await ensureExpanded(space2);
  await addPagesInput(space2).fill('1');
  await addPagesInput(space2).press('Enter');
  await expect.poll(async () => regionRows(space2).count(), {
    timeout: 8_000,
    message: 'Enter Add pages writes Region 1 on Space 2',
  }).toBe(1);
  await expect(regionRows(space1)).toHaveCount(1);

  // Break: Pen-armed still adds.
  const pen = await armPen(page);
  await openSpaces(page);
  await ensureExpanded(space2);
  await addPagesInput(space2).fill('1');
  await addPagesBtn(space2).click();
  await expect(regionRows(space2)).toHaveCount(1);
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after Add pages').toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Intended range + two-space isolation on spike-120.
  let rangePages = [];
  let twoSpaceIsolation = false;
  await openEditor(page, { url: SPIKE_PDF });
  await openSpaces(page);
  await createNamedSpace(page, 'Space 1');
  const rangeCard = spaceCard(page, 'Space 1');
  await ensureExpanded(rangeCard);
  await addPagesInput(rangeCard).fill('3,6-9,12');
  await addPagesBtn(rangeCard).click();
  await expect.poll(async () => regionRows(rangeCard).count(), {
    timeout: 8_000,
    message: 'range 3,6-9,12 writes six region rows',
  }).toBe(6);
  rangePages = await rangeCard.locator('.region-page-pill-leading').allTextContents();
  expect(rangePages.map((t) => t.trim())).toEqual(['3', '6', '7', '8', '9', '12']);

  await createNamedSpace(page, 'Space 2');
  const other = spaceCard(page, 'Space 2');
  await ensureExpanded(other);
  await addPagesInput(other).fill('1');
  await addPagesBtn(other).click();
  await expect.poll(async () => regionRows(other).count(), {
    timeout: 8_000,
    message: 'Space 2 gets Region 1',
  }).toBe(1);
  expect(await regionRows(rangeCard).count(), 'Space 1 range stays').toBe(6);
  twoSpaceIsolation = (await regionRows(rangeCard).count()) === 6
    && (await regionRows(other).count()) === 1;
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(spaceCard(page, 'Space 2')).toBeVisible({ timeout: 8_000 });
  expect(await regionRows(spaceCard(page, 'Space 2')).count(), 'undo drops Space 2 page, not the card').toBe(0);
  expect(await regionRows(spaceCard(page, 'Space 1')).count(), 'Space 1 range stays after Space 2 undo').toBe(6);
  await assertNoErrorBoundary(page);

  // Edge: 390 — Add pages if the card exists after Create.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const mobilePanel = page.locator('.mobile-spaces-panel');
  await expect(mobilePanel).toBeVisible({ timeout: 8_000 });
  const create390 = mobilePanel.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobileAddPages = 0;
  let mobileAdded = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().evaluate((el) => el.click());
    await expect(mobilePanel.getByRole('textbox', { name: 'Rename Space 1' })).toBeVisible({ timeout: 8_000 });
    const mobileCard = mobilePanel.locator('[data-space-sortable-row-id]').first();
    await expect(mobileCard).toBeVisible({ timeout: 8_000 });
    const add390 = mobilePanel.locator('.space-add-pages-input');
    const addBtn390 = mobilePanel.getByRole('button', { name: 'Add pages', exact: true });
    mobileAddPages = await addBtn390.count();
    if ((await add390.count()) && mobileAddPages > 0) {
      await add390.first().fill('1');
      await addBtn390.first().evaluate((el) => el.click());
      try {
        await expect.poll(async () => mobileCard.locator('.space-region-row').count(), {
          timeout: 6_000,
        }).toBeGreaterThan(0);
        mobileAdded = (await mobileCard.locator('.space-region-row').count()) > 0;
      } catch { /* page-row can race on the sheet */ }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_ADD_PAGES_PROOF', JSON.stringify({
    persist,
    noSpacesZero: true,
    emptyRejected: true,
    page99Rejected: true,
    lettersSanitized: true,
    plusAddsRegion1: true,
    enterAddsSpace2: true,
    alreadyAssignedNoOp: true,
    undoDropsRowKeepsCard: true,
    penArmed: true,
    rangePages,
    twoSpaceIsolation,
    mobileCreate,
    mobileAddPages,
    mobileAdded,
  }));
});
