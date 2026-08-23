import { test, expect } from '@playwright/test';

// Independent hunt after annotation context menuitem (`8d95e104`).
// Axis: other compile-visible menus that may still be clickable divs
// without role=menuitem (Pages thumbnail *actions*, Fit items,
// Style/Width, overflow / More, Survey/Spaces rail items, hub profile).
// Do not replay annotation context actions / dismiss / rail-toggle /
// Home `?` / remapped-after-CW. Do not stamp file.id.

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

test('independent hunt after annotation context menuitem', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    pagesActions: {},
    fit: {},
    styleWidth: {},
    surveySpaces: {},
    hub: {},
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
    inventory.editor.duplicate = await page.getByRole('button', { name: 'Duplicate', exact: true }).count();
    inventory.editor.selectAll = await page.getByRole('button', { name: 'Select all', exact: true }).count();

    const pagesTab = page.getByRole('button', { name: 'Pages', exact: true }).first();
    if (await pagesTab.isVisible().catch(() => false)) {
      if ((await pagesTab.getAttribute('aria-pressed')) !== 'true') {
        await pagesTab.click();
        await page.waitForTimeout(200);
      }
    }
    const thumb = page.locator('#chrome-left-host [data-page-number="1"]').first();
    if (await thumb.count()) {
      await thumb.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + Math.min(12, rect.width / 2),
          clientY: rect.top + Math.min(12, rect.height / 2),
        }));
      });
      await page.waitForTimeout(250);
    }
    inventory.pagesActions.menuOpen = await page.locator('[data-pages-context-menu="true"]').count();
    inventory.pagesActions.menuRole = await page.getByRole('menu', { name: 'Page 1 actions' }).count();
    inventory.pagesActions.items = await visibleNames(page.locator('[data-pages-context-menu="true"] [role="menuitem"]'));
    inventory.pagesActions.extract = await page.getByRole('menuitem', { name: /Extract/i }).count();
    inventory.pagesActions.duplicate = await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).count();
    await page.keyboard.press('Escape');

    const fit = page.getByRole('button', { name: 'Fit options', exact: true }).first();
    if (await fit.isVisible().catch(() => false)) {
      await fit.click();
      await page.waitForTimeout(200);
    }
    inventory.fit.open = await page.getByRole('button', { name: 'Fit page', exact: true }).count();
    inventory.fit.menuitem = await page.getByRole('menuitem', { name: 'Fit page', exact: true }).count();
    inventory.fit.buttons = await visibleNames(page.locator('button').filter({ hasText: /Fit (page|width|height)/ }));
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

    const survey = page.getByRole('button', { name: /Expand Survey panel|Survey/ }).first();
    inventory.surveySpaces.surveyTrigger = await survey.count();
    const spacesExport = page.getByRole('button', { name: /Export .*space|Create a space to export/i });
    inventory.surveySpaces.spacesExport = await spacesExport.count();
    inventory.surveySpaces.csvMenuitem = await page.getByRole('menuitem', { name: 'CSV', exact: true }).count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.pagesMenu = await page.locator('[data-pages-context-menu="true"]').count();
    const who = page.getByRole('button', { name: /You|Account|Profile/i }).first();
    inventory.hub.profileTrigger = await who.count();
    if (await who.isVisible().catch(() => false)) {
      await who.click().catch(() => {});
      await page.waitForTimeout(200);
    }
    inventory.hub.accountMenu = await page.getByRole('menu', { name: 'Account menu' }).count();
    inventory.hub.settingsMenuitem = await page.getByRole('menuitem', { name: 'Settings', exact: true }).count();
    inventory.hub.settingsButton = await page.getByRole('button', { name: 'Settings', exact: true }).count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="menuitem"], [role="tab"]'))).slice(0, 36);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.hidden = await hiddenCounts(page);
    inventory.mobile.more = await page.getByRole('button', { name: 'More document options', exact: true }).count();
    if (inventory.mobile.more) {
      await page.getByRole('button', { name: 'More document options', exact: true }).first().click();
      await page.waitForTimeout(200);
    }
    inventory.mobile.moreItems = await visibleNames(page.locator('.mobile-pdf-tools__popover button, [role="menuitem"]'));
    inventory.mobile.saveLog = await page.getByRole('button', { name: 'Save log', exact: true }).count();

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_ANNOTATION_MENUITEM_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.pagesActions.menuOpen).toBe(1);
  expect(inventory.pagesActions.menuRole).toBe(1);
  expect(inventory.pagesActions.duplicate).toBe(1);
  expect(inventory.pagesActions.extract).toBe(0);
  expect(inventory.fit.menuitem).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.pagesMenu).toBe(0);
  expect(inventory.mobile.saveLog).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
