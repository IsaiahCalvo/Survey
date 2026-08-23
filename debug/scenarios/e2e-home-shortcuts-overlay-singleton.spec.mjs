import { test, expect } from '@playwright/test';

// Unique leftover after Pages tab-as-switcher independent hunt.
// Home on `?testPdf=` stacked AppShell + DevTestRoute `?` overlays.
// V-09 is the viewer overlay. Home click leftover is handleTabClick.
// This leftover is the singleton `?` modal after Home.
// Distinct from leftover-18 / rail-toggle / dismiss-family / Close tab.
// Do not stamp file.id. Do not invent dest-XYZ / lease / Note create.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openPage(page, { width = 1400, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function waitEditor(page) {
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
}

async function blurInputs(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
    if (document.body) document.body.focus();
  });
}

function overlay(page) {
  return page.locator('[data-keyboard-shortcuts-modal="true"]');
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

async function goHome(page) {
  const home = page.getByRole('tab', { name: 'Home', exact: true });
  await expect(home).toBeVisible({ timeout: 15_000 });
  await home.click();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0, { timeout: 15_000 });
}

test('desktop Home `?` is one overlay after testPdf Home', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page);
  await waitEditor(page);
  await blurInputs(page);

  // Intended — viewer `?` stays one overlay (DevTestRoute remount).
  await page.keyboard.press('?');
  await expect(overlay(page), 'viewer `?` stays one overlay').toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);

  await goHome(page);
  await blurInputs(page);
  expect(await fileId(page), 'Home must not invent file.id').toBeNull();

  // Intended — Home `?` is one modal, not AppShell+DevTestRoute stacked.
  await page.keyboard.press('?');
  await expect(overlay(page), 'Home `?` must be one overlay, not two').toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(1);

  // Break — Esc / outside / Close dismiss the single instance.
  await page.keyboard.press('Escape');
  await expect(overlay(page), 'Esc dismisses the single Home overlay').toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(overlay(page)).toHaveCount(1);
  await overlay(page).click({ position: { x: 8, y: 8 } });
  await expect(overlay(page), 'click-outside dismisses').toHaveCount(0);

  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(overlay(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay(page), 'Close dismisses').toHaveCount(0);

  // Edge — second `?` toggles; PDF tab return keeps one; hubPreview 0.
  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(overlay(page)).toHaveCount(1);
  await page.keyboard.press('?');
  await expect(overlay(page), 'second `?` toggles closed').toHaveCount(0);

  const pdfTab = page.getByRole('tab', { name: /clickable-link-test/i }).first();
  await expect(pdfTab).toBeVisible();
  await pdfTab.click();
  await waitEditor(page);
  await blurInputs(page);
  await page.keyboard.press('?');
  await expect(overlay(page), 'PDF tab return keeps one overlay').toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);

  await openPage(page, { url: HUB });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await blurInputs(page);
  await page.keyboard.press('?');
  expect(await overlay(page).count(), 'hubPreview must not mount the overlay').toBe(0);

  console.log('HOME_SHORTCUTS_OVERLAY_SINGLETON_DESKTOP', JSON.stringify({
    viewerOne: 1,
    homeOne: 1,
    fileId: await fileId(page),
  }));
});

test('390 Home `?` stays one overlay', async ({ page }) => {
  test.setTimeout(180_000);
  await openPage(page, { width: 390, height: 844 });
  await waitEditor(page);
  await blurInputs(page);

  await page.keyboard.press('?');
  await expect(overlay(page), '390 viewer `?` stays one overlay').toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);

  const back = page.getByRole('button', { name: /Back|Home/i }).first();
  if (await back.count() && await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(400);
    await blurInputs(page);
    await page.keyboard.press('?');
    expect(await overlay(page).count(), '390 Home `?` must stay one overlay').toBeLessThanOrEqual(1);
    if (await overlay(page).count()) {
      await page.keyboard.press('Escape');
      await expect(overlay(page)).toHaveCount(0);
    }
  }

  expect(await fileId(page)).toBeNull();
});
