import { test, expect } from '@playwright/test';

// Independent hunt after Search text rail toggle (`7fbd7bb7` / `31baa5a0`).
// Do not replay Search rail toggle, Spaces rail toggle, Expand/Collapse
// Survey, left-rail History Expand/Collapse sidebar, Bookmarks rail
// toggle (this-pass leftover), dismiss-family, Home, Close tab, toolbar
// arm, P-04 letters, rail Prev-Next / Zoom ±, Ctrl+2 / Ctrl+M,
// remapped-after-CW, leftover-18 hosts, or the aligned popover contract.
// Go beyond e2e-after-spaces-rail-independent-hunt: Pages tab-as-switcher
// from Bookmarks (no thumbnail jump), History icon, File Print, unused
// chords, hub More, 390 Bookmarks tab, create-path Ellipse. Do not stamp
// file.id. Do not invent dest-XYZ.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';
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

test('independent hunt after Search rail toggle leftover', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    rails: {},
    pagesSwitcher: {},
    history: {},
    chords: {},
    create: {},
    forms: {},
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
    inventory.editor.export = await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).count();
    inventory.editor.rectangle = await page.getByRole('button', { name: 'Rectangle', exact: true }).count();
    inventory.editor.ellipse = await page.getByRole('button', { name: 'Ellipse', exact: true }).count();
    inventory.editor.selectAll = await page.getByRole('button', { name: 'Select all', exact: true }).count();
    inventory.editor.closeTab = await page.getByRole('button', { name: 'Close tab', exact: true }).count();

    inventory.rails.pages = await page.getByRole('button', { name: 'Pages', exact: true }).count();
    inventory.rails.searchText = await page.getByRole('button', { name: 'Search text', exact: true }).count();
    inventory.rails.bookmarks = await page.getByRole('button', { name: 'Bookmarks', exact: true }).count();
    inventory.rails.spaces = await page.getByRole('button', { name: 'Spaces', exact: true }).count();
    inventory.rails.expandSidebar = await page.getByRole('button', { name: 'Expand sidebar', exact: true }).count();
    inventory.rails.expandSurvey = await page.getByRole('button', { name: 'Expand Survey panel', exact: true }).count();
    inventory.rails.left = (await visibleNames(page.locator('#chrome-left-host button, #chrome-left-host [role="tab"]'))).slice(0, 24);
    inventory.rails.right = (await visibleNames(page.locator('#chrome-right-host button, #chrome-right-host [role="tab"]'))).slice(0, 24);

    // Beyond last hunt: Pages tab-as-switcher from Bookmarks (count only;
    // not this leftover; do not click thumbnails / do not jump).
    const bookmarksTab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
    if (await bookmarksTab.isVisible().catch(() => false)) {
      await bookmarksTab.click();
      await expect(page.getByText(/No bookmarks yet/i)).toBeVisible({ timeout: 8_000 }).catch(() => {});
    }
    const pagesTab = page.getByRole('button', { name: 'Pages', exact: true }).first();
    const editPage = page.getByRole('button', { name: 'Edit page number', exact: true });
    const pageBefore = (await editPage.count()) ? (await editPage.innerText()).trim() : '1';
    if (await pagesTab.isVisible().catch(() => false)) {
      await pagesTab.click();
      await expect(
        page.getByAltText('Page 1').or(page.getByText('Loading...')).or(page.getByText('Loading pages…')),
      ).toBeVisible({ timeout: 8_000 }).catch(() => {});
      inventory.pagesSwitcher.page1Visible = await page.getByAltText('Page 1').isVisible().catch(() => false);
      inventory.pagesSwitcher.loading = await page.getByText('Loading...').isVisible().catch(() => false);
      inventory.pagesSwitcher.noBookmarksYetVisible = await page.getByText(/No bookmarks yet/i).isVisible().catch(() => false);
      inventory.pagesSwitcher.pageAfter = (await editPage.count()) ? (await editPage.innerText()).trim() : pageBefore;
      inventory.pagesSwitcher.pageUnchanged = inventory.pagesSwitcher.pageAfter === pageBefore;
    }

    inventory.history.versionHistory = await page.getByRole('button', { name: 'Version history', exact: true }).count();
    inventory.history.collapseSidebar = await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).count();

    await page.keyboard.press('?');
    const overlay = page.locator('[data-keyboard-shortcuts-modal="true"]');
    if (await overlay.isVisible().catch(() => false)) {
      const overlayText = await overlay.innerText();
      inventory.chords.listsFind = /Find|Ctrl\+F|⌘F/.test(overlayText);
      inventory.chords.listsDuplicate = /Duplicate/.test(overlayText);
      inventory.chords.listsGroup = /Group|Ungroup/.test(overlayText);
      inventory.chords.listsExtract = /Extract/.test(overlayText);
      inventory.chords.listsBookmarksTab = /Open bookmarks|Expand Bookmarks|Bookmarks panel/.test(overlayText);
      await page.keyboard.press('Escape');
    }

    inventory.create.rectangle = inventory.editor.rectangle;
    inventory.create.ellipse = inventory.editor.ellipse;
    inventory.create.curve = await page.getByRole('button', { name: 'Curve', exact: true }).count();
    inventory.create.stamp = await page.getByRole('button', { name: 'Stamp', exact: true }).count();
    inventory.create.cloud = await page.getByRole('button', { name: 'Cloud', exact: true }).count();

    await openPage(page, { url: SEARCH_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    inventory.rails.searchTextOnSearchPdf = await page.getByRole('button', { name: 'Search text', exact: true }).count();
    inventory.rails.matchCase = await page.getByRole('button', { name: 'Match case', exact: true }).count();
    inventory.rails.wholeWord = await page.getByRole('button', { name: 'Whole word', exact: true }).count();

    await openPage(page, { url: FORM_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.forms.widgets = await page.locator('.pdfjsFormLayer input, .annotationLayer input, .pdfjsFormLayer select').count();
    inventory.forms.formsButton = await page.getByRole('button', { name: 'Forms', exact: true }).count();
    inventory.forms.fileId = await fileId(page);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.searchText = await page.getByRole('button', { name: 'Search text', exact: true }).count();
    inventory.hub.bookmarks = await page.getByRole('button', { name: 'Bookmarks', exact: true }).count();
    inventory.hub.noBookmarksYet = await page.getByText(/No bookmarks yet/i).count();
    inventory.hub.addBookmark = await page.getByRole('button', { name: 'Add bookmark', exact: true }).count();
    inventory.hub.copyToSpaces = await page.getByRole('button', { name: /Copy to Spaces|Copy to spaces/ }).count();
    inventory.hub.more = await page.getByRole('button', { name: /^More$/ }).count();
    inventory.hub.account = await page.getByRole('button', { name: /Account|You/ }).count();
    inventory.hub.buttons = (await visibleNames(page.locator('button, [role="tab"], [role="menuitem"]'))).slice(0, 48);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    inventory.mobile.openHub = await page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true }).count();
    inventory.mobile.openSpaces = await page.getByRole('button', { name: 'Open spaces', exact: true }).count();
    inventory.mobile.searchText = await page.getByRole('button', { name: 'Search text', exact: true }).count();
    if (inventory.mobile.openHub) {
      await page.getByRole('button', { name: 'Open pages, search, and bookmarks', exact: true }).click();
      inventory.mobile.hubBookmarksTab = await page.getByRole('button', { name: 'Bookmarks', exact: true }).count();
      inventory.mobile.hubDefaultsEmpty = await page.getByText(/No bookmarks yet/i).isVisible().catch(() => false);
    }
    inventory.mobile.hidden = await hiddenCounts(page);

    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_SEARCH_RAIL_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.rails.bookmarks).toBeGreaterThan(0);
  expect(inventory.rails.pages).toBeGreaterThan(0);
  expect(inventory.pagesSwitcher.page1Visible || inventory.pagesSwitcher.loading).toBe(true);
  expect(inventory.pagesSwitcher.noBookmarksYetVisible).toBe(false);
  expect(inventory.pagesSwitcher.pageUnchanged).toBe(true);
  expect(inventory.create.curve).toBe(0);
  expect(inventory.create.stamp).toBe(0);
  expect(inventory.rails.matchCase).toBe(0);
  expect(inventory.rails.wholeWord).toBe(0);
  expect(inventory.forms.formsButton).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.noBookmarksYet).toBe(0);
  expect(inventory.hub.addBookmark).toBe(0);
  expect(inventory.mobile.openHub).toBeGreaterThan(0);
  expect(inventory.mobile.hubBookmarksTab).toBeGreaterThan(0);
  expect(inventory.mobile.hubDefaultsEmpty).toBe(false);
});
