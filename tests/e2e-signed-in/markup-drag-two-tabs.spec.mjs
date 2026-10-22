// A mark being moved stays painted and under the pointer when another drawing
// is open in a second tab of the app (owner report 2026-10-22: marks vanished
// while being moved; he had two drawings open). Every open tab keeps its page
// layers in the DOM, so the move must only measure the active tab's pages.
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_SURVEY } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';

async function openFromHome(page, name) {
  await page.getByText(name, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${name}` })).toBeVisible({ timeout: 60_000 });
}

test('moving a mark with a second drawing open in another tab', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  // The second drawing is opened first, so its hidden page layers sit in the
  // DOM when the first one is in front.
  await openFromHome(page, E2E_SURVEY.documentName);
  await page.waitForTimeout(2000);
  await page.getByText('Home', { exact: true }).first().click();
  await openFromHome(page, E2E_DOCUMENT.name);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor();
  await page.waitForTimeout(2500);
  const visibleLayers = await page.evaluate(() => document.querySelectorAll('svg[data-svg-annotation-layer="1"]').length);
  console.log('page-1 layers in the DOM:', visibleLayers);

  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().boundingBox();
  const ids = () => page.locator(`${MARKS}`).evaluateAll((nodes) => [...new Set(nodes.filter((n) => n.getClientRects().length).map((n) => n.getAttribute('data-annotation-id')))]);
  const before = new Set(await ids());
  await page.keyboard.press('r');
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 50, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await ids()).filter((id) => !before.has(id)).length).toBe(1);
  const id = (await ids()).find((m) => !before.has(m));
  const visibleMark = () => page.evaluate((markId) => {
    const node = [...document.querySelectorAll(`[data-annotation-id="${markId}"]`)].find((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y };
  }, id);

  await page.keyboard.press('v');
  await page.mouse.click(x + 30, y);
  await page.waitForTimeout(300);
  const start = await visibleMark();
  await page.mouse.move(x + 30, y);
  await page.mouse.down();
  const misses = [];
  for (let i = 1; i <= 15; i += 1) {
    await page.mouse.move(x + 30, y - i * 5);
    await page.waitForTimeout(40);
    const at = await visibleMark();
    if (!at) misses.push(i);
  }
  const during = await visibleMark();
  await page.mouse.up();
  expect(misses, 'steps where the moved mark was not painted').toEqual([]);
  expect(start.y - during.y).toBeGreaterThan(15 * 5 - 12);

  await page.keyboard.press('Delete');
  await page.waitForTimeout(2500);
});
