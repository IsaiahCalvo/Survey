import { test, expect } from '@playwright/test';

// Independent hunt after Documents More → Share → Document Access.
// Do not treat the last Usage-hunt receipt as truth.
// Do not replay Settings General / Usage, A-04 menu, Archive family,
// TabBar Close, Documents extras / Lock persist / Open file / Share,
// Projects family, Templates family, Spaces, Survey-rail, PDF waves.

const HUB = '/?hubPreview=1';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const TABS = ['documents', 'projects', 'templates', 'archive'];
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const SHARED = 'Package 2 — Rev 4 — IC.pdf';

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

test('independent hunt after Documents Share / Document Access', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    tabs: {},
    documentsRest: {},
    settings: {},
    editor: {},
  };

  await openPage(page, { url: `${HUB}&tab=documents` });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  for (const tab of TABS) {
    await page.goto(`${HUB}&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const buttons = await visibleNames(page.locator('button, [role="menuitem"], input, [role="tab"]'));
    inventory.tabs[tab] = { buttons: buttons.slice(0, 20), more: await page.getByRole('button', { name: 'More' }).count() };
  }

  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  inventory.documentsRest.search = await page.getByPlaceholder('Search documents...').count();
  inventory.documentsRest.upload = await page.getByRole('button', { name: /^Upload/ }).count();
  inventory.documentsRest.select = await page.getByRole('button', { name: 'Select', exact: true }).count();

  await desktopDocRow(page, OWNER).click();
  inventory.documentsRest.previewTeam = await page.getByText('Team', { exact: true }).count();
  inventory.documentsRest.previewOpenFile = await page.getByRole('button', { name: 'Open file', exact: true }).count();
  inventory.documentsRest.previewShare = await page.locator('aside').getByRole('button', { name: 'Share' }).count();
  inventory.documentsRest.collaboratorsHeading = await page.getByText('Collaborators', { exact: true }).count();
  inventory.documentsRest.recentActivity = await page.getByText('Recent activity', { exact: true }).count();
  await page.getByRole('button', { name: 'Close preview' }).click();

  await desktopDocRow(page, SHARED).click();
  inventory.documentsRest.sharedPreviewTeam = await page.getByText('Team', { exact: true }).count();
  inventory.documentsRest.sharedCollaborators = await page.getByText('Collaborators', { exact: true }).count();
  await page.getByRole('button', { name: 'Close preview' }).click();

  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  inventory.settings.tabs = await visibleNames(dialog.locator('.account-sidebar-btn'));

  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  const connectedText = (await dialog.locator('.account-settings-content').innerText()).replace(/\s+/g, ' ');
  inventory.settings.connected = {
    microsoft: /Microsoft/.test(connectedText),
    google: /Google/.test(connectedText),
    connect: await dialog.getByRole('button', { name: /^Connect$|^Reconnect$/ }).count(),
    disconnect: await dialog.getByRole('button', { name: 'Disconnect' }).count(),
    snippet: connectedText.slice(0, 240),
  };

  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  inventory.settings.subscription = {
    startTrial: await dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial/ }).count(),
    usage: await dialog.getByRole('button', { name: 'Usage', exact: true }).count(),
    monthlyAnnual: await dialog.getByText(/Monthly|Annual|17%/).count(),
  };
  await dialog.locator('.account-settings-close').click();

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.editor.restTools = await visibleNames(page.locator('button[aria-label], [data-tool]'));
  inventory.editor.fontAtRest = await page.getByRole('button', { name: /Font|Arial|Helvetica/ }).count();
  inventory.editor.export = await page.getByRole('button', { name: /Export/i }).count();

  console.log('AFTER_DOCS_SHARE_HUNT', JSON.stringify(inventory, null, 2));

  expect(inventory.settings.tabs).toEqual(['General', 'Connected services', 'Subscription']);
  expect(inventory.documentsRest.search).toBeGreaterThan(0);
  expect(inventory.documentsRest.collaboratorsHeading).toBe(0);
  expect(inventory.settings.connected.connect).toBeGreaterThan(0);
});
