import { test, expect } from '@playwright/test';

// Independent hunt after Documents Share / Document Access.
// Do not treat the last hunt receipt as truth.
// Do not replay Share Access / extras / Lock persist / Open file,
// Settings General / Usage, A-04 menu, Archive family, TabBar Close,
// Projects family, Templates family, Spaces, Survey-rail, PDF waves.

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

async function desktopDocNames(page) {
  return page.locator('.documents-desktop-card [data-document-id]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('span')?.textContent?.trim() || '')
  ));
}

function desktopCheckedIds(page) {
  return page.locator('.documents-desktop-card [data-document-id]').evaluateAll((nodes) => (
    nodes
      .filter((node) => {
        const box = node.querySelector('span[style*="var(--gold)"]');
        return Boolean(box);
      })
      .map((node) => node.getAttribute('data-document-id'))
  ));
}

test('independent hunt after Documents Share Access', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    tabs: {},
    documentsMore: {},
    documentsSelect: {},
    documentsSort: {},
    documentsPreview: {},
    projectsTeam: {},
    settings: {},
    account: {},
    editor: {},
  };

  await openPage(page, { url: `${HUB}&tab=documents` });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  for (const tab of TABS) {
    await page.goto(`${HUB}&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.tabs[tab] = {
      buttons: (await visibleNames(page.locator('button, [role="menuitem"], input, [role="tab"]'))).slice(0, 24),
      more: await page.getByRole('button', { name: 'More' }).count(),
      select: await page.getByRole('button', { name: 'Select', exact: true }).count(),
      upload: await page.getByRole('button', { name: /^Upload/ }).count(),
      team: await page.getByRole('button', { name: /^Team$|^Manage team$/ }).count(),
      newProject: await page.getByRole('button', { name: /New project|Create project/ }).count(),
    };
  }

  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });

  await desktopDocRow(page, OWNER).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  inventory.documentsMore.items = await visibleNames(page.getByRole('menuitem'));
  await page.keyboard.press('Escape');

  const defaultOrder = await desktopDocNames(page);
  await page.locator('.documents-desktop-card').locator('span', { hasText: /^Project/ }).first().click();
  const afterProject = await desktopDocNames(page);
  await page.locator('.documents-desktop-card').locator('span', { hasText: /^Last edited/ }).first().click();
  const afterEdited = await desktopDocNames(page);
  await page.locator('.documents-desktop-card').locator('span', { hasText: /^File/ }).first().click();
  const afterFile = await desktopDocNames(page);
  inventory.documentsSort = {
    defaultOrder,
    afterProject,
    afterEdited,
    afterFile,
    projectChanged: afterProject.join('|') !== defaultOrder.join('|'),
    editedChanged: afterEdited.join('|') !== afterProject.join('|'),
    fileChanged: afterFile.join('|') !== afterEdited.join('|'),
  };

  await desktopDocRow(page, OWNER).click();
  const previewAside = page.locator('aside');
  inventory.documentsPreview = {
    teamLabel: await previewAside.getByText('Team', { exact: true }).count(),
    teamButtons: await previewAside.getByRole('button', { name: /^Team$|^Manage team$/ }).count(),
    teamName: (await previewAside.locator('span').filter({ hasText: /Isaiah|You|Calvo/ }).first().innerText().catch(() => '')),
    collaborators: await previewAside.getByText('Collaborators', { exact: true }).count(),
    recentActivity: await previewAside.getByText('Recent activity', { exact: true }).count(),
    openFile: await previewAside.getByRole('button', { name: 'Open file', exact: true }).count(),
    share: await previewAside.getByRole('button', { name: 'Share' }).count(),
    lastEdited: await previewAside.getByText('Last edited', { exact: true }).count(),
    uploaded: await previewAside.getByText('Uploaded', { exact: true }).count(),
  };
  await page.getByRole('button', { name: 'Close preview' }).click();

  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  inventory.documentsSelect.beforeAll = {
    all: await page.getByRole('button', { name: 'All', exact: true }).count(),
    none: await page.getByRole('button', { name: 'None', exact: true }).count(),
    done: await page.getByRole('button', { name: 'Done', exact: true }).count(),
    duplicate: await page.getByRole('button', { name: 'Duplicate', exact: true }).count(),
    moveCopy: await page.getByRole('button', { name: 'Move/Copy', exact: true }).count(),
    share: await page.getByRole('button', { name: 'Share' }).count(),
    del: await page.getByRole('button', { name: 'Delete' }).count(),
    checked: await desktopCheckedIds(page),
    ids: await desktopDocIds(page),
  };
  if (inventory.documentsSelect.beforeAll.all > 0) {
    await page.getByRole('button', { name: 'All', exact: true }).click();
    inventory.documentsSelect.afterAll = {
      none: await page.getByRole('button', { name: 'None', exact: true }).count(),
      checked: await desktopCheckedIds(page),
      ids: await desktopDocIds(page),
    };
    await page.getByRole('button', { name: 'None', exact: true }).click();
    inventory.documentsSelect.afterNone = {
      all: await page.getByRole('button', { name: 'All', exact: true }).count(),
      checked: await desktopCheckedIds(page),
    };
  }
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();

  await page.goto(`${HUB}&tab=projects`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.projectsTeam.listTeamButtons = await page.getByRole('button', { name: /^Team$|^Manage team$/ }).count();
  const tower = page.getByText('Tower 5 — Security').first();
  if (await tower.isVisible().catch(() => false)) {
    await tower.click();
    inventory.projectsTeam.afterOpen = {
      teamButtons: await page.getByRole('button', { name: /^Team$|^Manage team$/ }).count(),
      teamLabel: await page.getByText('Team', { exact: true }).count(),
      manageTeam: await page.getByRole('button', { name: /Manage team/ }).count(),
    };
    if (inventory.projectsTeam.afterOpen.teamButtons > 0) {
      await page.getByRole('button', { name: /^Team$|^Manage team$/ }).first().click();
      inventory.projectsTeam.modal = await visibleNames(page.locator('[role="dialog"] button, [role="dialog"] [role="tab"]'));
      inventory.projectsTeam.dialogTitle = await page.locator('[role="dialog"]').first().innerText().then((t) => t.slice(0, 180)).catch(() => '');
      await page.keyboard.press('Escape');
    }
  }

  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  inventory.account.menu = await visibleNames(page.getByRole('menu', { name: 'Account menu' }).locator('button'));
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('.account-settings-modal');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  inventory.settings.tabs = await visibleNames(dialog.locator('.account-sidebar-btn'));

  await dialog.getByRole('button', { name: 'Connected services', exact: true }).click();
  inventory.settings.connected = {
    connect: await dialog.getByRole('button', { name: /^Connect$|^Reconnect$/ }).count(),
    disconnect: await dialog.getByRole('button', { name: 'Disconnect' }).count(),
    snippet: (await dialog.locator('.account-settings-content').innerText()).replace(/\s+/g, ' ').slice(0, 240),
  };

  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  inventory.settings.subscription = {
    startTrial: await dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial/ }).count(),
    usage: await dialog.getByRole('button', { name: 'Usage', exact: true }).count(),
    monthlyAnnual: await dialog.getByText(/Monthly|Annual|17%/).count(),
    manage: await dialog.getByRole('button', { name: /Manage/ }).count(),
  };
  await dialog.locator('.account-settings-close').click();

  await openPage(page, { url: TEST_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.editor.restTools = await visibleNames(page.locator('button[aria-label], [data-tool]'));
  inventory.editor.fontAtRest = await page.getByRole('button', { name: /Font|Arial|Helvetica/ }).count();
  inventory.editor.export = await page.getByRole('button', { name: /Export/i }).count();
  inventory.editor.history = await page.getByRole('button', { name: /History|Save version/i }).count();
  inventory.editor.closeTab = await page.getByRole('button', { name: 'Close tab' }).count();
  inventory.editor.more = await page.getByRole('button', { name: 'More' }).count();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.documentsSelect.mobile = {
    select: await page.getByRole('button', { name: 'Select', exact: true }).count(),
    all: 0,
    none: 0,
  };
  if (inventory.documentsSelect.mobile.select > 0) {
    await page.getByRole('button', { name: 'Select', exact: true }).first().click();
    inventory.documentsSelect.mobile.all = await page.getByRole('button', { name: 'All', exact: true }).count();
    inventory.documentsSelect.mobile.none = await page.getByRole('button', { name: 'None', exact: true }).count();
    inventory.documentsSelect.mobile.done = await page.getByRole('button', { name: 'Done', exact: true }).count();
  }

  console.log('AFTER_SHARE_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));

  expect(inventory.settings.tabs).toEqual(['General', 'Connected services', 'Subscription']);
  expect(inventory.documentsMore.items).toEqual(expect.arrayContaining(['Rename', 'Copy', 'Share']));
  expect(inventory.documentsSelect.beforeAll.all).toBeGreaterThan(0);
});
