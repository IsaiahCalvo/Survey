import { test, expect } from '@playwright/test';

// Independent hunt after Hub load-error Try again.
// Do not treat the last hunt receipt as truth.
// Do not replay Hub Try again as the leftover.
// Do not replay Documents Select All / Share Access / extras / Lock persist /
// Open file; Settings General / Usage; A-04 menu; Archive family; TabBar Close
// tab; Projects family; Templates family; Spaces; Survey-rail; PDF waves.

const HUB = '/?hubPreview=1';
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

test('independent hunt after Hub Try again', async ({ page }) => {
  test.setTimeout(240_000);
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[hub preview]')) logs.push(text);
  });

  const inventory = {
    tabs: {},
    documentsMore: {},
    documentsPreview: {},
    documentsSearch: {},
    empty: {},
    guest: {},
    hubError: {},
    hubLoading: {},
    longDocs: {},
    mobileState: {},
    workflow: {},
    settings: {},
    account: {},
    cmdK: {},
    spike: {},
    editor: {},
    mobile: {},
  };

  try {
    await openPage(page, { url: `${HUB}&tab=documents` });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

    for (const tab of TABS) {
      await page.goto(`${HUB}&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
      inventory.tabs[tab] = {
        buttons: (await visibleNames(page.locator('button, [role="menuitem"], input, [role="tab"]'))).slice(0, 32),
        more: await page.getByRole('button', { name: 'More' }).count(),
        select: await page.getByRole('button', { name: 'Select', exact: true }).count(),
        upload: await page.getByRole('button', { name: /^Upload/ }).count(),
        team: await page.getByRole('button', { name: /^Team$|^Manage team$/ }).count(),
        newProject: await page.getByRole('button', { name: /New project|Create project/ }).count(),
        newTemplate: await page.getByRole('button', { name: /New template/ }).count(),
        tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
        goToDocuments: await page.getByRole('button', { name: 'Go to documents' }).count(),
        search: await page.locator('input[placeholder*="Search"]').count(),
        cmdK: await page.locator('.kbd', { hasText: '⌘K' }).count(),
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
      lastEdited: await previewAside.getByText('Last edited', { exact: true }).count(),
      uploaded: await previewAside.getByText('Uploaded', { exact: true }).count(),
      openFile: await previewAside.getByRole('button', { name: 'Open file', exact: true }).count(),
      share: await previewAside.getByRole('button', { name: 'Share' }).count(),
      buttons: await visibleNames(previewAside.locator('button')),
    };
    await page.getByRole('button', { name: 'Close preview' }).click();

    const search = page.locator('.documents-desktop-search input[placeholder="Search documents..."]');
    await search.fill('zzzz-no-such-document');
    inventory.documentsSearch.noMatch = await page.getByText('No documents match your search.').count();
    inventory.documentsSearch.ownerDuringMiss = await page.getByText(OWNER).count();
    await search.fill('');
    inventory.documentsSearch.ownerAfterClear = await page.getByText(OWNER).count();
    await search.click();
    await page.keyboard.press('Meta+k');
    inventory.cmdK.afterMetaK = {
      activePlaceholder: await page.evaluate(() => document.activeElement?.getAttribute('placeholder') || ''),
      shortcuts: await page.getByText('Keyboard shortcuts').count(),
    };
    await page.keyboard.press('Escape');

    for (const tab of TABS) {
      await page.goto(`${HUB}&empty=1&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
      inventory.empty[tab] = {
        noDocuments: await page.getByText('No documents yet').count(),
        noProjects: await page.getByText('No projects yet').count(),
        noTemplates: await page.getByText('No templates yet').count(),
        nothingArchive: await page.getByText('Nothing in Archive').count(),
        uploadPdf: await page.getByRole('button', { name: /Upload PDF|Upload/ }).count(),
        newProject: await page.getByRole('button', { name: /New project/ }).count(),
        newTemplate: await page.getByRole('button', { name: /New template/ }).count(),
        goToDocuments: await page.getByRole('button', { name: 'Go to documents' }).count(),
        tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
        select: await page.getByRole('button', { name: 'Select', exact: true }).count(),
      };
    }

    logs.length = 0;
    await page.goto(`${HUB}&empty=1&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Upload PDF' }).first().click();
    inventory.empty.documentsUploadLog = logs.slice();
    inventory.empty.documentsChooser = await page.locator('input[type="file"]').count();

    logs.length = 0;
    await page.goto(`${HUB}&empty=1&tab=projects`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText('No projects yet').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New project' }).first().click();
    inventory.empty.projectsModal = await page.getByRole('dialog', { name: 'Create project' }).count();
    inventory.empty.projectsLog = logs.slice();

    logs.length = 0;
    await page.goto(`${HUB}&empty=1&tab=templates`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText('No templates yet').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New template' }).first().click();
    inventory.empty.templatesMinted = await page.getByText(/^Template \d+$/).count();
    inventory.empty.templatesLog = logs.slice();

    await page.goto(`${HUB}&empty=1&tab=archive`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText('Nothing in Archive').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Go to documents' }).first().click();
    await page.getByText('No documents yet').first().waitFor({ timeout: 10_000 }).catch(() => {});
    inventory.empty.archiveLandedDocuments = await page.getByText('No documents yet').count();
    inventory.empty.archiveStillEmpty = await page.getByText('Nothing in Archive').count();

    await page.goto(`${HUB}&guest=1&tab=documents`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const auth = page.locator('.auth-modal, [role="dialog"]').filter({ hasText: 'Welcome back' }).first();
    inventory.guest = {
      signIn: await page.getByRole('button', { name: 'Sign in' }).count(),
      settings: await page.getByRole('button', { name: 'Open account menu' }).count(),
      welcome: await page.getByText('Welcome back').count(),
      continueWithout: await page.getByRole('button', { name: 'Continue without an account' }).count(),
      createAccount: await page.getByRole('button', { name: 'Create an account' }).count(),
      forgot: await page.getByRole('button', { name: 'Forgot password?' }).count(),
      google: await page.getByRole('button', { name: 'Continue with Google' }).count(),
      sso: await page.getByRole('button', { name: /SSO/ }).count(),
    };
    const authDialog = page.locator('.auth-modal');
    if (inventory.guest.forgot) {
      await authDialog.getByRole('button', { name: 'Forgot password?' }).click();
      inventory.guest.resetTitle = await page.getByText("We'll send you a password reset link").count();
      inventory.guest.sendReset = await page.getByRole('button', { name: 'Send reset link' }).count();
      await authDialog.getByRole('button', { name: /Back to sign in/ }).click();
    }
    if (inventory.guest.sso) {
      await authDialog.getByRole('button', { name: /SSO/ }).click();
      inventory.guest.ssoDomain = await page.getByLabel('Company domain').count();
      await authDialog.getByRole('button', { name: /Back to sign in/ }).click();
    }
    if (inventory.guest.createAccount) {
      await authDialog.getByRole('button', { name: 'Create an account' }).click();
      inventory.guest.signupTitle = await page.getByText('Get started with a free account').count();
      inventory.guest.createSubmit = await page.getByRole('button', { name: 'Create account' }).count();
      await authDialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    }

    for (const kind of ['documents', 'projects', 'templates']) {
      await page.goto(`${HUB}&hubError=${kind}&tab=${kind}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
      const alert = page.getByRole('alert');
      inventory.hubError[kind] = {
        alert: await alert.count(),
        copy: (await alert.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160),
        tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
        seed: kind === 'documents'
          ? await page.getByText(OWNER).count()
          : kind === 'projects'
            ? await page.getByText('Tower 5 — Security').count()
            : await page.getByText('Security Walk-Through').count(),
      };
    }
  } finally {
    console.log('AFTER_HUB_RETRY_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.documentsMore.items).toEqual(expect.arrayContaining(['Rename', 'Copy', 'Share']));
  expect(inventory.tabs.documents.tryAgain).toBe(0);
  expect(inventory.empty.projectsModal).toBe(0);
  expect(inventory.guest.continueWithout).toBe(1);
});
