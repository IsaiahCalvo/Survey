import { test, expect } from '@playwright/test';

// Owner 2026-10-26 (Spaces panel): the grip is always there, Edit region and
// Move or copy are always on a region line, the region count is a small line
// under the name, and entering edit mode moves nothing sideways.
test.use({ video: 'off' });
const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const SHOTS = process.env.SPACES_SHOTS_DIR || '';

async function setup(page, context) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.goto('/?testPdf=order-pages.pdf');
  await page.waitForFunction(() => window.__fix19SurveyRegionHarness && window.__pdfjsViewerPerf);
  await page.evaluate(() => window.__fix19SurveyRegionHarness.setup());
  await button(page, 'Spaces').click();
  await button(page, 'Open Fix19 Space A').click();
}

// Left edge of every visible thing on the space and region lines that is
// there both in and out of edit mode.
const lineLefts = (page) => page.locator('.spaces-panel').evaluate((panel) => {
  const pick = [
    '.space-card__grip', '.space-card__chevron', '.space-card__name', '.space-card__count',
    '.spaces-region__page', '.spaces-region__label', '.spaces-region__edit',
    '.spaces-region__marks', '.spaces-switch',
  ];
  const out = {};
  for (const selector of pick) {
    out[selector] = Array.from(panel.querySelectorAll(selector)).map((el) => Math.round(el.getBoundingClientRect().left * 10) / 10);
  }
  return out;
});

test('Spaces lines keep their place in edit mode and always offer grip, edit and move', async ({ page, context }) => {
  await setup(page, context);
  await expect(page.locator('.spaces-panel .space-card__grip')).toHaveCount(2);
  await expect(page.locator('.spaces-panel .space-card__count').first()).toHaveText(/^\d+ regions?$|^No regions$/);
  await expect(button(page, 'Edit the regions on page 1')).toBeVisible();
  await expect(button(page, 'Move or copy region on page 1')).toBeVisible();
  await expect(page.locator('.spaces-panel .space-card__delete')).toHaveCount(0);
  if (SHOTS) await page.locator('.spaces-panel').screenshot({ path: `${SHOTS}/rest.png` });
  const before = await lineLefts(page);

  await button(page, 'Edit Spaces').click();
  await expect(page.locator('.spaces-panel .space-card__delete').first()).toBeVisible();
  if (SHOTS) await page.locator('.spaces-panel').screenshot({ path: `${SHOTS}/edit.png` });
  const after = await lineLefts(page);
  expect(after).toEqual(before);

  await button(page, 'Done editing Spaces').click();
  expect(await lineLefts(page)).toEqual(before);
});

test('Spaces rearrange by the grip out of edit mode', async ({ page, context }) => {
  await setup(page, context);
  const names = () => page.locator('.spaces-panel .space-card__name').evaluateAll((els) => els.map((el) => el.value));
  const start = await names();
  const grips = page.locator('.spaces-panel .space-card__grip');
  const from = await grips.nth(1).boundingBox();
  const to = await grips.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 8, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y - 4, { steps: 12 });
  await page.mouse.up();
  await expect.poll(names).toEqual([start[1], start[0]]);
});
