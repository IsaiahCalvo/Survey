import { test, expect } from '@playwright/test';

// Manage Team Edit-mode All / Change role / Copy email / Remove
// already have visible names but omitted type="button" (live type
// was null). AuthModal remaining live actions were already typed
// after Close — not replayed. Hosted on `?hubPreview=1&tab=projects`
// via Manage team + Edit (setup only). Prove type only: names stay,
// type=button does not empty accname or apply role/remove/copy.
// Escape / Edit-Done dismisses without applying.
// Do NOT click All / None / Change role / Copy email / Remove.
// Do NOT click Invite / Send / View activity / Sign in apply.
// Role trigger stays 0 on creator-only seed (compile-typed).

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

async function openDesktopManageTeam(page) {
  await desktopManageTeam(page).click();
  await expect(namedTeam(page)).toBeVisible({ timeout: 10_000 });
}

async function enterEdit(dialog) {
  const edit = dialog.locator('[data-manage-team-edit]');
  await expect(edit).toHaveText('Edit');
  await edit.click();
  await expect(edit).toHaveText('Done');
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

async function expectEditChromeNotImplicit(dialog) {
  const implicit = await dialog.evaluate((node) => (
    [...node.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'All')).toBe(false);
  expect(implicit.some((name) => name === 'None')).toBe(false);
  expect(implicit.some((name) => name === 'Change role')).toBe(false);
  expect(implicit.some((name) => name === 'Copy email')).toBe(false);
  expect(implicit.some((name) => name === 'Remove from team')).toBe(false);
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

test('Manage Team Edit All / Change role / Copy email / Remove are typed; apply not clicked', async ({ page }) => {
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
  expect(await dialog.getByRole('button', { name: 'All', exact: true }).count()).toBe(0);
  expect(await dialog.getByRole('button', { name: 'Change role', exact: true }).count()).toBe(0);

  await enterEdit(dialog);
  const allBtn = dialog.getByRole('button', { name: 'All', exact: true });
  const changeRole = dialog.getByRole('button', { name: 'Change role', exact: true });
  const copyEmail = dialog.getByRole('button', { name: 'Copy email', exact: true });
  const remove = dialog.getByRole('button', { name: 'Remove from team', exact: true });
  await expectTypedNamed(allBtn, 'All');
  await expectTypedNamed(changeRole, 'Change role');
  await expectTypedNamed(copyEmail, 'Copy email');
  await expectTypedNamed(remove, 'Remove from team');
  await expectEditChromeNotImplicit(dialog);
  expect(await dialog.locator('[data-kal31-role-trigger]').count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);

  await dialog.locator('[data-manage-team-edit]').click();
  await expect(dialog.locator('[data-manage-team-edit]')).toHaveText('Edit');
  expect(await dialog.getByRole('button', { name: 'All', exact: true }).count()).toBe(0);
  expect(await dialog.getByRole('button', { name: 'Change role', exact: true }).count()).toBe(0);
  await expect(namedTeam(page)).toBeVisible();
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);

  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + idle editor break/edge for Manage Team Edit type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const auth = page.getByRole('dialog', { name: 'Welcome back', exact: true });
  await expect(auth).toBeVisible({ timeout: 15_000 });
  await expect(auth.getByRole('button', { name: 'Sign in', exact: true })).toHaveAttribute('type', 'submit');
  await expect(auth.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveAttribute('type', 'button');
  await expect(auth.getByRole('button', { name: 'Forgot password?', exact: true })).toHaveAttribute('type', 'button');
  await expect(auth.getByRole('button', { name: 'Continue without an account', exact: true })).toHaveAttribute('type', 'button');
  await page.keyboard.press('Escape');
  await expect(auth).toHaveCount(0);
  expect(await namedTeam(page).count()).toBe(0);
  expect(await desktopManageTeam(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();

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
  await enterEdit(mobile);
  await expectTypedNamed(mobile.getByRole('button', { name: 'All', exact: true }), 'All');
  await expectTypedNamed(mobile.getByRole('button', { name: 'Change role', exact: true }), 'Change role');
  await expectTypedNamed(mobile.getByRole('button', { name: 'Copy email', exact: true }), 'Copy email');
  await expectTypedNamed(mobile.getByRole('button', { name: 'Remove from team', exact: true }), 'Remove from team');
  await expectEditChromeNotImplicit(mobile);
  expect(await mobile.locator('[data-kal31-role-trigger]').count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(namedTeam(page)).toHaveCount(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

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
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
