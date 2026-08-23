import { test, expect } from '@playwright/test';

// Invite-open Manage Team Edit already had a visible label from
// innerText, but omitted type="button" (live type was null). Find a
// teammate is already named via placeholder. Same a11y type class as
// Add files / New project and Search Previous/Next, new host
// (ManageTeamModal Edit). Do not click Edit apply / All / None /
// Change role / Copy email / Remove / Copy / Send. Invite User role
// / Share Permission stay dedicated. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
const PROJECT = 'Tower 5 — Security';
const TEMPLATE = 'Security Walk-Through';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
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

function manageTeam(page) {
  return page.getByRole('dialog', { name: 'Manage Team', exact: true });
}

function inviteUser(page) {
  return page.getByRole('dialog', { name: 'Invite User', exact: true });
}

function teamEdit(page) {
  return page.locator('[data-manage-team-edit]');
}

function namedLinkRole(page) {
  return page.getByRole('combobox', { name: 'Share link role', exact: true });
}

function namedEmailRole(page) {
  return page.getByRole('combobox', { name: 'Invite by email role', exact: true });
}

function namedPermission(page) {
  return page.getByRole('combobox', { name: 'Permission', exact: true });
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

async function openInviteUser(page) {
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  await expect(manageTeam(page)).toBeVisible({ timeout: 10_000 });
  await expect(teamEdit(page)).toHaveAttribute('type', 'button');
  await expect(teamEdit(page)).toHaveText('Edit');
  await manageTeam(page).locator('[data-manage-team-invite]').click();
  await expect(inviteUser(page)).toBeVisible({ timeout: 10_000 });
}

test('Invite-open Edit is type=button; apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  expect(await teamEdit(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await teamEdit(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  expect(await teamEdit(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);

  await openInviteUser(page);
  await expect(teamEdit(page)).toHaveAttribute('type', 'button');
  await expect(teamEdit(page)).toHaveText('Edit');
  await expect(page.getByRole('textbox', { name: /Find a teammate/ })).toBeVisible();
  await expect(namedLinkRole(page)).toBeVisible();
  await expect(namedEmailRole(page)).toBeVisible();
  await expect(namedLinkRole(page)).toHaveValue('Viewer');
  await expect(namedEmailRole(page)).toHaveValue('Editor');
  expect(await namedPermission(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(inviteUser(page)).toHaveCount(0);
  await expect(manageTeam(page)).toBeVisible();
  await expect(teamEdit(page)).toHaveAttribute('type', 'button');
  await expect(teamEdit(page)).toHaveText('Edit');

  await page.keyboard.press('Escape');
  await expect(manageTeam(page)).toHaveCount(0);
  expect(await teamEdit(page).count()).toBe(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + templates + documents + editor break/edge for Invite-open Edit type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await teamEdit(page).count()).toBe(0);
  const mobileRow = page.locator('.projects-mobile-folder-row[data-project-id="p1"]');
  await expect(mobileRow).toBeVisible({ timeout: 15_000 });
  await mobileRow.click();
  await expect(page.locator('.projects-mobile-back-button')).toBeVisible({ timeout: 8_000 });
  const mobileTeam = page.getByRole('button', { name: 'Manage team' })
    .or(page.getByRole('button', { name: 'Team', exact: true }))
    .locator('visible=true');
  await expect(mobileTeam).toBeVisible();
  await mobileTeam.click();
  await expect(manageTeam(page)).toBeVisible({ timeout: 10_000 });
  await expect(teamEdit(page)).toHaveAttribute('type', 'button');
  await manageTeam(page).locator('[data-manage-team-invite]').click();
  await expect(inviteUser(page)).toBeVisible({ timeout: 10_000 });
  await expect(teamEdit(page)).toHaveAttribute('type', 'button');
  await expect(namedLinkRole(page)).toBeVisible();
  await expect(namedEmailRole(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inviteUser(page)).toHaveCount(0);
  await expect(teamEdit(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await teamEdit(page).count()).toBe(0);
  const tplMore = page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  }).locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE })
    .getByRole('button', { name: 'More', exact: true });
  await tplMore.click();
  await expect(page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share template', exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await inviteUser(page).count()).toBe(0);
  expect(await teamEdit(page).count()).toBe(0);
  await expect(namedPermission(page)).toBeVisible();
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await teamEdit(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Document Access', exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await teamEdit(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);
  expect(await namedPermission(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await teamEdit(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await namedPermission(page).count()).toBe(0);
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await teamEdit(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
