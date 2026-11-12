// Ctrl+Shift+V paste in place (beta flag 'paste-in-place-key', Drawboard PDF
// Pro push 2026-11-12): the copied mark comes back at its own spot wherever
// the pointer is; Ctrl+V still pastes at the pointer. Flag off: no paste.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

// Marks on page 1 (unpicked marks draw on a canvas, so count from the data).
const markCount = (page) => page.evaluate(() => {
  const host = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] [data-page-annotation-object-count], [data-page-annotation-object-count]');
  return Number(host?.getAttribute('data-page-annotation-object-count') ?? -1);
});
// The picked marks' frame (a paste picks what it pasted).
const pickedBox = (page) => page.evaluate(() => {
  const marks = [...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id]')]
    .map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (!marks.length) return null;
  return {
    left: Math.min(...marks.map((r) => r.left)),
    top: Math.min(...marks.map((r) => r.top)),
    farLeft: Math.max(...marks.map((r) => r.left)),
  };
});

// Hold the modifiers a moment first, as a hand does: a held Ctrl re-renders
// the viewer, and a key sent in the same instant can land between its key
// listener's swap.
async function chord(page, mods, key) {
  for (const m of mods) await page.keyboard.down(m);
  await page.waitForTimeout(150);
  await page.keyboard.press(key);
  for (const m of [...mods].reverse()) await page.keyboard.up(m);
}

async function openWithRect(page, sheet) {
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
  await page.keyboard.press('r');
  await page.mouse.move(at(0.2, 0.3).x, at(0.2, 0.3).y);
  await page.mouse.down();
  await page.mouse.move(at(0.35, 0.4).x, at(0.35, 0.4).y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect.poll(() => markCount(page)).toBe(1);
  // Pick it (Select, Ctrl+A) and copy.
  await page.mouse.click(5, 450);
  await page.keyboard.press('v');
  await page.mouse.move(at(0.5, 0.6).x, at(0.5, 0.6).y);
  await chord(page, ['Control'], 'a');
  await expect.poll(() => pickedBox(page)).not.toBeNull();
  const original = await pickedBox(page);
  // The pick's copy key arms once the pick has settled.
  await page.waitForTimeout(500);
  await chord(page, ['Control'], 'c');
  await page.waitForTimeout(300);
  return { at, original };
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test('Ctrl+Shift+V pastes the copy at its own spot; Ctrl+V at the pointer', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.paste-in-place-key', '1'));
    const sheet = await seedSheet('Paste in place key', { pages: 1 });
    try {
      const { at, original } = await openWithRect(page, sheet);
      await page.mouse.move(at(0.7, 0.75).x, at(0.7, 0.75).y);
      await chord(page, ['Control', 'Shift'], 'V');
      await expect.poll(() => markCount(page)).toBe(2);
      await page.waitForTimeout(300);
      const box = await pickedBox(page);
      expect(Math.abs(box.left - original.left)).toBeLessThan(2);
      expect(Math.abs(box.top - original.top)).toBeLessThan(2);
      // Plain Ctrl+V still lands at the pointer, far from the original.
      await chord(page, ['Control'], 'v');
      await expect.poll(() => markCount(page)).toBe(3);
      await page.waitForTimeout(300);
      const third = await pickedBox(page);
      expect(third.farLeft - original.left).toBeGreaterThan(100);
    } finally {
      await sheet.remove();
    }
  });

  test('flag off: Ctrl+Shift+V pastes nothing', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.paste-in-place-key', '0'));
    const sheet = await seedSheet('Paste in place key off', { pages: 1 });
    try {
      const { at } = await openWithRect(page, sheet);
      await page.mouse.move(at(0.7, 0.75).x, at(0.7, 0.75).y);
      await chord(page, ['Control', 'Shift'], 'V');
      await page.waitForTimeout(1200);
      expect(await markCount(page)).toBe(1);
    } finally {
      await sheet.remove();
    }
  });
});
