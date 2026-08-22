import { test, expect } from '@playwright/test';

// Independent hunt after Archive Select. Classify A-04 Account menu on
// hubPreview + ?testPdf=. Do NOT replay the dedicated A-04 / UL-13 / UL-15–18
// / UL-20–22 AccountSettings pane suite (e2e-helper-only-live,
// e2e-hubpreview-noop-hunt, e2e-silent-stub-hunt). Do NOT invent Stripe /
// MSAL / Turnstile / roster / inbox. Do NOT replay Archive Search / Preview /
// Select; TabBar Close tab; Documents extras + Lock persist + Open file;
// Projects family; Templates family; Spaces; Survey-rail; PDF waves.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

function accountChip(page) {
  return page.getByRole('button', { name: 'Open account menu' });
}

test('independent hunt: classify A-04 account menu vs leftover-18', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });

  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await expect(accountChip(page)).toBeVisible();
  await expect(page.locator('.profile-signin')).toHaveCount(0);

  const chipMeta = await page.locator('.who .name, .who .who-meta').allTextContents();
  await accountChip(page).click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  const menuItems = await visibleNames(menu.locator('button, [role="menuitem"]'));
  const menuText = await menu.innerText();
  const desktopArchiveInMenu = await menu.getByRole('button', { name: 'Archive', exact: true }).count();
  const settingsInMenu = await menu.getByRole('button', { name: 'Settings', exact: true }).count();
  const signOutInMenu = await menu.getByRole('button', { name: 'Sign out', exact: true }).count();

  // Local chrome: Settings opens AccountSettings (SurveyHub.setSettingsOpen).
  // HubPreview onSettings is an observer console.log — not the open path.
  await menu.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const settingsTabs = await visibleNames(dialog.locator('button').filter({ hasText: /General|Connected services|Subscription/ }));
  await dialog.locator('.account-settings-close').click();
  await expect(dialog).toHaveCount(0);
  await expect(accountChip(page)).toBeVisible();

  // Local chrome: Sign out confirm / Cancel. Do not invent session teardown.
  await accountChip(page).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.profile-signout-copy')).toContainText('Sign out of Survey?');
  await page.locator('.profile-signout-buttons button', { hasText: 'Cancel' }).click();
  await expect(page.locator('.profile-signout-copy')).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'Account menu' })).toBeVisible();
  await expect(accountChip(page)).toBeVisible();

  // Escape / scrim close (Cancel leaves the menu open).
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Account menu' })).toHaveCount(0);

  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 15_000 });
  const projectsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  const templatesChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));
  await page.locator('aside.side nav').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible({ timeout: 15_000 });
  const archiveChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));

  // Guest: Sign in chip, no account menu. A-01 leftover-18 Turnstile.
  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.profile-signin').first()).toBeVisible({ timeout: 30_000 });
  await expect(accountChip(page)).toHaveCount(0);
  const guestAuth = page.locator('.auth-modal');
  await expect(guestAuth).toBeVisible({ timeout: 15_000 });
  await expect(guestAuth.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  // Editor: no account chip. Home (Dashboard hub) has the same A-04 menu.
  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  const editorAccountMounted = await accountChip(page).count();
  const editorAccountReachable = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label="Open account menu"]');
    if (!btn) return false;
    const rect = btn.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!(hit && (hit === btn || btn.contains(hit) || hit.closest?.('[aria-label="Open account menu"]')));
  });
  await page.locator('.tab-bar').getByText('Home', { exact: true }).click();
  await expect(accountChip(page)).toBeVisible({ timeout: 30_000 });
  await accountChip(page).click();
  const testPdfMenu = page.getByRole('menu', { name: 'Account menu' });
  await expect(testPdfMenu).toBeVisible();
  const testPdfMenuItems = await visibleNames(testPdfMenu.locator('button, [role="menuitem"]'));
  await testPdfMenu.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.account-settings-modal')).toBeVisible({ timeout: 15_000 });
  await page.locator('.account-settings-close').click();

  // 390: account menu includes Archive nav (same destination as rail Archive).
  await openPage(page, { width: 390, height: 844, url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileChip = page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' });
  await expect(mobileChip).toBeVisible();
  await mobileChip.click();
  const mobileMenu = page.getByRole('menu', { name: 'Account menu' });
  await expect(mobileMenu).toBeVisible();
  const mobileMenuItems = await visibleNames(mobileMenu.locator('button, [role="menuitem"]'));
  await expect(mobileMenu.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await mobileMenu.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
  await expect(page.getByRole('menu', { name: 'Account menu' })).toHaveCount(0);

  const proof = {
    chipMeta: chipMeta.map((s) => s.trim()).filter(Boolean),
    menuItems,
    menuHasEmail: /dev-hubpreview@example\.invalid/.test(menuText),
    desktopArchiveInMenu,
    settingsInMenu,
    signOutInMenu,
    settingsOpened: true,
    settingsTabs,
    signOutCancelKeepsChip: true,
    guestSignIn: true,
    editorAccountMounted,
    editorAccountReachable,
    testPdfHomeHasMenu: true,
    testPdfMenuItems,
    mobileMenuItems,
    docsChrome: docsChrome.slice(0, 16),
    projectsChrome: projectsChrome.slice(0, 12),
    templatesChrome: templatesChrome.slice(0, 12),
    archiveChrome: archiveChrome.slice(0, 16),
    a04AlreadyDedicatedSlice: true,
    leftover18NotInvented: true,
  };
  console.log('HUNT_INVENTORY', JSON.stringify(proof));
  expect(settingsInMenu).toBe(1);
  expect(signOutInMenu).toBe(1);
  expect(desktopArchiveInMenu).toBe(0);
  expect(editorAccountReachable).toBe(false);
  expect(editorAccountMounted).toBeGreaterThan(0);
});
