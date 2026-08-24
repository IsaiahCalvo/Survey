import { test, expect } from '@playwright/test';

// ManageTeamModal member-row More already has a visible name
// (`More`) but omitted type="button" (live type was null).
// Manage Team Invite / Done type, Manage team trigger type,
// AccessManagement Invite / Done / Close type, and Manage Team
// More menuitem NAMES are dedicated — do not replay those.
// Hosted on `?hubPreview=1&tab=projects` via Manage team
// (setup only). Prove the trigger type only: still named More,
// type=button does not empty accname or auto-submit a form,
// click still opens the menu. Escape / outside dismisses
// without applying a menuitem. Opening the menu is OK.
// Do NOT click Change role / Remove / Resend / Invite user /
// View activity / Copy email menuitems.
// Do NOT click Invite / Send / Done apply.

const HUB = '/?hubPreview=1&tab=projects';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=projects';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=projects';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const PROJECT = 'Tower 5 — Security';
const MEMBER = 'Isaiah Calvo';
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

function teamMore(page) {
  return namedTeam(page).getByRole('button', { name: 'More', exact: true });
}

function memberMenu(page) {
  return page.getByRole('menu', { name: `${MEMBER} actions`, exact: true });
}

async function openDesktopManageTeam(page) {
  await desktopManageTeam(page).click();
  await expect(namedTeam(page)).toBeVisible({ timeout: 10_000 });
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
  expect(accname).not.toBe('');
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function expectMoreNotImplicit(dialog) {
  const implicit = await dialog.evaluate((node) => (
    [...node.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'More')).toBe(false);
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

test('Manage Team member-row More is typed; menu opens; menuitem apply not clicked', async ({ page }) => {
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
  const more = teamMore(page).first();
  await expectTypedMore(more);
  await expectMoreNotImplicit(dialog);
  expect(await more.count()).toBeGreaterThan(0);
  const moreCount = await teamMore(page).count();
  expect(moreCount).toBeGreaterThan(0);
  if (moreCount > 1) {
    await expectTypedMore(teamMore(page).nth(1));
  }
  expect(await memberMenu(page).count()).toBe(0);

  await more.click();
  await expect(memberMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(more);
  expect(await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('menuitem', { name: 'Invite user', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('menuitem', { name: 'View activity', exact: true }).count()).toBeGreaterThan(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(memberMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(namedTeam(page)).toBeVisible();
  await expectTypedMore(more);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

  await more.click();
  await expect(memberMenu(page)).toBeVisible({ timeout: 8_000 });
  await page.locator('body').click({ position: { x: 8, y: 8 } });
  await expect(memberMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(namedTeam(page)).toBeVisible();
  await expectTypedMore(more);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.locator('[data-kal31-role-trigger]').count()).toBe(0);

  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + idle editor break/edge for Manage Team More type', async ({ page }) => {
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
  const mobileMore = teamMore(page).first();
  await expectTypedMore(mobileMore);
  await expectMoreNotImplicit(mobile);
  await mobileMore.click();
  await expect(memberMenu(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedMore(mobileMore);
  await page.keyboard.press('Escape');
  await expect(memberMenu(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(namedTeam(page)).toBeVisible();
  await expectTypedMore(mobileMore);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0);

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
