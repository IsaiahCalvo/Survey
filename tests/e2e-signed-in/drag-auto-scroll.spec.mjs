// Nightly 'drag-auto-scroll' (Drawboard parity, t2-tools-deep.md gap 8):
// drawing a rectangle with the pointer held at the bottom of the document view
// scrolls the view down, and the rectangle grows into what scrolled in.
// Without the flag the view stays put. Mouse only: touch is pan-only, so the
// phone layouts have nothing to scroll this way.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  if (value) localStorage.setItem('survey.flag.drag-auto-scroll', '1');
  else localStorage.removeItem('survey.flag.drag-auto-scroll');
}, on);

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { surface, marks: surface.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

// The view that scrolls the pages, and its box on screen.
const scrollerOf = (surface) => surface.evaluate((el) => {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      n.setAttribute('data-test-scroller', '1');
      const b = n.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, scrollTop: n.scrollTop };
    }
  }
  return null;
});
const scrollTop = (page) => page.evaluate(() => document.querySelector('[data-test-scroller]').scrollTop);

for (const on of [true, false]) {
  test(`a rectangle drawn to the bottom edge ${on ? 'scrolls the view and keeps growing' : 'leaves the view still without the flag'}`, async ({ page }) => {
    test.setTimeout(150_000);
    await flagOn(page, on);
    const sheet = await seedSheet(`Auto scroll ${on ? 'on' : 'off'}`, { pages: 3 });
    try {
      const { surface, marks } = await openSheet(page, sheet);
      // Zoom in so page 1 runs well past the bottom of the view.
      const zoomIn = page.getByRole('button', { name: 'Zoom in' }).filter({ visible: true }).first();
      for (let i = 0; i < 3; i += 1) { await zoomIn.click(); await page.waitForTimeout(400); }
      await page.waitForTimeout(800);
      const view = await scrollerOf(surface);
      expect(view, 'the pages scroll').toBeTruthy();
      await page.keyboard.press('r');
      const x = (view.left + view.right) / 2 - 100;
      const startY = view.top + 80;
      const edgeY = view.bottom - 8;
      await page.mouse.move(x, startY);
      await page.mouse.down();
      await page.mouse.move(x + 150, edgeY, { steps: 12 });
      // Hold at the edge, wiggling a pixel as a hand does.
      for (let i = 0; i < 25; i += 1) {
        await page.mouse.move(x + 150 + (i % 2), edgeY);
        await page.waitForTimeout(40);
      }
      await page.mouse.up();
      await expect(marks).toHaveCount(1);
      const scrolled = (await scrollTop(page)) - view.scrollTop;
      const rect = await marks.first().evaluate((g) => g.getBoundingClientRect().height);
      const dragged = edgeY - startY;
      if (on) {
        expect(scrolled).toBeGreaterThan(60);
        // The shape reaches past where the pointer was dragged on screen.
        expect(rect).toBeGreaterThan(dragged + 40);
      } else {
        expect(scrolled).toBe(0);
        expect(rect).toBeLessThan(dragged + 10);
      }
    } finally {
      await sheet.remove();
    }
  });
}
