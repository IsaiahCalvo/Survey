import { test, expect } from '@playwright/test';

// Independent hunt after Templates checklist item field name.
// Axis: compile-visible leftovers that are NOT leftover-18 and NOT
// Templates checklist item field name / Templates entity color
// layer type / Templates checklist chrome type / Templates More
// trigger type / Templates More menu name / Survey toolbar
// category chips type / Manage Team Edit type / AuthModal
// remaining type / AuthModal Close type / Manage Team search
// field name / Settings Connect type / Search text field name /
// Bookmarks drag grip name / Survey category-main / arrow type /
// Survey Close type / Bookmarks Delete / Edit / Done / group
// chrome types / CreateCategoryModal type / Draw/Shapes/Text
// sub-toolbar types / Projects More type / Documents More
// trigger type.
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
// View activity / swatch / hex / Transparent.

const AFTER_TEMPLATES_CHECKLIST_ITEM_FIELD_NAME_INDEPENDENT_HUNT = true;

const HUB = '/?hubPreview=1';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const TEMPLATE = 'Security Walk-Through';
const CATEGORY = 'Cameras';
const TWO_CAT = /Two Category Template/;
const KAL436 = /KAL-436|Existing/;

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function expandCategory(page, name) {
  const clicked = await page.evaluate((wanted) => {
    const titles = [...document.querySelectorAll('input.inline-edit.cat-title')];
    const field = titles.find((el) => el.value === wanted && el.offsetParent);
    if (!field) return false;
    const row = field.closest('[data-drag-rearrange-row]');
    const toggle = row?.querySelector('button[title="Expand"], button[title="Collapse"]');
    if (!toggle) return false;
    if (toggle.getAttribute('title') === 'Expand') toggle.click();
    return true;
  }, name);
  expect(clicked, `expand ${name}`).toBe(true);
}

function namedField(page) {
  return page.getByRole('textbox', { name: 'Checklist item', exact: true });
}

function fillTab(page) {
  return page.locator('[data-entity-color-panel]').getByRole('button', { name: 'Fill', exact: true }).first();
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

test('AFTER_TEMPLATES_CHECKLIST_ITEM_FIELD_NAME_INDEPENDENT_HUNT inventories remaining unique leftovers', async ({ page }) => {
  expect(AFTER_TEMPLATES_CHECKLIST_ITEM_FIELD_NAME_INDEPENDENT_HUNT).toBe(true);
  test.setTimeout(180_000);
  const inventory = {
    templates: {},
    survey: {},
    editor: {},
    auth: {},
    hub: {},
    lease: {},
  };

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(TEMPLATE).first().click();
  await expandCategory(page, CATEGORY);
  inventory.templates.fieldCount = await namedField(page).count();
  inventory.templates.fieldName = inventory.templates.fieldCount
    ? await namedField(page).first().getAttribute('aria-label')
    : null;
  inventory.templates.fieldPlaceholder = inventory.templates.fieldCount
    ? await namedField(page).first().getAttribute('placeholder')
    : null;
  inventory.templates.fieldInForm = inventory.templates.fieldCount
    ? await namedField(page).first().evaluate((node) => Boolean(node.closest('form')))
    : null;
  inventory.templates.addType = await page.getByRole('button', { name: /Add checklist item/ }).first().getAttribute('type');
  inventory.templates.deleteType = await page.getByRole('button', { name: 'Delete item', exact: true }).first().getAttribute('type');
  inventory.templates.listMoreType = await page.getByRole('button', { name: 'More', exact: true }).first().getAttribute('type');
  await page.keyboard.press('Escape');
  inventory.templates.afterEscapeField = await namedField(page).count();

  await openPage(page, { width: 390, height: 844, url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-browser .templates-mobile-row').filter({ hasText: TEMPLATE }).first();
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.evaluate((row) => row.click());
  await expect(page.locator('.templates-mobile-detail')).toBeVisible({ timeout: 15_000 });
  const camerasToggle = page.locator('.templates-mobile-category-toggle[aria-label*="Cameras"]').first();
  await expect(camerasToggle).toBeVisible({ timeout: 8_000 });
  if ((await camerasToggle.getAttribute('aria-label') || '').startsWith('Expand')) {
    await camerasToggle.evaluate((button) => button.click());
  }
  const mobileField = page.locator('.templates-mobile-detail').getByRole('textbox', { name: 'Checklist item', exact: true }).first();
  inventory.templates.mobileFieldCount = await mobileField.count();
  inventory.templates.mobileFieldName = inventory.templates.mobileFieldCount
    ? await mobileField.getAttribute('aria-label')
    : null;
  await page.getByRole('button', { name: 'Entities', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Entities', exact: true })).toBeVisible({ timeout: 8_000 });
  await page.locator('.templates-mobile-entity-modal').getByRole('button', { name: 'Edit color', exact: true }).first().click();
  inventory.templates.mobileFillType = await fillTab(page).count()
    ? await fillTab(page).getAttribute('type')
    : null;

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
  const wallsChip = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Walls', exact: true });
  inventory.survey.toolbarChipType = await wallsChip.count()
    ? await wallsChip.first().getAttribute('type')
    : null;
  inventory.survey.toolbarChipImplicitSubmit = await implicitNamed(page, ['Walls', 'Windows']);
  inventory.survey.notes = await page.getByRole('button', { name: /item notes/i }).count();
  inventory.survey.spacesExpand = await page.getByRole('button', { name: 'Expand', exact: true }).count();

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.auth.dialogCount = await page.locator('.auth-modal-overlay').count();
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  inventory.auth.authCloseType = await authClose.count()
    ? await authClose.first().getAttribute('type')
    : null;
  const authSignIn = page.locator('.auth-modal-overlay .auth-submit-btn, .auth-form .auth-submit-btn').first();
  inventory.auth.signInType = await authSignIn.count()
    ? await authSignIn.getAttribute('type')
    : null;
  const google = page.getByRole('button', { name: /Continue with Google/i });
  inventory.auth.googleType = await google.count()
    ? await google.first().getAttribute('type')
    : null;

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  inventory.hub.checklistIdle = await namedField(page).count();
  inventory.hub.moveCopy = await page.getByRole('dialog', { name: 'Move or copy documents' }).count();
  inventory.hub.activity = await page.getByRole('dialog', { name: /activity/i }).count();

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
  inventory.editor.unnamedForm = await page.evaluate(() => {
    const fields = [...document.querySelectorAll('input, textarea')]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .filter((node) => {
        const name = node.getAttribute('aria-label') || (node.labels && [...node.labels].map((l) => l.innerText).join(' ')) || '';
        return !String(name).trim() && (node.type === 'text' || node.type === 'checkbox');
      });
    return fields.length;
  });

  expect(inventory.templates.fieldCount).toBeGreaterThan(0);
  expect(inventory.templates.fieldName).toBe('Checklist item');
  expect(inventory.templates.fieldPlaceholder).toBe('Add checklist item');
  expect(inventory.templates.fieldInForm).toBe(false);
  expect(inventory.templates.addType).toBe('button');
  expect(inventory.templates.deleteType).toBe('button');
  expect(inventory.templates.afterEscapeField).toBeGreaterThan(0);
  expect(inventory.templates.mobileFieldCount).toBeGreaterThan(0);
  expect(inventory.templates.mobileFieldName).toBe('Checklist item');
  expect(inventory.templates.mobileFillType).toBe('button');
  expect(inventory.survey.closeType).toBe('button');
  if (inventory.survey.toolbarChipType) {
    expect(inventory.survey.toolbarChipType).toBe('button');
  }
  expect(inventory.survey.toolbarChipImplicitSubmit).toEqual([]);
  expect(inventory.survey.notes).toBe(0);
  expect(inventory.survey.spacesExpand).toBe(0);
  expect(inventory.editor.highlighterCaret).toBe(0);
  expect(inventory.editor.counterCaret).toBe(0);
  expect(inventory.editor.versionHistory).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.auth.authCloseType).toBe('button');
  expect(inventory.auth.signInType).toBe('submit');
  expect(inventory.auth.googleType).toBe('button');
  expect(inventory.hub.checklistIdle).toBe(0);
  expect(inventory.hub.moveCopy).toBe(0);
  expect(inventory.hub.activity).toBe(0);
  expect(inventory.hub.roleTrigger).toBe(0);
  expect(inventory.hub.restore).toBe(0);
  expect(inventory.hub.deleteForever).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
