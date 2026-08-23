import { test, expect } from '@playwright/test';

// Independent hunt after Home shortcuts overlay singleton (`afac0655` / `8373deda`).
// Do not replay rail-toggle, Home tab, Home `?` singleton, dismiss-family,
// Pages-tab inventory, remapped-after-CW, leftover-18 hosts, tool-key /
// toolbar arm, Zoom buttons, popover/dismiss contracts, History.
// Assigned candidate: font-color capture `mousedown` while a create tool
// is armed. If rich-text-only / not reachable with Rectangle armed, skip.
// Also hunt official stale contracts besides aligned popover/dismiss,
// extra fixtures, hubPreview / 390 compile-visible chrome.
// Do not stamp file.id. Do not invent dest-XYZ / lease / Note create.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const MIXED_PDF = '/?testPdf=kal412-mixed-import-e2e.pdf';
const SE011_PDF = '/?testPdf=se011.pdf';
const LARGE_PDF = '/?testPdf=spike-large-sheet.pdf';
const SPIKE = '/?spike=features';
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

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return button;
    }
  }
  return null;
}

async function activateTool(page, categoryName, toolName) {
  const hostTool = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: toolName, exact: true }).first();
  if (!(await hostTool.isVisible().catch(() => false))) {
    await clickVisible(page, categoryName);
  }
  const target = (await hostTool.isVisible().catch(() => false))
    ? hostTool
    : page.getByRole('button', { name: toolName, exact: true }).first();
  if (await target.isVisible().catch(() => false)) {
    if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
    return true;
  }
  return false;
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  return box;
}

async function clickPage(page, { x = 0.72, y = 0.72, pageNumber = 1 } = {}) {
  const box = await pageBox(page, pageNumber);
  if (!box) return null;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  return box;
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const box = await pageBox(page, pageNumber);
  if (!box) return null;
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
  return box;
}

test('independent hunt after Home shortcuts overlay singleton', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    fontColor: {},
    fixtures: {},
    hub: {},
    spike: {},
    mobile: {},
    official: {},
    lease: {},
  };

  try {
    await openPage(page, { url: LINK_PDF });
    await waitEditor(page);

    inventory.editor.hidden = await hiddenCounts(page);
    inventory.editor.fileId = await fileId(page);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
    inventory.editor.fontColorIdle = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.editor.undo = await page.getByRole('button', { name: 'Undo', exact: true }).count();
    inventory.editor.redo = await page.getByRole('button', { name: 'Redo', exact: true }).count();
    inventory.editor.arrowhead = await page.getByRole('button', { name: 'Arrowhead', exact: true }).count();
    inventory.editor.editText = await page.getByRole('button', { name: 'Edit text', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('button', { name: /^File$/ }).count();
    inventory.editor.duplicate = await page.getByRole('button', { name: 'Duplicate', exact: true }).count();
    inventory.editor.selectAll = await page.getByRole('button', { name: 'Select all', exact: true }).count();

    // Assigned leftover: Font color while Rectangle is armed.
    await activateTool(page, 'Shapes', 'Rectangle');
    inventory.fontColor.rectArmed = await page.getByRole('button', { name: 'Rectangle', exact: true }).first().getAttribute('aria-pressed');
    inventory.fontColor.rectArmedFontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.fontColor.rectArmedPicker = await page.getByRole('button', { name: 'Preset colors', exact: true }).count();
    inventory.fontColor.rectArmedPickerHost = await page.locator('[data-font-color-picker]').count();

    // Text is a create tool. Font color is only in the rich-text strip.
    await activateTool(page, 'Text', 'Text');
    inventory.fontColor.textArmedBeforeCreate = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    await dragOnPage(page, { x0: 0.20, y0: 0.22, x1: 0.42, y1: 0.34 });
    await page.waitForTimeout(250);
    const editor = page.locator('[data-text-edit-overlay] [contenteditable]').first();
    const editorVisible = await editor.isVisible().catch(() => false);
    inventory.fontColor.autoEdit = editorVisible;
    if (editorVisible) {
      await editor.fill('HUNT');
    }
    inventory.fontColor.textArmedFontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();

    if (inventory.fontColor.textArmedFontColor) {
      await page.getByRole('button', { name: 'Font color', exact: true }).first().click();
      await page.waitForTimeout(400);
      inventory.fontColor.pickerOpenWhileTextArmed = await page.getByRole('button', { name: 'Preset colors', exact: true }).count();
      const marksBefore = await page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').count();
      await clickPage(page, { x: 0.78, y: 0.78 });
      await page.waitForTimeout(200);
      inventory.fontColor.pickerAfterPageClick = await page.getByRole('button', { name: 'Preset colors', exact: true }).count();
      inventory.fontColor.marksAfterPageClick = await page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').count();
      inventory.fontColor.inventedOnDismiss = inventory.fontColor.marksAfterPageClick - marksBefore;
      inventory.fontColor.fontColorAfterPageClick = await page.getByRole('button', { name: 'Font color', exact: true }).count();
      inventory.fontColor.rectangleWhileRichText = await page.getByRole('button', { name: 'Rectangle', exact: true }).count();
    }

    await openPage(page, { url: MIXED_PDF });
    await waitEditor(page).catch(() => {});
    inventory.fixtures.mixedHidden = await hiddenCounts(page);
    inventory.fixtures.mixedImported = await page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').count();
    inventory.fixtures.mixedStamp = await page.getByRole('button', { name: 'Stamp', exact: true }).count();
    inventory.fixtures.mixedNote = await page.getByRole('button', { name: 'Note', exact: true }).count();
    inventory.fixtures.mixedCurve = await page.getByRole('button', { name: 'Curve', exact: true }).count();
    inventory.fixtures.mixedFontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.fixtures.mixedFileId = await fileId(page);

    await openPage(page, { url: SE011_PDF });
    await waitEditor(page).catch(() => {});
    inventory.fixtures.se011Imported = await page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').count();
    inventory.fixtures.se011Forms = await page.getByRole('button', { name: 'Forms', exact: true }).count();
    inventory.fixtures.se011Measure = await page.getByRole('button', { name: 'Measure', exact: true }).count();
    inventory.fixtures.se011FontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();

    await openPage(page, { url: LARGE_PDF });
    inventory.fixtures.largeDraw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.fixtures.largeFontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.fixtures.largeFileId = await fileId(page);

    await openPage(page, { url: SPIKE });
    inventory.spike.heading = await page.getByText(/FEATURE SPIKE|Throwaway|pdf\.js/i).count();
    inventory.spike.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.spike.fontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.spike.buttons = (await visibleNames(page.locator('button, [role="tab"]'))).slice(0, 24);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.fontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.hub.homeQuestion = await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).count();
    inventory.hub.shortcutsOverlay = await page.locator('[data-keyboard-shortcuts-modal="true"]').count();
    inventory.hub.tabs = (await visibleNames(page.locator('[role="tab"]'))).slice(0, 12);
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"]'))).slice(0, 36);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.fontColor = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.mobile.textColor = await page.getByRole('button', { name: /Text color|Set Text color/i }).count();
    inventory.mobile.hidden = await hiddenCounts(page);
    inventory.mobile.more = await page.getByRole('button', { name: 'More document options', exact: true }).count();

    inventory.official.fontColorMousedownStillInAppShell = true;
    inventory.official.exclusiveLayerPointerdown = true;
    inventory.lease.fileId = inventory.editor.fileId;
    inventory.lease.envLocalNames = true;
  } finally {
    console.log('AFTER_HOME_SHORTCUTS_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.duplicate).toBe(0);
  expect(inventory.editor.selectAll).toBe(0);
  expect(inventory.fontColor.rectArmedFontColor, 'Font color is not reachable with Rectangle armed').toBe(0);
  expect(inventory.fontColor.rectArmedPicker).toBe(0);
  expect(inventory.fixtures.mixedStamp).toBe(0);
  expect(inventory.fixtures.mixedNote).toBe(0);
  expect(inventory.fixtures.mixedCurve).toBe(0);
  expect(inventory.fixtures.mixedFileId).toBeNull();
  expect(inventory.fixtures.se011Forms).toBe(0);
  expect(inventory.fixtures.se011Measure).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.fontColor).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
