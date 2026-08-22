import { test, expect } from '@playwright/test';

// Unique leftover after Hub Documents extras catalog (do not replay
// search/rename/delete/copy/paste/duplicate/sort/preview): Documents
// Lock persist. Confirm the real More → Lock document control, then
// prove persist is fail-closed on hubPreview (no onLockDocument; Dashboard
// lockDocument needs a real id — leftover-18). Do not invent preview lock.
// Do not invent Print / stamp / measure / Group / Extract / Note-Link.

const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const OWNER_DOC = 'SE-011 Security Shop Drawings.pdf';
const OTHER_DOC = 'Package 2 — Rev 4 — IC.pdf';
const TEST_DOC = 'test.pdf';

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function desktopRow(page, name) {
  return page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: name }).first();
}

async function openDesktopMore(page, name) {
  await desktopRow(page, name).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

function lockItem(page) {
  return page.getByRole('menuitem', { name: /Lock document|Unlock document/ });
}

test('Hub Documents Lock persist intended + break + edge', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  const emptyLock = await page.getByRole('menuitem', { name: /Lock document|Unlock document/ }).count();
  const emptyMore = await page.getByRole('button', { name: 'More' }).count();
  expect(emptyLock, 'empty documents have no Lock menu').toBe(0);

  await openHub(page, { url: HUB_GUEST });
  const guestDialog = page.getByRole('dialog');
  if (await guestDialog.getByRole('button', { name: 'Continue without an account' }).isVisible().catch(() => false)) {
    await guestDialog.getByRole('button', { name: 'Continue without an account' }).click();
  }
  await expect(page.getByText(OWNER_DOC).first()).toBeVisible({ timeout: 15_000 });
  await openDesktopMore(page, OWNER_DOC);
  const guestLock = lockItem(page);
  await expect(guestLock).toBeVisible();
  await expect(guestLock).toBeDisabled();
  await page.keyboard.press('Escape');

  await openHub(page);
  await expect(page.getByText(OWNER_DOC).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TEST_DOC).first()).toBeVisible();

  await openDesktopMore(page, OWNER_DOC);
  const ownerLock = lockItem(page);
  await expect(ownerLock).toHaveText('Lock document');
  await expect(ownerLock).toBeEnabled();
  await ownerLock.click();
  await expect(page.getByRole('dialog', { name: /Lock this document/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Lock document|Unlock document/ })).toHaveCount(0);

  await openDesktopMore(page, OWNER_DOC);
  await expect(lockItem(page)).toHaveText('Lock document');
  await expect(page.getByRole('menuitem', { name: 'Unlock document', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openDesktopMore(page, OTHER_DOC);
  await expect(lockItem(page)).toHaveText('Lock document');
  await expect(lockItem(page)).toBeDisabled();
  await page.keyboard.press('Escape');

  await openDesktopMore(page, TEST_DOC);
  await expect(lockItem(page)).toHaveText('Lock document');
  await expect(lockItem(page)).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(OWNER_DOC).first()).toBeVisible({ timeout: 15_000 });
  await openDesktopMore(page, OWNER_DOC);
  await expect(lockItem(page)).toHaveText('Lock document');
  await page.keyboard.press('Escape');

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileCard = page.locator('.mobile-doc-card').filter({ hasText: 'SE-011' }).first();
  let mobileLock = 0;
  let mobileStillLock = false;
  if (await mobileCard.isVisible().catch(() => false)) {
    await mobileCard.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    const mobileItem = lockItem(page);
    await expect(mobileItem).toHaveText('Lock document');
    await expect(mobileItem).toBeEnabled();
    mobileLock = 1;
    await mobileItem.click();
    await expect(page.getByRole('dialog', { name: /Lock this document/ })).toHaveCount(0);
    await mobileCard.getByRole('button', { name: 'More' }).click();
    await expect(lockItem(page)).toHaveText('Lock document');
    mobileStillLock = true;
    await page.keyboard.press('Escape');
  }

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    HUB_DOCS_LOCK_PERSIST_PROOF: {
      emptyLock,
      emptyMore,
      guestDisabled: true,
      ownerEnabled: true,
      persistFailClosed: true,
      unlockNeverAppeared: true,
      nonOwnerDisabled: true,
      isolation: true,
      noFileId: fileId === null,
      mobileLock,
      mobileStillLock,
    },
  }));
});
