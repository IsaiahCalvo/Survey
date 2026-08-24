import { test, expect } from '@playwright/test';

// ManageTeamModal Invite / Done already have visible names
// but omitted type="button" (live type was null). Manage team
// trigger type, Invite-open Edit, and AccessManagement
// Invite / Done type are dedicated — do not replay those.
// Hosted on `?hubPreview=1&tab=projects` via Manage team
// (setup only). Prove the type only: still named Invite /
// Done, type=button does not empty accname or auto-submit
// invite. Escape / outside dismisses without Invite / Send /
// Done. Do NOT click Invite / Send / Done apply.
// Do not click Save / Restore / Delete forever / Open file /
// Upload / Sign out / Delete account / Select apply / Create
// project / Edit apply / View activity. Do not take
// Select-gated All / None / Duplicate / Move/Copy /
// Restore / Delete forever themselves. Do not name Activity.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
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

function teamInvite(page) {
  return namedTeam(page).getByRole('button', { name: 'Invite', exact: true });
}

function teamDone(page) {
  return namedTeam(page).getByRole('button', { name: 'Done', exact: true });
}

async function openDesktopManageTeam(page) {
  await desktopManageTeam(page).click();
  await expect(namedTeam(page)).toBeVisible({ timeout: 10_000 });
}

async function expectTypedNamed(button, name) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe(name);
  expect(accname).not.toBe('');
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function expectInviteDoneNotImplicit(dialog) {
  const implicit = await dialog.evaluate((node) => (
    [...node.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Invite')).toBe(false);
  expect(implicit.some((name) => name === 'Done')).toBe(false);
  expect(implicit.some((name) => name === 'Send' || /Send .*invite/.test(name))).toBe(false);
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

test('Manage Team Invite / Done are typed; Invite / Send / Done apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await namedTeam(page).count(), 'empty hub has no Manage Team').toBe(0);
  expect(await desktopManageTeam(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(PROJECT).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedTeam(page).count()).toBe(0);
  await expect(desktopManageTeam(page)).toHaveAttribute('type', 'button');

  await openDesktopManageTeam(page);
  const dialog = namedTeam(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expectTypedNamed(teamInvite(page), 'Invite');
  await expectTypedNamed(teamDone(page), 'Done');
  await expectInviteDoneNotImplicit(dialog);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0);
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

  await openDesktopManageTeam(page);
  await expectTypedNamed(teamInvite(page), 'Invite');
  await expectTypedNamed(teamDone(page), 'Done');
  await page.locator('body').click({ position: { x: 8, y: 8 } });
  await expect(namedTeam(page)).toHaveCount(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);

  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + idle editor break/edge for Manage Team Invite type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await namedTeam(page).count()).toBe(0);
  expect(await desktopManageTeam(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB });
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
  await expectTypedNamed(teamInvite(page), 'Invite');
  await expectTypedNamed(teamDone(page), 'Done');
  await expectInviteDoneNotImplicit(mobile);
  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedTeam(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedTeam(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Upload' }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedTeam(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedTeam(page).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Width', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Color', exact: true }).count()).toBe(0);
  expect(await page.getByRole('slider', { name: 'Opacity', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
