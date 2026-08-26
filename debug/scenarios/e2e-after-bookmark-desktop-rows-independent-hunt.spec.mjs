import { test, expect } from '@playwright/test';

// Independent hunt after Bookmarks desktop rows role=button.
// Axis: compile-visible leftovers that are NOT leftover-18
// and NOT Bookmarks desktop rows / Search result rows /
// Templates desktop template rows / Projects desktop
// project rows / Documents desktop rows / Documents
// desktop sort headers / Documents More / Archive desktop
// rows / Archive desktop sort headers / Manage Team Users /
// Role / Added / Selection mode caret / Eraser Type caret /
// Eraser Type menuitem / 390 hub rail nav Escape / Invite
// accept type / 390 Templates category title name /
// Templates checklist item field name / Templates entity
// color layer type / Templates checklist chrome type /
// Templates More trigger type / Templates More menu name /
// desktop Templates Click to rename / Projects Tap to
// rename / Survey toolbar category chips type / Manage Team
// Edit type / AuthModal remaining type / AuthModal Close
// type / Manage Team search field name / Settings Connect
// type / Search text field name / Search Clear / Search
// Previous/Next type / Bookmarks drag grip name / Bookmarks
// Expand/Edit/Delete/grip name/type. Official
// annotationContextMenuitem leftover vs spec Enter is not
// stale vs live source (source already has Enter). Do not
// stamp file.id. Do not invent leftover-18 mint / roster /
// Stripe. Do not take MoveCopy Close/Cancel/Confirm. Do not
// take Documents More menuitem type-null. Do not take
// Templates MoreMenu menuitem type-null. Do not take
// Activity Close (A-06) or Activity File / Edited spans
// (need View activity). Do not take Manage Team role
// trigger (0). Do not take Survey item Notes. Do not take
// Spaces expand/delete (Create space apply). Do not open
// Edit-modules. Do not take Projects file rows (Open file).
// Do not click Share / Delete / Duplicate / Move/Copy /
// Rename / New template apply / Add checklist item apply /
// Walls / Windows chips / Sign in / Create account /
// Restore / Delete forever / Open file / Upload / Sign out
// / Delete account / Subscription apply / Create category
// confirm / Create space / Export Excel / Sync / View
// activity / Change role / Remove / All / Copy email /
// Invite / Send / swatch / hex / Transparent / Sign in to
// continue apply / Back to Survey apply / Documents /
// Projects / Templates / Archive drawer apply / Select
// annotations / Select text apply / Pen / Highlighter /
// Eraser create / Partial erase menuitem / Full stroke
// erase menuitem / Manage team / New project apply /
// Create project / Previous match / Next match / Add
// bookmark / Export / Create bookmark group / Add to group.

const AFTER_BOOKMARK_DESKTOP_ROWS_INDEPENDENT_HUNT = true;

const HUB = '/?hubPreview=1';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const INVITE = '/invite/leftover-type-probe';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const OUTLINE_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const TEMPLATE = 'Security Walk-Through';

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('kal31_pending_invite_token');
      localStorage.removeItem('eraserMode');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function navTrigger(page) {
  return page.getByRole('button', { name: 'Open navigation', exact: true });
}

function navDrawer(page) {
  return page.locator('[aria-label="Mobile navigation"]');
}

function desktopCategoryTitle(page) {
  return page.locator('input.inline-edit.cat-title:not([data-template-title])');
}

function fileHeader(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^File/i });
}

function desktopRows(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^Preview / });
}

function nameHeader(page) {
  return page.locator('.archive-desktop-card').getByRole('button', { name: /^Name/i });
}

function projectRows(page) {
  return page.locator('.projects-desktop-layout').getByRole('button', { name: /^Open project / });
}

function templateRows(page) {
  return page.locator('.templates-editor-grid').getByRole('button', { name: /^Open template / });
}

function searchResultRows(page) {
  return page.getByRole('button', { name: /^Jump to match / });
}

function bookmarkRows(page) {
  return page.getByRole('button', { name: /^Jump to bookmark / })
    .or(page.getByRole('button', { name: /^Select bookmark group / }));
}

function namedSelectCaret(page) {
  return page.getByRole('button', { name: 'Selection mode', exact: true });
}

function namedEraserCaret(page) {
  return page.getByRole('button', { name: 'Eraser Type', exact: true });
}

async function implicitNamed(page, names) {
  const want = new Set(names);
  return page.evaluate((need) => (
    [...document.querySelectorAll('button')]
      .filter((node) => !node.getAttribute('type'))
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => need.includes(name))
  ), [...want]);
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

test('AFTER_BOOKMARK_DESKTOP_ROWS_INDEPENDENT_HUNT inventories remaining unique leftovers', async ({ page }) => {
  expect(AFTER_BOOKMARK_DESKTOP_ROWS_INDEPENDENT_HUNT).toBe(true);
  test.setTimeout(180_000);
  const inventory = {
    docs: {},
    archive: {},
    rail: {},
    invite: {},
    templates: {},
    survey: {},
    editor: {},
    auth: {},
    hub: {},
    team: {},
    lease: {},
    projects: {},
    search: {},
    bookmarks: {},
  };

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(fileHeader(page)).toBeVisible({ timeout: 15_000 });
  inventory.docs.fileType = await fileHeader(page).getAttribute('type');
  inventory.docs.fileImplicit = await implicitNamed(page, ['File', 'FILE']);
  inventory.docs.rowCount = await desktopRows(page).count();
  inventory.docs.firstRowRole = await desktopRows(page).first().getAttribute('role');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(nameHeader(page)).toBeVisible({ timeout: 15_000 });
  inventory.archive.nameType = await nameHeader(page).getAttribute('type');
  inventory.archive.nameImplicit = await implicitNamed(page, ['Name', 'NAME']);
  inventory.hub.restore = await page.getByRole('button', { name: 'Restore', exact: true }).count();
  inventory.hub.deleteForever = await page.getByRole('button', { name: 'Delete forever', exact: true }).count();

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(navTrigger(page)).toBeVisible({ timeout: 15_000 });
  await navTrigger(page).click();
  await expect(navDrawer(page)).toBeVisible({ timeout: 8_000 });
  inventory.rail.openCount = await navDrawer(page).count();
  await page.keyboard.press('Escape');
  inventory.rail.afterEscape = await navDrawer(page).count();
  inventory.docs.mobilePreviewRows = await desktopRows(page).count();

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  const signInContinue = page.getByRole('button', { name: 'Sign in to continue', exact: true });
  await expect(signInContinue).toBeVisible({ timeout: 15_000 });
  inventory.invite.signInContinueType = await signInContinue.getAttribute('type');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(templateRows(page).first()).toBeVisible({ timeout: 15_000 });
  inventory.templates.rowCount = await templateRows(page).count();
  inventory.templates.firstRowRole = await templateRows(page).first().getAttribute('role');
  inventory.templates.firstRowName = await templateRows(page).first().getAttribute('aria-label');
  inventory.templates.selectType = await page.locator('.templates-editor-grid aside').first().getByRole('button', { name: 'Select', exact: true }).getAttribute('type');
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });
  const desktopField = desktopCategoryTitle(page).first();
  await expect(desktopField).toBeVisible({ timeout: 8_000 });
  inventory.templates.desktopCategoryName = await desktopField.getAttribute('aria-label');
  inventory.templates.listMoreType = await page.getByRole('button', { name: 'More', exact: true }).first().getAttribute('type');

  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  inventory.editor.highlighterCaret = await page.locator('[data-highlighter-caret-button="true"]').count();
  inventory.editor.counterCaret = await page.locator('[data-counter-caret], [data-counter-caret-button="true"]').count();
  inventory.editor.versionHistory = await page.getByRole('button', { name: 'Version history', exact: true }).count();
  inventory.editor.selectCaretType = await namedSelectCaret(page).getAttribute('type');
  inventory.editor.selectCaretImplicit = await implicitNamed(page, ['Selection mode', 'SELECTION MODE']);
  await page.getByRole('button', { name: 'Draw', exact: true }).first().click();
  await expect(namedEraserCaret(page)).toBeVisible({ timeout: 15_000 });
  inventory.editor.eraserCaretType = await namedEraserCaret(page).getAttribute('type');
  inventory.editor.eraserCaretImplicit = await implicitNamed(page, ['Eraser Type', 'ERASER TYPE']);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  const twoCat = page.getByRole('button', { name: /Two Category Template/ });
  if (await twoCat.count()) {
    await twoCat.click();
  } else {
    await page.getByRole('button', { name: /KAL-436|Existing/ }).first().click();
  }
  await expect(page.getByRole('button', { name: 'Close Survey panel', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  inventory.survey.closeType = await page.getByRole('button', { name: 'Close Survey panel', exact: true }).first().getAttribute('type');
  inventory.survey.notes = await page.getByRole('button', { name: /item notes/i }).count();
  inventory.survey.spacesExpand = await page.getByRole('button', { name: 'Expand', exact: true }).count();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  inventory.auth.authCloseType = await authClose.count()
    ? await authClose.first().getAttribute('type')
    : null;
  const authSignIn = page.locator('.auth-modal-overlay .auth-submit-btn, .auth-form .auth-submit-btn').first();
  inventory.auth.signInType = await authSignIn.count()
    ? await authSignIn.getAttribute('type')
    : null;

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(projectRows(page).first()).toBeVisible({ timeout: 20_000 });
  inventory.projects.rowCount = await projectRows(page).count();
  inventory.projects.firstRowRole = await projectRows(page).first().getAttribute('role');
  inventory.projects.firstRowName = await projectRows(page).first().getAttribute('aria-label');
  inventory.projects.manageTeamType = await page.locator('.projects-desktop-layout').getByRole('button', { name: 'Manage team', exact: true }).getAttribute('type');
  inventory.hub.roleTrigger = await page.locator('[data-kal31-role-trigger]').count();
  inventory.team.activityFile = await page.getByRole('button', { name: /^File/i }).count();
  inventory.team.changeRole = await page.getByRole('button', { name: 'Change role', exact: true }).count();
  inventory.team.usersType = null;

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  inventory.lease.fileId = await fileId(page);
  const searchTab = page.getByRole('button', { name: 'Search text', exact: true }).first();
  await expect(searchTab).toBeVisible({ timeout: 15_000 });
  if ((await searchTab.getAttribute('aria-pressed')) !== 'true') {
    await searchTab.click();
  }
  const field = page.getByRole('textbox', { name: 'Search text in PDF', exact: true });
  await expect(field).toBeVisible({ timeout: 10_000 });
  await field.fill('the');
  const searching = page.locator('#chrome-left-host, [data-sidebar-panel]').getByText(/Searching\.\.\./);
  await searching.first().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
  await expect(searching).toHaveCount(0, { timeout: 20_000 });
  await expect(searchResultRows(page).first()).toBeVisible({ timeout: 15_000 });
  inventory.search.rowCount = await searchResultRows(page).count();
  inventory.search.firstRowRole = await searchResultRows(page).first().getAttribute('role');
  inventory.search.firstSearchRowName = await searchResultRows(page).first().getAttribute('aria-label');

  await openPage(page, { url: OUTLINE_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const bookmarksTab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(bookmarksTab).toBeVisible({ timeout: 15_000 });
  if ((await bookmarksTab.getAttribute('aria-pressed')) !== 'true') {
    await bookmarksTab.click();
  }
  await expect(bookmarkRows(page).first()).toBeVisible({ timeout: 20_000 });
  inventory.bookmarks.rowCount = await bookmarkRows(page).count();
  inventory.bookmarks.firstRowRole = await bookmarkRows(page).first().getAttribute('role');
  inventory.bookmarks.firstRowName = await bookmarkRows(page).first().getAttribute('aria-label');

  expect(inventory.docs.fileType).toBe('button');
  expect(inventory.docs.fileImplicit).toEqual([]);
  expect(inventory.docs.rowCount).toBeGreaterThan(1);
  expect(inventory.docs.firstRowRole).toBe('button');
  expect(inventory.docs.mobilePreviewRows).toBe(0);
  expect(inventory.archive.nameType).toBe('button');
  expect(inventory.archive.nameImplicit).toEqual([]);
  expect(inventory.rail.openCount).toBe(1);
  expect(inventory.rail.afterEscape).toBe(0);
  expect(inventory.invite.signInContinueType).toBe('button');
  expect(inventory.templates.rowCount).toBeGreaterThan(1);
  expect(inventory.templates.firstRowRole).toBe('button');
  expect(inventory.templates.firstRowName).toMatch(/^Open template /);
  expect(inventory.templates.selectType).toBe('button');
  expect(inventory.templates.desktopCategoryName).toBe('Click to rename');
  expect(inventory.templates.listMoreType).toBe('button');
  expect(inventory.survey.closeType).toBe('button');
  expect(inventory.survey.notes).toBe(0);
  expect(inventory.survey.spacesExpand).toBe(0);
  expect(inventory.editor.highlighterCaret).toBe(0);
  expect(inventory.editor.counterCaret).toBe(0);
  expect(inventory.editor.versionHistory).toBe(0);
  expect(inventory.editor.selectCaretType).toBe('button');
  expect(inventory.editor.selectCaretImplicit).toEqual([]);
  expect(inventory.editor.eraserCaretType).toBe('button');
  expect(inventory.editor.eraserCaretImplicit).toEqual([]);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.auth.authCloseType).toBe('button');
  expect(inventory.auth.signInType).toBe('submit');
  expect(inventory.projects.rowCount).toBeGreaterThan(1);
  expect(inventory.projects.firstRowRole).toBe('button');
  expect(inventory.projects.firstRowName).toMatch(/^Open project /);
  expect(inventory.projects.manageTeamType).toBe('button');
  expect(inventory.team.activityFile).toBe(0);
  expect(inventory.team.changeRole).toBe(0);
  expect(inventory.hub.roleTrigger).toBe(0);
  expect(inventory.hub.restore).toBe(0);
  expect(inventory.hub.deleteForever).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
  expect(inventory.search.rowCount).toBeGreaterThan(1);
  expect(inventory.search.firstRowRole).toBe('button');
  expect(inventory.search.firstSearchRowName).toMatch(/^Jump to match /);
  expect(inventory.bookmarks.rowCount).toBeGreaterThan(1);
  expect(inventory.bookmarks.firstRowRole).toBe('button');
  expect(inventory.bookmarks.firstRowName).toMatch(/^(Jump to bookmark |Select bookmark group )/);
});
