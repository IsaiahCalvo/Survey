import { test, expect } from '@playwright/test';

// Independent hunt after Home-tab click (`3431364f`).
// Do not replay Home / Close tab / toolbar arm / P-04 letters / rail Prev-Next /
// Ctrl+2 / Ctrl+M / remapped-after-CW / leftover-18 hosts.
// Hunt harder than tab chrome. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
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

test('independent hunt after Home tab click', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    contextPage: {},
    contextObject: {},
    rails: {},
    keys: {},
    hub: {},
    mobile: {},
    lease: {},
  };

  try {
    await openPage(page, { url: LINK_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

    inventory.editor.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 80);
    inventory.editor.hidden = await hiddenCounts(page);
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('menuitem', { name: /Open PDF|Export annotated|Re-import/ }).count();
    inventory.editor.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.editor.pdfTabRole = await page.locator('[data-pdf-tab-id]').evaluateAll((nodes) => (
      nodes.map((node) => ({ role: node.getAttribute('role'), tabIndex: node.getAttribute('tabindex'), aria: node.getAttribute('aria-label') }))
    ));
    inventory.editor.fileId = await page.evaluate(() => {
      const file = window.__phase35SelectedPdf || window.selectedPDF || null;
      return file && typeof file === 'object' ? file.id ?? null : null;
    }).catch(() => null);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');

    const layer = page.locator('[data-svg-annotation-layer="1"]').first();
    const box = await layer.boundingBox();
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8, { button: 'right' });
    inventory.contextPage.open = await page.locator('[data-annotation-context-menu="true"]').count();
    inventory.contextPage.items = inventory.contextPage.open
      ? await visibleNames(page.locator('[data-annotation-context-menu="true"]'))
      : [];
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + 70, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 140);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.mouse.click(box.x + 110, box.y + 100);
    await page.mouse.click(box.x + 110, box.y + 100, { button: 'right' });
    inventory.contextObject.open = await page.locator('[data-annotation-context-menu="true"]').count();
    inventory.contextObject.items = inventory.contextObject.open
      ? await visibleNames(page.locator('[data-annotation-context-menu="true"]'))
      : [];
    await page.keyboard.press('Escape');

    for (const name of ['Bookmarks', 'History', 'Pages', 'Search', 'Spaces']) {
      const btn = page.getByRole('button', { name, exact: true });
      inventory.rails[name] = {
        count: await btn.count(),
        labels: [],
      };
      if (await btn.count()) {
        await btn.first().click();
        await page.waitForTimeout(200);
        inventory.rails[name].labels = (await visibleNames(page.locator('button, [role="menuitem"], input'))).slice(0, 24);
      }
    }

    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    inventory.keys.afterTab = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName || null,
        role: el?.getAttribute?.('role') || null,
        name: (el?.getAttribute?.('aria-label') || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    });
    await page.keyboard.press('Enter');
    inventory.keys.afterEnterStillViewer = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.keys.ctrlO = await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true }));
      return document.querySelectorAll('input[type="file"]').length;
    });

    await openPage(page, { url: SEARCH_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    inventory.editor.searchHidden = await hiddenCounts(page);
    inventory.editor.searchFileId = await page.evaluate(() => null);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 40);

    for (const tab of ['documents', 'projects', 'templates', 'archive']) {
      await page.goto(`${HUB}&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 20_000 });
      inventory.hub[tab] = {
        buttons: (await visibleNames(page.locator('button, [role="tab"]'))).slice(0, 20),
        tryAgain: await page.getByRole('button', { name: 'Try again' }).count(),
        upload: await page.getByRole('button', { name: /^Upload/ }).count(),
      };
    }

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).count();
    inventory.mobile.closeTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();
    inventory.mobile.back = await page.getByRole('button', { name: /Back/ }).count();
    inventory.mobile.hidden = await hiddenCounts(page);

    inventory.lease.envLocalNames = await page.evaluate(() => false);
  } finally {
    console.log('AFTER_HOME_TAB_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.homeTab).toBe(1);
  expect(inventory.hub.homeTab).toBe(0);
  expect(inventory.mobile.homeTab).toBe(0);
});
