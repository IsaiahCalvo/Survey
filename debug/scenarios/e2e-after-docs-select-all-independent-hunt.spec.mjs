import { test, expect } from '@playwright/test';

// Independent hunt after Documents Select All / None / Done.
// Do not treat the last hunt receipt as truth.
// Do not replay Documents Select All / Share Access / extras / Lock persist /
// Open file; Settings General / Usage; A-04 menu contents; Archive family;
// TabBar Close tab; Projects family; Templates family; Spaces; Survey-rail;
// PDF waves.

const HUB = '/?hubPreview=1';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const TABS = ['documents', 'projects', 'templates', 'archive'];
const OWNER = 'SE-011 Security Shop Drawings.pdf';

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

function desktopDocRow(page, name) {
  return page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: name }).first();
}

async function desktopDocIds(page) {
  return page.locator('.documents-desktop-card [data-document-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-document-id'))
  ));
}

test('independent hunt after Documents Select All', async ({ page }) => {
  test.setTimeout(180_000);
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[hub preview]')) logs.push(text);
  });

  let inventory = {
    tabs: {},
    documentsMore: {},
    documentsSelect: {},
    documentsPreview: {},
    empty: {},
    guest: {},
    hubError: {},
    hubLoading: {},
    settings: {},
    account: {},
    mobile: {},
    newChrome: {},
    editor: {},
    hubKeys: {},
  };

  try {
  await openPage(page, { url: `${HUB}&tab=documents` });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  for (const tab of TABS) {
    await page.goto(`${HUB}&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.tabs[tab] = {
      buttons: (await visibleNames(page.locator('button, [role="menuitem"], input, [role="tab"]'))).slice(0, 28),
      more: await page.getByRole('button', { name: 'More' }).count(),
      select: await page.getByRole('button', { name: 'Select', exact: true }).count(),
      upload: await page.getByRole('button', { name: /^Upload/ }).count(),
      team: await page.getByRole('button', { name: /^Team$|^Manage team$/ }).count(),
      newProject: await page.getByRole('button', { name: /New project|Create project/ }).count(),
      newTemplate: await page.getByRole('button', { name: /New template/ }).count(),
      tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
      search: await page.locator('input[placeholder*="Search"]').count(),
    };
  }

  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });

  await desktopDocRow(page, OWNER).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  inventory.documentsMore.items = await visibleNames(page.getByRole('menuitem'));
  await page.keyboard.press('Escape');

  await desktopDocRow(page, OWNER).click();
  const previewAside = page.locator('aside').filter({ hasText: 'Preview' }).first();
  inventory.documentsPreview = {
    teamLabel: await previewAside.getByText('Team', { exact: true }).count(),
    teamButtons: await previewAside.getByRole('button', { name: /^Team$|^Manage team$/ }).count(),
    collaborators: await previewAside.getByText('Collaborators', { exact: true }).count(),
    recentActivity: await previewAside.getByText('Recent activity', { exact: true }).count(),
    openFile: await previewAside.getByRole('button', { name: 'Open file', exact: true }).count(),
    share: await previewAside.getByRole('button', { name: 'Share' }).count(),
    buttons: await visibleNames(previewAside.locator('button')),
  };
  await page.getByRole('button', { name: 'Close preview' }).click();

  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  inventory.documentsSelect.before = {
    all: await page.getByRole('button', { name: 'All', exact: true }).count(),
    none: await page.getByRole('button', { name: 'None', exact: true }).count(),
    done: await page.getByRole('button', { name: 'Done', exact: true }).count(),
    duplicate: await page.getByRole('button', { name: 'Duplicate', exact: true }).count(),
    moveCopy: await page.getByRole('button', { name: 'Move/Copy', exact: true }).count(),
    share: await page.getByRole('button', { name: 'Share' }).count(),
    del: await page.getByRole('button', { name: 'Delete', exact: true }).count(),
    delDisabled: await page.getByRole('button', { name: 'Delete', exact: true }).first().isDisabled().catch(() => null),
    ids: await desktopDocIds(page),
  };
  await desktopDocRow(page, 'test.pdf').click();
  inventory.documentsSelect.afterOne = {
    delDisabled: await page.getByRole('button', { name: 'Delete', exact: true }).first().isDisabled().catch(() => null),
    shareDisabled: await page.getByRole('button', { name: 'Share' }).first().isDisabled().catch(() => null),
  };
  await page.getByRole('button', { name: 'Share' }).first().click();
  inventory.documentsSelect.shareDialog = {
    access: await page.getByText('Document Access').count(),
    shareDoc: await page.getByText('Share document').count(),
    heading: (await page.locator('[role="dialog"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160),
  };
  await page.keyboard.press('Escape');
  if (await page.locator('[role="dialog"]').count()) {
    await page.keyboard.press('Escape');
  }

  const idsBeforeDelete = await desktopDocIds(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  const confirm = page.getByRole('dialog').filter({ hasText: /delete|Delete/ });
  inventory.documentsSelect.deleteConfirm = await confirm.count();
  inventory.documentsSelect.idsAfterDelete = await desktopDocIds(page);
  inventory.documentsSelect.testPdfAfterDelete = await page.getByText('test.pdf').count();
  inventory.documentsSelect.seedMinusDeleted = idsBeforeDelete.filter((id) => id !== 'd6');
  inventory.documentsSelect.stillSelectMode = await page.getByRole('button', { name: 'Done', exact: true }).count();
  if (inventory.documentsSelect.stillSelectMode) {
    await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  }

  await page.goto(`${HUB}&empty=1&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.empty = {
    copy: await page.getByText('No documents yet').count(),
    uploadPdf: await page.getByRole('button', { name: /Upload PDF|Upload/ }).count(),
    select: await page.getByRole('button', { name: 'Select', exact: true }).count(),
    tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
    rows: await page.locator('[data-document-id]').count(),
  };

  await page.goto(`${HUB}&guest=1&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.guest = {
    signIn: await page.getByRole('button', { name: 'Sign in' }).count(),
    settings: await page.getByRole('button', { name: 'Open account menu' }).count(),
    authModal: await page.getByText('Welcome back').count(),
  };

  for (const kind of ['documents', 'projects', 'templates']) {
    await page.goto(`${HUB}&hubError=${kind}&tab=${kind}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const alert = page.getByRole('alert');
    inventory.hubError[kind] = {
      alert: await alert.count(),
      copy: (await alert.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160),
      tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
      seedBefore: kind === 'documents'
        ? await page.getByText(OWNER).count()
        : kind === 'projects'
          ? await page.getByText('Tower 5 — Security').count()
          : await page.getByText('Security Walk-Through').count(),
    };
    if (inventory.hubError[kind].tryAgain > 0) {
      await page.getByRole('button', { name: 'Try again' }).click();
      inventory.hubError[kind].seedAfter = kind === 'documents'
        ? await page.getByText(OWNER).count()
        : kind === 'projects'
          ? await page.getByText('Tower 5 — Security').count()
          : await page.getByText('Security Walk-Through').count();
      inventory.hubError[kind].tryAfter = await page.getByRole('button', { name: 'Try again' }).count();
    }
  }

  await page.goto(`${HUB}&hubLoading=documents&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hubLoading = {
    tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
    skeleton: await page.locator('.documents-desktop-search, [class*="skeleton"]').count(),
    seed: await page.getByText(OWNER).count(),
  };

  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  inventory.account.menu = await visibleNames(page.getByRole('menu', { name: 'Account menu' }).locator('button'));
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  inventory.settings.tabs = await visibleNames(dialog.locator('.account-sidebar-btn'));
  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  inventory.settings.connected = {
    connect: await dialog.getByRole('button', { name: /^Connect$|^Reconnect$/ }).count(),
    disconnect: await dialog.getByRole('button', { name: 'Disconnect' }).count(),
    snippet: (await dialog.locator('.account-settings-content').innerText()).replace(/\s+/g, ' ').slice(0, 200),
  };
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  inventory.settings.subscription = {
    startTrial: await dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial/ }).count(),
    usage: await dialog.getByRole('button', { name: 'Usage', exact: true }).count(),
    monthlyAnnual: await dialog.getByText(/Monthly|Annual|17%/).count(),
    manage: await dialog.getByRole('button', { name: /Manage/ }).count(),
  };
  await dialog.locator('.account-settings-close').click();

  await page.goto(`${HUB}&tab=projects`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  logs.length = 0;
  const newProject = page.getByRole('button', { name: /New project|Create project/ }).first();
  inventory.newChrome.projectVisible = await newProject.count();
  if (inventory.newChrome.projectVisible) {
    await newProject.click();
    inventory.newChrome.projectModal = await page.getByRole('dialog').count();
    inventory.newChrome.projectLog = logs.slice();
  }

  await page.goto(`${HUB}&tab=templates`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  logs.length = 0;
  const newTemplate = page.getByRole('button', { name: /New template/ }).first();
  inventory.newChrome.templateVisible = await newTemplate.count();
  if (inventory.newChrome.templateVisible) {
    await newTemplate.click();
    inventory.newChrome.templateLog = logs.slice();
    inventory.newChrome.templateMinted = await page.getByText(/Template \d+|Untitled Template/).count();
  }

  await page.keyboard.press('?');
  inventory.hubKeys.shortcuts = await page.getByText('Keyboard shortcuts').count();
  await page.keyboard.press('Escape');

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.editor.restTools = (await visibleNames(page.locator('button[aria-label], [data-tool]'))).slice(0, 40);
  inventory.editor.fontAtRest = await page.getByRole('button', { name: /Font|Arial|Helvetica/ }).count();
  inventory.editor.export = await page.getByRole('button', { name: /Export/i }).count();
  inventory.editor.history = await page.getByRole('button', { name: /History|Save version/i }).count();
  inventory.editor.closeTab = await page.getByRole('button', { name: 'Close tab' }).count();
  inventory.editor.more = await page.getByRole('button', { name: 'More' }).count();
  inventory.editor.print = await page.getByRole('button', { name: /Print/i }).count();
  inventory.editor.stamp = await page.getByRole('button', { name: /Stamp/i }).count();
  inventory.editor.measure = await page.getByRole('button', { name: /Measure/i }).count();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.mobile.openNav = await page.getByRole('button', { name: 'Open navigation' }).count();
  if (inventory.mobile.openNav) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    inventory.mobile.navItems = await visibleNames(page.getByRole('navigation', { name: 'Mobile navigation' }).locator('button'));
    const scrim = page.locator('.mobile-rail-nav-scrim');
    if (await scrim.count()) await scrim.click({ position: { x: 8, y: 8 } });
    else await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await expect(page.locator('.mobile-rail-nav-scrim')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account menu' }).click();
  inventory.mobile.accountMenu = await visibleNames(page.getByRole('menu', { name: 'Account menu' }).locator('button'));
  await page.keyboard.press('Escape');
  inventory.mobile.sort = await page.locator('.documents-mobile-filter').count();
  if (inventory.mobile.sort) {
    await page.locator('.documents-mobile-filter').click();
    inventory.mobile.sortItems = await visibleNames(page.locator('.documents-mobile-sort-menu [role="menuitem"]'));
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  inventory.mobile.select = {
    all: await page.getByRole('button', { name: 'All', exact: true }).count(),
    del: await page.getByRole('button', { name: 'Delete', exact: true }).count(),
    share: await page.getByRole('button', { name: 'Share' }).count(),
    duplicate: await page.getByRole('button', { name: 'Duplicate', exact: true }).count(),
  };
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();

  } finally {
    console.log('AFTER_DOCS_SELECT_ALL_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.settings.tabs).toEqual(['General', 'Connected services', 'Subscription']);
  expect(inventory.documentsMore.items).toEqual(expect.arrayContaining(['Rename', 'Copy', 'Share']));
});
