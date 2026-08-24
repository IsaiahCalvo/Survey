import { test, expect } from '@playwright/test';

// AccessManagementModal Close already has aria-label="Close" + title
// but omitted type="button" (live type was null). Dialog name is
// dedicated — do not replay AccessManagement dialog name. Hosted on
// `?hubPreview=1&tab=documents` via Documents More → Share (setup
// only). Prove the type only: still named Close, type=button does
// not empty accname or submit invite. Close / Escape / outside
// dismisses without Send. Do NOT click Send / Invite / Done apply.
// Do not click Save / Restore / Delete forever / Open file /
// Upload / Sign out / Delete account / Select apply / Create
// project. Do not take Select-gated All / None / Duplicate /
// Move/Copy / Restore / Delete forever themselves.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const OTHER = 'Package 2 — Rev 4 — IC.pdf';
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

function namedAccess(page) {
  return page.getByRole('dialog', { name: 'Document Access', exact: true });
}

function accessClose(page) {
  return namedAccess(page).getByRole('button', { name: 'Close', exact: true });
}

function shareDialog(page, noun = 'document') {
  return page.getByRole('dialog', { name: `Share ${noun}` });
}

function desktopRow(page, name) {
  return page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: name }).first();
}

async function openDesktopMoreShare(page, name) {
  await desktopRow(page, name).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
}

async function expectTypedClose(button) {
  await expect(button).toBeVisible({ timeout: 8_000 });
  await expect(button).toHaveAttribute('type', 'button');
  await expect(button).toHaveAttribute('aria-label', 'Close');
  await expect(button).toHaveAttribute('title', 'Close');
  const accname = await button.evaluate((node) => {
    const labelled = node.getAttribute('aria-label')
      || node.getAttribute('title')
      || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return labelled || '';
  });
  expect(accname).toBe('Close');
  expect(accname).not.toBe('');
  const form = await button.evaluate((node) => Boolean(node.closest('form')));
  expect(form).toBe(false);
}

async function expectCloseNotImplicit(dialog) {
  const implicit = await dialog.evaluate((node) => (
    [...node.querySelectorAll('button')]
      .filter((btn) => !btn.getAttribute('type'))
      .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
  ));
  expect(implicit.some((name) => name === 'Close')).toBe(false);
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

test('AccessManagement Close is typed; Send / Invite apply not clicked', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await namedAccess(page).count(), 'empty hub has no Document Access').toBe(0);
  expect(await page.getByRole('button', { name: 'More' }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedAccess(page).count()).toBe(0);

  await openDesktopMoreShare(page, OWNER);
  const dialog = namedAccess(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toHaveAttribute('aria-labelledby', 'access-management-modal-title');
  await expectTypedClose(accessClose(page));
  await expectCloseNotImplicit(dialog);
  await expect(dialog.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Restore', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Delete forever', exact: true }).count()).toBe(0);

  await accessClose(page).click();
  await expect(namedAccess(page)).toHaveCount(0);
  await expect(page.getByText(OWNER).first()).toBeVisible();

  await openDesktopMoreShare(page, OWNER);
  await expect(namedAccess(page)).toBeVisible({ timeout: 8_000 });
  await expectTypedClose(accessClose(page));
  await page.keyboard.press('Escape');
  await expect(namedAccess(page)).toHaveCount(0);
  expect(await page.getByRole('dialog', { name: 'Invite User', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

  await openDesktopMoreShare(page, OWNER);
  await expect(namedAccess(page)).toBeVisible({ timeout: 8_000 });
  await page.locator('body').click({ position: { x: 8, y: 8 } });
  await expect(namedAccess(page)).toHaveCount(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

  await openDesktopMoreShare(page, OTHER);
  await expect(shareDialog(page)).toBeVisible({ timeout: 10_000 });
  expect(await namedAccess(page).count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(shareDialog(page)).toHaveCount(0);

  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + idle editor break/edge for AccessManagement Close type', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const authClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await authClose.isVisible().catch(() => false)) {
    await authClose.click();
  }
  expect(await namedAccess(page).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB });
  const mobileCard = page.locator('.mobile-doc-card').filter({ hasText: OWNER }).first();
  await expect(mobileCard).toBeVisible({ timeout: 15_000 });
  await mobileCard.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  const mobile = namedAccess(page);
  await expect(mobile).toBeVisible({ timeout: 10_000 });
  await expectTypedClose(accessClose(page));
  await expectCloseNotImplicit(mobile);
  await page.keyboard.press('Escape');
  await expect(namedAccess(page)).toHaveCount(0);
  expect(await page.getByRole('button', { name: /Send .*invite/i }).count()).toBe(0);

  await openPage(page, { url: HUB_ARCHIVE });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedAccess(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Show documents', exact: true }).first()).toHaveAttribute('aria-label', 'Show documents');

  await openPage(page, { url: HUB_PROJECTS });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedAccess(page).count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Manage team', exact: true }).first()).toHaveAttribute('type', 'button');

  await openPage(page, { url: HUB_TEMPLATES });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  expect(await namedAccess(page).count()).toBe(0);
  await expect(page.locator('.ed-scope button[aria-label="Expand"]').first()).toHaveAttribute('aria-label', 'Expand');

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedAccess(page).count()).toBe(0);
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
