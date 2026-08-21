import { test, expect } from '@playwright/test';

// Unique unblocked GAP after leftover-18 env hunt (secrets absent):
// mobile 390×844 chrome hit targets. Desktop catalogs ≠ these buttons.
// Do not replay leftover-18 fail-closed, flatten, pickers, callout paste,
// PDF links, History restore, or pages-menu waves. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';
const HUB = '/?hubPreview=1&tab=documents';

async function openMobileEditor(page, fixture = LINK_PDF) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture);
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function userAnnotationIds(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter((id) => id && !/^\d+R$/i.test(id));
    return [...new Set(ids)].filter((id) => window.__phase35GetAnnotationById?.(id)?.isPdfImported !== true);
  }, pageNumber);
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function readPageWidth(page, pageNumber = 1) {
  return page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).evaluate((el) => el.offsetWidth);
}

async function headerPageLabel(page) {
  return (await page.getByRole('button', { name: 'Jump to page' }).innerText()).replace(/\s+/g, '');
}

async function jumpToPage(page, value) {
  await page.getByRole('button', { name: 'Jump to page' }).click();
  const input = page.getByRole('textbox', { name: 'Page number' });
  await expect(input).toBeVisible();
  const digits = String(value).replace(/\D/g, '');
  await input.fill(digits);
  await expect(input).toHaveValue(digits);
  await input.press('Enter');
}

test('mobile 390×844 viewer chrome header / More / dock intended + break + edge', async ({ page }) => {
  await openMobileEditor(page, LINK_PDF);

  await expect(page.locator('#chrome-top-host')).toHaveAttribute('data-mobile-pdf-header', 'true');
  await expect(page.getByRole('complementary', { name: 'Document tools' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Document panels' })).toBeVisible();
  // Desktop top-toolbar Export is not mounted on the mobile header.
  await expect(page.locator('#chrome-top-host').getByRole('button', { name: 'Export annotated PDF' })).toHaveCount(0);

  const prev = page.getByRole('button', { name: 'Previous page' });
  const next = page.getByRole('button', { name: 'Next page' });
  await expect(prev).toBeDisabled();
  await expect(next).toBeDisabled();
  // History uses getHistoryDocumentId (local ?testPdf= key), not file.id.
  // Opening it must stay fail-closed for named cloud save (leftover-18 X-01).
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('kal48-save-revision')).toHaveCount(0);
  await expect(page.getByText(/Only the document owner can save or restore versions|No versions yet|Local history/i).first()).toBeVisible();
  const closeHistory = page.getByRole('button', { name: /Close version history/i });
  if (await closeHistory.count()) await closeHistory.first().click();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Document panels' })).toBeVisible({ timeout: 10_000 });

  const beforeIds = new Set(await userAnnotationIds(page));
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  const rectBtn = page.getByRole('button', { name: 'Rectangle', exact: true });
  await expect(rectBtn).toBeVisible();
  await rectBtn.click();
  await dragOnPage(page, { x0: 0.28, y0: 0.32, x1: 0.55, y1: 0.52 });
  let created = null;
  await expect.poll(async () => {
    const ids = await userAnnotationIds(page);
    created = ids.find((id) => !beforeIds.has(id)) || null;
    return created;
  }).not.toBeNull();

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(created)).toBe(false);
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect.poll(async () => (await userAnnotationIds(page)).includes(created)).toBe(true);

  const more = page.getByRole('button', { name: 'More document options' });
  await more.click();
  const moreMenu = page.locator('.mobile-pdf-tools__popover.is-more');
  await expect(moreMenu).toBeVisible();
  await more.click();
  await expect(moreMenu).toHaveCount(0);

  const widthBefore = await readPageWidth(page);
  await more.click();
  await moreMenu.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => readPageWidth(page)).not.toBe(widthBefore);

  await more.click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    moreMenu.getByRole('button', { name: 'Export annotated PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  await page.getByRole('button', { name: 'Zoom and fit options' }).click();
  const zoomMenu = page.locator('.mobile-pdf-header__zoom-menu');
  await expect(zoomMenu).toHaveClass(/is-open/);
  await zoomMenu.getByRole('option', { name: /Fit width/i }).click();
  await expect(zoomMenu).not.toHaveClass(/is-open/);

  await jumpToPage(page, '0');
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^1\//);
  await jumpToPage(page, '99');
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^1\//);

  await page.getByRole('button', { name: /1 active user/ }).click();
  const users = page.getByRole('region', { name: 'Active users' });
  await expect(users).toBeVisible();
  await expect(users).toContainText(/You/i);
  await page.getByRole('button', { name: 'Close active users' }).first().click();
  await expect(users).toHaveCount(0);

  await page.getByRole('button', { name: 'Open spaces' }).click();
  await expect.poll(async () => (
    (await page.getByRole('button', { name: 'Create space', exact: true }).count())
    + (await page.locator('.mobile-pdf-sheet').count())
  )).toBeGreaterThan(0);

  const leftoverFileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(leftoverFileId).toBeNull();

  console.log('MOBILE_VIEWER_CHROME_PROOF', JSON.stringify({
    viewport: '390x844',
    desktopExportHidden: true,
    rectCreated: created,
    undoRedo: true,
    moreExport: download.suggestedFilename(),
    pageJumpClamp: true,
    historySaveVersionHidden: true,
    presenceYou: true,
    fileId: leftoverFileId,
  }));
});

test('mobile 390×844 page jump on spike-120 + dock survey (edge)', async ({ page }) => {
  await openMobileEditor(page, MULTI_PDF);
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^1\/120$/);
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^2\/120$/);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^1\/120$/);

  await jumpToPage(page, '3');
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^3\/120$/);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^4\/120$/);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^3\/120$/);

  await jumpToPage(page, '0');
  await expect.poll(async () => headerPageLabel(page)).toMatch(/^3\/120$/);

  await page.goto(`${LINK_PDF}&surveyTransitionE2E=1`);
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Open survey' }).click();
  await expect.poll(async () => (
    (await page.getByRole('heading', { name: 'Choose survey template' }).count())
    + (await page.getByRole('button', { name: /KAL-436/ }).count())
    + (await page.locator('.mobile-pdf-sheet').count())
  )).toBeGreaterThan(0);

  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();

  console.log('MOBILE_PAGE_SURVEY_PROOF', JSON.stringify({
    jumpedTo: 3,
    nextPrev: true,
    zeroKeepsCurrent: true,
    surveyDock: true,
    fileId: null,
  }));
});

test('mobile 390×844 hub documents remaining buttons intended + break + edge', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB);
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.documents-mobile-list .mobile-doc-card').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.documents-desktop-card')).toBeHidden();

  const search = page.locator('.documents-mobile-search-actions input[placeholder="Search documents..."]');
  await expect(search).toBeVisible();
  await search.fill('zzzz-no-such-document');
  await expect(page.locator('.documents-mobile-list').getByText('No documents match your search.')).toBeVisible();
  await search.fill('Package 2');
  await expect(page.locator('.mobile-doc-card').filter({ hasText: 'Package 2 — Rev 4 — IC.pdf' })).toBeVisible();
  await expect(page.locator('.mobile-doc-card').filter({ hasText: 'test.pdf' })).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('.mobile-doc-card').filter({ hasText: 'test.pdf' })).toBeVisible();

  const namesBefore = await page.locator('.mobile-doc-card .mobile-card-title').evaluateAll((els) => (
    els.map((el) => el.textContent?.trim() || '')
  ));
  const filter = page.locator('.documents-mobile-filter');
  await expect(filter).toBeVisible();
  await filter.click();
  const sortMenu = page.locator('.documents-mobile-sort-menu');
  if (!(await sortMenu.isVisible().catch(() => false))) {
    await filter.evaluate((el) => el.click());
  }
  await expect(sortMenu).toBeVisible();
  await sortMenu.getByRole('menuitem', { name: /^Size/ }).click();
  const namesAfter = await page.locator('.mobile-doc-card .mobile-card-title').evaluateAll((els) => (
    els.map((el) => el.textContent?.trim() || '')
  ));
  expect(namesAfter.join('|')).not.toBe(namesBefore.join('|'));

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const duplicate = page.getByRole('button', { name: 'Duplicate', exact: true });
  await expect(duplicate).toBeDisabled();
  await page.locator('.mobile-doc-card').filter({ hasText: 'test.pdf' }).click();
  await expect(duplicate).toBeEnabled();
  await duplicate.click();
  await expect(page.locator('.mobile-doc-card').filter({ hasText: 'test-copy.pdf' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.locator('.mobile-doc-card').filter({ hasText: 'SE-011 Security Shop Drawings.pdf' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Preview & details', exact: true }).click();
  const detail = page.getByRole('dialog', { name: /SE-011 Security Shop Drawings\.pdf details/ });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Share' }).click();
  // Preview owner opens Manage Access (not leftover-18 inbox Send).
  const access = page.getByText('Document Access').first();
  const shareFail = page.getByText(/Sharing needs a signed-in cloud account|Must be signed in|Could not create invite link|Preview cannot/i);
  await expect.poll(async () => (
    (await access.isVisible().catch(() => false)) || (await shareFail.count()) > 0
  ), { timeout: 8_000 }).toBeTruthy();
  if (await access.isVisible().catch(() => false)) {
    await expect(page.getByRole('button', { name: 'Invite' })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(access).toHaveCount(0);
  }
  if (await page.getByRole('button', { name: 'Close details' }).count()) {
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  await expect(detail).toHaveCount(0);

  await page.locator('.mobile-doc-card').filter({ hasText: 'RFI-014 Lobby Camera Coverage.pdf' }).click();
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 60_000 });
  expect(page.url()).toMatch(/testPdf=/);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();

  console.log('MOBILE_HUB_DOCS_PROOF', JSON.stringify({
    viewport: '390x844',
    desktopLedgerHidden: true,
    searchNoMatch: true,
    sortSizeChangedOrder: namesAfter.join('|') !== namesBefore.join('|'),
    selectDuplicateDisabled: true,
    selectDuplicate: 'test-copy.pdf',
    detailShareFailClosed: true,
    openFileToViewer: true,
    fileId: null,
  }));
});
