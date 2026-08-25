import { test, expect } from '@playwright/test';

// InviteAcceptPage CTAs omitted type="button" (live type was null).
// Guest `/invite/<token>` shows Sign in to continue. Visible names
// already present. Same a11y type class as AuthModal Close /
// Settings Close, new host (Invite accept). Do NOT click Sign in
// to continue / Sign in / Create account / Continue with Google /
// Continue without / Back to Survey apply / Open document /
// Sign out and switch. Escape keeps the invite page. Distinct
// from leftover-18 A-01 Sign in apply and invite deeplink resolve.
// Do not stamp file.id.

const INVITE = '/invite/leftover-type-probe';
const HUB = '/?hubPreview=1';
const HUB_GUEST = '/?hubPreview=1&guest=1';
const HUB_EMPTY = '/?hubPreview=1&empty=1';
const HUB_DOCS = '/?hubPreview=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const RESET = '/reset-password';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SEARCH_PDF = '/?testPdf=text-search-glyph-lab.pdf';
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

function invitePage(page) {
  return page.locator('[data-kal31-invite-page="true"]');
}

function signInContinue(page) {
  return invitePage(page).getByRole('button', { name: 'Sign in to continue', exact: true });
}

function backToSurvey(page) {
  return invitePage(page).getByRole('button', { name: 'Back to Survey', exact: true });
}

async function implicitNamed(page, names) {
  const want = new Set(names);
  return page.evaluate((need) => (
    [...document.querySelectorAll('button')]
      .filter((node) => {
        if (node.getAttribute('type')) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((name) => need.includes(name))
  ), [...want]);
}

async function expectInviteCtaTyped(page) {
  await expect(invitePage(page)).toBeVisible({ timeout: 15_000 });
  const signIn = signInContinue(page);
  const back = backToSurvey(page);
  await expect(signIn.or(back)).toBeVisible({ timeout: 15_000 });
  if (await signIn.count()) {
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute('type', 'button');
    await expect(page.getByText('Sign in to accept this invite')).toBeVisible();
  }
  if (await back.count()) {
    await expect(back).toHaveAttribute('type', 'button');
  }
  const implicit = await implicitNamed(page, [
    'Sign in to continue',
    'Back to Survey',
    'Open document',
    'Go to Survey',
    'Sign out and switch',
  ]);
  expect(implicit).toEqual([]);
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

test('Invite accept Sign in to continue is typed; Sign in apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: INVITE });
  await expectInviteCtaTyped(page);
  await expect(signInContinue(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to accept this invite' }).or(page.getByText('Sign in to accept this invite'))).toBeVisible();

  await signInContinue(page).focus();
  await page.keyboard.press('Escape');
  await expect(invitePage(page)).toBeVisible();
  await expect(signInContinue(page)).toBeVisible();
  await expect(signInContinue(page)).toHaveAttribute('type', 'button');
  expect(page.url()).toContain('/invite/leftover-type-probe');

  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /activity/i }).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Find a teammate', exact: true }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hub + reset-password + editor break/edge for Invite accept type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: INVITE });
  await expectInviteCtaTyped(page);
  await expect(signInContinue(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(signInContinue(page)).toBeVisible();
  await expect(signInContinue(page)).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await signInContinue(page).count()).toBe(0);
  expect(await invitePage(page).count()).toBe(0);
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  await expect(authClose.first()).toHaveAttribute('type', 'button');
  const authSignIn = page.locator('.auth-modal-overlay .auth-submit-btn, .auth-form .auth-submit-btn').first();
  await expect(authSignIn).toHaveAttribute('type', 'submit');
  expect(await page.getByRole('textbox', { name: 'Find a teammate', exact: true }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await signInContinue(page).count()).toBe(0);
  expect(await invitePage(page).count()).toBe(0);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await signInContinue(page).count()).toBe(0);

  await openPage(page, { url: HUB_DOCS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await signInContinue(page).count()).toBe(0);
  await expect(page.locator('.documents-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await signInContinue(page).count()).toBe(0);
  await expect(page.locator('.archive-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await signInContinue(page).count()).toBe(0);
  await expect(page.locator('.templates-mobile-select-row button.mobile-header-select-button')).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await signInContinue(page).count()).toBe(0);
  await expect(page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]')).toHaveAttribute('type', 'button');
  expect(await page.getByRole('textbox', { name: 'Find a teammate', exact: true }).count()).toBe(0);

  await openPage(page, { url: RESET });
  await expect(page.locator('[data-reset-password-page="true"]')).toBeVisible({ timeout: 15_000 });
  expect(await signInContinue(page).count()).toBe(0);
  expect(await invitePage(page).count()).toBe(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await signInContinue(page).count()).toBe(0);
  expect(await page.getByRole('textbox', { name: 'Search text in PDF', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Style', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count()).toBe(0);
  expect(await fileId(page)).toBeNull();

  await openPage(page, { url: SEARCH_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await signInContinue(page).count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});
