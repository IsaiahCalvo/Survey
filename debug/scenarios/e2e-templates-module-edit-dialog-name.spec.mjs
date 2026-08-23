import { test, expect } from '@playwright/test';

// Templates Edit modules had a visible "Edit modules" heading and
// .templates-module-edit-modal host but no role="dialog" / aria-label /
// aria-labelledby. Sibling Access / Shortcuts / Settings / Confirm /
// CreateCategory / Share / Create project / Auth are already named.
// Leftover-18 module Move/Copy apply is not taken. PromptModal lock /
// NewColumnsModal stay leftover-18. Do not replay Access dialog name.
// Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const TEMPLATE = 'Security Walk-Through';
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

function namedEdit(page) {
  return page.getByRole('dialog', { name: 'Edit modules', exact: true });
}

function desktopModuleSelect(page) {
  return page.locator('.templates-editor-grid p.micro', { hasText: /^Module$/ })
    .locator('xpath=following-sibling::button[1]');
}

async function openDesktopEditModules(page) {
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });
  await page.getByText(TEMPLATE).first().click();
  const select = desktopModuleSelect(page);
  await expect(select).toBeVisible({ timeout: 10_000 });
  await select.click();
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

test('Templates Edit modules is named via the visible title', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_EMPTY });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 15_000 });
  expect(await namedEdit(page).count(), 'empty hub has no named Edit modules').toBe(0);
  expect(await page.locator('.templates-module-edit-modal').count()).toBe(0);
  expect(await desktopModuleSelect(page).count()).toBe(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 20_000 });
  expect(await namedEdit(page).count()).toBe(0);
  expect(await page.getByRole('heading', { name: 'Edit modules', exact: true }).count()).toBe(0);

  await openDesktopEditModules(page);
  const dialog = namedEdit(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toHaveAttribute('aria-labelledby', 'templates-module-edit-title');
  await expect(page.locator('#templates-module-edit-title')).toHaveText('Edit modules');
  await expect(page.locator('.templates-module-edit-modal')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'New module', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Move/Copy', exact: true })).toBeDisabled();
  await expect(dialog.getByPlaceholder('Search modules...')).toBeVisible();

  await dialog.getByPlaceholder('Search modules...').fill('zzz-no-such-module');
  await expect(dialog.getByText('No modules match your search.')).toBeVisible();
  await dialog.getByPlaceholder('Search modules...').fill('');

  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(namedEdit(page)).toHaveCount(0);

  await openDesktopEditModules(page);
  await expect(namedEdit(page)).toBeVisible({ timeout: 8_000 });
  await page.locator('.templates-module-edit-modal').locator('xpath=..').click({ position: { x: 4, y: 4 } });
  await expect(namedEdit(page)).toHaveCount(0);

  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Settings', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Document Access', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + guest + idle editor break/edge for Edit modules name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { url: HUB_GUEST });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  // Guest AuthModal is leftover-18 A-01 — do not submit. Named Edit modules
  // must not be idle-open under the overlay.
  await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
  expect(await namedEdit(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);

  await openPage(page, { width: 390, height: 844, url: HUB });
  await expect(page.getByText(TEMPLATE).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(TEMPLATE).first().click();
  const mobileSelect = page.locator('.templates-mobile-modules-section').getByRole('button', { name: 'Select', exact: true });
  await expect(mobileSelect).toBeVisible({ timeout: 10_000 });
  await mobileSelect.click();
  const mobile = namedEdit(page);
  await expect(mobile).toBeVisible({ timeout: 10_000 });
  await expect(mobile).toHaveAttribute('aria-labelledby', 'templates-module-edit-title');
  await expect(mobile.getByRole('button', { name: 'Move/Copy', exact: true })).toBeDisabled();
  await mobile.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(namedEdit(page)).toHaveCount(0);

  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  expect(await namedEdit(page).count()).toBe(0);
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
