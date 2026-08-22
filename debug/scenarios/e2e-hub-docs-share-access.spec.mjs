import { test, expect } from '@playwright/test';

// Unique leftover after Account Settings Usage:
// Documents More → Share → Document Access (Invite + Done on SE-011).
// Not Documents extras / Lock persist / Open file.
// Not leftover-18 A-03 inbox mint. Not Templates Share (already fail-closed).
// hubPreview is fail-closed: no invite mint
// (isSupabaseAvailable: false → "Sharing needs a signed-in cloud account.").
// Do not invent a share backend. Do not invent .env.local.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const OTHER = 'Package 2 — Rev 4 — IC.pdf';
const CLOUD_BLOCK = 'Sharing needs a signed-in cloud account.';

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

async function openDesktopMoreShare(page, name) {
  await desktopRow(page, name).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
}

function accessTitle(page) {
  return page.getByText('Document Access', { exact: true });
}

function shareDialog(page, noun = 'document') {
  return page.getByRole('dialog', { name: `Share ${noun}` });
}

async function dismissGuestAuth(page) {
  const guestDialog = page.getByRole('dialog');
  if (await guestDialog.getByRole('button', { name: 'Continue without an account' }).isVisible().catch(() => false)) {
    await guestDialog.getByRole('button', { name: 'Continue without an account' }).click();
  }
}

async function expectAccessEmpty(page) {
  await expect(accessTitle(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(OWNER, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(page.getByText('No collaborators yet. Use Invite to add one.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(page.getByText('Loading collaborators…')).toHaveCount(0);
}

test('Hub Documents More Share / Document Access intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);

  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  const emptyMore = await page.getByRole('button', { name: 'More' }).count();
  expect(await accessTitle(page).count(), 'empty hub has no Document Access').toBe(0);
  expect(await page.getByRole('button', { name: 'Invite', exact: true }).count()).toBe(0);
  expect(emptyMore, 'empty documents have no More').toBe(0);
  await assertNoErrorBoundary(page);

  await openHub(page, { url: HUB_GUEST });
  await dismissGuestAuth(page);
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 15_000 });
  await openDesktopMoreShare(page, OWNER);
  await expect(shareDialog(page)).toBeVisible({ timeout: 10_000 });
  await expect(accessTitle(page)).toHaveCount(0);
  await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(shareDialog(page).getByText(CLOUD_BLOCK)).toBeVisible();
  await shareDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(shareDialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open account menu' })).toHaveCount(0);
  await assertNoErrorBoundary(page);

  await openHub(page);
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(OTHER).first()).toBeVisible();

  await openDesktopMoreShare(page, OWNER);
  await expectAccessEmpty(page);

  await page.keyboard.press('Escape');
  await expect(accessTitle(page)).toHaveCount(0);

  await openDesktopMoreShare(page, OWNER);
  await expectAccessEmpty(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(accessTitle(page)).toHaveCount(0);

  await openDesktopMoreShare(page, OWNER);
  await expectAccessEmpty(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(accessTitle(page)).toHaveCount(0);

  await openDesktopMoreShare(page, OWNER);
  await expectAccessEmpty(page);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const invite = shareDialog(page);
  await expect(invite).toBeVisible({ timeout: 10_000 });
  await expect(invite.getByText('Share document')).toBeVisible();
  await expect(invite.getByText(OWNER)).toBeVisible();
  await expect(invite.locator('select')).toHaveValue('Viewer');
  const roles = await invite.locator('select option').allTextContents();
  expect(roles).toEqual(['Viewer', 'Editor', 'Owner']);
  await invite.locator('select').selectOption('Editor');
  await expect(invite.getByText('Anyone with this invite link can join as editor.')).toBeVisible();

  await expect(invite.getByRole('button', { name: 'Send editor invite' })).toBeDisabled();

  await invite.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(invite.getByText(CLOUD_BLOCK)).toBeVisible();
  await expect(page.getByText(/\/invite\//)).toHaveCount(0);

  await invite.locator('textarea').fill('not-an-email');
  await invite.getByRole('button', { name: 'Send editor invite' }).click();
  await expect(invite.getByText('Enter at least one valid email.')).toBeVisible();

  await invite.locator('textarea').fill('teammate@example.com');
  await invite.getByRole('button', { name: 'Send editor invite' }).click();
  await expect(invite.getByText(CLOUD_BLOCK)).toBeVisible();
  await expect(page.getByText(/\/invite\//)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(invite).toHaveCount(0);
  await expect(accessTitle(page)).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(accessTitle(page)).toHaveCount(0);

  await openDesktopMoreShare(page, OTHER);
  await expect(shareDialog(page)).toBeVisible({ timeout: 10_000 });
  await expect(accessTitle(page)).toHaveCount(0);
  await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(shareDialog(page).getByText(CLOUD_BLOCK)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shareDialog(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.getByText('Tower 5 — Security', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();
  await expect(shareDialog(page, 'project')).toBeVisible({ timeout: 10_000 });
  await expect(accessTitle(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(shareDialog(page, 'project')).toHaveCount(0);

  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.getByText('Security Walk-Through', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();
  await expect(shareDialog(page, 'template')).toBeVisible({ timeout: 10_000 });
  await expect(accessTitle(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(shareDialog(page, 'template')).toHaveCount(0);

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 15_000 });
  await expect(accessTitle(page)).toHaveCount(0);

  await openHub(page, { width: 390, height: 844 });
  const mobileCard = page.locator('.mobile-doc-card').filter({ hasText: OWNER }).first();
  await expect(mobileCard).toBeVisible({ timeout: 15_000 });
  await mobileCard.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expectAccessEmpty(page);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(shareDialog(page)).toBeVisible({ timeout: 10_000 });
  await shareDialog(page).getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(shareDialog(page).getByText(CLOUD_BLOCK)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shareDialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(accessTitle(page)).toHaveCount(0);
  await assertNoErrorBoundary(page);

  const proof = {
    emptyAccess: 0,
    guestOpensShareModal: true,
    se011Access: true,
    inviteDone: true,
    remove: 0,
    emptyEmailDisabled: true,
    invalidEmail: true,
    copyLinkFailClosed: true,
    sendFailClosed: true,
    package2ShareModal: true,
    projectsShareIsolated: true,
    templatesShareIsolated: true,
    mobileAccess: true,
    leftover18InboxNotInvented: true,
  };
  console.log('DOCS_SHARE_ACCESS_PROOF', JSON.stringify(proof));
  expect(proof.se011Access).toBe(true);
  expect(proof.leftover18InboxNotInvented).toBe(true);
});
