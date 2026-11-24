// Round 4 audit (r4c #5, #10). Desktop: grabbing the handle of the stamp just
// placed dropped a second stamp. iPad: a tap on the page with Stamp chosen
// opened an empty text box and placed nothing.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';
import { seedSheet } from './seedSheet.mjs';

const stampCount = (page) => page.locator('.survey-pdfjs-page-div[data-page-number="1"] [data-annotation-index]').count();

async function openWithStamp(page, sheet) {
  await page.addInitScript(() => localStorage.setItem('survey.flag.stamp-tool', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (await openFile.isVisible().catch(() => false)) await openFile.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return pageDiv;
}

async function chooseStamp(page) {
  const stampButton = page.getByRole('button', { name: 'Stamp', exact: true }).filter({ visible: true }).first();
  if (!(await stampButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().click();
  }
  await stampButton.click();
  await expect(page.locator('[data-stamp-picker]')).toBeVisible();
}

test('desktop: the stamp just placed can be resized, not stamped again', async ({ page }) => {
  test.setTimeout(150_000);
  const sheet = await seedSheet('Stamp resize', { size: [792, 612], pages: 1 });
  try {
    const pageDiv = await openWithStamp(page, sheet);
    await chooseStamp(page);
    await page.locator('[data-stamp-preset="approved"]').click();
    const box = await pageDiv.boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await expect.poll(() => stampCount(page)).toBe(1);
    const handle = page.locator('[data-resize-handle]').filter({ visible: true }).last();
    await expect(handle).toBeVisible();
    const h = await handle.boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 60, h.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await stampCount(page)).toBe(1);
  } finally {
    await sheet.remove();
  }
});

test.describe('iPad', () => {
  test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
  test('a tap on the page with a stamp chosen places it', async ({ page }) => {
    test.setTimeout(150_000);
    const sheet = await seedSheet('Stamp tap', { size: [792, 612], pages: 1 });
    try {
      const pageDiv = await openWithStamp(page, sheet);
      await chooseStamp(page);
      // Chosen with a mouse or pen (a finger tap on a tile drops it mid-page).
      await page.locator('[data-stamp-preset="for-review"]').click();
      const box = await pageDiv.boundingBox();
      await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await expect.poll(() => stampCount(page)).toBe(1);
      await expect(page.getByRole('button', { name: 'Keep text' })).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
