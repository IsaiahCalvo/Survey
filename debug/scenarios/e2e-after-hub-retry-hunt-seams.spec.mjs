import { test, expect } from '@playwright/test';

// Follow-up seams after the first independent hunt pass.
// Do not replay Hub Try again / Documents / Archive / Settings / families.

const HUB = '/?hubPreview=1';
const TEST_PDF = '/?testPdf=clickable-link-test.pdf';
const OWNER = 'SE-011 Security Shop Drawings.pdf';

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

async function desktopDocIds(page) {
  return page.locator('.documents-desktop-card [data-document-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-document-id'))
  ));
}

test('independent hunt leftover query seams', async ({ page }) => {
  test.setTimeout(120_000);
  const inventory = {
    hubErrorArchive: {},
    hubLoading: {},
    longDocs: {},
    mobileState: {},
    workflow: {},
    settings: {},
    account: {},
    spike: {},
    editor: {},
    mobile: {},
  };

  try {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`${HUB}&hubError=archive&tab=archive`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hubErrorArchive = {
      alert: await page.getByRole('alert').count(),
      tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
      sitePlan: await page.getByText('Site plan').count(),
      nothing: await page.getByText('Nothing in Archive').count(),
    };

    for (const kind of ['documents', 'projects', 'templates']) {
      await page.goto(`${HUB}&hubLoading=${kind}&tab=${kind}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
      inventory.hubLoading[kind] = {
        tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
        skeleton: await page.locator('.hub-skeleton-block').count(),
        disabledSelect: await page.locator('button.hub-loading-metric-button[disabled]').count(),
        seed: kind === 'documents'
          ? await page.getByText(OWNER).count()
          : kind === 'projects'
            ? await page.getByText('Tower 5 — Security').count()
            : await page.getByText('Security Walk-Through').count(),
      };
    }

    await page.goto(`${HUB}&longDocs=1&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const ids = await desktopDocIds(page);
    inventory.longDocs = {
      idCount: ids.length,
      uniqueIds: [...new Set(ids)].length,
      pagination: await page.getByRole('button', { name: /Next|Previous|Load more|Show more/ }).count(),
      pageNumbers: await page.getByText(/Showing \d|page \d of/i).count(),
      tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
      more: await page.getByRole('button', { name: 'More' }).count(),
      select: await page.getByRole('button', { name: 'Select', exact: true }).count(),
    };

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${HUB}&mobileState=detail&tab=projects`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.mobileState.projects = {
      back: await page.getByRole('button', { name: /Back/ }).count(),
      searchFiles: await page.getByPlaceholder('Search files...').count(),
      manageTeam: await page.getByRole('button', { name: /Team|Manage team/ }).count(),
      open: await page.getByRole('button', { name: 'Open', exact: true }).count(),
      tower: await page.getByText('Tower 5 — Security').count(),
    };
    await page.goto(`${HUB}&mobileState=detail&tab=templates`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.mobileState.templates = {
      title: await page.locator('[data-template-title]').count(),
      newCategory: await page.getByRole('button', { name: /New category/ }).count(),
      editColor: await page.getByRole('button', { name: 'Edit color' }).count(),
      security: await page.getByText('Security Walk-Through').count(),
    };

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${HUB}&workflowE2E=1&tab=projects`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.workflow.fileInput = await page.locator('[data-testid="mobile-workflow-upload-input"]').count();
    inventory.workflow.newProject = await page.getByRole('button', { name: 'New project' }).count();
    await page.getByRole('button', { name: 'New project' }).first().click();
    inventory.workflow.createDialog = await page.getByRole('dialog', { name: 'Create project' }).count();
    if (inventory.workflow.createDialog) await page.keyboard.press('Escape');

    await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
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
    };
    await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
    inventory.settings.subscription = {
      startTrial: await dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial/ }).count(),
      usage: await dialog.getByRole('button', { name: 'Usage', exact: true }).count(),
      monthlyAnnual: await dialog.getByText(/Monthly|Annual|17%/).count(),
      manage: await dialog.getByRole('button', { name: /Manage/ }).count(),
    };
    await dialog.locator('.account-settings-close').click();

    await page.goto('/?spike=features', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    inventory.spike = {
      url: page.url(),
      surveyHub: await page.locator('.survey-hub').count(),
      draw: await page.getByRole('button', { name: 'Draw', exact: true }).count(),
      body: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 180),
    };

    await page.goto(TEST_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
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
    await page.keyboard.press('?');
    inventory.editor.shortcutsAfterQ = await page.getByText('Keyboard shortcuts').count();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${HUB}&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.mobile.openNav = await page.getByRole('button', { name: 'Open navigation' }).count();
    if (inventory.mobile.openNav) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      inventory.mobile.navItems = await visibleNames(page.getByRole('navigation', { name: 'Mobile navigation' }).locator('button'));
      const scrim = page.locator('.mobile-rail-nav-scrim');
      if (await scrim.count()) await scrim.click({ position: { x: 8, y: 8 } });
    }
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
    console.log('AFTER_HUB_RETRY_HUNT_SEAMS', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.settings.tabs).toEqual(['General', 'Connected services', 'Subscription']);
  expect(inventory.hubErrorArchive.tryAgain).toBe(0);
});
