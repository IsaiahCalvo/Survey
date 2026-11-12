// Snapshot tool (beta flag 'snapshot-tool', Drawboard PDF Pro push 2026-11-12,
// drawboard-trial/pdf-pro/apps-side-by-side.md A10): drag an area, it is
// copied to the clipboard as a picture, the box stays with handles; a handle
// drag copies again; Escape clears it and goes back to Pan.
import { E2E_ACCOUNTS, E2E_BASE_URL } from './accounts.mjs';
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

// The clipboard picture's size, or null.
const clipboardPicture = (page) => page.evaluate(async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes('image/png')) continue;
      const blob = await item.getType('image/png');
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let red = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 90) red += 1;
      return { width: bitmap.width, height: bitmap.height, red };
    }
  } catch { /* nothing yet */ }
  return null;
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('drag copies a picture, a handle copies again, Escape clears', async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_BASE_URL });
    await page.addInitScript(() => localStorage.setItem('survey.flag.snapshot-tool', '1'));
    const sheet = await seedSheet('Snapshot tool', { pages: 1 });
    try {
      const pageDiv = await openSheet(page, sheet);
      const box = await pageDiv.boundingBox();
      const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

      // A red rectangle inside the area, so the copy must carry marks too.
      await page.keyboard.press('r');
      await page.mouse.move(at(0.3, 0.25).x, at(0.3, 0.25).y);
      await page.mouse.down();
      await page.mouse.move(at(0.45, 0.35).x, at(0.45, 0.35).y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => page.locator('[data-overlay-page="1"] [data-annotation-id]').count()).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      const marksBefore = await page.locator('[data-overlay-page="1"] [data-annotation-id]').count();

      await page.keyboard.press('t');
      await page.getByRole('button', { name: 'Snapshot', exact: true }).filter({ visible: true }).first().click();
      await expect(page.locator('[data-snapshot-tool="true"]')).toHaveCount(1);

      // Drag an area: a box with 8 handles, and a picture of that shape on the clipboard.
      await page.mouse.move(at(0.2, 0.2).x, at(0.2, 0.2).y);
      await page.mouse.down();
      await page.mouse.move(at(0.6, 0.4).x, at(0.6, 0.4).y, { steps: 8 });
      await page.mouse.up();
      await expect(page.locator('[data-snapshot-box]')).toHaveCount(1);
      await expect(page.locator('[data-snapshot-handle]')).toHaveCount(8);
      await expect(page.getByText('Snapshot copied to clipboard')).toBeVisible();
      await expect.poll(() => clipboardPicture(page), { timeout: 15_000 }).not.toBeNull();
      const first = await clipboardPicture(page);
      // 0.4 x 0.2 of the page: twice as wide as tall (in page shape).
      const pageAspect = box.width / box.height;
      expect(first.width / first.height).toBeGreaterThan(2 * pageAspect * 0.9);
      expect(first.width / first.height).toBeLessThan(2 * pageAspect * 1.1);
      // The rectangle's red is in the picture, and no new mark was made.
      expect(first.red).toBeGreaterThan(20);
      await page.screenshot({ path: process.env.SNAP_SHOT || test.info().outputPath('snapshot-box.png') });
      expect(await page.locator('[data-overlay-page="1"] [data-annotation-id]').count()).toBe(marksBefore);

      // Carry the right edge handle out: the copy is redone, wider.
      await page.evaluate(() => navigator.clipboard.writeText('reset'));
      const handle = await page.locator('[data-snapshot-handle="e"]').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(at(0.8, 0.3).x, at(0.8, 0.3).y, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => clipboardPicture(page), { timeout: 15_000 }).not.toBeNull();
      const second = await clipboardPicture(page);
      expect(second.width).toBeGreaterThan(first.width * 1.3);

      // Escape: box gone, tool back to Pan.
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-snapshot-box]')).toHaveCount(0);
      await expect(page.locator('[data-snapshot-tool="true"]')).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no Snapshot button', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.snapshot-tool', '0'));
    const sheet = await seedSheet('Snapshot tool off', { pages: 1 });
    try {
      await openSheet(page, sheet);
      await page.keyboard.press('t');
      await expect(page.getByRole('button', { name: 'Callout', exact: true }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
