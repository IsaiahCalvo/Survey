// A mark being dragged must stay under the pointer and painted on every frame
// even when the page's mark list changes under the drag: another screen
// deletes a mark that sits earlier in the list, so every later mark moves up
// one position (owner report 2026-10-22: marks vanished while being moved).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
const mark = (page, id) => page.locator(`[data-overlay-page="1"] [data-annotation-id="${id}"]`);

async function openAs(browser, account) {
  const context = await browser.newContext();
  await context.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  const page = await context.newPage();
  await signIn(page, account);
  await page.getByText('E2E Sample Drawing.pdf', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator(MARKS).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

async function drawRect(page, fx, fy) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const before = new Set(await markIds(page));
  await page.keyboard.press('r');
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 50, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  return { id: (await markIds(page)).find((id) => !before.has(id)), x, y };
}

// Per-frame check in the page: the mark is in the DOM with a real box.
const startSampler = (page, id) => page.evaluate((markId) => {
  window.__dragMiss = 0;
  window.__dragSampling = true;
  const tick = () => {
    if (!window.__dragSampling) return;
    const painted = [...document.querySelectorAll(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`)]
      .some((n) => { const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
    if (!painted) window.__dragMiss += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, id);
const stopSampler = (page) => page.evaluate(() => { window.__dragSampling = false; return window.__dragMiss; });
const topLeft = (page, id) => mark(page, id).first().evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y }; });

test('a dragged mark keeps following the pointer when an earlier mark is deleted elsewhere', async ({ browser }) => {
  const a = await openAs(browser, E2E_ACCOUNTS.owner);
  const b = await openAs(browser, E2E_ACCOUNTS.editor);
  try {
    const first = await drawRect(a.page, 0.15, 0.82);
    const second = await drawRect(a.page, 0.55, 0.82);
    await expect(mark(b.page, second.id)).toHaveCount(1, { timeout: 20_000 });
    await a.page.waitForTimeout(1500);

    // A grabs the second rectangle by its top edge.
    await a.page.keyboard.press('v');
    await a.page.mouse.click(second.x + 30, second.y);
    await a.page.waitForTimeout(300);
    const start = await topLeft(a.page, second.id);
    await startSampler(a.page, second.id);
    await a.page.mouse.move(second.x + 30, second.y);
    await a.page.mouse.down();
    let step = 0;
    const moveA = async (n) => {
      for (let i = 0; i < n; i += 1) {
        step += 1;
        await a.page.mouse.move(second.x + 30 + step * 4, second.y - step * 4);
        await a.page.waitForTimeout(50);
      }
    };
    await moveA(6);

    // B deletes the first rectangle while A is still holding the second.
    await b.page.keyboard.press('v');
    const firstBox = await mark(b.page, first.id).first().boundingBox();
    await b.page.mouse.click(firstBox.x + 1.5, firstBox.y + firstBox.height / 2);
    await b.page.keyboard.press('Delete');
    await expect(mark(a.page, first.id)).toHaveCount(0, { timeout: 20_000 });

    await moveA(10);
    const during = await topLeft(a.page, second.id);
    const misses = await stopSampler(a.page);
    await a.page.mouse.up();

    expect(misses, 'frames where the dragged mark was not painted').toBe(0);
    // Still following the pointer after the delete: it kept rising with every
    // step (snapping may hold the x and take the first few px), and it did not
    // jump back to where the drag began.
    expect(start.y - during.y).toBeGreaterThan(step * 4 - 12);
    await expect.poll(async () => start.y - (await topLeft(a.page, second.id)).y).toBeGreaterThan(step * 4 - 12);

    // Leave the shared sample as it was.
    await a.page.keyboard.press('Delete');
    await expect(mark(a.page, second.id)).toHaveCount(0);
    await a.page.waitForTimeout(2500);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
