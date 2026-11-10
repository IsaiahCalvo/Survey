// Share from inside a document (beta flag 'viewer-share', Drawboard PDF Pro
// trial audit 2026-11-09: Drawboard shares from its viewer; Survey only from
// Home). The owner gets the Manage access dialog, as on Home.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

for (const on of [true, false]) {
  test(`viewer top bar ${on ? 'has' : 'has no'} Share`, async ({ page }) => {
    test.setTimeout(120_000);
    if (on) await page.addInitScript(() => localStorage.setItem('survey.flag.viewer-share', '1'));
    const sheet = await seedSheet('Viewer share');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      await expect(page.getByText('Viewer share sheet').filter({ visible: true })).toBeVisible({ timeout: 60_000 });
      const share = page.locator('[data-viewer-share]').filter({ visible: true });
      if (!on) {
        await expect(share).toHaveCount(0);
        return;
      }
      await share.click();
      const dialog = page.getByRole('dialog').filter({ visible: true }).first();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(dialog).toContainText(sheet.name.replace(/\.pdf$/, ''));
      await page.waitForTimeout(400);
      const r = await dialog.boundingBox();
      // The dialog paints over the viewer, not under it.
      const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="dialog"]'), { x: r.x + r.width / 2, y: r.y + r.height / 2 });
      expect(onTop).toBe(true);
      await page.screenshot({ path: test.info().outputPath('viewer-share.png') });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Viewer share sheet').filter({ visible: true })).toBeVisible();
    } finally {
      await sheet.remove();
    }
  });
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('phone header Share opens the access dialog', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.viewer-share', '1'));
    const sheet = await seedSheet('Phone share');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
      await page.waitForTimeout(1200);
      const open = page.getByRole('button', { name: 'Open file' });
      if (await open.isVisible().catch(() => false)) await open.tap();
      const header = page.locator('[data-mobile-pdf-header]');
      await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
      const share = header.locator('[data-viewer-share]');
      await expect(share).toBeVisible();
      const hb = await header.boundingBox();
      const kids = await header.locator(':scope > *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width).map((r) => [r.left, r.right]));
      for (let i = 1; i < kids.length; i += 1) expect(kids[i][0], JSON.stringify(kids)).toBeGreaterThanOrEqual(kids[i - 1][1] - 0.5);
      expect(kids.at(-1)[1]).toBeLessThanOrEqual(hb.x + hb.width + 0.5);
      await share.tap();
      const dialog = page.getByRole('dialog').filter({ visible: true }).first();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(400);
      const r = await dialog.boundingBox();
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(391);
      const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="dialog"]'), { x: r.x + r.width / 2, y: r.y + r.height / 2 });
      expect(onTop).toBe(true);
      await page.screenshot({ path: test.info().outputPath('phone-share.png') });
    } finally {
      await sheet.remove();
    }
  });
});
