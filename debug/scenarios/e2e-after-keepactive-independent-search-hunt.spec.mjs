import { test, expect } from '@playwright/test';

// Independent hunt after the keepActive noteHasContent contract + last hunt.
// Do not treat the last hunt receipt as truth.
// Last hunt missed opening Search (`/^Search$/` after History/Bookmarks).
// This pass opens Search + zoom + unused seams the last hunt did not use.
// Do not replay Continue pin / Continue Count / Print fail-closed /
// compile-hidden / leftover-18 fail-closed / Templates / Projects /
// Documents / Archive / Spaces / Survey-rail / PDF waves.
// Do not invent .env.local / Stripe / MSAL / Turnstile / accounts /
// Print panel / stamp / measure / Group / Extract / Note-Link.

const HUB = '/?hubPreview=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const GLYPH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';

function visibleNames(locator) {
  return locator.evaluateAll((nodes) => (
    nodes
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80)
  ));
}

test('independent hunt after keepActive — open Search + unused seams', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    hub: {},
    hubEmpty: {},
    editorFresh: {},
    searchPanel: {},
    zoomMenu: {},
    overlay: {},
    thinnerChrome: {},
    unusedSeams: {},
    leftover18Hosts: {},
    mobile390: {},
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hub.accountExact = await page.getByRole('button', { name: 'Account', exact: true }).count();
  inventory.hub.settings = await page.getByRole('button', { name: /Settings/ }).count();
  inventory.hub.startTrial = await page.getByRole('button', { name: /Start .*trial/i }).count();
  inventory.hub.connect = await page.getByRole('button', { name: /^Connect$/ }).count();
  inventory.hub.upload = await page.getByRole('button', { name: /^Upload$/ }).count();
  inventory.hub.tabs = await visibleNames(page.locator('[role="tab"], .hub-tab, nav button'));
  inventory.hub.theme = await page.getByRole('button', { name: /Theme/ }).count();
  inventory.hub.notifications = await page.getByRole('button', { name: /Notifications/ }).count();
  inventory.hub.comments = await page.getByRole('button', { name: /Comments/ }).count();
  inventory.hub.pageDrop = await page.getByText(/page drop|dropped page/i).count();

  await page.goto(HUB_EMPTY, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hubEmpty.upload = await page.getByRole('button', { name: /Upload/ }).count();
  inventory.hubEmpty.newProject = await page.getByRole('button', { name: /New project/ }).count();
  inventory.hubEmpty.newTemplate = await page.getByRole('button', { name: /New template/ }).count();
  inventory.hubEmpty.startTrial = await page.getByRole('button', { name: /Start .*trial/i }).count();
  inventory.hubEmpty.connect = await page.getByRole('button', { name: /^Connect$/ }).count();

  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

  inventory.editorFresh.exportPdf = await page.getByRole('button', { name: 'Export annotated PDF' }).count();
  inventory.editorFresh.history = await page.getByRole('button', { name: /History|Version history|Revisions/ }).count();
  inventory.editorFresh.bookmarks = await page.getByRole('button', { name: /Bookmarks/ }).count();
  inventory.editorFresh.search = await page.getByRole('button', { name: /Search/ }).count();
  inventory.editorFresh.pages = await page.getByRole('button', { name: /Pages/ }).count();
  inventory.editorFresh.spaces = await page.getByRole('button', { name: /^Spaces$/ }).count();
  inventory.editorFresh.print = await page.getByRole('button', { name: /Print/ }).count();
  inventory.editorFresh.stamp = await page.getByRole('button', { name: /Stamp/ }).count();
  inventory.editorFresh.extract = await page.getByRole('button', { name: /Extract/ }).count();
  inventory.editorFresh.forms = await page.getByRole('button', { name: 'Forms', exact: true }).count();
  inventory.editorFresh.continueCount = await page.getByText('Continue Count', { exact: true }).count();
  inventory.editorFresh.continuePin = await page.getByText('Continue pin', { exact: true }).count();
  inventory.editorFresh.actualSize = await page.getByRole('button', { name: /Actual size/ }).count();
  inventory.editorFresh.renamePage = await page.getByRole('button', { name: /Rename page/i }).count();
  inventory.editorFresh.twoPage = await page.getByRole('button', { name: /Two.page|Facing/i }).count();
  inventory.editorFresh.rotateView = await page.getByRole('button', { name: /Rotate view/i }).count();
  inventory.editorFresh.comments = await page.getByRole('button', { name: /Comments/ }).count();
  inventory.editorFresh.theme = await page.getByRole('button', { name: /Theme/ }).count();
  inventory.editorFresh.notifications = await page.getByRole('button', { name: /Notifications/ }).count();
  inventory.editorFresh.pageDrop = await page.getByText(/page drop|dropped page/i).count();
  inventory.editorFresh.matchCase = await page.getByRole('button', { name: /Match case|Case sensitive/i }).count();
  inventory.editorFresh.wholeWord = await page.getByRole('button', { name: /Whole word/i }).count();

  const zoomTrigger = page.getByRole('button', { name: /Fit options|Zoom options|Fit page|Fit width|Fit height/ }).first();
  if (await zoomTrigger.count()) {
    await zoomTrigger.click({ timeout: 5_000 }).catch(() => {});
    inventory.zoomMenu.labels = await visibleNames(page.locator('[role="menu"] button, [data-zoom-menu] button, [role="menuitem"]'));
    inventory.zoomMenu.actualSize = await page.getByRole('button', { name: /Actual size/ }).count();
    inventory.zoomMenu.fitHeight = await page.getByRole('button', { name: /Fit height/ }).count();
    inventory.zoomMenu.fitWidth = await page.getByRole('button', { name: /Fit width/ }).count();
    inventory.zoomMenu.fitPage = await page.getByRole('button', { name: /Fit page/ }).count();
    inventory.zoomMenu.twoPage = await page.getByRole('button', { name: /Two.page|Facing/i }).count();
    inventory.zoomMenu.rotateView = await page.getByRole('button', { name: /Rotate view/i }).count();
    await page.keyboard.press('Escape');
  }

  await page.keyboard.press('?');
  inventory.overlay.visible = await page.getByRole('dialog', { name: /shortcut|keyboard/i }).count()
    + await page.locator('[data-keyboard-shortcuts], .keyboard-shortcuts-overlay').count();
  inventory.overlay.stamp = await page.getByText('Stamp', { exact: true }).count();
  inventory.overlay.measure = await page.getByText(/Measure/).count();
  inventory.overlay.extract = await page.getByText('Extract', { exact: true }).count();
  inventory.overlay.forms = await page.getByText('Forms', { exact: true }).count();
  inventory.overlay.continue = await page.getByText(/Continue (pin|Count)/).count();
  inventory.overlay.f3 = await page.getByText(/F3/).count();
  inventory.overlay.searchText = await page.getByText('Search text').count();
  inventory.overlay.close = await page.getByRole('button', { name: 'Close' }).count();
  await page.keyboard.press('Escape');

  // Last keepActive hunt missed this panel. Open Search independently.
  await page.goto(GLYPH_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  const searchBtn = page.getByRole('button', { name: /Search/ }).first();
  await expect(searchBtn).toBeVisible({ timeout: 15_000 });
  await searchBtn.click({ timeout: 8_000 });
  inventory.searchPanel.open = true;
  inventory.searchPanel.field = await page.locator('input[type="search"], input[aria-label*="Search" i], input[placeholder*="Search" i], input[placeholder*="Find" i]').count();
  inventory.searchPanel.next = await page.getByRole('button', { name: /Next|Find next/i }).count();
  inventory.searchPanel.prev = await page.getByRole('button', { name: /Previous|Find previous/i }).count();
  inventory.searchPanel.matchCase = await page.getByRole('button', { name: /Match case|Case sensitive/i }).count();
  inventory.searchPanel.wholeWord = await page.getByRole('button', { name: /Whole word/i }).count();
  inventory.searchPanel.buttons = (await visibleNames(page.locator('button'))).filter((name) => (
    /Search|Find|Next|Previous|Close|Match|Word/i.test(name)
  )).slice(0, 20);
  await page.keyboard.press('Escape');

  await page.goto(FORM_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.unusedSeams.kal441 = {
    draw: await page.getByRole('button', { name: 'Draw', exact: true }).count(),
    formLayer: await page.locator('.pdfjsFormLayer, .annotationLayer input, [data-form-tool]').count(),
    formsToolbar: await page.getByRole('button', { name: 'Forms', exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
    print: await page.getByRole('button', { name: /Print/ }).count(),
  };

  inventory.leftover18Hosts = await page.evaluate(() => ({
    envLocalHint: Boolean(window.__devAutoLoginEmail),
    fileId: window.__devTestPdf?.id ?? null,
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LINK_PDF, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  inventory.mobile390 = {
    continuePin: await page.getByText('Continue pin', { exact: true }).count(),
    continueCount: await page.getByText('Continue Count', { exact: true }).count(),
    print: await page.getByRole('button', { name: /Print/ }).count(),
    stamp: await page.getByRole('button', { name: /Stamp/ }).count(),
    extract: await page.getByRole('button', { name: /Extract/ }).count(),
    forms: await page.getByRole('button', { name: 'Forms', exact: true }).count(),
    actualSize: await page.getByRole('button', { name: /Actual size/ }).count(),
    twoPage: await page.getByRole('button', { name: /Two.page|Facing/i }).count(),
    rotateView: await page.getByRole('button', { name: /Rotate view/i }).count(),
    search: await page.getByRole('button', { name: /Search/ }).count(),
    history: await page.getByRole('button', { name: /Version history|History/ }).count(),
    matchCase: await page.getByRole('button', { name: /Match case|Case sensitive/i }).count(),
  };

  inventory.thinnerChrome = {
    searchOpened: inventory.searchPanel.open === true,
    searchField: inventory.searchPanel.field,
    searchNext: inventory.searchPanel.next,
    searchPrev: inventory.searchPanel.prev,
    searchMatchCase: inventory.searchPanel.matchCase,
    searchWholeWord: inventory.searchPanel.wholeWord,
    zoomActualSize: inventory.zoomMenu.actualSize ?? 0,
    zoomFitHeight: inventory.zoomMenu.fitHeight ?? 0,
    editorTwoPage: inventory.editorFresh.twoPage,
    editorRotateView: inventory.editorFresh.rotateView,
    editorComments: inventory.editorFresh.comments,
    editorTheme: inventory.editorFresh.theme,
    editorNotifications: inventory.editorFresh.notifications,
    editorPageDrop: inventory.editorFresh.pageDrop,
    editorRenamePage: inventory.editorFresh.renamePage,
    hubTheme: inventory.hub.theme,
    hubNotifications: inventory.hub.notifications,
    hubComments: inventory.hub.comments,
  };

  expect(inventory.hub.startTrial).toBe(0);
  expect(inventory.hub.connect).toBe(0);
  expect(inventory.overlay.stamp).toBe(0);
  expect(inventory.overlay.extract).toBe(0);
  expect(inventory.overlay.continue).toBe(0);
  expect(inventory.searchPanel.open).toBe(true);
  expect(inventory.searchPanel.field).toBeGreaterThan(0);
  expect(inventory.searchPanel.matchCase).toBe(0);
  expect(inventory.searchPanel.wholeWord).toBe(0);
  expect(inventory.editorFresh.twoPage).toBe(0);
  expect(inventory.editorFresh.rotateView).toBe(0);
  expect(inventory.editorFresh.actualSize).toBe(0);
  expect(inventory.leftover18Hosts.envLocalHint).toBeFalsy();
  expect(inventory.leftover18Hosts.fileId).toBeNull();
  expect(inventory.mobile390.continueCount).toBe(0);
  expect(inventory.mobile390.print).toBe(0);
  expect(inventory.unusedSeams.kal441.formsToolbar).toBe(0);

  console.log('AFTER_KEEPACTIVE_INDEPENDENT_SEARCH_HUNT', JSON.stringify(inventory));
});
