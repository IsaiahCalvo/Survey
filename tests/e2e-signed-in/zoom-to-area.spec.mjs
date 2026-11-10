// Zoom to an area (beta flag 'zoom-to-area', Drawboard PDF Pro trial audit
// 2026-11-09): Ctrl+Shift+drag draws a box, and letting go zooms so the box
// fills the view, its middle in the middle. Off: nothing happens.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const on of [true, false]) {
  test(`Ctrl+Shift+drag ${on ? 'zooms to the box' : 'does nothing with the flag off'}`, async ({ page }) => {
    test.setTimeout(150_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.zoom-to-area', '1'));
    const sheet = await seedSheet('Zoom area');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
      await expect(pageDiv).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      const before = await pageDiv.boundingBox();
      // A box round the sheet's title line (72 pt in from the top left).
      const from = { x: before.x + before.width * 0.08, y: before.y + before.height * 0.05 };
      const to = { x: before.x + before.width * 0.45, y: before.y + before.height * 0.14 };
      await page.keyboard.down('Control');
      await page.keyboard.down('Shift');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      if (on) await expect(page.locator('[data-zoom-area-box]')).toBeVisible();
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await page.keyboard.up('Control');
      await expect(page.locator('[data-zoom-area-box]')).toHaveCount(0);
      await page.waitForTimeout(1000);
      const after = await pageDiv.boundingBox();
      if (!on) {
        expect(Math.abs(after.width - before.width)).toBeLessThan(2);
        return;
      }
      expect(after.width / before.width).toBeGreaterThan(2);
      // The box's middle (26.5% across, 9.5% down the page) is near the view's middle.
      const scroller = await page.evaluate(() => {
        const el = document.querySelector('.survey-pdfjs-page-div')?.closest('[data-pdfjs-scroller], .pdfjs-viewer-scroller') || document.querySelector('.survey-pdfjs-page-div')?.parentElement?.parentElement;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const mid = { x: after.x + after.width * 0.265, y: after.y + after.height * 0.095 };
      expect(Math.abs(mid.x - (scroller.x + scroller.w / 2))).toBeLessThan(scroller.w * 0.15);
      expect(Math.abs(mid.y - (scroller.y + scroller.h / 2))).toBeLessThan(scroller.h * 0.2);
      await page.screenshot({ path: test.info().outputPath('zoom-area.png') });
    } finally {
      await sheet.remove();
    }
  });
}
