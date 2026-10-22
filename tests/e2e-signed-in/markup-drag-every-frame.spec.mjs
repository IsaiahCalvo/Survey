// Every frame of a move drag paints the mark under the pointer, for a mouse
// and for a pen (owner report 2026-10-22: marks vanished while being moved).
// A finger on the page pans (touch is pan-only), so it has no move to check.
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);

for (const pointerType of ['mouse', 'pen']) {
  test(`a selected mark stays painted on every frame of a ${pointerType} move`, async ({ page }) => {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openSampleDocument(page);
    await page.waitForTimeout(1500);
    const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="1"]`).boundingBox();

    const before = new Set(await markIds(page));
    await page.keyboard.press('r');
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.82;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 50, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
    const id = (await markIds(page)).find((m) => !before.has(m));
    await page.waitForTimeout(1500);

    await page.keyboard.press('v');
    await page.mouse.click(x + 30, y);
    await page.waitForTimeout(300);
    const topOf = () => page.evaluate((markId) => document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`)?.getBoundingClientRect().y ?? null, id);
    const startY = await topOf();

    // Count, inside the page, every animation frame where the mark is not
    // painted (gone from the DOM or a zero box).
    await page.evaluate((markId) => {
      window.__dragMiss = 0;
      window.__dragFrames = 0;
      window.__dragSampling = true;
      const tick = () => {
        if (!window.__dragSampling) return;
        window.__dragFrames += 1;
        const painted = [...document.querySelectorAll(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`)]
          .some((n) => { const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
        if (!painted) window.__dragMiss += 1;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, id);

    const cdp = await page.context().newCDPSession(page);
    const send = (type, px, py, buttons) => cdp.send('Input.dispatchMouseEvent', {
      type, x: px, y: py, button: 'left', buttons, clickCount: 1, pointerType, force: pointerType === 'pen' ? 0.5 : 0,
    });
    await send('mouseMoved', x + 30, y, 0);
    await send('mousePressed', x + 30, y, 1);
    for (let i = 1; i <= 20; i += 1) {
      await send('mouseMoved', x + 30, y - i * 4, 1);
      await page.waitForTimeout(30);
    }
    const duringY = await topOf();
    const [misses, frames] = await page.evaluate(() => { window.__dragSampling = false; return [window.__dragMiss, window.__dragFrames]; });
    await send('mouseReleased', x + 30, y - 80, 0);

    expect(frames).toBeGreaterThan(10);
    expect(misses, 'frames where the moved mark was not painted').toBe(0);
    expect(startY - duringY, 'the mark followed the pointer up').toBeGreaterThan(80 - 12);
    await expect.poll(async () => startY - (await topOf())).toBeGreaterThan(80 - 12);

    await page.keyboard.press('Delete');
    await expect(page.locator(`[data-overlay-page="1"] [data-annotation-id="${id}"]`)).toHaveCount(0);
    await page.waitForTimeout(2500);
    expect(E2E_DOCUMENT.pageCount).toBe(1);
  });
}
