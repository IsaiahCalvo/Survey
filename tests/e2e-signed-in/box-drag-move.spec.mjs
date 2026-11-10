// Drag inside a picked mark to move it; a finger drags a move grip under the
// pick (beta flag 'box-drag-move', Drawboard PDF Pro trial audit 2026-11-10,
// R3-F #1). Flag off: a drag from inside an unfilled rectangle does not move it.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.evaluate((sel) => [...new Set([...document.querySelectorAll(sel)]
  .map((el) => el.getAttribute('data-annotation-id')))].filter((x) => x && !x.startsWith('creation-preview')), MARKS);

// The drawn rectangle's on-screen box (its own outline path / rect).
const markBox = (page, id) => page.evaluate((markId) => {
  const g = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`);
  const r = g?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}, id);

async function drag(page, from, to, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
}

async function openSheet(page, sheet, { phone = false } = {}) {
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
  if (phone) await row.tap(); else await row.click();
  await page.waitForTimeout(1200);
  const open = page.getByRole('button', { name: 'Open file' });
  if (await open.isVisible().catch(() => false)) {
    if (phone) await open.tap(); else await open.click();
  }
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  return pageDiv;
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  for (const on of [true, false]) {
    test(`a drag from inside a picked rectangle ${on ? 'moves' : 'does not move'} it`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.addInitScript((value) => localStorage.setItem('survey.flag.box-drag-move', value), on ? '1' : '0');
      const sheet = await seedSheet(`Box drag move ${on ? 'on' : 'off'}`);
      try {
        const pageDiv = await openSheet(page, sheet);
        const box = await pageDiv.boundingBox();
        const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

        await pageDiv.click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('r');
        await drag(page, at(0.3, 0.3), at(0.55, 0.45));
        await expect.poll(async () => (await markIds(page)).length).toBe(1);
        const [id] = await markIds(page);

        await page.keyboard.press('v');
        await page.waitForTimeout(300);
        const before = await markBox(page, id);
        // Pick it on its left outline.
        await page.mouse.click(before.x + 1, before.y + before.height / 2);
        await expect(page.locator('[data-overlay-page="1"] .svg-selection-overlay').first()).toBeVisible();
        if (on) await expect(page.locator('[data-box-drag-move-zone="true"]')).toHaveCount(1);
        else await expect(page.locator('[data-box-drag-move-zone]')).toHaveCount(0);

        // Drag from the empty middle of the rectangle.
        const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
        await drag(page, centre, { x: centre.x + 120, y: centre.y + 80 });
        await page.waitForTimeout(600);
        const after = await markBox(page, id);
        if (on) {
          expect(after.x - before.x, JSON.stringify({ before, after })).toBeGreaterThan(100);
          expect(after.y - before.y, JSON.stringify({ before, after })).toBeGreaterThan(60);
          // One Undo puts it back.
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
          await expect.poll(async () => Math.abs((await markBox(page, id)).x - before.x)).toBeLessThan(3);
        } else {
          expect(Math.abs(after.x - before.x), JSON.stringify({ before, after })).toBeLessThan(2);
          expect(Math.abs(after.y - before.y), JSON.stringify({ before, after })).toBeLessThan(2);
        }
      } finally {
        await sheet.remove();
      }
    });
  }

  test('a press on another mark inside the picked box still picks that mark', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.box-drag-move', '1'));
    const sheet = await seedSheet('Box drag move inner');
    try {
      const pageDiv = await openSheet(page, sheet);
      const box = await pageDiv.boundingBox();
      const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
      await pageDiv.click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('r');
      await drag(page, at(0.2, 0.2), at(0.7, 0.6));
      // With the Rectangle tool a drag inside the just-drawn (picked) box
      // draws a second box; it does not move the first.
      await drag(page, at(0.4, 0.35), at(0.5, 0.45));
      await expect.poll(async () => (await markIds(page)).length).toBe(2);
      const [outer, inner] = await markIds(page);
      await page.keyboard.press('v');
      await page.waitForTimeout(300);
      const o = await markBox(page, outer);
      await page.mouse.click(o.x + 1, o.y + o.height * 0.8);
      await expect(page.locator('[data-box-drag-move-zone="true"]')).toHaveCount(1);
      // A drag that starts on the inner (unpicked) box's outline does not
      // move the picked outer box (it is the unpicked mark's press: a box
      // select, owner rule).
      const i0 = await markBox(page, inner);
      const o0 = await markBox(page, outer);
      await drag(page, { x: i0.x + 1, y: i0.y + i0.height / 2 }, { x: i0.x + 1 + 60, y: i0.y + i0.height / 2 });
      await page.waitForTimeout(600);
      const o1 = await markBox(page, outer);
      expect(Math.abs(o1.x - o0.x), 'the outer box stays').toBeLessThan(2);
      // A click on the inner box's outline picks it.
      const i1 = await markBox(page, inner);
      await page.mouse.click(i1.x + 1, i1.y + i1.height / 2);
      const leftHandleX = async () => {
        const b = await page.locator('[data-overlay-page="1"] [data-resize-handle="ml"]').first().boundingBox().catch(() => null);
        return b ? b.x + b.width / 2 : null;
      };
      await expect.poll(async () => Math.abs((await leftHandleX()) - i1.x)).toBeLessThan(8);
    } finally {
      await sheet.remove();
    }
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a finger drags the move grip under a picked rectangle', async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.box-drag-move', '1'));
    const sheet = await seedSheet('Box drag move phone');
    try {
      const pageDiv = await openSheet(page, sheet, { phone: true });
      const box = await pageDiv.boundingBox();
      const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
      });
      const fingerDrag = async (from, to, steps = 12) => {
        await touch('touchStart', from.x, from.y);
        for (let i = 1; i <= steps; i += 1) {
          await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
          await page.waitForTimeout(30);
        }
        await touch('touchEnd');
      };

      // Draw a rectangle with the Rectangle tool.
      await page.keyboard.press('r');
      await page.waitForTimeout(300);
      await fingerDrag(at(0.25, 0.25), at(0.6, 0.4));
      await expect.poll(async () => (await markIds(page)).length).toBe(1);
      const [id] = await markIds(page);

      // Pick it with Select, by a tap on its outline.
      await page.keyboard.press('v');
      await page.waitForTimeout(300);
      const before = await markBox(page, id);
      await page.touchscreen.tap(before.x + 1, before.y + before.height / 2);
      const grip = page.locator('[data-box-move-grip="true"]');
      await expect(grip).toHaveCount(1);
      const g = await grip.locator('circle').boundingBox();
      // About 36 px, just under the box.
      expect(g.width).toBeGreaterThan(30);
      expect(g.width).toBeLessThan(42);
      expect(g.y).toBeGreaterThan(before.y + before.height);
      // Clear of the quick bar.
      const bar = page.locator('[data-selection-quick-bar][data-visible="true"]');
      if (await bar.count()) {
        const b = await bar.boundingBox();
        const overlapX = Math.min(b.x + b.width, g.x + g.width) - Math.max(b.x, g.x);
        const overlapY = Math.min(b.y + b.height, g.y + g.height) - Math.max(b.y, g.y);
        expect(overlapX > 0 && overlapY > 0, `bar ${JSON.stringify(b)} over grip ${JSON.stringify(g)}`).toBe(false);
      }
      await page.screenshot({ path: test.info().outputPath('phone-grip.png') });

      const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
      await fingerDrag(from, { x: from.x + 50, y: from.y + 70 });
      await page.waitForTimeout(800);
      const after = await markBox(page, id);
      expect(after.x - before.x, JSON.stringify({ before, after })).toBeGreaterThan(35);
      expect(after.y - before.y, JSON.stringify({ before, after })).toBeGreaterThan(50);

      // Under Pan (the pick stays) the grip still moves it.
      await page.keyboard.press('m');
      await page.waitForTimeout(400);
      // Pan: the page layer leaves presses to the pan scroller.
      await expect.poll(() => page.evaluate(() => document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"]')?.style.pointerEvents)).toBe('none');
      await expect(grip).toHaveCount(1);
      const g2 = await grip.locator('circle').boundingBox();
      const from2 = { x: g2.x + g2.width / 2, y: g2.y + g2.height / 2 };
      await fingerDrag(from2, { x: from2.x - 40, y: from2.y + 40 });
      await page.waitForTimeout(800);
      const panned = await markBox(page, id);
      expect(after.x - panned.x, JSON.stringify({ after, panned })).toBeGreaterThan(25);
      expect(panned.y - after.y, JSON.stringify({ after, panned })).toBeGreaterThan(25);
    } finally {
      await sheet.remove();
    }
  });
});
