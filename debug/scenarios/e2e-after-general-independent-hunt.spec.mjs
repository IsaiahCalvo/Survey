import { test, expect } from '@playwright/test';

// Independent hunt after Account Settings General.
// Do not treat the last General-hunt receipt as truth.
// Do not replay General pane contents as the main slice.
// Do not replay A-04 menu, Archive family, TabBar Close, Documents extras /
// Lock persist / Open file, Projects family, Templates family, Spaces,
// Survey-rail, dedicated PDF waves.

const HUB = '/?hubPreview=1';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';

const TABS = ['documents', 'projects', 'templates', 'archive'];

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 60)
  ));
}

function desktopDocRow(page, name) {
  return page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: name }).first();
}

test('independent hunt after General — live chrome catalog', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    tabs: {},
    settings: {},
    documentsShare: {},
    editor: {},
  };

  await openPage(page, { url: `${HUB}&tab=documents` });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  for (const tab of TABS) {
    await page.goto(`${HUB}&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const buttons = await visibleNames(page.locator('button, [role="menuitem"], input, [role="tab"]'));
    const moreCount = await page.getByRole('button', { name: 'More' }).count();
    inventory.tabs[tab] = { buttons: buttons.slice(0, 24), moreCount };
  }

  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByText('SE-011 Security Shop Drawings.pdf').first()).toBeVisible({ timeout: 20_000 });

  await desktopDocRow(page, 'SE-011 Security Shop Drawings.pdf').getByRole('button', { name: 'More' }).click();
  const se011More = await visibleNames(page.getByRole('menuitem'));
  inventory.documentsShare.se011More = se011More;
  const shareItem = page.getByRole('menuitem', { name: 'Share', exact: true });
  await expect(shareItem).toBeVisible();
  await shareItem.click();

  const accessHeading = page.getByText('Document Access', { exact: true });
  const shareDialog = page.getByRole('dialog').filter({ hasText: /Share|Invite/ });
  const accessVisible = await accessHeading.isVisible().catch(() => false);
  const shareModalVisible = await shareDialog.first().isVisible().catch(() => false);
  const accessText = accessVisible
    ? (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 800)
    : '';
  inventory.documentsShare.se011 = {
    accessVisible,
    shareModalVisible,
    emptyCopy: /No collaborators yet/.test(accessText),
    invite: accessVisible && await page.getByRole('button', { name: 'Invite', exact: true }).count(),
    done: accessVisible && await page.getByRole('button', { name: 'Done', exact: true }).count(),
    remove: accessVisible && await page.getByRole('button', { name: 'Remove' }).count(),
    snippet: accessText.slice(0, 280),
  };
  if (accessVisible) {
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  } else if (shareModalVisible) {
    await page.keyboard.press('Escape');
  }

  await desktopDocRow(page, 'Package 2 — Rev 4 — IC.pdf').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  const pkgAccess = await page.getByText('Document Access', { exact: true }).isVisible().catch(() => false);
  const pkgShare = await page.getByText(/Must be signed in|Sharing needs a signed-in|Share document|Invite by email|Copy link/i).first().isVisible().catch(() => false);
  inventory.documentsShare.package2 = { accessVisible: pkgAccess, shareModalLikely: pkgShare };
  await page.keyboard.press('Escape');
  if (await page.getByText('Document Access', { exact: true }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }

  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  inventory.settings.tabs = await visibleNames(dialog.locator('.account-sidebar-btn'));

  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Usage', exact: true })).toBeVisible();
  const manageText = (await dialog.locator('.account-settings-content').innerText()).replace(/\s+/g, ' ');
  inventory.settings.manageHasRetry = /Retry/.test(manageText);
  inventory.settings.manageHasLoading = /Loading subscription/.test(manageText);
  inventory.settings.manageHasPlans = /Pro|Enterprise|Current plan|Developer account/.test(manageText);
  inventory.settings.billingToggle = await dialog.getByText(/Monthly|Annual|17%/).count();

  await dialog.getByRole('button', { name: 'Usage', exact: true }).click();
  await page.waitForTimeout(800);
  const usageSection = dialog.locator('.account-section').filter({ has: page.locator('h3', { hasText: /^Usage$/ }) });
  const usageVisible = await usageSection.isVisible().catch(() => false);
  const usageText = usageVisible
    ? (await usageSection.innerText()).replace(/\s+/g, ' ')
    : (await dialog.locator('.account-settings-content').innerText()).replace(/\s+/g, ' ');
  inventory.settings.usage = {
    usageVisible,
    hasProjects: /Projects/.test(usageText),
    hasDocuments: /Documents/.test(usageText),
    hasStorage: /Storage/.test(usageText),
    hasTier: /developer|pro|free|enterprise/i.test(usageText),
    hasRetry: /Retry/.test(usageText),
    snippet: usageText.slice(0, 240),
  };
  await dialog.locator('.account-settings-close').click();

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.editor.restTools = await visibleNames(page.locator('button[aria-label], [data-tool]'));
  inventory.editor.fontAtRest = await page.getByRole('button', { name: /Font|Arial|Helvetica/ }).count();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  inventory.editor.fontArmed = await page.getByRole('button', { name: /Font|Arial|Helvetica/ }).count();
  inventory.editor.boldArmed = await page.getByRole('button', { name: /Bold/i }).count();
  inventory.editor.export = await page.getByRole('button', { name: /Export/i }).count();
  inventory.editor.saveVersion = await page.getByRole('button', { name: /Save version/i }).count();

  console.log('INDEPENDENT_HUNT_INVENTORY', JSON.stringify(inventory, null, 2));

  expect(inventory.settings.tabs).toEqual(['General', 'Connected services', 'Subscription']);
  expect(inventory.documentsShare.se011More).toContain('Share');
});
