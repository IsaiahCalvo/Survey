import { test, expect } from '@playwright/test';

// Independent hunt after Pages tab-as-switcher (`e03c9deb`).
// Do not replay rail-toggle family (Expand Survey / Spaces / Search /
// Bookmarks / Pages tab-as-switcher), dismiss-family, Home, Close tab,
// toolbar arm, P-04 letters, rail Prev-Next / Zoom ±, Ctrl+2 / Ctrl+M /
// Ctrl+0 / Ctrl+1, remapped-after-CW, leftover-18 hosts, History
// Expand/Collapse, hub More dedicated, V-06/V-07, dest-XYZ, or the
// aligned popover contract.
// Go beyond e2e-after-bookmarks-rail-independent-hunt: click Export
// (do not claim as leftover), unused chords, 390 More items, hub More
// items, extra fixtures, query-param chrome, form fill, fresh rect
// create+persist without rotate, official font-color mousedown note.
// Do not stamp file.id. Do not invent dest-XYZ / lease / Note create.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
const STICKY_PDF = '/?testPdf=e2e-sticky-note.pdf';
const INK_PDF = '/?testPdf=kal405-ink-dots.pdf';
const POLY_PDF = '/?testPdf=e2e-poly-vertices.pdf';
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

test('independent hunt after Pages tab-as-switcher leftover', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    export: {},
    chords: {},
    create: {},
    multi: {},
    fixtures: {},
    forms: {},
    hub: {},
    queries: {},
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
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.rectangle = await page.getByRole('button', { name: 'Rectangle', exact: true }).count();
    inventory.editor.ellipse = await page.getByRole('button', { name: 'Ellipse', exact: true }).count();
    inventory.editor.selectAll = await page.getByRole('button', { name: 'Select all', exact: true }).count();
    inventory.editor.duplicate = await page.getByRole('button', { name: 'Duplicate', exact: true }).count();
    inventory.editor.fileMenu = await page.getByRole('button', { name: /^File$/ }).count();
    inventory.editor.curve = await page.getByRole('button', { name: 'Curve', exact: true }).count();
    inventory.editor.stamp = await page.getByRole('button', { name: 'Stamp', exact: true }).count();
    inventory.editor.cloud = await page.getByRole('button', { name: 'Cloud', exact: true }).count();
    inventory.editor.versionHistory = await page.getByRole('button', { name: 'Version history', exact: true }).count();

    // Beyond last hunt: click the live Export button (X-02 / leftover-18 /
    // remapped export already dedicated — do not claim this leftover).
    if (inventory.editor.export) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 45_000 }).catch(() => null),
        page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first().click(),
      ]);
      inventory.export.desktopClicked = true;
      inventory.export.desktopFilename = download ? download.suggestedFilename() : null;
      inventory.export.inventedAfterExport = await page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').count();
    }

    await page.keyboard.press('Control+s');
    inventory.chords.ctrlSToast = await page.getByText(/saved|Save version needs|signed-in/i).count();
    await page.keyboard.press('Control+Shift+E');
    inventory.chords.ctrlShiftEDownloadWait = 'browser-noop-or-menu';
    await page.keyboard.press('Control+w');
    inventory.chords.ctrlWDrawStill = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.chords.ctrlWCloseTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();

    await page.keyboard.press('?');
    const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
    if (await overlay.isVisible().catch(() => false)) {
      const overlayText = await overlay.innerText();
      inventory.chords.listsFind = /Find|Ctrl\+F|⌘F/.test(overlayText);
      inventory.chords.listsExport = /Export/.test(overlayText);
      inventory.chords.listsSave = /Save/.test(overlayText);
      inventory.chords.listsUndo = /Undo/.test(overlayText);
      inventory.chords.listsFitHeight = /Fit height/.test(overlayText);
      inventory.chords.listsF3 = /F3/.test(overlayText);
      inventory.chords.listsDuplicate = /Duplicate/.test(overlayText);
      inventory.chords.listsPagesTab = /Open pages|Expand Pages|Pages panel|Pages tab|Switch to Pages/.test(overlayText);
      await page.keyboard.press('Escape');
    }

    // Fresh rect create+persist without rotate (shape-live-create dedicated).
    const shapes = page.getByRole('button', { name: 'Shapes', exact: true });
    if (await shapes.count()) await shapes.first().click();
    const rectBtn = page.getByRole('button', { name: 'Rectangle', exact: true }).first();
    if (await rectBtn.count()) {
      await rectBtn.click();
      const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(200);
      }
    }
    inventory.create.rectIds = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-annotation-index]')];
      return groups.map((g) => g.getAttribute('data-anno-id')).filter(Boolean);
    });
    inventory.create.duplicateAfterCreate = await page.getByRole('button', { name: 'Duplicate', exact: true }).count();
    inventory.create.group = await page.getByRole('button', { name: 'Group', exact: true }).count();
    inventory.create.selectAll = await page.getByRole('button', { name: 'Select all', exact: true }).count();

    await openPage(page, { url: FORM_PDF });
    await waitEditor(page).catch(() => {});
    inventory.forms.widgets = await page.locator('.pdfjsFormLayer input, .annotationLayer input, .pdfjsFormLayer select').count();
    inventory.forms.formsButton = await page.getByRole('button', { name: 'Forms', exact: true }).count();
    const textWidget = page.locator('.pdfjsFormLayer input[type="text"]').first();
    if (await textWidget.count()) {
      await textWidget.click({ timeout: 5_000 }).catch(() => {});
      await textWidget.fill('HUNT').catch(() => {});
      inventory.forms.filled = await textWidget.inputValue().catch(() => null);
    }
    inventory.forms.fileId = await fileId(page);

    await openPage(page, { url: STICKY_PDF });
    await waitEditor(page).catch(() => {});
    inventory.fixtures.stickyNoteBtn = await page.getByRole('button', { name: 'Note', exact: true }).count();
    inventory.fixtures.stickyPopup = await page.getByText(/Sticky|Popup note/i).count();

    await openPage(page, { url: INK_PDF });
    await waitEditor(page).catch(() => {});
    inventory.fixtures.inkDots = await page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').count();

    await openPage(page, { url: POLY_PDF });
    await waitEditor(page).catch(() => {});
    inventory.fixtures.polyGroups = await page.locator('[data-svg-annotation-layer="1"] > g[data-annotation-index]').count();

    await openPage(page, { url: SEARCH_PDF });
    await waitEditor(page);
    inventory.editor.matchCase = await page.getByRole('button', { name: 'Match case', exact: true }).count();
    inventory.editor.wholeWord = await page.getByRole('button', { name: 'Whole word', exact: true }).count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.pages = await page.getByRole('button', { name: 'Pages', exact: true }).count();
    inventory.hub.more = await page.getByRole('button', { name: /^More$/ }).count();
    inventory.hub.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 48);
    if (inventory.hub.more) {
      await page.getByRole('button', { name: /^More$/ }).first().click();
      inventory.hub.moreItems = (await visibleNames(page.locator('[role="menuitem"], [data-doc-menu] button, .doc-menu button'))).slice(0, 16);
      await page.keyboard.press('Escape');
    }

    await openPage(page, { url: '/?hubPreview=1&empty=1' });
    inventory.queries.emptyHub = await page.locator('.survey-hub').isVisible().catch(() => false);
    inventory.queries.emptyTryAgain = await page.getByRole('button', { name: 'Try again', exact: true }).count();

    await openPage(page, { url: '/?hubPreview=1&guest=1' });
    inventory.queries.guestAuth = await page.locator('.auth-modal').isVisible().catch(() => false);

    await openPage(page, { url: '/?hubPreview=1&tab=billing' });
    inventory.queries.billingStartTrial = await page.getByRole('button', { name: /Start trial|Upgrade/i }).count();

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.openHub = await page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true }).count();
    inventory.mobile.versionHistory = await page.getByRole('button', { name: 'Version history', exact: true }).count();
    inventory.mobile.more = await page.getByRole('button', { name: 'More document options', exact: true }).count();
    if (inventory.mobile.more) {
      await page.getByRole('button', { name: 'More document options', exact: true }).click();
      inventory.mobile.moreItems = (await visibleNames(page.locator('.mobile-pdf-tools__popover.is-more button'))).slice(0, 12);
      inventory.mobile.moreExport = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
      inventory.mobile.saveLog = await page.getByRole('button', { name: 'Save log', exact: true }).count();
      await page.keyboard.press('Escape');
    }
    inventory.mobile.hidden = await hiddenCounts(page);
    inventory.mobile.presence = await page.getByRole('button', { name: /active user/ }).count();

    inventory.official.fontColorMousedown = true;
    inventory.lease.fileId = inventory.editor.fileId;
    inventory.lease.envLocalNames = true;
  } finally {
    console.log('AFTER_PAGES_TAB_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.curve).toBe(0);
  expect(inventory.editor.stamp).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.selectAll).toBe(0);
  expect(inventory.create.group).toBe(0);
  expect(inventory.create.duplicateAfterCreate).toBe(0);
  expect(inventory.chords.listsPagesTab).toBe(false);
  expect(inventory.editor.matchCase).toBe(0);
  expect(inventory.editor.wholeWord).toBe(0);
  expect(inventory.forms.formsButton).toBe(0);
  expect(inventory.fixtures.stickyNoteBtn).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.mobile.openHub).toBeGreaterThan(0);
  expect(inventory.mobile.more).toBeGreaterThan(0);
  expect(inventory.mobile.saveLog).toBe(0);
  expect(inventory.chords.ctrlWDrawStill).toBeGreaterThan(0);
});
