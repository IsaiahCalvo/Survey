// Template page below (beta flag 'page-templates', Drawboard PDF Pro push
// 2026-11-12, drawboard-trial/pdf-pro row C18): the page right-click adds a
// page drawn with a paper template; the lines show at once and stay after a
// reload (the PDF itself carries them). Flag off: no row.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  return pageDiv;
}

const pageMenu = (page) => page.locator('[data-page-menu]');
const row = (page, name) => pageMenu(page).getByRole('menuitem', { name, exact: true });

// Light-blue ruled pixels on page `n`'s canvas (the paper's rule tone).
const bluePixels = (page, n) => page.evaluate((num) => {
  const canvas = [...document.querySelectorAll(`.survey-pdfjs-page-div[data-page-number="${num}"] canvas`)]
    .find((c) => c.width > 50 && c.height > 50 && c.getBoundingClientRect().width > 0);
  if (!canvas) return -1;
  let data;
  try { data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; } catch { return -2; }
  let blue = 0;
  for (let i = 0; i < data.length; i += 16) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (b > 190 && b - r > 20 && g > 150 && r < 235) blue += 1;
  }
  return blue;
}, n);

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('Template page below adds a ruled page that stays after a reload', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-templates', '1'));
    const sheet = await seedSheet('Page templates', { pages: 1 });
    try {
      const pageDiv = await openSheet(page, sheet);
      const box = await pageDiv.boundingBox();
      await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.85, { button: 'right' });
      await expect(pageMenu(page)).toBeVisible();
      await row(page, 'Template page below').click();
      const picker = page.locator('[data-page-template-picker]');
      await expect(picker).toBeVisible();
      await expect(picker.locator('[data-paper-template="blank"]')).toHaveCount(0);
      await picker.locator('[data-paper-template="engineering"]').click();
      await expect(picker).toHaveCount(0);

      const page2 = page.locator('.survey-pdfjs-page-div[data-page-number="2"]').filter({ visible: true }).first();
      await page2.scrollIntoViewIfNeeded();
      await expect(page2.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => bluePixels(page, 2), { timeout: 20_000 }).toBeGreaterThan(200);
      // Page 1 stays plain.
      expect(await bluePixels(page, 1)).toBeLessThan(50);
      await page.screenshot({ path: process.env.TEMPLATE_SHOT || test.info().outputPath('template-page.png') });

      // Wait for the rewrite to save, then reload: the lines come from the PDF.
      await page.waitForTimeout(6000);
      await page.reload();
      const again = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
      await expect(again.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      const page2Again = page.locator('.survey-pdfjs-page-div[data-page-number="2"]').filter({ visible: true }).first();
      await page2Again.scrollIntoViewIfNeeded();
      await expect(page2Again.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => bluePixels(page, 2), { timeout: 30_000 }).toBeGreaterThan(200);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no Template page row', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-templates', '0'));
    const sheet = await seedSheet('Page templates off', { pages: 1 });
    try {
      const pageDiv = await openSheet(page, sheet);
      const box = await pageDiv.boundingBox();
      await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.85, { button: 'right' });
      await expect(row(page, 'Blank page below')).toBeVisible();
      await expect(row(page, 'Template page below')).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
