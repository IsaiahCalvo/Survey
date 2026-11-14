// Ctrl+drag lasso (beta flag 'ctrl-lasso', Drawboard PDF Pro check
// 2026-11-14): under Box Select, Ctrl+drag on bare page draws a lasso for
// that drag and picks the marks inside it; flag off keeps the box.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const COUNT = '[data-selection-quick-bar][data-visible="true"] [data-selection-count]';
const TRAIL = '[data-lasso-selection-trail="true"]';

async function drawMark(page, key, from, to) {
  await page.keyboard.press(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function openWithThreeMarks(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1000);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) await open.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  const pb = await pageDiv.boundingBox();
  const at = (fx, fy) => ({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
  await drawMark(page, 'r', at(0.2, 0.62), at(0.3, 0.7));
  await drawMark(page, 'o', at(0.36, 0.62), at(0.46, 0.72));
  await drawMark(page, 'l', at(0.32, 0.8), at(0.56, 0.84));
  await page.waitForTimeout(800);
  await page.mouse.click(5, 450);
  await page.keyboard.press('v');
  return at;
}

// A loop around the rectangle and the ellipse, not the line below them
// (it must not cross itself, or the lasso is refused).
async function ctrlLoop(page, at, onMid) {
  const loop = [at(0.5, 0.57), at(0.52, 0.76), at(0.15, 0.77), at(0.14, 0.58), at(0.24, 0.565)];
  await page.mouse.move(at(0.3, 0.56).x, at(0.3, 0.56).y);
  await page.keyboard.down('Control');
  await page.mouse.down();
  for (const p of loop) await page.mouse.move(p.x, p.y, { steps: 8 });
  await onMid?.();
  await page.mouse.up();
  await page.keyboard.up('Control');
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('Ctrl+drag draws a lasso and picks the two marks inside it', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.ctrl-lasso', '1');
      localStorage.setItem('survey.flag.selection-count', '1');
    });
    const sheet = await seedSheet('Ctrl lasso', { pages: 1 });
    try {
      const at = await openWithThreeMarks(page, sheet);
      await ctrlLoop(page, at, async () => {
        await expect(page.locator(TRAIL)).toHaveCount(1);
        await page.screenshot({ path: process.env.LASSO_SHOT || test.info().outputPath('ctrl-lasso-mid.png') });
      });
      await expect(page.locator(TRAIL)).toHaveCount(0);
      await expect(page.locator(COUNT)).toHaveText('2');
      // A plain drag is still a box.
      await page.mouse.click(at(0.8, 0.95).x, at(0.8, 0.95).y);
      await page.mouse.move(at(0.14, 0.56).x, at(0.14, 0.56).y);
      await page.mouse.down();
      await page.mouse.move(at(0.6, 0.9).x, at(0.6, 0.9).y, { steps: 8 });
      await expect(page.locator(TRAIL)).toHaveCount(0);
      await page.mouse.up();
      await expect(page.locator(COUNT)).toHaveText('3');
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: Ctrl+drag draws no lasso', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.ctrl-lasso', '0'));
    const sheet = await seedSheet('Ctrl lasso off', { pages: 1 });
    try {
      const at = await openWithThreeMarks(page, sheet);
      await ctrlLoop(page, at, async () => {
        await expect(page.locator(TRAIL)).toHaveCount(0);
      });
    } finally {
      await sheet.remove();
    }
  });
});
