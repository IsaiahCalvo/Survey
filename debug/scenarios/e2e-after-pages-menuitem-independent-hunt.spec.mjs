import { test, expect } from '@playwright/test';

// Independent hunt after Pages context menuitem (`d5b6d570` / `2bbc746d`).
// Axis: other compile-visible menus that may still lack role=menuitem
// (hub Account *actions*, Spaces CSV, Fit items, Style/Width).
// Do not replay Pages context actions / dismiss / rail-toggle /
// Home `?` / annotation context actions / remapped-after-CW.
// Do not invent leftover-18 auth/billing panes. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  ));
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

test('independent hunt after Pages context menuitem', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    account: {},
    spacesCsv: {},
    fit: {},
    styleWidth: {},
    mobile: {},
    lease: {},
  };

  try {
    await openPage(page, { url: LINK_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

    inventory.editor.hidden = await hiddenCounts(page);
    inventory.editor.fileId = await fileId(page);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
    inventory.editor.accountMenu = await page.getByRole('menu', { name: 'Account menu' }).count();
    inventory.editor.settingsMenuitem = await page.getByRole('menuitem', { name: 'Settings', exact: true }).count();
    inventory.editor.rotateMenuitem = await page.getByRole('menuitem', { name: 'Rotate', exact: true }).count();

    const fit = page.getByRole('button', { name: 'Fit options', exact: true }).first();
    if (await fit.isVisible().catch(() => false)) {
      await fit.click();
      await page.waitForTimeout(200);
    }
    inventory.fit.open = await page.getByRole('button', { name: 'Fit page', exact: true }).count();
    inventory.fit.menuitem = await page.getByRole('menuitem', { name: 'Fit page', exact: true }).count();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Shapes', exact: true }).first().click().catch(() => {});
    const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
    if (await rectangle.isVisible().catch(() => false)) await rectangle.click();
    const style = page.getByRole('button', { name: 'Style', exact: true }).first();
    if (await style.isVisible().catch(() => false)) {
      await style.click();
      await page.waitForTimeout(200);
    }
    inventory.styleWidth.styleOptions = await page.locator('[role="option"]').count();
    inventory.styleWidth.styleMenuitem = await page.getByRole('menuitem', { name: /Solid|Dashed|Dotted|Cloud/ }).count();
    await page.keyboard.press('Escape');

    const spacesExport = page.getByRole('button', { name: /Export .*space|Create a space to export/i });
    inventory.spacesCsv.spacesExport = await spacesExport.count();
    inventory.spacesCsv.csvMenuitem = await page.getByRole('menuitem', { name: 'CSV', exact: true }).count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.account.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    const chip = page.getByRole('button', { name: 'Open account menu' }).first();
    inventory.account.profileTrigger = await chip.count();
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
      await page.waitForTimeout(200);
    }
    inventory.account.menu = await page.getByRole('menu', { name: 'Account menu' }).count();
    inventory.account.settingsMenuitem = await page.getByRole('menuitem', { name: 'Settings', exact: true }).count();
    inventory.account.settingsButton = await page.getByRole('button', { name: 'Settings', exact: true }).count();
    inventory.account.signOutMenuitem = await page.getByRole('menuitem', { name: 'Sign out', exact: true }).count();
    inventory.account.archiveMenuitem = await page.getByRole('menuitem', { name: 'Archive', exact: true }).count();
    inventory.account.items = await visibleNames(page.locator('[role="menu"][aria-label="Account menu"] [role="menuitem"]'));

    await openPage(page, { width: 390, height: 844, url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const mobileChip = page.locator('.mobile-profile').getByRole('button', { name: 'Open account menu' });
    if (await mobileChip.isVisible().catch(() => false)) {
      await mobileChip.click();
      await page.waitForTimeout(200);
    }
    inventory.mobile.menu = await page.getByRole('menu', { name: 'Account menu' }).count();
    inventory.mobile.archiveMenuitem = await page.getByRole('menuitem', { name: 'Archive', exact: true }).count();
    inventory.mobile.settingsMenuitem = await page.getByRole('menuitem', { name: 'Settings', exact: true }).count();
    inventory.mobile.items = await visibleNames(page.locator('[role="menu"][aria-label="Account menu"] [role="menuitem"]'));

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_PAGES_MENUITEM_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.accountMenu).toBe(0);
  expect(inventory.fit.menuitem).toBe(0);
  expect(inventory.account.draw).toBe(0);
  expect(inventory.account.menu).toBe(1);
  expect(inventory.account.settingsMenuitem).toBe(1);
  expect(inventory.account.settingsButton).toBe(0);
  expect(inventory.mobile.settingsMenuitem).toBe(1);
  expect(inventory.mobile.archiveMenuitem).toBe(1);
  expect(inventory.lease.fileId).toBeNull();
});
