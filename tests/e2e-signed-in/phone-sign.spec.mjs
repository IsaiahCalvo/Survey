// Sign from phone (beta flag 'phone-sign', Drawboard PDF Pro push 2026-11-12,
// drawboard-trial/pdf-pro row A8 "Mobile sign"). The Add signature dialog's
// Phone tab shows a QR code; a phone that opens its link (no sign-in) draws
// and taps Send; the signature lands on the computer's Draw pad, ready to
// Save. The link works once.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

async function openSheet(page, sheet) {
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

async function openAddDialog(page) {
  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Signature', exact: true }).filter({ visible: true }).first().click();
  await expect(page.locator('[data-signature-card]')).toBeVisible();
  await page.locator('[data-signature-add]').click();
  const dialog = page.locator('[data-signature-dialog]');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function phonePage(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !LOCAL_HOSTS.has(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  return { context, page: await context.newPage() };
}

async function scribble(page) {
  const pad = await page.locator('[data-signature-pad]').boundingBox();
  await page.mouse.move(pad.x + pad.width * 0.15, pad.y + pad.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(pad.x + pad.width * (0.15 + i * 0.05), pad.y + pad.height * (0.6 + 0.2 * Math.sin(i)), { steps: 2 });
  }
  await page.mouse.up();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('scan, sign on the phone, it lands on the Draw pad; the link works once', async ({ page, browser }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.signature-tool', '1');
      localStorage.setItem('survey.flag.phone-sign', '1');
    });
    const sheet = await seedSheet('Phone sign', { pages: 1 });
    const phone = await phonePage(browser);
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.evaluate(() => localStorage.removeItem('survey.signatures.v1'));
      await openSheet(page, sheet);
      const dialog = await openAddDialog(page);

      await dialog.locator('[data-signature-tab="phone"]').click();
      await expect(dialog.locator('[data-phone-sign-qr]')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      const link = await dialog.locator('[data-phone-sign-link]').getAttribute('href');
      expect(link).toMatch(/\/sign\/[0-9a-f-]{36}$/);
      await page.screenshot({ path: process.env.PHONE_SIGN_SHOT || test.info().outputPath('phone-tab.png') });

      // The phone: no sign-in, a pad, Send.
      await phone.page.goto(link);
      await expect(phone.page.locator('[data-phone-sign-page="drawing"]')).toBeVisible({ timeout: 30_000 });
      await expect(phone.page.locator('[data-phone-sign-send]')).toBeDisabled();
      await scribble(phone.page);
      await phone.page.locator('[data-phone-sign-send]').click();
      await expect(phone.page.locator('[data-phone-sign-page="sent"]')).toBeVisible();
      await phone.page.screenshot({ path: test.info().outputPath('phone-sent.png') });

      // The computer: back on Draw with the strokes, Save works.
      await expect(dialog.locator('[data-signature-tab="draw"]')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      await page.locator('[data-signature-title]').fill('From phone');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('[data-signature-id]')).toHaveCount(1);

      // The same link again: refused.
      await phone.page.goto(link);
      await expect(phone.page.locator('[data-phone-sign-page="drawing"]')).toBeVisible({ timeout: 30_000 });
      await scribble(phone.page);
      await phone.page.locator('[data-phone-sign-send]').click();
      await expect(phone.page.locator('[data-phone-sign-page="failed"]')).toBeVisible();

      // A made-up link says so.
      await phone.page.goto(link.replace(/\/sign\/.*/, '/sign/nope'));
      await expect(phone.page.locator('[data-phone-sign-page="bad-link"]')).toBeVisible({ timeout: 30_000 });
    } finally {
      await phone.context.close();
      await sheet.remove();
    }
  });

  test('flag off: no Phone tab', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.signature-tool', '1');
      localStorage.setItem('survey.flag.phone-sign', '0');
    });
    const sheet = await seedSheet('Phone sign off', { pages: 1 });
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await openSheet(page, sheet);
      const dialog = await openAddDialog(page);
      await expect(dialog.locator('[data-signature-tab="draw"]')).toBeVisible();
      await expect(dialog.locator('[data-signature-tab="phone"]')).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
