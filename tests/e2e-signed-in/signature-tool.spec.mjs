// Signature tool (beta flag 'signature-tool', Drawboard PDF Pro push
// 2026-11-12, drawboard-trial/pdf-pro/apps-side-by-side.md A8): draw or type a
// signature, save it, it is picked; each click on the page signs once more;
// Esc lets go; saved signatures stay after a reload; Delete removes one.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.evaluate((sel) => [...new Set([...document.querySelectorAll(sel)]
  .map((el) => el.getAttribute('data-annotation-id')))].filter((x) => x && !x.startsWith('creation-preview')), MARKS);

async function openSheet(page, sheet) {
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  return pageDiv;
}

const openCard = async (page) => {
  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Signature', exact: true }).filter({ visible: true }).first().click();
  await expect(page.locator('[data-signature-card]')).toBeVisible();
};

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('draw and type a signature, sign twice, Esc lets go, kept after reload, delete', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.signature-tool', '1');
    });
    const sheet = await seedSheet('Signature tool', { pages: 1 });
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.evaluate(() => localStorage.removeItem('survey.signatures.v1'));
      const pageDiv = await openSheet(page, sheet);
      const box = await pageDiv.boundingBox();
      const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

      await openCard(page);
      await expect(page.locator('[data-signature-id]')).toHaveCount(0);

      // Draw one.
      await page.locator('[data-signature-add]').click();
      const dialog = page.locator('[data-signature-dialog]');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      const pad = await page.locator('[data-signature-pad]').boundingBox();
      await page.mouse.move(pad.x + pad.width * 0.15, pad.y + pad.height * 0.6);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(pad.x + pad.width * (0.15 + i * 0.05), pad.y + pad.height * (0.6 + 0.2 * Math.sin(i)), { steps: 2 });
      }
      await page.mouse.up();
      await page.locator('[data-signature-title]').fill('Drawn');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('[data-signature-id]')).toHaveCount(1);
      // A new signature is picked at once.
      await expect(page.locator('[data-signature-id]').first()).toHaveAttribute('aria-selected', 'true');

      // Each click on the page signs once more; the tile stays picked.
      const before = (await markIds(page)).length;
      await page.mouse.click(at(0.3, 0.5).x, at(0.3, 0.5).y);
      await expect.poll(async () => (await markIds(page)).length).toBe(before + 1);
      await page.mouse.click(at(0.6, 0.7).x, at(0.6, 0.7).y);
      await expect.poll(async () => (await markIds(page)).length).toBe(before + 2);
      await expect(page.locator('[data-signature-id]').first()).toHaveAttribute('aria-selected', 'true');
      await page.screenshot({ path: process.env.SIG_SHOT || test.info().outputPath('signed.png') });

      // Esc lets go: the next click signs nothing.
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-signature-id]').first()).toHaveAttribute('aria-selected', 'false');

      // Type one.
      await page.locator('[data-signature-add]').click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('tab', { name: 'Type' }).click();
      await page.locator('[data-signature-name]').fill('Pat Lee');
      await page.locator('[data-signature-font="serif"]').click();
      await page.locator('[data-signature-title]').fill('Typed');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('[data-signature-id]')).toHaveCount(2);
      await expect(page.locator('[data-signature-id]').first()).toHaveAccessibleName('Typed');

      // Kept on this device after a reload.
      await page.reload();
      // The open tab comes back by itself.
      await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(800);
      await openCard(page);
      await expect(page.locator('[data-signature-id]')).toHaveCount(2);

      // Delete one.
      await page.getByRole('button', { name: 'Delete Typed' }).click();
      await expect(page.locator('[data-signature-id]')).toHaveCount(1);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no Signature button', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.signature-tool', '0'));
    const sheet = await seedSheet('Signature tool off', { pages: 1 });
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await openSheet(page, sheet);
      await page.keyboard.press('t');
      await expect(page.getByRole('button', { name: 'Callout', exact: true }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Signature', exact: true })).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`signature tool, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the Text group has Signature; type one, a tap on it signs mid-page', async ({ page }) => {
      test.setTimeout(150_000);
      await page.addInitScript((native) => {
        localStorage.setItem('survey.flag.signature-tool', '1');
        if (native) window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
      }, layout.native);
      const sheet = await seedSheet(`Signature ${layout.native ? 'app' : 'web'}`, { pages: 1 });
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        await page.evaluate(() => localStorage.removeItem('survey.signatures.v1'));
        const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
        await row.tap();
        const openFile = page.getByRole('button', { name: 'Open file' });
        if (await openFile.isVisible().catch(() => false)) await openFile.tap();
        await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(1200);
        const before = (await markIds(page)).length;

        await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().tap();
        await page.getByRole('button', { name: 'Signature', exact: true }).filter({ visible: true }).last().tap();
        await expect(page.locator('[data-signature-card]')).toBeVisible();
        await page.locator('[data-signature-add]').tap();
        const dialog = page.locator('[data-signature-dialog]');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('tab', { name: 'Type' }).tap();
        await page.locator('[data-signature-name]').fill('Pat Lee');
        await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
        await expect(page.locator('[data-signature-id]')).toHaveCount(1);
        await page.waitForTimeout(600);
        await page.screenshot({ path: test.info().outputPath('phone-card.png') });
        await page.locator('[data-signature-id]').first().tap();
        await expect.poll(async () => (await markIds(page)).length).toBe(before + 1);
      } finally {
        await sheet.remove();
      }
    });
  });
}
