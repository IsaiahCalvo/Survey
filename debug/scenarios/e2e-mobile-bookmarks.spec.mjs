import { test, expect } from '@playwright/test';

// Unique unblocked GAP after Eraser Size every-preset:
// mobile Bookmarks create / up-down / jump. Desktop V-07 is dnd-kit;
// 390 chrome hit-targets opened Spaces + History, not this sheet.
// Do not replay leftover-18, eraser Size, Counter Size, F3, Search,
// keyboard, every-swatch, hub extras, waves 5–13. No 768 tablet pass
// (source breakpoint is max-width: 720px only). Do not stamp file.id.

const MULTI_PDF = '/?testPdf=spike-120-pages.pdf';

async function openMobileEditor(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(MULTI_PDF);
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function openMobileBookmarks(page) {
  const hubClose = page.getByRole('button', { name: 'Close document hub' });
  const dock = page.getByRole('button', { name: 'Open pages, search, and bookmarks' });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  if (!(await hubClose.isVisible().catch(() => false))) {
    await dock.click();
  }
  await expect(hubClose).toBeVisible({ timeout: 15_000 });
  const bookmarksTab = page.locator('.mobile-pdf-hub-tab').filter({ hasText: 'Bookmarks' })
    .or(page.getByRole('button', { name: 'Bookmarks', exact: true }));
  await expect(bookmarksTab.first()).toBeVisible({ timeout: 15_000 });
  await bookmarksTab.first().click();
  await expect(page.getByRole('button', { name: /Add bookmark|Cancel new bookmark/ })).toBeVisible({ timeout: 15_000 });
}

function bookmarkRow(page, name) {
  return page.locator('.mobile-bookmark-row').filter({ hasText: name });
}

async function titles(page) {
  return page.locator('.mobile-bookmark-title').evaluateAll((els) => (
    els.map((el) => el.textContent?.trim() || '').filter(Boolean)
  ));
}

async function addBookmark(page, name, pageNumber) {
  const add = page.getByRole('button', { name: 'Add bookmark', exact: true });
  if (await add.count()) await add.click();
  const editor = page.locator('.mobile-bookmark-editor[aria-label="New bookmark"]');
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Bookmark name' }).fill(name);
  await editor.getByRole('spinbutton', { name: 'Bookmark page' }).fill(String(pageNumber));
  await editor.getByRole('button', { name: 'Create', exact: true }).click();
}

test('mobile Bookmarks create / up-down / jump intended + break + edge', async ({ page }) => {
  await openMobileEditor(page);
  await openMobileBookmarks(page);

  const alpha = `E2E-MB-A-${Date.now()}`;
  const bravo = `E2E-MB-B-${Date.now()}`;

  await addBookmark(page, alpha, 1);
  await expect(bookmarkRow(page, alpha)).toBeVisible({ timeout: 10_000 });
  await addBookmark(page, bravo, 1);
  await expect(bookmarkRow(page, bravo)).toBeVisible({ timeout: 10_000 });

  const names = await titles(page);
  const alphaAt = names.indexOf(alpha);
  const bravoAt = names.indexOf(bravo);
  expect(alphaAt).toBeGreaterThan(-1);
  expect(bravoAt).toBe(alphaAt + 1);

  const firstName = names[0];
  await expect(bookmarkRow(page, firstName).getByRole('button', { name: 'Move bookmark up' })).toBeDisabled();
  await expect(bookmarkRow(page, bravo).getByRole('button', { name: 'Move bookmark down' })).toBeDisabled();

  await bookmarkRow(page, bravo).getByRole('button', { name: 'Move bookmark up' }).click();
  await expect.poll(async () => {
    const next = await titles(page);
    return next.indexOf(bravo) < next.indexOf(alpha);
  }).toBeTruthy();

  await bookmarkRow(page, bravo).getByRole('button', { name: 'Move bookmark down' }).click();
  await expect.poll(async () => {
    const next = await titles(page);
    return next.indexOf(alpha) < next.indexOf(bravo);
  }).toBeTruthy();

  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  const editor = page.locator('.mobile-bookmark-editor[aria-label="New bookmark"]');
  await editor.getByRole('textbox', { name: 'Bookmark name' }).fill('   ');
  await editor.getByRole('spinbutton', { name: 'Bookmark page' }).fill('1');
  await editor.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Please enter a bookmark name/i })).toBeVisible();

  await editor.getByRole('textbox', { name: 'Bookmark name' }).fill('E2E-MB-bad-page');
  await editor.getByRole('spinbutton', { name: 'Bookmark page' }).fill('0');
  await editor.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /page number between 1 and 120/i })).toBeVisible();

  await editor.getByRole('spinbutton', { name: 'Bookmark page' }).fill('999');
  await editor.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /page number between 1 and 120/i })).toBeVisible();
  await expect(bookmarkRow(page, 'E2E-MB-bad-page')).toHaveCount(0);

  await editor.getByRole('textbox', { name: 'Bookmark name' }).fill(alpha);
  await editor.getByRole('spinbutton', { name: 'Bookmark page' }).fill('1');
  await editor.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /already exists/i })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel new bookmark' }).click();
  await expect(editor).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await bookmarkRow(page, bravo).getByRole('button', { name: `Delete bookmark ${bravo}` }).click();
  await expect(bookmarkRow(page, bravo)).toHaveCount(0);
  await expect(bookmarkRow(page, alpha)).toBeVisible();

  const jumper = `E2E-MB-P3-${Date.now()}`;
  await addBookmark(page, jumper, 3);
  await expect(bookmarkRow(page, jumper)).toBeVisible();
  await bookmarkRow(page, jumper).getByRole('button', { name: `Open bookmark ${jumper}` }).click();
  await expect.poll(async () => (
    (await page.getByRole('button', { name: 'Jump to page' }).innerText()).replace(/\s+/g, '')
  )).toMatch(/^3\//);

  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();

  console.log('MOBILE_BOOKMARKS_PROOF', JSON.stringify({
    viewport: '390x844',
    created: [alpha, bravo],
    upDownSwapped: true,
    firstUpDisabled: true,
    lastDownDisabled: true,
    emptyNameRejected: true,
    page0and999Rejected: true,
    clashRejected: true,
    deleteAccepted: true,
    jumpedTo: 3,
    fileId: null,
  }));
});
