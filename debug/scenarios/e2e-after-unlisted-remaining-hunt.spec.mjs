import { test, expect } from '@playwright/test';

// AFTER_UNLISTED_REMAINING_HUNT
// Short remaining-E2E-UNLISTED probe after tip df8ae57a / product f2f02e68.
// No unique LIVE leftover. Do not replay the six exhausted classes.
// Do not invent Font family chrome, leftover-18, Extract, or a name/type/row leftover.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 390, height = 844, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('surveyMarkers_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
          || key.startsWith('pdfSidebar_')
        )) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return button;
    }
  }
  await buttons.first().click();
  return buttons.first();
}

test('390 remaining UL already ride + hubPreview break', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  await assertNoErrorBoundary(page);

  const history = page.getByRole('button', { name: 'Version history', exact: true }).first();
  await expect(history, '390 UL-08 Version history already live').toBeVisible();
  expect(await history.isDisabled(), '390 Version history must not leftover-disable on testPdf').toBe(false);
  await history.click();
  await expect(page.getByRole('button', { name: 'Close version history', exact: true })).toBeVisible({ timeout: 8_000 });
  expect(await page.getByRole('button', { name: /^Restore/i }).count(), 'fresh testPdf Restore must be 0').toBe(0);
  await page.getByRole('button', { name: 'Close version history', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close version history', exact: true })).toHaveCount(0);

  await clickVisible(page, 'Text');
  await clickVisible(page, 'Text formatting');
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toBeVisible({ timeout: 8_000 });
  expect(await page.getByRole('button', { name: /^Font:/ }).count(), 'must not invent 390 Font family chrome').toBe(0);
  expect(await page.getByRole('combobox', { name: 'Font' }).count()).toBe(0);
  const close = page.getByRole('button', { name: 'Close annotation settings', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
  else await page.keyboard.press('Escape');

  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toMatch(/^0 0 /);
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();

  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await assertNoErrorBoundary(page);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count(), 'hubPreview Version history must be 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Text formatting', exact: true }).count(), 'hubPreview Text formatting must be 0').toBe(0);
});

test('1440 edge: no 390 sheet; Version history 0; viewBox / file.id', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page, { width: 1440, height: 900 });
  await assertNoErrorBoundary(page);
  expect(await page.getByRole('button', { name: 'Version history', exact: true }).count(), '1440 Version history trigger must stay 0').toBe(0);
  expect(await page.getByRole('button', { name: 'Italic', exact: true }).count(), '1440 next-draw Italic chrome must be 0').toBe(0);
  expect(await page.getByRole('button', { name: /^Font$|Font family/ }).count(), '1440 next-draw Font chrome must be 0').toBe(0);
  expect(await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox')).toBe('0 0 612 792');
  expect(await page.evaluate(() => window.__devTestPdf?.id ?? null)).toBeNull();
});
