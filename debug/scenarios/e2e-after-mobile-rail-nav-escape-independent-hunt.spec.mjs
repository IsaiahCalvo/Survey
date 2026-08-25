import { test, expect } from '@playwright/test';

// Independent hunt after 390 hub rail nav Escape.
// Axis: compile-visible leftovers that are NOT leftover-18 and NOT
// 390 hub rail nav Escape / Invite accept type / 390 Templates
// category title name / Templates checklist item field name /
// Templates entity color layer type / Templates checklist chrome
// type / Templates More trigger type / Templates More menu name /
// desktop Templates Click to rename / Projects Tap to rename /
// Survey toolbar category chips type / Manage Team Edit type /
// AuthModal remaining type / AuthModal Close type / Manage Team
// search field name / Settings Connect type / Search text field
// name / Bookmarks drag grip name / Survey category-main / arrow
// type / Survey Close type / Bookmarks Delete / Edit / Done /
// group chrome types / CreateCategoryModal type / Draw/Shapes/Text
// sub-toolbar types / Projects More type / Documents More trigger
// type.
// Official annotationContextMenuitem leftover vs spec Enter is
// not stale vs live source (source already has Enter).
// Do not stamp file.id. Do not invent leftover-18 mint / roster /
// Stripe. Do not take MoveCopy Close/Cancel/Confirm. Do not take
// Documents More menuitem type-null. Do not take Templates
// MoreMenu menuitem type-null. Do not take Activity Close (A-06).
// Do not take Manage Team role trigger (0). Do not take Survey
// item Notes. Do not take Spaces expand/delete (Create space
// apply). Do not open Edit-modules. Do not click Share / Delete /
// Duplicate / Move/Copy / Rename / New template apply / Add
// checklist item apply / Walls / Windows chips / Sign in /
// Create account / Restore / Delete forever / Open file /
// Upload / Sign out / Delete account / Subscription apply /
// Create category confirm / Create space / Export Excel / Sync /
// View activity / swatch / hex / Transparent / Sign in to
// continue apply / Back to Survey apply / Documents / Projects /
// Templates / Archive drawer apply.

const AFTER_MOBILE_RAIL_NAV_ESCAPE_INDEPENDENT_HUNT = true;

const HUB = '/?hubPreview=1';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const INVITE = '/invite/leftover-type-probe';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const TEMPLATE = 'Security Walk-Through';
const TWO_CAT = /Two Category Template/;
const KAL436 = /KAL-436|Existing/;

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('kal31_pending_invite_token');
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

test('AFTER_MOBILE_RAIL_NAV_ESCAPE_INDEPENDENT_HUNT inventories remaining unique leftovers', async ({ page }) => {
  expect(AFTER_MOBILE_RAIL_NAV_ESCAPE_INDEPENDENT_HUNT).toBe(true);
  test.setTimeout(180_000);
  const inventory = {
    rail: {},
    invite: {},
    templates: {},
    survey: {},
    editor: {},
    auth: {},
    hub: {},
    lease: {},
  };

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(navTrigger(page)).toBeVisible({ timeout: 15_000 });
  await navTrigger(page).click();
  await expect(navDrawer(page)).toBeVisible({ timeout: 8_000 });
  inventory.rail.openCount = await navDrawer(page).count();
  await page.keyboard.press('Escape');
  inventory.rail.afterEscape = await navDrawer(page).count();
  inventory.rail.triggerAfterEscape = await navTrigger(page).count();

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  const signInContinue = page.getByRole('button', { name: 'Sign in to continue', exact: true });
  await expect(signInContinue).toBeVisible({ timeout: 15_000 });
  inventory.invite.signInContinueType = await signInContinue.getAttribute('type');
  inventory.invite.signInContinueImplicit = await implicitNamed(page, ['Sign in to continue']);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(TEMPLATE).first().click();
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
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  const twoCat = page.getByRole('button', { name: TWO_CAT });
  if (await twoCat.count()) {
    await twoCat.click();
  } else {
    await page.getByRole('button', { name: KAL436 }).first().click();
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

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hub.moveCopy = await page.getByRole('dialog', { name: 'Move or copy documents' }).count();
  inventory.hub.activity = await page.getByRole('dialog', { name: /activity/i }).count();
  inventory.hub.openNavigationDesktop = await navTrigger(page).count();

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hub.roleTrigger = await page.locator('[data-kal31-role-trigger]').count();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hub.restore = await page.getByRole('button', { name: 'Restore', exact: true }).count();
  inventory.hub.deleteForever = await page.getByRole('button', { name: 'Delete forever', exact: true }).count();

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  inventory.lease.fileId = await fileId(page);

  expect(inventory.rail.openCount).toBe(1);
  expect(inventory.rail.afterEscape).toBe(0);
  expect(inventory.rail.triggerAfterEscape).toBeGreaterThan(0);
  expect(inventory.invite.signInContinueType).toBe('button');
  expect(inventory.invite.signInContinueImplicit).toEqual([]);
  expect(inventory.templates.desktopCategoryName).toBe('Click to rename');
  expect(inventory.templates.listMoreType).toBe('button');
  expect(inventory.survey.closeType).toBe('button');
  expect(inventory.survey.notes).toBe(0);
  expect(inventory.survey.spacesExpand).toBe(0);
  expect(inventory.editor.highlighterCaret).toBe(0);
  expect(inventory.editor.counterCaret).toBe(0);
  expect(inventory.editor.versionHistory).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.auth.authCloseType).toBe('button');
  expect(inventory.auth.signInType).toBe('submit');
  expect(inventory.hub.openNavigationDesktop).toBe(0);
  expect(inventory.hub.moveCopy).toBe(0);
  expect(inventory.hub.activity).toBe(0);
  expect(inventory.hub.roleTrigger).toBe(0);
  expect(inventory.hub.restore).toBe(0);
  expect(inventory.hub.deleteForever).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
