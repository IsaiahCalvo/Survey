import { test, expect } from '@playwright/test';

// Invite User overlay (Manage Team → Invite) had a named Invite User
// dialog but the two role <select>s had no name —
// getByRole('combobox', { name: 'Share link role' }) was 0 while
// Invite User was open. Invite-by-email textarea also omitted a name.
// Overlay buttons omitted type="button". Distinct from Share
// Permission (ShareModal single Permission combobox) and Manage Team
// role picker (hubPreview creator-only seed — not taken). Last hunt
// opened Manage Team but never opened Invite. Do not change role.
// Do not click Copy link / Send. Activity stay A-06 adjacent — not
// taken. PromptModal lock stays leftover-18. Do not stamp file.id.

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

function namedLinkRole(page) {
  return page.getByRole('combobox', { name: 'Share link role', exact: true });
}

function namedEmailRole(page) {
  return page.getByRole('combobox', { name: 'Invite by email role', exact: true });
}

function namedPermission(page) {
  return page.getByRole('combobox', { name: 'Permission', exact: true });
}

function inviteUser(page) {
  return page.getByRole('dialog', { name: 'Invite User', exact: true });
}

function manageTeam(page) {
  return page.getByRole('dialog', { name: 'Manage Team', exact: true });
}

function shareProject(page) {
  return page.getByRole('dialog', { name: 'Share project', exact: true });
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
  await manageTeam(page).locator('[data-manage-team-invite]').click();
  await expect(inviteUser(page)).toBeVisible({ timeout: 10_000 });
}

test('desktop Invite User roles are named; Escape dismisses; role apply not changed', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No projects yet.').first()).toBeVisible({ timeout: 15_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await namedEmailRole(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await namedEmailRole(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await namedEmailRole(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);

  await openInviteUser(page);
  const linkRole = namedLinkRole(page);
  const emailRole = namedEmailRole(page);
  await expect(linkRole).toBeVisible({ timeout: 8_000 });
  await expect(emailRole).toBeVisible({ timeout: 8_000 });
  await expect(linkRole).toHaveAttribute('aria-label', 'Share link role');
  await expect(emailRole).toHaveAttribute('aria-label', 'Invite by email role');
  await expect(linkRole).toHaveValue('Viewer');
  await expect(emailRole).toHaveValue('Editor');
  await expect(inviteUser(page).getByRole('textbox', { name: 'Invite by email', exact: true })).toBeVisible();
  await expect(inviteUser(page).getByRole('button', { name: 'Close', exact: true })).toHaveAttribute('type', 'button');
  await expect(inviteUser(page).getByRole('button', { name: 'Copy link', exact: true })).toHaveAttribute('type', 'button');
  await expect(inviteUser(page).getByRole('button', { name: 'Cancel', exact: true })).toHaveAttribute('type', 'button');
  expect(await namedPermission(page).count()).toBe(0);
  expect(await shareProject(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(inviteUser(page)).toHaveCount(0);
  await expect(namedLinkRole(page)).toHaveCount(0);
  await expect(namedEmailRole(page)).toHaveCount(0);
  await expect(manageTeam(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(manageTeam(page)).toHaveCount(0);

  expect(await fileId(page)).toBeNull();
});

test('390 + templates + documents + editor break/edge for Invite User role name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
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
  await manageTeam(page).locator('[data-manage-team-invite]').click();
  await expect(inviteUser(page)).toBeVisible({ timeout: 10_000 });
  await expect(namedLinkRole(page)).toBeVisible();
  await expect(namedEmailRole(page)).toBeVisible();
  await expect(namedLinkRole(page)).toHaveValue('Viewer');
  await expect(namedEmailRole(page)).toHaveValue('Editor');
  await page.keyboard.press('Escape');
  await expect(inviteUser(page)).toHaveCount(0);
  await expect(namedLinkRole(page)).toHaveCount(0);
  await expect(namedEmailRole(page)).toHaveCount(0);

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
  const tplMore = page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New template', exact: true }),
  }).locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE })
    .getByRole('button', { name: 'More', exact: true });
  await tplMore.click();
  await expect(page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share template', exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await inviteUser(page).count()).toBe(0);
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await namedEmailRole(page).count()).toBe(0);
  await expect(namedPermission(page)).toBeVisible();
  await page.keyboard.press('Escape');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
  const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
    .filter({ hasText: OWNER })
    .getByRole('button', { name: 'More' })
    .first();
  await ownerMore.click();
  await expect(page.getByRole('menu', { name: `${OWNER} actions`, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Document Access', exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await namedEmailRole(page).count()).toBe(0);
  expect(await inviteUser(page).count()).toBe(0);
  expect(await namedPermission(page).count()).toBe(0);
  await page.keyboard.press('Escape');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await namedEmailRole(page).count()).toBe(0);
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
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedLinkRole(page).count()).toBe(0);
  expect(await namedEmailRole(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
