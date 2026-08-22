import { test, expect } from '@playwright/test';

// Unique leftover after Spaces region-row Hide/Show survey annotations:
// region-row Go to page (aria-label="Go to page N" / onNavigateToPage /
// handleNavigateToSpacePage). Distinct from thumbnail left-click and
// the rail page-number input. Reuses Add pages only as setup.
// Not leftover-18 (Space CSV / PDF Pages stay parked).
// UL-31 Continue pin parked. No file.id. Do not invent Print / stamp /
// measure / Group / Extract / Note-Link / Copy-to-Spaces / checklist items.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';

async function openEditor(page, { width = 1440, height = 900, url = MULTI_PDF } = {}) {
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

function regionRows(page) {
  return page.locator('.space-region-row');
}

function goToPageButtons(page) {
  return page.locator('.space-region-row .region-page-pill');
}

function goToPageBtn(page, n) {
  return page.getByRole('button', { name: `Go to page ${n}`, exact: true });
}

function pageThumbs(page) {
  // Pages panel stays mounted (display:none). Count is not a visibility signal.
  return page.locator('#chrome-left-host .page-thumbnail[data-page-number], #chrome-left-host [data-page-thumb]');
}

async function currentPageNumber(page) {
  const fromWindow = await page.evaluate(() => Number(window.__currentPageNumber) || 0);
  if (fromWindow > 0) return fromWindow;
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  if (await input.count()) return Number.parseInt(await input.inputValue(), 10);
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) return Number.parseInt((await btn.innerText()).trim(), 10);
  return null;
}

async function waitForPage(page, n) {
  await expect.poll(() => currentPageNumber(page), {
    timeout: 20_000,
    message: `expected viewer page ${n}`,
  }).toBe(n);
  await expect(page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`)).toBeVisible({ timeout: 20_000 });
}

async function typePageNumber(page, n) {
  const btn = page.getByRole('button', { name: 'Edit page number', exact: true });
  if (await btn.count()) await btn.click();
  const input = page.getByRole('textbox', { name: 'Current page', exact: true });
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(String(n));
  await input.press('Enter');
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible({ timeout: 15_000 });
}

async function createSpaceWithPages(page, pageSpec = '3') {
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

async function armPen(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  return pen;
}

test('U-02 region-row Go to page navigates; thumb and page input are different controls', async ({ page }) => {
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    if (dialog.type() === 'beforeunload' || /unsaved|leave/i.test(message)) {
      await dialog.accept();
      return;
    }
    await dialog.dismiss();
  });

  await openEditor(page, { url: MULTI_PDF });
  await openSpaces(page);

  // Break: no region row → no Go to page pill.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await goToPageButtons(page).count(), 'no Go to page with zero spaces').toBe(0);
  expect(await goToPageBtn(page, 1).count()).toBe(0);

  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Rename Space/i }).first()).toBeVisible({ timeout: 8_000 });
  expect(await regionRows(page).count(), 'Create space does not invent a region row').toBe(0);
  expect(await goToPageButtons(page).count(), 'no Go to page before Add pages').toBe(0);

  // Intended setup: region on page 3. Active-space page clamp would
  // snap a page-input jump to an unassigned page back onto page 3, so
  // Turn off first, leave via the rail input, then return via the pill.
  const addInput = page.locator('.space-add-pages-input').last();
  await addInput.fill('3');
  await page.getByRole('button', { name: 'Add pages', exact: true }).last().click();
  await expect(regionRows(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(goToPageBtn(page, 3)).toBeVisible();
  expect(await goToPageBtn(page, 1).count(), 'page-1 pill is a different region').toBe(0);
  const pill3 = goToPageBtn(page, 3);
  await expect(pill3).toHaveClass(/region-page-pill/);
  expect(
    await pill3.evaluate((el) => el.closest('[data-page-number], .page-thumbnail') ? true : false),
    'Go to page pill is not a Pages thumbnail',
  ).toBe(false);

  const turnOff = page.getByLabel('Turn off space');
  if (await turnOff.count()) {
    await turnOff.first().click();
  }
  await typePageNumber(page, 5);
  await waitForPage(page, 5);
  expect(await currentPageNumber(page), 'page input left page 3').toBe(5);

  await goToPageBtn(page, 3).click();
  await waitForPage(page, 3);
  await expect(spacesTab(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible();

  // Break: already on that page → stay.
  await goToPageBtn(page, 3).click();
  await waitForPage(page, 3);

  // Break: Pen-armed still jumps via the region-row pill.
  const pen = await armPen(page);
  await openSpaces(page);
  const turnOffAgain = page.getByLabel('Turn off space');
  if (await turnOffAgain.count()) {
    await turnOffAgain.first().click();
  }
  await typePageNumber(page, 8);
  await waitForPage(page, 8);
  await goToPageBtn(page, 3).click();
  await waitForPage(page, 3);
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen stays armed after region-row Go to page').toBe(true);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: two regions on different pages — each pill goes to its page.
  await createSpaceWithPages(page, '1,5');
  await expect(goToPageBtn(page, 1)).toBeVisible({ timeout: 8_000 });
  await expect(goToPageBtn(page, 5)).toBeVisible();
  const turnOffTwo = page.getByLabel('Turn off space');
  if (await turnOffTwo.count()) {
    await turnOffTwo.first().click();
  }
  await typePageNumber(page, 2);
  await waitForPage(page, 2);
  await goToPageBtn(page, 5).click();
  await waitForPage(page, 5);
  await goToPageBtn(page, 1).click();
  await waitForPage(page, 1);
  await goToPageBtn(page, 5).click();
  await waitForPage(page, 5);

  await assertNoErrorBoundary(page);

  // Break: 1-page fixture — only Go to page 1; click stays.
  await openEditor(page, { url: LINK_PDF });
  await openSpaces(page);
  await createSpaceWithPages(page, '1');
  await expect(goToPageBtn(page, 1)).toBeVisible({ timeout: 8_000 });
  expect(await goToPageBtn(page, 2).count()).toBe(0);
  await waitForPage(page, 1);
  await goToPageBtn(page, 1).click();
  await waitForPage(page, 1);
  await assertNoErrorBoundary(page);

  // Edge: 390 — region-row Go to page if the page-row exists after Create + Add pages.
  await openEditor(page, { width: 390, height: 844, url: MULTI_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const create390 = page.getByRole('button', { name: 'Create space', exact: true });
  let mobileCreate = 0;
  let mobilePageRows = 0;
  let mobileGoTo = 0;
  let mobileJumped = false;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().click();
    const add390 = page.locator('.space-add-pages-input');
    if (await add390.count()) {
      await add390.first().fill('3');
      const addPages = page.getByRole('button', { name: 'Add pages', exact: true });
      if (await addPages.count()) await addPages.first().click();
    }
    mobilePageRows = await regionRows(page).count();
    mobileGoTo = await goToPageBtn(page, 3).count();
    if (mobileGoTo > 0) {
      await goToPageBtn(page, 3).first().evaluate((el) => el.click());
      try {
        await expect.poll(() => currentPageNumber(page), { timeout: 8_000 }).toBe(3);
        mobileJumped = true;
      } catch {
        mobileJumped = (await currentPageNumber(page)) === 3;
      }
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_REGION_GOTO_PAGE_PROOF', JSON.stringify({
    persist,
    noSpacesZero: true,
    noRegionZero: true,
    leftViaPageInput: true,
    returnedViaPill: true,
    stayOnSamePage: true,
    penArmed: true,
    twoRegionEachPage: true,
    onePageStay: true,
    pillNotThumbnail: true,
    mobileCreate,
    mobilePageRows,
    mobileGoTo,
    mobileJumped,
  }));
});
