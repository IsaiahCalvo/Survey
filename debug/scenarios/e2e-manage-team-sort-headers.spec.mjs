import { test, expect } from '@playwright/test';

// Manage Team Users / Role / Added were clickable <span>s.
// Mouse sort worked; Tab never reached them.
// Now type="button" so keyboard can sort.
// Distinct from leftover-18, Archive desktop sort headers,
// Documents desktop sort headers, Manage Team Edit / Invite /
// Done / More / search, Invite accept type, 390 MobileRailNav
// Escape.
// Open Manage team on ?hubPreview=1&tab=projects is setup only.
// Do NOT click Change role / Remove / All / Copy email / Invite /
// Send / View activity / Restore / Delete forever / Permanently
// delete / Select / Upload / Share / Open file / Sign out /
// Delete account. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const INVITE = '/invite/leftover-type-probe';
const RESET = '/reset-password';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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
      localStorage.removeItem('kal31_pending_invite_token');
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

function usersHeader(root) {
  return root.getByRole('button', { name: /^Users/i });
}

function roleHeader(root) {
  return root.getByRole('button', { name: /^Role/i });
}

function addedHeader(root) {
  return root.getByRole('button', { name: /^Added/i });
}

function fileHeader(page) {
  return page.locator('.documents-desktop-card').getByRole('button', { name: /^File/i });
}

function nameHeader(page) {
  return page.locator('.archive-desktop-card').getByRole('button', { name: /^Name/i });
}

async function openDesktopManageTeam(page) {
  await desktopManageTeam(page).click();
  await expect(namedTeam(page)).toBeVisible({ timeout: 10_000 });
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

test('Manage Team sort headers are buttons; Users sorts; Escape does not apply', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedTeam(page).count()).toBe(0);
  expect(await usersHeader(page).count()).toBe(0);

  await openDesktopManageTeam(page);
  const dialog = namedTeam(page);
  await expect(usersHeader(dialog)).toBeVisible();
  await expect(roleHeader(dialog)).toBeVisible();
  await expect(addedHeader(dialog)).toBeVisible();
  await expect(usersHeader(dialog)).toHaveAttribute('type', 'button');
  await expect(roleHeader(dialog)).toHaveAttribute('type', 'button');
  await expect(addedHeader(dialog)).toHaveAttribute('type', 'button');
  await expect(usersHeader(dialog)).toHaveText(/^Users$/i);
  await expect(roleHeader(dialog)).toHaveText(/^Role$/i);
  await expect(addedHeader(dialog)).toHaveText(/^Added$/i);

  await dialog.locator('[data-manage-team-edit]').focus();
  await page.keyboard.press('Tab');
  await expect(usersHeader(dialog)).toBeFocused();

  const firstMember = dialog.locator('[data-kal31-project-member]').first();
  await expect(firstMember).toBeVisible();
  const beforeRole = await firstMember.innerText();
  expect(await dialog.locator('[data-kal31-role-trigger]').count()).toBe(0);

  await usersHeader(dialog).click();
  await expect(usersHeader(dialog)).toHaveText(/Users\s*↑/i);
  expect(await firstMember.innerText()).toBe(beforeRole);
  expect(await dialog.locator('[data-kal31-role-trigger]').count()).toBe(0);
  expect(await dialog.getByRole('button', { name: 'Change role', exact: true }).count()).toBe(0);
  expect(await dialog.getByRole('button', { name: 'Remove from team', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);

  await usersHeader(dialog).focus();
  await expect(usersHeader(dialog)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(usersHeader(dialog)).toHaveText(/Users\s*↓/i);
  expect(await firstMember.innerText()).toBe(beforeRole);

  await roleHeader(dialog).click();
  await expect(roleHeader(dialog)).toHaveText(/Role\s*↑/i);
  await expect(usersHeader(dialog)).toHaveText(/^Users$/i);

  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Change role', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
});

test('Manage Team sort headers break + edge; leftover-18 skipped', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await namedTeam(page).count(), 'empty hub has no Manage Team').toBe(0);
  expect(await usersHeader(page).count()).toBe(0);
  expect(await desktopManageTeam(page).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await usersHeader(page).count()).toBe(0);
  expect(await roleHeader(page).count()).toBe(0);
  expect(await addedHeader(page).count()).toBe(0);
  const mobileProject = page.locator('.projects-mobile-layout [data-project-id], .projects-mobile-row, .projects-mobile-browser [data-project-id]')
    .filter({ hasText: PROJECT }).first();
  await expect(mobileProject).toBeVisible({ timeout: 15_000 });
  await mobileProject.click();
  const mobileTeam = page.getByRole('button', { name: 'Manage team', exact: true }).first();
  await expect(mobileTeam).toBeVisible({ timeout: 10_000 });
  await expect(mobileTeam).toHaveAttribute('type', 'button');
  await mobileTeam.click();
  const mobile = namedTeam(page);
  await expect(mobile).toBeVisible({ timeout: 10_000 });
  await expect(usersHeader(mobile)).toHaveAttribute('type', 'button');
  await expect(roleHeader(mobile)).toHaveAttribute('type', 'button');
  await expect(addedHeader(mobile)).toHaveAttribute('type', 'button');
  const usersAcc = await usersHeader(mobile).evaluate((node) => (
    node.getAttribute('aria-label')
    || node.getAttribute('title')
    || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
  ));
  expect(usersAcc).toMatch(/^Users/i);
  expect(usersAcc).not.toBe('');
  expect(await mobile.locator('[data-kal31-role-trigger]').count()).toBe(0);
  await addedHeader(mobile).click();
  await expect(addedHeader(mobile)).toHaveText(/Added\s*↓/i);
  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedTeam(page).count()).toBe(0);
  expect(await usersHeader(page).count()).toBe(0);
  await expect(fileHeader(page)).toBeVisible();
  await expect(fileHeader(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedTeam(page).count()).toBe(0);
  expect(await usersHeader(page).count()).toBe(0);
  await expect(nameHeader(page)).toBeVisible();
  await expect(nameHeader(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedTeam(page).count()).toBe(0);
  expect(await usersHeader(page).count()).toBe(0);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.count()) {
    await expect(authClose.first()).toHaveAttribute('type', 'button');
  }
  expect(await namedTeam(page).count()).toBe(0);

  await openPage(page, { url: INVITE });
  await expect(page.locator('[data-kal31-invite-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await usersHeader(page).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await usersHeader(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Back to Survey', exact: true }).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedTeam(page).count()).toBe(0);
  expect(await usersHeader(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
  const viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
  expect(viewBox).toBe('0 0 612 792');
  const hidden = await hiddenCounts(page);
  for (const name of HIDDEN) {
    expect(hidden[name], name).toBe(0);
  }
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
});
