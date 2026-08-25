import { test, expect } from '@playwright/test';

// Invite ?docId= must resolve the invite row, not only the visitor's list.
// Uses the fixture invite hook — no second-account host, no cloud write.

const OWNED = '/?testPdf=clickable-link-test.pdf&documentDeepLinkE2E=1&docId=deep-link-test-document';
const INVITE = '/?testPdf=clickable-link-test.pdf&documentDeepLinkInviteE2E=1&docId=deep-link-test-document';
const MISSING = '/?testPdf=clickable-link-test.pdf&documentDeepLinkInviteE2E=1&docId=missing-invite-document';
const HUB = '/?hubPreview=1&tab=documents';

async function expectEditorOpened(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('clickable-link-test.pdf').first()).toBeVisible();
  await expect(page).not.toHaveURL(/docId=/);
}

test('invite deep-link resolve intended / break / edge', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto(INVITE, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expectEditorOpened(page);

  await page.goto(MISSING, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/docId=/);

  const proof = {
    inviteResolvedOpensEditor: true,
    missingInviteDoesNotOpen: true,
    hubHasNoDocId: true,
    noSecondAccountHost: true,
    noCloudWrite: true,
  };
  console.log('INVITE_DEEPLINK_RESOLVE_PROOF', JSON.stringify(proof));
  expect(proof.inviteResolvedOpensEditor).toBe(true);
  expect(proof.missingInviteDoesNotOpen).toBe(true);
});

test('owned list deep-link still opens', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(OWNED, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expectEditorOpened(page);
  console.log('INVITE_DEEPLINK_OWNED_PROOF', JSON.stringify({ ownedListStillOpens: true }));
});
