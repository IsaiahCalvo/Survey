import { test, expect } from '@playwright/test';

// Templates More triggers already have a visible name (`More`)
// but omitted type="button" (live type was null). Hosted on
// `?hubPreview=1&tab=templates`. Same a11y type class as
// Projects More / Manage Team More / Documents More trigger,
// new host (TemplatesEditor list / entity / 390 list).
// Templates More *menu name* is exhausted — do not replay.
// Documents More menuitem type-null stays parked — do not type
// Templates More menuitems. Prove the trigger type only: still
// named More, still opens the named menu, Escape dismisses
// without applying a menuitem.
// Do not click Share / Delete / Duplicate / Move/Copy / Rename
// / New template apply / Restore / Delete forever / Open file
// / Upload / Sign out / Delete account.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const TEMPLATE = 'Security Walk-Through';
const ENTITY = 'GC';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

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

function templatesList(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  });
}

function entitiesRail(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New entity', exact: true }),
  });
}

function templateRow(page, name) {
  return templatesList(page).locator('[data-drag-rearrange-row]').filter({ hasText: name }).first();
}

function entityRow(page, role) {
  return entitiesRail(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input[placeholder="Entity name"][value="${role}"]`),
  });
}

function desktopTemplateMore(page, name = TEMPLATE) {
  return templateRow(page, name).getByRole('button', { name: 'More', exact: true });
}

function desktopEntityMore(page, role = ENTITY) {
  return entityRow(page, role).getByRole('button', { name: 'More', exact: true });
}

function mobileTemplateMore(page, name = TEMPLATE) {
  return page.locator('.templates-mobile-row').filter({ hasText: name }).first()
    .getByRole('button', { name: 'More', exact: true });
}

function templateMenu(page) {
  return page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true });
}

function entityMenu(page) {
  return page.getByRole('menu', { name: `${ENTITY} actions`, exact: true });
}

async function expectTypedMore(button) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  await expect(button).toHaveAttribute('title', 'More');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe('More');
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function implicitMore(page, scope) {
  return scope.evaluate((root) => (
    [...root.querySelectorAll('button')]
      .filter((node) => !node.getAttribute('type'))
      .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => name === 'More')
  ));
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

test('Templates More trigger is typed; menu opens; menuitem apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });

  const listMore = desktopTemplateMore(page);
  await expectTypedMore(listMore);
  expect(await implicitMore(page, templatesList(page))).toEqual([]);
  expect(await templateMenu(page).count()).toBe(0);

  await listMore.click();
  await expect(templateMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(listMore);
  expect(await page.getByRole('menuitem', { name: 'Share', exact: true }).count()).toBe(1);
  expect(await page.getByRole('dialog', { name: 'Share template' }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(templateMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expectTypedMore(listMore);
  await expect(page.locator('.survey-hub')).toBeVisible();

  const entityMore = desktopEntityMore(page);
  await expectTypedMore(entityMore);
  expect(await implicitMore(page, entitiesRail(page))).toEqual([]);
  await entityMore.click();
  await expect(entityMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(entityMore);
  expect(await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).count()).toBe(1);
  await page.keyboard.press('Escape');
  await expect(entityMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expectTypedMore(entityMore);
  expect(await page.getByRole('dialog', { name: 'Move or copy items' }).count()).toBe(0);

  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + empty + guest + tabs + editor break/edge for Templates More type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15_000 });
  const mobileMore = mobileTemplateMore(page);
  await expectTypedMore(mobileMore);
  await mobileMore.click();
  await expect(templateMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(mobileMore);
  await page.keyboard.press('Escape');
  await expect(templateMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expectTypedMore(mobileMore);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No templates yet').first()).toBeVisible();
  expect(await desktopTemplateMore(page).count()).toBe(0);
  expect(await desktopEntityMore(page).count()).toBe(0);
  expect(await templatesList(page).getByRole('button', { name: 'More', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await page.getByRole('textbox', { name: 'Search templates...', exact: true }).count()).toBeGreaterThan(0);
  await expectTypedMore(desktopTemplateMore(page));
  await expectTypedMore(desktopEntityMore(page));

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopTemplateMore(page).count()).toBe(0);
  expect(await desktopEntityMore(page).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopTemplateMore(page).count()).toBe(0);

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await desktopTemplateMore(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await desktopTemplateMore(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await desktopTemplateMore(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
