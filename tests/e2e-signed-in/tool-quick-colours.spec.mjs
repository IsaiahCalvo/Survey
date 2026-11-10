// Per-tool quick colours (Nightly 'tool-quick-colours'): the highlighter's
// discs are yellow, green and pink on desktop and phone; the pen keeps red.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const layout of ['desktop', 'phone']) {
  test.describe(layout, () => {
    if (layout === 'phone') test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test(`highlighter discs (${layout})`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.addInitScript(() => localStorage.setItem('survey.flag.tool-quick-colours', '1'));
      const sheet = await seedSheet(`Quick colours ${layout}`);
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
        if (layout === 'phone') await row.tap(); else await row.click();
        await page.waitForTimeout(1200);
        const open = page.getByRole('button', { name: 'Open file' });
        if (await open.isVisible().catch(() => false)) await open.click();
        await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
        const discs = page.locator('[data-quick-colours="true"]').filter({ visible: true }).first();
        if (layout === 'phone') {
          await page.getByRole('button', { name: 'Draw', exact: true }).filter({ visible: true }).first().tap();
          await page.waitForTimeout(500);
          const hl = page.getByRole('button', { name: /^Highlighter/ }).filter({ visible: true }).first();
          await hl.tap();
        } else {
          await page.keyboard.press('h');
        }
        await expect(discs.getByRole('button', { name: /Yellow/ })).toBeVisible();
        await expect(discs.getByRole('button', { name: /Pink/ })).toBeVisible();
        if (layout === 'desktop') {
          // Green draws green (R3-Z B1: every disc drew the one fixed amber).
          await discs.getByRole('button', { name: /Green/ }).click();
          const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
          const box = await pageDiv.boundingBox();
          await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
          await page.mouse.down();
          for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x + box.width * (0.3 + i * 0.03), box.y + box.height * 0.3);
          await page.mouse.up();
          const inks = () => pageDiv.locator('[data-svg-annotation-layer="1"]').first().evaluate((layer) => [...layer.querySelectorAll('[data-annotation-index] *')]
            .map((el) => `${getComputedStyle(el).stroke} ${getComputedStyle(el).fill}`).join(' | '));
          await expect.poll(inks).toMatch(/34,\s*197,\s*94/);
          await expect.poll(inks).not.toMatch(/255,\s*193,\s*7/);
          // A picked highlight shows the highlighter's discs (B5).
          await page.keyboard.press('v');
          await page.mouse.click(box.x + box.width * 0.39, box.y + box.height * 0.3);
          await expect(discs.getByRole('button', { name: /Pink/ })).toBeVisible();
          await page.keyboard.press('Escape');
          await page.keyboard.press('p');
          await expect(discs.getByRole('button', { name: /Red/ })).toBeVisible();
        }
      } finally {
        await sheet.remove();
      }
    });
  });
}
