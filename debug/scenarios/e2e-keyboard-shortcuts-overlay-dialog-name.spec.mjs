import { test, expect } from '@playwright/test';

// KeyboardShortcutsOverlay was a modal card with a visible title but no
// role="dialog" / aria-label / aria-labelledby. getByRole('dialog', {
// name: 'Keyboard shortcuts' }) was 0. Sibling CreateCategory / Confirm /
// Settings / Share / Create project / Rename / Auth are already named.
// Home `?` singleton (stack count) and V-09 catalog stay dedicated — this
// leftover is the accessible name. PromptModal lock / NewColumnsModal stay
// leftover-18. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';
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

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
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

function namedShortcuts(page) {
  return page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
}

function overlayHost(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

test('KeyboardShortcutsOverlay is named; Escape / Close / toggle keep one dialog', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { url: LINK_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toHaveAttribute('viewBox', '0 0 612 792');
  await blurInputs(page);

  expect(await namedShortcuts(page).count(), 'idle editor named dialog must be 0').toBe(0);

  await page.keyboard.press('?');
  const dialog = namedShortcuts(page);
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await expect(dialog).toHaveAttribute('aria-labelledby', 'keyboard-shortcuts-title');
  await expect(page.locator('#keyboard-shortcuts-title')).toHaveText('Keyboard shortcuts');
  await expect(overlayHost(page), 'name must not invent a second overlay').toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Create category', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Lock this document/ })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(namedShortcuts(page), 'Esc dismisses the named dialog').toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(namedShortcuts(page)).toBeVisible({ timeout: 8_000 });
  await namedShortcuts(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(namedShortcuts(page), 'Close dismisses the named dialog').toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(namedShortcuts(page)).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('?');
  await expect(namedShortcuts(page), 'second `?` toggles closed').toHaveCount(0);

  const hidden = await hiddenCounts(page);
  expect(hidden['Match case']).toBe(0);
  expect(hidden.Forms).toBe(0);
  expect(hidden.Note).toBe(0);
  expect(hidden.Group).toBe(0);
  expect(await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count()).toBe(0);
  expect(await page.locator('iframe[src*="challenges.cloudflare.com"]').count()).toBe(0);
  expect(await fileId(page)).toBeNull();
});

test('390 + hubPreview + survey idle break/edge for KeyboardShortcuts overlay name', async ({ page }) => {
  test.setTimeout(180_000);

  await openPage(page, { width: 390, height: 844, url: LINK_PDF });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  await blurInputs(page);
  expect(await namedShortcuts(page).count()).toBe(0);
  await page.keyboard.press('?');
  await expect(namedShortcuts(page), '390 viewer `?` names the dialog').toBeVisible({ timeout: 8_000 });
  await expect(overlayHost(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(namedShortcuts(page)).toHaveCount(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await blurInputs(page);
  await page.keyboard.press('?');
  expect(await namedShortcuts(page).count(), 'hubPreview must not open the named dialog').toBe(0);
  expect(await overlayHost(page).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: /Lock this document/ }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);

  await openPage(page, { url: SURVEY_PDF });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await namedShortcuts(page).count(), 'survey idle named dialog must stay 0').toBe(0);
  expect(await page.getByRole('dialog', { name: 'Create category', exact: true }).count()).toBe(0);
  expect(await page.getByRole('dialog', { name: 'Delete 1 category?', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-hub-keep-mount]').evaluate((host) => (
    host.hasAttribute('inert') || host.inert === true
  ))).toBe(true);
  expect(await fileId(page)).toBeNull();
});
