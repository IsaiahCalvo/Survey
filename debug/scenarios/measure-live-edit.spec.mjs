import { expect, test } from '@playwright/test';

// Measure tools, 2026-10-22 owner report: the value and its label must follow
// every handle while it is dragged (bend included), an end drag must not move
// the bend handle, and handles must stay under the pointer on fast drags.

async function openMeasure(page, kind) {
  await page.goto('/?testPdf=spike-120-pages.pdf');
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await surface.waitFor();
  await page.getByRole('button', { name: 'Shapes', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await page.locator(`[data-measure-tool="${kind}"]`).click();
  return surface.boundingBox();
}

const center = async (locator) => {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const labelText = (page) => page.locator('.measure-labels .measure-label text').first().textContent();
// No page scale on the fixture, so labels read plain paper inches.
const feet = (text) => Number(/([\d.]+)/.exec(text || '')?.[1]);

test('length: value and label follow end and bend drags; bend handle stays put', async ({ page }) => {
  const box = await openMeasure(page, 'length');
  const y = box.y + 300;
  await page.mouse.move(box.x + 150, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.measure-labels .measure-label')).toHaveCount(1);
  const start = feet(await labelText(page));
  expect(start).toBeGreaterThan(0);

  await page.mouse.move(box.x + 10, box.y + 10);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 200, y);
  const mid = page.locator('circle[data-handle="midpoint"]').first();
  await mid.waitFor();

  // End drag: the value grows WHILE the button is still down.
  await page.mouse.move(box.x + 350, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, y, { steps: 6 });
  const during = feet(await labelText(page));
  expect(during).toBeGreaterThan(start * 1.4);
  const pill = await center(page.locator('.measure-labels .measure-label rect').first());
  expect(Math.abs(pill.x - (box.x + 300))).toBeLessThan(4);
  await page.mouse.up();
  const straight = feet(await labelText(page));
  expect(Math.abs(straight - during)).toBeLessThan(0.1);

  // Bend: the curve is longer than its chord, live.
  const m0 = await center(mid);
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m0.x, m0.y + 90, { steps: 6 });
  const bentDuring = feet(await labelText(page));
  expect(bentDuring).toBeGreaterThan(straight * 1.1);
  const handleDuring = await center(mid);
  expect(Math.abs(handleDuring.x - m0.x)).toBeLessThan(1.5);
  expect(Math.abs(handleDuring.y - (m0.y + 90))).toBeLessThan(1.5);
  await page.mouse.up();
  const bent = feet(await labelText(page));
  expect(Math.abs(bent - bentDuring)).toBeLessThan(0.1);

  // End drag on the bent line: the bend handle does not move.
  const m1 = await center(mid);
  await page.mouse.move(box.x + 450, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, y - 80, { steps: 6 });
  const m2 = await center(mid);
  expect(Math.hypot(m2.x - m1.x, m2.y - m1.y)).toBeLessThan(1.5);
  await page.mouse.up();
  const m3 = await center(mid);
  expect(Math.hypot(m3.x - m1.x, m3.y - m1.y)).toBeLessThan(1.5);

  // Fast drag in one jump, out past the page edge: the end lands under the pointer.
  const target = { x: box.x + box.width + 40, y: y - 120 };
  await page.mouse.move(box.x + 520, y - 80);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 1 });
  await page.mouse.move(target.x - 60, target.y + 10, { steps: 1 });
  const ends = page.locator('[data-handle-hit-pad="p2"]').first();
  const endNow = await center(ends);
  expect(Math.hypot(endNow.x - (target.x - 60), endNow.y - (target.y + 10))).toBeLessThan(2);
  await page.mouse.up();
});

test('area: value and label follow a corner drag', async ({ page }) => {
  const box = await openMeasure(page, 'area');
  const pts = [[150, 250], [350, 250], [350, 400], [150, 400]];
  for (const [x, yy] of pts) await page.mouse.click(box.x + x, box.y + yy);
  await page.mouse.click(box.x + pts[0][0], box.y + pts[0][1]);
  await expect(page.locator('.measure-labels .measure-label')).toHaveCount(1);
  const area = async () => feet(await labelText(page));
  const before = await area();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 250, box.y + 250);
  const corner = page.locator('[data-resize-handle="vertex-2"]').first();
  await corner.waitFor();
  const c = await center(corner);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 100, c.y + 100, { steps: 6 });
  const during = await area();
  expect(during).toBeGreaterThan(before * 1.2);
  await page.mouse.up();
  expect(Math.abs((await area()) - during)).toBeLessThan(0.05);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('length: a finger drag on an end updates the value live', async ({ page }) => {
    const box = await openMeasure(page, 'length');
    const y = box.y + 300;
    await page.mouse.move(box.x + 150, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, y, { steps: 8 });
    await page.mouse.up();
    const start = feet(await labelText(page));
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 200, y);
    await page.locator('circle[data-handle="midpoint"]').first().waitFor();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, yy) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await touch('touchStart', box.x + 350, y);
    for (let i = 1; i <= 8; i += 1) await touch('touchMove', box.x + 350 + i * 12, y);
    const during = feet(await labelText(page));
    expect(during).toBeGreaterThan(start * 1.3);
    const end = await center(page.locator('[data-handle-hit-pad="p2"]').first());
    expect(Math.abs(end.x - (box.x + 446))).toBeLessThan(2);
    await touch('touchEnd');
    expect(Math.abs(feet(await labelText(page)) - during)).toBeLessThan(0.1);
  });
});
