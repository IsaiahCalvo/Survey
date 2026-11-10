// Back closes the open sheet, then the document (beta flag 'back-button',
// Drawboard PDF Pro trial audit 2026-11-09, slice 7): the browser back gesture
// and the Android back button used to leave Survey from inside a document.
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

const openDocument = async (page, tap) => {
  const row = page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first();
  await (tap ? row.tap() : row.click());
  await page.waitForTimeout(1200);
  // A document already open in a tab comes straight back; else the details
  // panel asks first.
  const shown = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).count();
  const open = page.getByRole('button', { name: 'Open file' });
  if (!shown && await open.isVisible().catch(() => false)) await (tap ? open.tap() : open.click());
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').filter({ visible: true }).first())
    .toBeVisible({ timeout: 60_000 });
};
const viewerShown = (page) => page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true });
const markState = (page) => page.evaluate(() => Boolean(window.history.state?.surveyViewerBack));

test.describe('desktop', () => {
  test('back leaves the document for home, and the in-app back takes its entry off', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.back-button', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    const homeUrl = page.url();
    await openDocument(page, false);
    expect(await markState(page)).toBe(true);

    await page.goBack();
    await expect(viewerShown(page)).toHaveCount(0, { timeout: 15_000 });
    expect(page.url()).toBe(homeUrl);
    expect(await markState(page)).toBe(false);

    // Close it with the app's own control: no entry is left behind.
    await openDocument(page, false);
    expect(await markState(page)).toBe(true);
    await page.getByRole('button', { name: 'Home', exact: true }).filter({ visible: true }).first().click();
    await expect(viewerShown(page)).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => markState(page)).toBe(false);
  });

  test('flag off: no history entry is added', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDocument(page, false);
    expect(await markState(page)).toBe(false);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('back closes the hub sheet first, then the document', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.back-button', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDocument(page, true);

    await page.getByRole('button', { name: 'Open pages, search, and bookmarks' }).tap();
    const tabs = page.locator('.mobile-pdf-hub-tabs').filter({ visible: true });
    await expect(tabs).toHaveCount(1, { timeout: 10_000 });

    await page.goBack();
    await expect(tabs).toHaveCount(0, { timeout: 10_000 });
    await expect(viewerShown(page)).toHaveCount(1);
    expect(await markState(page)).toBe(true);

    await page.goBack();
    await expect(viewerShown(page)).toHaveCount(0, { timeout: 15_000 });
  });
});

for (const phone of [false, true]) {
  test.describe(phone ? 'home, phone' : 'home, desktop', () => {
    if (phone) test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('back on home closes Settings first and stays in Survey', async ({ page }) => {
      test.setTimeout(120_000);
      await page.addInitScript(() => localStorage.setItem('survey.flag.back-button', '1'));
      await signIn(page, E2E_ACCOUNTS.owner);
      const homeUrl = page.url();
      const homeMark = () => page.evaluate(() => Boolean(window.history.state?.surveyHomeBack));
      expect(await homeMark()).toBe(false);
      const openSettings = async () => {
        await page.getByRole('button', { name: 'Open account menu' }).filter({ visible: true }).first().click();
        await page.getByRole('menuitem', { name: 'Settings' }).filter({ visible: true }).first().click();
      };
      await openSettings();
      const settings = page.locator('.account-settings-modal').filter({ visible: true });
      await expect(settings).toHaveCount(1);
      await expect.poll(homeMark).toBe(true);
      await page.goBack();
      await expect(settings).toHaveCount(0, { timeout: 10_000 });
      expect(page.url()).toBe(homeUrl);
      await expect(page.getByText(E2E_DOCUMENT.name, { exact: true }).filter({ visible: true }).first()).toBeVisible();
      // Closed its own way (the X), the entry goes again quietly.
      await openSettings();
      await expect(settings).toHaveCount(1);
      await expect.poll(homeMark).toBe(true);
      await page.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);
      await expect.poll(homeMark).toBe(false);
      expect(page.url()).toBe(homeUrl);
    });
  });
}
