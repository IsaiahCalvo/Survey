// Isaiah, 2026-11-12: "I selected all the annotations on a page, hit Delete
// and one red box didn't go away" and "I draw something, click on it, click
// off of it and it just stays selected".
//
// 1. Ctrl+A on a drawing picks every mark and Delete removes them all. The
//    Home screen stays mounted (inert) under an open document and keeps its
//    size, and its Documents list answered Ctrl+A too: whenever its key
//    listener ran before the viewer's (the viewer re-adds its listener on
//    every tool change, so after V it is last), the Home list took the key
//    and the drawing's select-all never ran.
// 2. A drawing tool stays on after you draw. A click off the picked mark onto
//    ANOTHER page left it picked (the press rules only looked at the page
//    clicked); under Select it already dropped (cross-page-deselect.spec).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const QUICK_BAR = '[data-selection-quick-bar][data-visible="true"]';

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = (n) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).filter({ visible: true }).first();
  await expect(pageDiv(1).locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return pageDiv;
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

const marksOnPage = (pageDiv) => pageDiv.evaluate((root) => new Set(
  [...root.querySelectorAll('[data-annotation-index]')].map((el) => el.getAttribute('data-annotation-index')),
).size);

test('Ctrl+A picks every mark on the page and Delete removes them all', async ({ page }) => {
  test.setTimeout(150_000);
  const sheet = await seedSheet('Select all delete');
  try {
    const pageDiv = await openSheet(page, sheet);
    const pb = await pageDiv(1).boundingBox();
    const at = (fx, fy) => ({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
    // A few rounds, each the way a person does it: draw, put the tool down
    // (V), Ctrl+A at once, Delete. Before the fix about one press in three
    // went to the Home list behind the drawing.
    for (let round = 0; round < 4; round += 1) {
      const shapes = [
        ['r', at(0.2, 0.3), at(0.35, 0.4)],
        ['o', at(0.5, 0.3), at(0.65, 0.4)],
        ['r', at(0.3, 0.6), at(0.45, 0.7)],
      ].slice(0, 1 + (round % 3));
      for (const [key, from, to] of shapes) {
        await page.keyboard.press('Escape');
        await page.keyboard.press(key);
        await drag(page, from, to);
      }
      await expect.poll(() => marksOnPage(pageDiv(1))).toBe(shapes.length);
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');
      await page.keyboard.press('Control+a');
      await expect(page.locator(QUICK_BAR), `round ${round}: Ctrl+A picked the marks`).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Delete');
      await expect.poll(() => marksOnPage(pageDiv(1)), { timeout: 10_000, message: `round ${round}: every mark deleted` }).toBe(0);
    }
  } finally {
    await sheet.remove();
  }
});

for (const [key, name] of [['r', 'Rectangle'], ['o', 'Ellipse']]) {
  test(`${name} tool still on: a click off the picked mark onto another page drops it`, async ({ page }) => {
    test.setTimeout(150_000);
    const sheet = await seedSheet(`Click off ${name}`, { size: [792, 400], pages: 2 });
    try {
      const pageDiv = await openSheet(page, sheet);
      await expect(pageDiv(2)).toBeVisible({ timeout: 30_000 });
      const b2 = await pageDiv(2).boundingBox();
      await page.keyboard.press(key);
      await drag(page, { x: b2.x + 150, y: b2.y + 80 }, { x: b2.x + 280, y: b2.y + 150 });
      // Click the new mark (its top edge) with the tool still on: it is picked.
      await page.mouse.click(b2.x + 215, b2.y + 80);
      const bar = page.locator(QUICK_BAR);
      await expect(bar).toBeVisible({ timeout: 5_000 });
      // Click empty space on page 1, tool still on.
      const b1 = await pageDiv(1).boundingBox();
      await page.mouse.click(b1.x + b1.width - 120, b1.y + b1.height - 60);
      await expect(bar).toHaveCount(0, { timeout: 5_000 });
      await expect(page.locator('[data-resize-handle]').filter({ visible: true })).toHaveCount(0);
      // The click only dropped the pick: it drew nothing on page 1.
      expect(await marksOnPage(pageDiv(1))).toBe(0);
      expect(await marksOnPage(pageDiv(2))).toBe(1);
    } finally {
      await sheet.remove();
    }
  });
}
