// Nightly 'marker-tap-card' (owner 2026-11-24): a tap on a Survey Marker shows
// what it is (Category, Tag, its checklist answers) in place of Comment,
// Duplicate and Delete, and Expand opens the Survey panel on that marker
// instead of the shape panel (transform, stroke).
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function openSurvey(page) {
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${E2E_SURVEY.documentName}` })).toBeVisible({ timeout: 60_000 });
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  if (await category.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  const chooser = page.getByText('Choose a survey template', { exact: true });
  const latest = page.getByRole('button', { name: 'Use latest version' });
  await expect(chooser.or(category).or(latest).first()).toBeVisible({ timeout: 30_000 });
  if (await latest.isVisible()) await latest.click();
  // With no memory on this device, Survey opens the drawing's own template;
  // a newer version of it is asked about first, over the picker.
  await page.getByRole('button', { name: 'Use latest version' }).click({ timeout: 2_000 }).catch(() => {});
  if (await chooser.isVisible()) {
    await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
    if (await latest.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await latest.click();
  }
  await expect(category).toBeVisible();
}

test('a tapped Survey Marker names itself and Expand opens its Survey row', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.marker-tap-card', '1');
    localStorage.setItem('survey.flag.properties-panel', '1');
  });
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);

  const marker = page.locator(`[data-survey-marker-id="${E2E_SURVEY.markerId}"]`).filter({ visible: true }).first();
  await expect(marker).toBeVisible({ timeout: 30_000 });
  // Close the panel first so Expand has to open it.
  await page.keyboard.press('Escape');
  await marker.click();

  const card = page.locator('[data-selection-quick-marker-card]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(E2E_SURVEY.categoryName);
  await expect(card).toContainText(E2E_SURVEY.itemName);
  for (const { text } of E2E_SURVEY.checklist) {
    await expect(card.getByRole('listitem', { name: new RegExp(`^${text.replace(/[&]/g, '\\$&')}:`) })).toBeVisible();
  }
  const bar = page.locator('.selection-quick-bar');
  await expect(bar.getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Comment', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'More', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('marker-tap-card.png') });

  await bar.getByRole('button', { name: 'Expand menu', exact: true }).click();
  await expect(page.locator(`#highlight-item-${E2E_SURVEY.markerId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-props-section]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('marker-tap-card-expanded.png') });
});
