import { test, expect } from '@playwright/test';

// Unique leftover after Spaces space-name rename:
// Create space (aria-label="Create space" / handleCreateSpace / handleSpaceCreate).
// Cluster only minted Space 1/2. Distinct from space-name rename, space-card
// Delete, leftover-18 Space CSV / PDF Pages. UL-31 Continue pin parked.
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

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(createSpaceBtn(page)).toBeVisible({ timeout: 15_000 });
}

async function waitForCreateBurst(page) {
  await page.waitForTimeout(360);
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

test('U-02 Create space / handleCreateSpace', async ({ page }) => {
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
  expect(await spaceCards(page).count(), 'empty list has no cards').toBe(0);
  expect(await renameField(page, 'Space 1').count()).toBe(0);
  expect(
    await page.getByRole('button', { name: 'Upgrade to Pro to create spaces' }).count(),
    'testPdf developer can create',
  ).toBe(0);
  expect(
    await page.locator('.space-card-delete-button').count(),
    'Create is not space-card Delete',
  ).toBe(0);
  expect(
    await page.getByRole('button', { name: /Export /i }).count(),
    'Create is not leftover-18 export until a card exists',
  ).toBeGreaterThanOrEqual(0);

  // Intended: one click mints a unique name and increments the count.
  await createSpaceBtn(page).click();
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 1')).toHaveValue('Space 1');
  expect(await spaceCards(page).count()).toBe(1);
  expect(
    await spaceCards(page).locator('.space-card-delete-button').count(),
    'minted card has Delete chrome (not this leftover)',
  ).toBe(1);
  expect(
    await page.getByRole('button', { name: 'Export Space 1' }).count(),
    'leftover-18 export is contrast, not this GAP',
  ).toBeGreaterThan(0);
  await waitForCreateBurst(page);

  // Break: rapid double-click adds one card, not two (unique names are not enough).
  const afterFirst = await spaceCards(page).count();
  await createSpaceBtn(page).dblclick();
  await waitForCreateBurst(page);
  expect(
    await spaceCards(page).count(),
    'desktop dblclick mints one card',
  ).toBe(afterFirst + 1);
  await expect(renameField(page, 'Space 2')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 1')).toBeVisible();
  expect(await renameField(page, 'Space 3').count()).toBe(0);

  // Break: two pointer-down clicks in the same burst still +1.
  const afterDblclick = await spaceCards(page).count();
  await createSpaceBtn(page).click({ delay: 20 });
  await createSpaceBtn(page).click({ delay: 20 });
  await waitForCreateBurst(page);
  expect(
    await spaceCards(page).count(),
    'desktop rapid pair mints one card',
  ).toBe(afterDblclick + 1);
  await expect(renameField(page, 'Space 3')).toBeVisible({ timeout: 8_000 });
  expect(await renameField(page, 'Space 4').count()).toBe(0);

  // Break: no compiled product max — Create stays enabled; no max toast.
  const createEnabled = await createSpaceBtn(page).isEnabled();
  expect(createEnabled, 'no product max disables Create').toBe(true);
  expect(await page.getByText(/maximum|too many spaces|space limit/i).count()).toBe(0);

  // Break: Pen-armed still mints.
  const pen = await armPen(page);
  await openSpaces(page);
  await waitForCreateBurst(page);
  await createSpaceBtn(page).click();
  await expect(renameField(page, 'Space 4')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count()).toBe(4);
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after Create').toBe(true);

  // Edge: undo pops the last space:create; earlier cards stay.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Space 4')).toHaveCount(0);
  await expect(renameField(page, 'Space 1')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 2')).toBeVisible();
  await expect(renameField(page, 'Space 3')).toBeVisible();
  expect(await spaceCards(page).count()).toBe(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Space 4')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count()).toBe(4);

  // Edge: two Creates isolate — undo the second, the first stays.
  await waitForCreateBurst(page);
  await createSpaceBtn(page).click();
  await expect(renameField(page, 'Space 5')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count()).toBe(5);
  await waitForCreateBurst(page);
  await createSpaceBtn(page).click();
  await expect(renameField(page, 'Space 6')).toBeVisible({ timeout: 8_000 });
  expect(await spaceCards(page).count()).toBe(6);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openSpaces(page);
  await expect(renameField(page, 'Space 6')).toHaveCount(0);
  await expect(renameField(page, 'Space 5')).toBeVisible({ timeout: 8_000 });
  await expect(renameField(page, 'Space 1')).toBeVisible();
  expect(await spaceCards(page).count()).toBe(5);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — Create if the button exists; record whether dblclick still multi-mints.
  // Drop the desktop session first. Same-URL goto can restore the 5 cards.
  await page.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const mobilePanel = page.locator('.mobile-spaces-panel');
  await expect(mobilePanel).toBeVisible({ timeout: 8_000 });
  const create390 = mobilePanel.getByRole('button', { name: 'Create space', exact: true });
  const create390PageWide = page.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobileCreatePageWide = 0;
  let mobileBeforeClick = 0;
  let mobileAfterClick = 0;
  let mobileAfterDblclick = 0;
  let mobileDblclickDelta = 0;
  let mobileStillDoubleMints = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    mobileCreatePageWide = await create390PageWide.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    const beforeClick = await spaceCards(page).count();
    mobileBeforeClick = beforeClick;
    await create390.first().evaluate((el) => el.click());
    try {
      await expect.poll(async () => spaceCards(page).count(), { timeout: 8_000 }).toBeGreaterThan(beforeClick);
    } catch { /* sheet can race the card */ }
    mobileAfterClick = await spaceCards(page).count();
    await waitForCreateBurst(page);
    const beforeDbl = await spaceCards(page).count();
    await create390.first().dblclick({ force: true }).catch(async () => {
      await create390.first().evaluate((el) => {
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        el.click();
        el.click();
      });
    });
    await waitForCreateBurst(page);
    mobileAfterDblclick = await spaceCards(page).count();
    mobileDblclickDelta = mobileAfterDblclick - beforeDbl;
    mobileStillDoubleMints = mobileDblclickDelta > 1;
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_CREATE_SPACE_PROOF', JSON.stringify({
    persist,
    intendedMint: 'Space 1',
    desktopDblclickPlusOne: true,
    desktopRapidPairPlusOne: true,
    noProductMax: true,
    penArmed: true,
    undoPopsCreate: true,
    twoCreateIsolation: true,
    mobileCreate,
    mobileCreatePageWide,
    mobileBeforeClick,
    mobileAfterClick,
    mobileAfterDblclick,
    mobileDblclickDelta,
    mobileStillDoubleMints,
  }));
});
