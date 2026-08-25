import { test, expect } from '@playwright/test';

// Manage Team search input was placeholder-only
// ("Find a teammate…", no aria-label). Same a11y name
// class as Search text field, new host (ManageTeamModal
// filter). Hosted on `?hubPreview=1&tab=projects` via
// Manage team (setup only). Do NOT click Invite / Send /
// Done / Edit / Connect. Do not fill the field. Escape
// dismisses Manage Team. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const PROJECT = 'Tower 5 — Security';
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

function desktopManageTeam(page) {
  return page.locator('.projects-desktop-layout').getByRole('button', { name: 'Manage team', exact: true });
}

function namedTeam(page) {
  return page.getByRole('dialog', { name: 'Manage Team', exact: true });
}

function namedField(page) {
  return namedTeam(page).getByRole('textbox', { name: 'Find a teammate', exact: true });
}

async function expectNamedField(field) {
  await expect(field).toBeVisible({ timeout: 10_000 });
  await expect(field).toHaveAttribute('aria-label', 'Find a teammate');
  await expect(field).toHaveAttribute('placeholder', 'Find a teammate…');
  const accname = await field.evaluate((node) => (
    node.getAttribute('aria-label')
    || node.getAttribute('title')
    || node.getAttribute('placeholder')
    || ''
  ));
  expect(accname).toBe('Find a teammate');
  expect(accname).not.toBe('Find a teammate…');
  const form = await field.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function openDesktopManageTeam(page) {
  await desktopManageTeam(page).click();
  await expect(namedTeam(page)).toBeVisible({ timeout: 10_000 });
  const field = namedField(page);
  await expectNamedField(field);
  return field;
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

test('desktop Manage Team search field is named; Invite / fill apply not taken', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await namedTeam(page).count()).toBe(0);
  expect(await namedField(page).count()).toBe(0);
  expect(await desktopManageTeam(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedTeam(page).count()).toBe(0);
  expect(await namedField(page).count()).toBe(0);

  const field = await openDesktopManageTeam(page);
  expect(await namedField(page).count()).toBe(1);
  await expect(namedTeam(page).getByRole('button', { name: 'Invite', exact: true })).toHaveAttribute('type', 'button');
  await expect(namedTeam(page).getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('type', 'button');
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);

  await field.focus();
  await page.keyboard.press('Escape');
  await expectNamedField(field);
  expect(await namedTeam(page).count()).toBe(1);
  expect(await namedField(page).count()).toBe(1);

  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await namedField(page).count()).toBe(0);
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);

  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + idle editor break/edge for Manage Team search field name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  const mobileProject = page.locator('.projects-mobile-layout [data-project-id], .projects-mobile-row, .projects-mobile-browser [data-project-id]')
    .filter({ hasText: PROJECT }).first();
  await expect(mobileProject).toBeVisible({ timeout: 15_000 });
  expect(await namedField(page).count()).toBe(0);
  await mobileProject.click();
  const mobileTeam = page.getByRole('button', { name: 'Manage team', exact: true }).first();
  await expect(mobileTeam).toBeVisible({ timeout: 10_000 });
  await mobileTeam.click();
  await expect(namedTeam(page)).toBeVisible({ timeout: 10_000 });
  const mobileField = namedField(page);
  await expectNamedField(mobileField);
  expect(await namedField(page).count()).toBe(1);
  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0);
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await namedTeam(page).count()).toBe(0);
  expect(await namedField(page).count()).toBe(0);
  expect(await desktopManageTeam(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedField(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedField(page).count()).toBe(0);
  expect(await namedTeam(page).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Search text in PDF', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedField(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
