// Page right-click extras (beta flag 'page-menu-extras', Drawboard PDF Pro
// push 2026-11-12, drawboard-trial/pdf-pro/apps-side-by-side.md): Move page
// up / down, Unlock all, Select all text. Flag off: none of them.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.evaluate((sel) => [...new Set([...document.querySelectorAll(sel)]
  .map((el) => el.getAttribute('data-annotation-id')))].filter((x) => x && !x.startsWith('creation-preview')), MARKS);

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

async function openPageMenu(page, pageDiv, fx = 0.8, fy = 0.85) {
  const box = await pageDiv.boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, { button: 'right' });
  await expect(pageMenu(page)).toBeVisible();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('Select all text, Unlock all and Move page down', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-menu-extras', '1'));
    const sheet = await seedSheet('Page menu extras', { pages: 2 });
    try {
      const pageDiv = await openSheet(page, sheet);
      const box = await pageDiv.boundingBox();
      const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

      // Page 1 of 2: Move up off, Move down on, nothing locked yet.
      await openPageMenu(page, pageDiv);
      await expect(row(page, 'Move up')).toBeDisabled();
      await expect(row(page, 'Move down')).toBeEnabled();
      await expect(row(page, 'Unlock all')).toBeDisabled();
      await expect(row(page, 'Select all text')).toBeVisible();

      // Select all text: the page's own words, under Text Select.
      await row(page, 'Select all text').click();
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || '')).toContain('Page menu extras sheet page 1');
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');

      // Draw a rectangle and lock it.
      await page.keyboard.press('r');
      await page.mouse.move(at(0.3, 0.3).x, at(0.3, 0.3).y);
      await page.mouse.down();
      await page.mouse.move(at(0.5, 0.45).x, at(0.5, 0.45).y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await markIds(page)).length).toBe(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');
      await page.mouse.click(at(0.3, 0.375).x, at(0.3, 0.375).y);
      await page.mouse.click(at(0.3, 0.375).x, at(0.3, 0.375).y, { button: 'right' });
      await page.getByRole('menuitem', { name: /^Lock/ }).first().click();
      await page.keyboard.press('Escape');

      // Unlock all is on now and unlocks it.
      await openPageMenu(page, pageDiv);
      await expect(row(page, 'Unlock all')).toBeEnabled();
      await row(page, 'Unlock all').click();
      await page.mouse.click(at(0.3, 0.375).x, at(0.3, 0.375).y);
      await page.mouse.click(at(0.3, 0.375).x, at(0.3, 0.375).y, { button: 'right' });
      await expect(page.getByRole('menuitem', { name: /^Lock/ }).first()).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      // Move down: the page (and its mark) is page 2 now; the view follows it.
      await openPageMenu(page, pageDiv);
      await row(page, 'Move down').click();
      await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-overlay-page="2"] [data-annotation-id]').length), { timeout: 60_000 }).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id]').length)).toBe(0);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no extras', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-menu-extras', '0'));
    const sheet = await seedSheet('Page menu extras off', { pages: 2 });
    try {
      const pageDiv = await openSheet(page, sheet);
      await openPageMenu(page, pageDiv);
      await expect(row(page, 'Delete')).toBeVisible();
      await expect(row(page, 'Select all text')).toHaveCount(0);
      await expect(row(page, 'Unlock all')).toHaveCount(0);
      await expect(row(page, 'Move down')).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
