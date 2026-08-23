import { test, expect } from '@playwright/test';

// Independent hunt after official Spaces rail openPanel align (`4a10a417`).
// Axis: leftover official files besides spacesRailToggle / overlay-mount /
// isolated 8448; compile-visible chrome that is NOT rail-toggle, dismiss,
// Home `?`, or remapped-after-CW — annotation context *actions* (not
// dismiss), History besides Restore, page-ops besides rotate/Prev/Next,
// overflow / More besides Export+Zoom, live names without a 2026-08-23
// receipt. Do not replay spacesRailToggle / rail-toggle E2E / overlay-mount
// / popover pointerdown. Do not stamp file.id. Do not invent dest-XYZ /
// lease / Note create.

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
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function userAnnoIds(page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/i.test(String(id || ''));
    });
  }).catch(() => []);
}

async function drawRect(page) {
  const before = new Set(await userAnnoIds(page));
  await page.getByRole('button', { name: 'Shapes', exact: true }).first().click().catch(() => {});
  const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
  if (await rectangle.isVisible().catch(() => false)) {
    await rectangle.click();
  }
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  if (!box) return { id: null, created: before.size };
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.36, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await userAnnoIds(page);
  const id = after.find((item) => !before.has(item)) || after[after.length - 1] || null;
  await page.getByRole('button', { name: 'Select', exact: true }).first().click().catch(() => {});
  return { id, created: after.length };
}

test('independent hunt after official Spaces rail openPanel align', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    official: {},
    editor: {},
    contextActions: {},
    history: {},
    pagesOps: {},
    sync: {},
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
    inventory.editor.buttons = (await visibleNames(page.locator('button, [role="menuitem"], [role="tab"], input'))).slice(0, 90);
    inventory.editor.duplicate = await page.getByRole('button', { name: 'Duplicate', exact: true }).count();
    inventory.editor.selectAll = await page.getByRole('button', { name: 'Select all', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('button', { name: /^File$/ }).count();
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.undo = await page.getByRole('button', { name: 'Undo', exact: true }).count();
    inventory.editor.redo = await page.getByRole('button', { name: 'Redo', exact: true }).count();
    inventory.editor.closeTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();
    inventory.editor.addBookmark = await page.getByRole('button', { name: 'Add bookmark', exact: true }).count();
    inventory.editor.createSpace = await page.getByRole('button', { name: 'Create space', exact: true }).count();

    inventory.sync.upToDate = await page.getByRole('button', { name: /Up to date/i }).count();
    inventory.sync.retryNow = await page.getByRole('button', { name: 'Retry now', exact: true }).count();
    inventory.sync.presence = await page.getByRole('button', { name: /active user/i }).count();

    const drawn = await drawRect(page);
    inventory.contextActions.created = drawn.created;
    inventory.contextActions.userId = drawn.id;
    if (drawn.id) {
      const mark = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${drawn.id}"]`).first();
      const markBox = await mark.boundingBox();
      if (markBox) {
        await page.mouse.click(markBox.x + 2, markBox.y + markBox.height / 2, { button: 'right' });
        await page.waitForTimeout(250);
      }
    }
    inventory.contextActions.itemsBefore = await visibleNames(page.locator('[data-annotation-context-menu="true"] [role="menuitem"], [data-annotation-context-menu="true"] button'));
    inventory.contextActions.menuOpen = await page.locator('[data-annotation-context-menu="true"]').count();
    inventory.contextActions.duplicate = await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).count();
    inventory.contextActions.group = await page.getByRole('menuitem', { name: 'Group', exact: true }).count();
    inventory.contextActions.copy = await page.getByRole('menuitem', { name: 'Copy', exact: true }).count()
      + await page.getByRole('button', { name: 'Copy', exact: true }).count();
    inventory.contextActions.bringToFront = await page.getByRole('menuitem', { name: 'Bring to front', exact: true }).count()
      + await page.getByRole('button', { name: 'Bring to front', exact: true }).count();

    const copyItem = page.getByRole('menuitem', { name: 'Copy', exact: true })
      .or(page.locator('[data-annotation-context-menu="true"]').getByText('Copy', { exact: true }));
    if (await copyItem.count()) {
      await copyItem.first().click();
      await page.waitForTimeout(150);
      inventory.contextActions.menuAfterCopy = await page.locator('[data-annotation-context-menu="true"]').count();
      const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.58, { button: 'right' });
        await page.waitForTimeout(250);
      }
      const pasteItem = page.getByRole('menuitem', { name: 'Paste', exact: true })
        .or(page.locator('[data-annotation-context-menu="true"]').getByText('Paste', { exact: true }));
      inventory.contextActions.pasteEnabled = await pasteItem.count();
      if (inventory.contextActions.pasteEnabled) {
        await pasteItem.first().click();
        await page.waitForTimeout(250);
      }
      inventory.contextActions.afterPaste = (await userAnnoIds(page)).length;
    }

    const afterIds = await userAnnoIds(page);
    const pasteId = afterIds.find((id) => id !== drawn.id) || drawn.id;
    if (pasteId) {
      const second = page.locator(`[data-svg-annotation-layer="1"] > g[data-anno-id="${pasteId}"]`).first();
      const secondBox = await second.boundingBox();
      if (secondBox) {
        await page.mouse.click(secondBox.x + 2, secondBox.y + secondBox.height / 2, { button: 'right' });
        await page.waitForTimeout(250);
      }
      const front = page.getByRole('menuitem', { name: 'Bring to front', exact: true })
        .or(page.locator('[data-annotation-context-menu="true"]').getByText('Bring to front', { exact: true }));
      if (await front.count()) {
        await front.first().click();
        await page.waitForTimeout(150);
        inventory.contextActions.menuAfterBringToFront = await page.locator('[data-annotation-context-menu="true"]').count();
        inventory.contextActions.afterBringToFront = (await userAnnoIds(page)).length;
      }
    }

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
    inventory.history.filter = await page.getByPlaceholder(/filter|search history/i).count();
    inventory.history.close = await page.getByRole('button', { name: /Close version history|Collapse sidebar|Close document panel/ }).count();
    inventory.history.items = (await visibleNames(page.locator('[data-history-event], [data-anno-id], button, [role="menuitem"]'))).filter((name) => (
      /history|restore|save version|spotlight/i.test(name)
    )).slice(0, 20);

    const pagesTab = page.getByRole('button', { name: 'Pages', exact: true }).first();
    if (await pagesTab.isVisible().catch(() => false)) {
      await pagesTab.click();
      await page.waitForTimeout(200);
    }
    const thumb = page.locator('img[alt="Page 1"], [data-page-thumb="1"]').first();
    if (await thumb.count()) {
      await thumb.click({ button: 'right' }).catch(() => {});
      await page.waitForTimeout(200);
    }
    inventory.pagesOps.items = await visibleNames(page.locator('[data-pages-context-menu="true"] button, [data-pages-context-menu="true"] [role="menuitem"]'));
    inventory.pagesOps.extract = await page.getByRole('menuitem', { name: /Extract/i }).count()
      + await page.getByRole('button', { name: /Extract/i }).count();
    inventory.pagesOps.mirrorH = await page.getByText('Mirror horizontally', { exact: true }).count();
    inventory.pagesOps.reset = await page.getByText('Reset', { exact: true }).count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.retryNow = await page.getByRole('button', { name: 'Retry now', exact: true }).count();
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
    inventory.official.staleCollapsedClick = false;
    inventory.official.staleOverlayMount = false;
  } finally {
    console.log('AFTER_SPACES_OPENPANEL_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
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
  expect(inventory.contextActions.duplicate).toBe(0);
  expect(inventory.contextActions.group).toBe(0);
  expect(inventory.contextActions.created).toBeGreaterThan(0);
  expect(inventory.contextActions.copy).toBeGreaterThan(0);
  expect(inventory.contextActions.afterPaste).toBeGreaterThan(inventory.contextActions.created);
  expect(inventory.contextActions.menuAfterBringToFront).toBe(0);
  expect(inventory.pagesOps.extract).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.mobile.saveLog).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
