import { test, expect } from '@playwright/test';

// Independent hunt after official overlay-mount align (`0e812b9f` / `5b7114de`).
// Axis: leftover official files that still fail vs live source (NOT overlay-mount,
// NOT isolated 8448). Do not replay rail-toggle product/E2E, dismiss-family,
// Home `?`, remapped-after-CW, leftover-18 hosts.
// Live DOM: buttons / menuitems / inputs whose names are not leftover-18
// and not exhausted (Sync / Presence / Retry now / 390 More besides
// Export+Zoom / History actions besides Restore / annotation context).
// Do not stamp file.id. Do not invent dest-XYZ / lease / Note create.

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

async function waitEditor(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

test('independent hunt after official overlay-mount align', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    sync: {},
    history: {},
    context: {},
    hub: {},
    mobile: {},
    lease: {},
  };

  try {
    await openPage(page, { url: LINK_PDF });
    await waitEditor(page);

    inventory.editor.hidden = await hiddenCounts(page);
    inventory.editor.fileId = await fileId(page);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
    inventory.editor.buttons = (await visibleNames(page.locator('button, [role="menuitem"], [role="tab"], input'))).slice(0, 80);
    inventory.editor.duplicate = await page.getByRole('button', { name: 'Duplicate', exact: true }).count();
    inventory.editor.selectAll = await page.getByRole('button', { name: 'Select all', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('button', { name: /^File$/ }).count();
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.undo = await page.getByRole('button', { name: 'Undo', exact: true }).count();
    inventory.editor.redo = await page.getByRole('button', { name: 'Redo', exact: true }).count();

    inventory.sync.upToDate = await page.getByRole('button', { name: /Up to date/i }).count();
    inventory.sync.retryNow = await page.getByRole('button', { name: 'Retry now', exact: true }).count();
    inventory.sync.presence = await page.getByRole('button', { name: /active user/i }).count();
    inventory.sync.syncChip = await page.locator('[data-sync-status], .sync-status-chip, [aria-label*="Up to date"]').count();

    const history = page.getByRole('button', { name: 'Version history', exact: true }).first();
    inventory.history.trigger = await history.count();
    if (await history.isVisible().catch(() => false)) {
      await history.click();
      await page.waitForTimeout(300);
    }
    inventory.history.saveVersion = await page.getByRole('button', { name: 'Save version', exact: true }).count();
    inventory.history.restore = await page.getByRole('button', { name: 'Restore', exact: true }).count();
    inventory.history.kal48Save = await page.locator('[data-testid="kal48-save-revision"]').count();
    inventory.history.noHistory = await page.getByText('No history yet').count();

    await page.getByRole('button', { name: 'Shapes', exact: true }).first().click().catch(() => {});
    const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
    if (await rectangle.isVisible().catch(() => false)) {
      await rectangle.click();
    }
    const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.24);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.36, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const mark = page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').first();
      if (await mark.count()) {
        const markBox = await mark.boundingBox();
        if (markBox) {
          await page.mouse.click(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2, { button: 'right' });
          await page.waitForTimeout(200);
        }
      }
    }
    inventory.context.items = await visibleNames(page.locator('[role="menuitem"]'));
    inventory.context.bringToFront = await page.getByRole('menuitem', { name: 'Bring to front', exact: true }).count();
    inventory.context.sendToBack = await page.getByRole('menuitem', { name: 'Send to back', exact: true }).count();
    inventory.context.duplicate = await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).count();
    inventory.context.group = await page.getByRole('menuitem', { name: 'Group', exact: true }).count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.retryNow = await page.getByRole('button', { name: 'Retry now', exact: true }).count();
    inventory.hub.upToDate = await page.getByRole('button', { name: /Up to date/i }).count();
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
    inventory.mobile.export = await page.getByRole('button', { name: /Export annotated PDF/i }).count();
    inventory.mobile.zoomIn = await page.getByRole('button', { name: 'Zoom in', exact: true }).count();
    inventory.mobile.zoomOut = await page.getByRole('button', { name: 'Zoom out', exact: true }).count();
    inventory.mobile.retryNow = await page.getByRole('button', { name: 'Retry now', exact: true }).count();
    inventory.mobile.presence = await page.getByRole('button', { name: /active user/i }).count();

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_OVERLAY_MOUNT_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.duplicate).toBe(0);
  expect(inventory.editor.selectAll).toBe(0);
  expect(inventory.sync.retryNow).toBe(0);
  expect(inventory.history.saveVersion).toBe(0);
  expect(inventory.history.kal48Save).toBe(0);
  expect(inventory.context.duplicate).toBe(0);
  expect(inventory.context.group).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.mobile.saveLog).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
