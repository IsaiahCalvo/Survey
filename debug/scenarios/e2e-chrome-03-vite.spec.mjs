import { test, expect } from '@playwright/test';

/**
 * E2E-CHROME-03 — Vite-reachable surface (no MSAL / Excel host / Stripe Checkout).
 * Intended + break + edge on 5173 `?hubPreview=1` / `?testPdf=`.
 */

const HUB = '/?hubPreview=1&tab=documents';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';

async function openSettings(page) {
  await page.goto(HUB);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
}

test('E2E-CHROME-03 A-02 Microsoft Connect fail-closed (no MSAL host)', async ({ page }) => {
  await openSettings(page);
  const dialog = page.locator('.account-settings-modal');

  // Intended: Connect chrome is offered on localhost (Capacitor hide is false).
  await dialog.getByRole('button', { name: 'Connected services' }).click();
  await expect(dialog.getByText('Microsoft')).toBeVisible();
  await expect(dialog.getByText('Not connected. Connect to sync exported surveys')).toBeVisible();
  const connect = dialog.getByRole('button', { name: 'Connect', exact: true }).first();
  await expect(connect).toBeVisible();
  await expect(connect).toBeEnabled();

  const capacitorHidden = await page.evaluate(() => {
    const origin = String(window.location?.origin || '');
    return origin.startsWith('capacitor://') || origin.startsWith('ionic://');
  });
  expect(capacitorHidden).toBe(false);

  // Break: Connect does not start MSAL / OneDrive.
  const popupPromise = page.waitForEvent('popup', { timeout: 1500 }).catch(() => null);
  await connect.click();
  await expect(dialog.locator('.account-error')).toContainText(/Failed to connect Microsoft|Preview cannot/i);
  expect(await popupPromise).toBeNull();
  await expect(page).not.toHaveURL(/login\.microsoftonline|onedrive\.live/i);

  // Edge: still Not connected; no invented token.
  await expect(dialog.getByText('Not connected. Connect to sync exported surveys')).toBeVisible();

  console.log('CHROME03_A02_PROOF', JSON.stringify({
    connectVisible: true,
    failClosed: true,
    noMsalPopup: true,
    capacitorHidden,
  }));
});

test('E2E-CHROME-03 A-05 billing catalog + return query (no Stripe click)', async ({ page }) => {
  const opened = [];
  await page.exposeFunction('__chrome03RecordOpen', (url) => { opened.push(String(url || '')); });
  await page.addInitScript(() => {
    window.open = (url) => {
      window.__chrome03RecordOpen?.(url);
      return null;
    };
  });

  await openSettings(page);
  const dialog = page.locator('.account-settings-modal');

  // Intended: Pro / Enterprise catalog. Start trial visible; do not click it.
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manage subscription' }).click();
  await expect(dialog.getByText('Pro', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('Enterprise').first()).toBeVisible();
  const trial = dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial|Developer account/ });
  await expect(trial).toBeVisible();
  const contact = dialog.getByRole('button', { name: 'Contact sales' });
  await expect(contact).toBeVisible();

  // Break: Contact sales is mailto (no Checkout). Do not click Start trial.
  await contact.click();
  await expect.poll(() => opened.length, { timeout: 5_000 }).toBe(1);
  expect(opened[0]).toMatch(/^mailto:/i);
  expect(opened[0]).toMatch(/Enterprise Plan Inquiry/);
  expect(opened[0]).not.toMatch(/checkout\.stripe|billing\.stripe/i);
  await expect(page).not.toHaveURL(/checkout\.stripe|billing\.stripe/i);

  // Edge: Stripe return query toasts without a Checkout host. Junk query does not.
  await page.goto('/?hubPreview=1&tab=documents&billing=nope');
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.goto('/?hubPreview=1&tab=documents&billing=cancelled');
  await expect(page.getByRole('status').filter({ hasText: 'Checkout cancelled.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get('billing')).toBeNull();

  console.log('CHROME03_A05_PROOF', JSON.stringify({
    catalog: true,
    trialVisibleNotClicked: true,
    contactMailto: true,
    stripeNotOpened: true,
    junkQueryNoToast: true,
    cancelledToast: true,
  }));
});

test('E2E-CHROME-03 X-06 Excel EXPORT without host workbook', async ({ page }) => {
  await page.goto(SURVEY_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();

  // Intended: local EXPORT downloads .xlsx (no Excel host).
  const exportBtn = page.locator('.survey-marker-export-compact-button').first();
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);

  // Break: no linked workbook → Microsoft 365 push is not enabled.
  const sync365 = page.getByText('Sync Microsoft 365');
  if (await sync365.count()) {
    const row = sync365.locator('xpath=ancestor::*[self::button or self::div][1]');
    await expect(row).toBeDisabled();
  }
  await expect(page).not.toHaveURL(/graph\.microsoft|onedrive/i);

  // Edge: testPdf has no file.id; Live Sync host row is OneDrive-only.
  const fileIdCount = await page.locator('[data-document-id]').count();
  expect(fileIdCount).toBe(0);
  expect(await page.getByText('Live Sync', { exact: true }).count()).toBe(0);

  console.log('CHROME03_X06_PROOF', JSON.stringify({
    filename: download.suggestedFilename(),
    hostWorkbook: false,
    liveSyncHidden: true,
    fileIdAbsent: true,
  }));
});
