import { test, expect } from '@playwright/test';

// AccessManagementModal had a visible "Document Access" heading but no
// role="dialog" / aria-label / aria-labelledby. Sibling Share / Create
// project / Rename / Settings / Confirm / CreateCategory / Auth /
// KeyboardShortcuts are already named. Documents Share Access *chrome*
// (Invite + Done / fail-closed mint) is already dedicated — this leftover
// is the accessible name. PromptModal lock / NewColumnsModal stay
// leftover-18. Do not replay Share Access apply / leftover-18 A-03 mint.
// Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
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

test('AccessManagementModal is named via the visible Document Access title', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  expect(await namedAccess(page).count(), 'empty hub has no named Document Access').toBe(0);
  expect(await page.getByRole('button', { name: 'More' }).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedAccess(page).count()).toBe(0);

  await openDesktopMoreShare(page, OWNER);
  const dialog = namedAccess(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toHaveAttribute('aria-labelledby', 'access-management-modal-title');
  await expect(page.locator('#access-management-modal-title')).toHaveText('Document Access');
  await expect(dialog.getByText(OWNER, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(dialog.getByText('No collaborators yet. Use Invite to add one.')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(namedAccess(page)).toHaveCount(0);

  await openDesktopMoreShare(page, OWNER);
  await expect(namedAccess(page)).toBeVisible({ timeout: 8_000 });
  await namedAccess(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(namedAccess(page)).toHaveCount(0);

  await openDesktopMoreShare(page, OWNER);
  await expect(namedAccess(page)).toBeVisible({ timeout: 8_000 });
  await namedAccess(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(namedAccess(page)).toHaveCount(0);

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

test('390 + guest + idle editor break/edge for AccessManagementModal name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  // Guest AuthModal is leftover-18 A-01 — do not submit. Named Access must
  // not be idle-open under the overlay.
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await namedAccess(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB });
  const mobileCard = page.locator('.mobile-doc-card').filter({ hasText: OWNER }).first();
  await expect(mobileCard).toBeVisible({ timeout: 15_000 });
  await mobileCard.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  const mobile = namedAccess(page);
  await expect(mobile).toBeVisible({ timeout: 10_000 });
  await expect(mobile).toHaveAttribute('aria-labelledby', 'access-management-modal-title');
  await mobile.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(namedAccess(page)).toHaveCount(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedAccess(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count()).toBe(0);
  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
