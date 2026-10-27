import { test, expect } from '@playwright/test';

// Owner 2026-10-26 (Spaces and regions UI round), local mock PDF only:
// - a lit toggle (the region bulb) stays gold under the pointer;
// - area editing has no hint, no Cancel / Done / Delete / Full page row:
//   Enter keeps, Esc drops (Undo on a toast), Delete or Erase removes, and a
//   drawing group leaves keeping the areas; no areas left = the whole page;
// - with a shape tool armed a click picks an area and the tool stays armed.
test.use({ video: 'off' });

const GOLD = 'rgb(216, 168, 78)';
const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
const storedPage = (page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((value) => value.startsWith('pdfSidebar_order-pages.pdf'));
  return JSON.parse(localStorage.getItem(key)).spaces.find((space) => space.id === 'fix19-space-a').assignedPages[0];
});
const areas = (page) => page.locator('[data-region-edit-layer] [data-region-id]');

async function setup(page, context, { phone = false } = {}) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.goto('/?testPdf=order-pages.pdf');
  await page.waitForFunction(() => window.__fix19SurveyRegionHarness && window.__pdfjsViewerPerf);
  await page.evaluate(() => window.__fix19SurveyRegionHarness.setup());
  await button(page, phone ? 'Open spaces' : 'Spaces').click();
  await button(page, 'Open Fix19 Space A').click();
}

async function openAreas(page) {
  await page.getByRole('button', { name: /^Edit the (areas|regions) on page 1$/ }).filter({ visible: true }).first().click();
  await expect(page.locator('[data-region-edit-layer]')).toBeVisible();
}

async function drawRect(page, x, y, w = 70, h = 60) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 10 });
  await page.mouse.up();
  return { x: box.x + x + w / 2, y: box.y + y + h / 2 };
}

const pickedCount = (page) => page.locator('[data-region-edit-layer] [data-region-id][stroke="#F5A623"]').count();

test('desktop: lit bulb stays gold on hover; area tools without Cancel/Done; click picks; keys and Erase', async ({ page, context }) => {
  test.skip(test.info().project.use?.isMobile, 'desktop pass');
  await setup(page, context);
  await page.getByRole('switch', { name: 'Turn on space', exact: true }).first().click();
  const bulb = page.locator('.spaces-region__marks.is-on').first();
  await expect(bulb).toHaveCSS('color', GOLD);
  await bulb.hover();
  await page.waitForTimeout(250);
  await expect(bulb).toHaveCSS('color', GOLD);

  await openAreas(page);
  const editButton = page.locator('.spaces-region__edit.is-on').first();
  await expect(editButton).toHaveCSS('color', GOLD);
  await expect(page.locator('[data-area-hint]')).toHaveCount(0);
  for (const name of ['Cancel', 'Done', 'Full page', 'Delete area']) await expect(button(page, name)).toHaveCount(0);
  await expect(page.locator('[data-area-tool="erase"]')).toBeVisible();
  // Every other tool group stays live.
  await expect(button(page, 'Draw')).toBeEnabled();

  const startCount = await areas(page).count();
  const centre = await drawRect(page, 330, 430);
  await expect(areas(page)).toHaveCount(startCount + 1);
  // A click on the new area picks it; Rectangle stays armed.
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(() => pickedCount(page)).toBe(1);
  await expect(page.locator('[data-area-tool="rectangle"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-region-resize-handle], [data-region-vertex-handle]').first()).toBeVisible();
  // Dragging the picked area moves it (still on Rectangle).
  const before = await areas(page).last().boundingBox();
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 30, centre.y + 20, { steps: 8 });
  await page.mouse.up();
  const after = await areas(page).last().boundingBox();
  expect(Math.abs(after.x - before.x - 30)).toBeLessThan(4);
  await expect(areas(page)).toHaveCount(startCount + 1);
  // Delete removes the picked area.
  await page.keyboard.press('Delete');
  await expect(areas(page)).toHaveCount(startCount);

  // Erase (E) takes an area away by pressing on it.
  const second = await drawRect(page, 330, 560);
  await expect(areas(page)).toHaveCount(startCount + 1);
  await page.keyboard.press('e');
  await expect(page.locator('[data-area-tool="erase"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(second.x, second.y);
  await expect(areas(page)).toHaveCount(startCount);

  // Esc with nothing in hand drops the edits; the toast's Undo saves them.
  await page.locator('[data-area-tool="rectangle"]').click();
  await drawRect(page, 330, 430);
  const savedBefore = (await storedPage(page)).regions.length;
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-region-edit-layer]')).toHaveCount(0);
  await expect(page.getByText('Area changes dropped')).toBeVisible();
  expect((await storedPage(page)).regions.length).toBe(savedBefore);
  await page.getByRole('button', { name: 'Undo', exact: true }).filter({ hasText: 'Undo' }).last().click();
  await expect.poll(async () => (await storedPage(page)).regions.length).toBe(savedBefore + 1);

  // Enter leaves, keeping a new area.
  await openAreas(page);
  await drawRect(page, 330, 560);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-region-edit-layer]')).toHaveCount(0);
  await expect.poll(async () => (await storedPage(page)).regions.length).toBe(savedBefore + 2);

  // A drawing group leaves keeping the areas and arms that group.
  await openAreas(page);
  await page.locator('[data-area-tool="erase"]').click();
  const last = areas(page).last();
  const lastBox = await last.boundingBox();
  await page.mouse.click(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
  await button(page, 'Draw').click();
  await expect(page.locator('[data-region-edit-layer]')).toHaveCount(0);
  await expect(button(page, 'Draw')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await storedPage(page)).regions.length).toBe(savedBefore + 1);

  // Deleting every area gives the whole page back.
  await openAreas(page);
  await page.keyboard.press('e');
  for (let guard = 0; guard < 12 && await areas(page).count(); guard += 1) {
    const b = await areas(page).first().boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  }
  await expect(areas(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await storedPage(page)).wholePageIncluded).toBe(true);
  expect((await storedPage(page)).regions.length).toBe(0);
  await page.screenshot({ path: test.info().outputPath('desktop-areas.png') });
});

test('desktop pen: a pen tap picks an area under a shape tool', async ({ page, context }) => {
  test.skip(test.info().project.use?.isMobile, 'desktop pass');
  await setup(page, context);
  await openAreas(page);
  const centre = await drawRect(page, 330, 430);
  await page.locator('[data-region-edit-layer]').dispatchEvent('pointerdown', { pointerType: 'pen', pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: centre.x, clientY: centre.y, bubbles: true });
  await page.locator('[data-region-edit-layer]').dispatchEvent('pointerup', { pointerType: 'pen', pointerId: 7, isPrimary: true, button: 0, buttons: 0, clientX: centre.x, clientY: centre.y, bubbles: true });
  await expect.poll(() => pickedCount(page)).toBe(1);
  await expect(page.locator('[data-area-tool="rectangle"]')).toHaveAttribute('aria-pressed', 'true');
});

test('phone: Done check leaves keeping areas; a tap picks without switching tools', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await setup(page, context, { phone: true });
  await openAreas(page);
  const strip = page.locator('[aria-label="Area editing"]');
  await expect(strip).toBeVisible();
  for (const name of ['Cancel', 'Full page']) await expect(strip.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(strip.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erase area', exact: true })).toBeVisible();
  // Tap an existing area with Rectangle armed: picked, Rectangle stays armed.
  const first = areas(page).first();
  await expect(first).toHaveCount(1);
  const box = await first.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => pickedCount(page)).toBe(1);
  await expect(page.getByRole('button', { name: 'Rectangle area', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(strip.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('phone-areas.png') });
  await strip.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('[data-region-edit-layer]')).toHaveCount(0);
  await context.close();
});
