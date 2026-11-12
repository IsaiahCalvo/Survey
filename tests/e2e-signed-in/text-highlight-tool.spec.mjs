// Highlight text (beta flag 'text-highlight-tool', Drawboard PDF Pro push
// 2026-11-12, drawboard-trial/pdf-pro/apps-side-by-side.md A6): the band
// follows the drag in the highlight colour, letting go highlights the words;
// dragging the same words again does not take it off; Undo does.
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

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('drag over words highlights them on release; a second drag keeps it; Undo', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.text-highlight-tool', '1'));
    const sheet = await seedSheet('Highlight text', { pages: 1 });
    try {
      const pageDiv = await openSheet(page, sheet);
      await page.keyboard.press('t');
      const button = page.getByRole('button', { name: 'Highlight text', exact: true }).filter({ visible: true }).first();
      await button.click();
      await expect(page.locator('[data-text-highlight-mode="true"]')).toHaveCount(1);
      // It rides Select text: the bar shows Select's Text mode and its highlight colours.

      const words = pageDiv.locator('.pdfjsTextLayer span').filter({ hasText: 'Highlight text sheet' }).first();
      await expect(words).toHaveCount(1, { timeout: 20_000 });
      const box = await words.boundingBox();
      const before = (await markIds(page)).length;
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 6 });
      // Mid-drag: the live band is in the highlight colour, not the blue.
      const live = await page.evaluate(() => {
        const span = document.querySelector('[data-text-highlight-mode="true"] .pdfjsTextLayer span');
        return span ? getComputedStyle(span, '::selection').backgroundColor : '';
      });
      expect(live).not.toContain('58, 122, 254');
      await page.screenshot({ path: process.env.HL_SHOT || test.info().outputPath('mid-drag.png') });
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => (await markIds(page)).length, { timeout: 15_000 }).toBe(before + 1);

      // Same words again: still one highlight.
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(800);
      expect((await markIds(page)).length).toBe(before + 1);

      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => (await markIds(page)).length, { timeout: 15_000 }).toBe(before);
    } finally {
      await sheet.remove();
    }
  });

  test('Select text (Shift+V) ends Highlight text', async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.text-highlight-tool', '1'));
    const sheet = await seedSheet('Highlight text off by Select', { pages: 1 });
    try {
      await openSheet(page, sheet);
      await page.keyboard.press('t');
      const button = page.getByRole('button', { name: 'Highlight text', exact: true }).filter({ visible: true }).first();
      await button.click();
      await expect(page.locator('[data-text-highlight-mode="true"]')).toHaveCount(1);
      await expect(page.locator('[data-select-tool="true"][aria-pressed="true"]')).toHaveCount(0);
      await page.mouse.move(5, 450);
      await page.keyboard.press('Shift+V');
      await expect(page.locator('[data-text-highlight-mode="true"]')).toHaveCount(0);
      await expect(page.locator('[data-select-tool="true"][aria-pressed="true"]').filter({ visible: true })).toHaveCount(1);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: no Highlight text button', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.text-highlight-tool', '0'));
    const sheet = await seedSheet('Highlight text off', { pages: 1 });
    try {
      await openSheet(page, sheet);
      await page.keyboard.press('t');
      await expect(page.getByRole('button', { name: 'Callout', exact: true }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Highlight text', exact: true })).toHaveCount(0);
    } finally {
      await sheet.remove();
    }
  });
});
