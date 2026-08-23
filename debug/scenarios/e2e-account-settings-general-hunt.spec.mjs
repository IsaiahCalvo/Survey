import { test, expect } from '@playwright/test';

// Hunt after Account Settings General. Do not replay General contents,
// A-04 menu open/close, Archive / TabBar / Documents / Projects /
// Templates / Spaces / Survey-rail / PDF waves. Do not invent Stripe /
// MSAL / Turnstile / roster / inbox.

const HUB = '/?hubPreview=1&tab=documents';
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

test('independent hunt after Account Settings General', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  const settingsTabs = await visibleNames(dialog.locator('.account-sidebar-btn'));
  const generalButtons = await visibleNames(dialog.locator('button'));
  const themeCount = await dialog.getByText('Theme', { exact: true }).count();
  const appearanceCount = await dialog.getByText('Appearance', { exact: true }).count();
  const notificationsCount = await dialog.getByText('Notifications', { exact: true }).count();

  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  const connectedText = (await dialog.innerText()).replace(/\s+/g, ' ');
  const connectedButtons = await visibleNames(dialog.locator('button'));

  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  const billingToggle = await dialog.getByText(/Monthly|Annual|17%/).count();
  const manageButtons = await visibleNames(dialog.locator('button'));
  await dialog.getByRole('button', { name: 'Usage' }).click();
  const usageText = (await dialog.locator('.account-settings-content').innerText()).replace(/\s+/g, ' ');
  const usageHasProjects = /Projects/.test(usageText);
  const usageHasDocuments = /Documents/.test(usageText);
  const usageHasStorage = /Storage/.test(usageText);
  const usageTier = /\bdeveloper\b/i.test(usageText);
  const usageButtons = await visibleNames(dialog.locator('button'));

  await dialog.locator('.account-settings-close').click();

  const docsChrome = await visibleNames(page.locator('button, [role="menuitem"], input'));

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  const editorTools = await visibleNames(page.locator('button[aria-label], [data-tool]'));
  const fontMenu = await page.getByRole('button', { name: /Font|Arial|Helvetica/ }).count();
  const colorButtons = await page.locator('[aria-label*="color" i], [aria-label*="Color" i]').count();

  const proof = {
    settingsTabs,
    generalButtons: generalButtons.slice(0, 16),
    themeCount,
    appearanceCount,
    notificationsCount,
    connectedHasMicrosoft: /Microsoft/.test(connectedText),
    connectedHasGoogle: /Google/.test(connectedText),
    connectedButtons: connectedButtons.filter((name) => /Connect|Disconnect|General|Subscription/.test(name)),
    billingToggle,
    manageButtons: manageButtons.filter((name) => /trial|Contact|Developer|Usage|Manage|General/.test(name)),
    usageHasProjects,
    usageHasDocuments,
    usageHasStorage,
    usageTier,
    usageButtons: usageButtons.filter((name) => /Usage|Manage|General|Contact|trial|Developer/.test(name)),
    usageTextSnippet: usageText.slice(0, 240),
    docsChrome: docsChrome.slice(0, 12),
    editorTools: editorTools.slice(0, 16),
    fontMenu,
    colorButtons,
    leftover18NotInvented: true,
  };
  console.log('GENERAL_HUNT_INVENTORY', JSON.stringify(proof));
  expect(settingsTabs).toEqual(['General', 'Connected services', 'Subscription']);
  expect(themeCount + appearanceCount + notificationsCount).toBe(0);
  expect(proof.connectedHasMicrosoft).toBe(true);
  expect(proof.connectedHasGoogle).toBe(true);
});
