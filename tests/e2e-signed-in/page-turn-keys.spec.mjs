// Page turn keys (beta flag 'page-turn-keys', Drawboard PDF Pro push
// 2026-11-12): with nothing picked, Right / Shift+Down go to the next page,
// Left / Shift+Up back; with a mark picked the arrows nudge it instead.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const pageInView = (page) => page.evaluate(() => {
  const mid = window.innerHeight / 2;
  const divs = [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')];
  let best = null;
  for (const div of divs) {
    const r = div.getBoundingClientRect();
    if (r.height <= 0) continue;
    const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (!best || d < best.d) best = { d, n: Number(div.getAttribute('data-page-number')) };
  }
  return best?.n || 0;
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('arrows turn pages with nothing picked', async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-turn-keys', '1'));
    const sheet = await seedSheet('Page turn keys', { pages: 3 });
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
      await page.waitForTimeout(1000);
      const open = page.getByRole('button', { name: 'Open file' });
      if (await open.isVisible().catch(() => false)) await open.click();
      const first = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
      await expect(first.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      expect(await pageInView(page)).toBe(1);

      // A picked mark keeps the arrows: Right nudges it, the page stays.
      const box = await first.boundingBox();
      await page.keyboard.press('r');
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.375);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(600);
      expect(await pageInView(page)).toBe(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await page.keyboard.press('ArrowRight');
      await expect.poll(() => pageInView(page)).toBe(2);
      await page.keyboard.press('Shift+ArrowDown');
      await expect.poll(() => pageInView(page)).toBe(3);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(500);
      expect(await pageInView(page)).toBe(3);
      await page.keyboard.press('Shift+ArrowUp');
      await expect.poll(() => pageInView(page)).toBe(2);
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => pageInView(page)).toBe(1);

      // A leftover text selection does not hold a plain Right (only Shift +
      // arrows grow a selection).
      const selected = await page.evaluate(() => {
        const layer = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] .pdfjsTextLayer');
        if (!layer?.textContent?.trim()) return false;
        window.getSelection().selectAllChildren(layer);
        return window.getSelection().isCollapsed === false;
      });
      expect(selected).toBe(true);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => pageInView(page)).toBe(2);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: Right does not turn the page', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.page-turn-keys', '0'));
    const sheet = await seedSheet('Page turn keys off', { pages: 3 });
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
      await page.waitForTimeout(1000);
      const open = page.getByRole('button', { name: 'Open file' });
      if (await open.isVisible().catch(() => false)) await open.click();
      const first = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
      await expect(first.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(800);
      expect(await pageInView(page)).toBe(1);
    } finally {
      await sheet.remove();
    }
  });
});
