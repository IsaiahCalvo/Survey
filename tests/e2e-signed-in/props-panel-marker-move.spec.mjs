// Tester #1717: with a Survey Marker picked, the properties panel's X and Y
// follow it after a drag and after Undo (they kept the old place).
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
  await page.getByRole('button', { name: 'Use latest version' }).click({ timeout: 2_000 }).catch(() => {});
  if (await chooser.isVisible()) {
    await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
    if (await latest.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await latest.click();
  }
  await expect(category).toBeVisible();
}

test('a picked Survey Marker: X and Y follow a drag and an Undo', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.properties-panel', '1');
    localStorage.removeItem('survey.flag.marker-tap-card');
    localStorage.removeItem('survey.propertiesPanel.open');
  });
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurvey(page);

  const marker = page.locator(`[data-survey-marker-id="${E2E_SURVEY.markerId}"]`).filter({ visible: true }).first();
  await expect(marker).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await marker.click();
  await page.locator('.selection-quick-bar').getByRole('button', { name: 'Expand menu', exact: true }).click();
  const x = page.locator('[data-properties-panel] input[data-props-field="X"]');
  await expect(x).toBeVisible({ timeout: 10_000 });
  await expect(x).not.toHaveValue('');
  const before = Number(await x.inputValue());

  const box = await marker.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy, { steps: 5 });
  await page.mouse.move(cx + 80, cy, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await x.inputValue()), { timeout: 10_000 }).toBeGreaterThan(before + 20);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => Math.abs(Number(await x.inputValue()) - before), { timeout: 10_000 }).toBeLessThan(1);
});
