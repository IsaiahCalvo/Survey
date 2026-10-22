// Owner 2026-10-22: the selection's floating quick bar sat on top of the
// counter pin's turn grabber and on top of the degree box next to a shape's
// rotate grabber, and snapping had no switch anyone could find.
// - The bar never covers a rotate grabber (a counter pin's included) or the
//   degree box, whichever side the grabber is on: it takes the side away from
//   the grabber.
// - Snapping has a switch on the rail and Shift+S; it is remembered.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const BAR = '[data-selection-quick-bar]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

async function shownBar(page) {
  const bar = page.locator(`${BAR}[data-visible="true"]`);
  await expect(bar).toHaveCount(1);
  await page.waitForTimeout(150);
  return bar.boundingBox();
}

async function newMark(page, draw) {
  const before = new Set(await markIds(page));
  await draw();
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  return (await markIds(page)).find((id) => !before.has(id));
}

async function deleteSelected(page, id) {
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-overlay-page="1"] [data-annotation-id="${id}"]`)).toHaveCount(0);
  await page.waitForTimeout(800);
}

test('the bar keeps clear of a counter pin\'s turn grabber, whichever way the tail points', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const box = await page.locator(PAGE).boundingBox();
  const at = { x: box.x + box.width * 0.5, y: box.y + Math.min(box.height * 0.45, 420) };
  const id = await newMark(page, async () => {
    await page.keyboard.press('c');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('Escape');
  });
  await page.keyboard.press('v');
  await page.waitForTimeout(600);
  const centre = await page.evaluate((markId) => {
    const r = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] text`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  await page.mouse.click(centre.x, centre.y);
  const grabber = page.locator('[data-counter-rotate-grabber]');
  await expect(grabber).toHaveCount(1);

  // Swing the tail up, right, down and left; after each turn the bar is back
  // and clear of the grabber, on the side away from it when it points up/down.
  for (const [dx, dy, side] of [[0, -1, 'below'], [1, 0, null], [0, 1, 'above'], [-1, 0, null]]) {
    const g = await grabber.boundingBox();
    const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    const reach = Math.hypot(from.x - centre.x, from.y - centre.y);
    // Press the grabber where nothing else covers it.
    const press = await page.evaluate(({ x, y, width, height }) => {
      for (const fy of [0.5, 0.3, 0.7, 0.2, 0.8]) {
        for (const fx of [0.5, 0.3, 0.7, 0.2, 0.8]) {
          const px = x + width * fx;
          const py = y + height * fy;
          if (document.elementFromPoint(px, py)?.closest?.('[data-counter-rotate-grabber]')) return { x: px, y: py };
        }
      }
      return null;
    }, g);
    expect(press, 'the grabber is not covered').not.toBeNull();
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + dx * reach, centre.y + dy * reach, { steps: 8 });
    await expect(page.locator(`${BAR}[data-visible="true"]`), 'the bar hides while the pin turns').toHaveCount(0);
    await page.mouse.up();
    const bar = await shownBar(page);
    const turned = await grabber.boundingBox();
    expect(overlap(bar, turned), `bar over the grabber (tail ${dx},${dy})`).toBe(0);
    if (side === 'below') expect(bar.y, 'tail up: the bar sits below the pin').toBeGreaterThan(centre.y);
    if (side === 'above') expect(bar.y + bar.height, 'tail down: the bar sits above the pin').toBeLessThan(centre.y);
  }
  await deleteSelected(page, id);
});

test('the bar keeps clear of a shape\'s rotate grabber and its degree box, upright or upside down', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const box = await page.locator(PAGE).boundingBox();
  const x0 = box.x + box.width * 0.4;
  const y0 = box.y + Math.min(box.height * 0.35, 330);
  const id = await newMark(page, async () => {
    await page.keyboard.press('r');
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 160, y0 + 90, { steps: 8 });
    await page.mouse.up();
  });
  await page.keyboard.press('v');
  // An unfilled box is picked on its outline.
  await page.mouse.click(x0, y0 + 45);
  const mtr = page.locator('[data-overlay-page="1"] [data-rotation-handle="mtr"] circle').last();
  await expect(mtr).toBeVisible();

  const check = async (label) => {
    const bar = await shownBar(page);
    const handle = await mtr.boundingBox();
    expect(overlap(bar, handle), `${label}: bar over the rotate grabber`).toBe(0);
    // Hover the grabber: the degree box opens beside it, clear of the bar.
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    const field = page.locator('[data-rotation-input-field]');
    await expect(field).toBeVisible();
    const pill = await field.boundingBox();
    const barNow = await shownBar(page);
    expect(overlap(barNow, pill), `${label}: bar over the degree box`).toBe(0);
    return { bar: barNow, handle, pill };
  };

  const upright = await check('upright');
  expect(upright.handle.y, 'upright: the grabber is on top').toBeLessThan(y0);
  expect(upright.bar.y, 'upright: the bar takes the bottom').toBeGreaterThan(y0 + 90);

  // Turn it upside down with the degree box.
  const input = page.locator('[data-rotation-input-field] input');
  const handle = await mtr.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await expect(input).toBeVisible();
  await input.click();
  await input.fill('180');
  await input.press('Enter');
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await page.waitForTimeout(900);
  const flipped = await check('upside down');
  expect(flipped.handle.y, 'upside down: the grabber is underneath').toBeGreaterThan(y0 + 90);
  expect(flipped.bar.y + flipped.bar.height, 'upside down: the bar takes the top').toBeLessThan(y0);

  await page.mouse.click(x0 + 160, y0 + 45);
  await deleteSelected(page, id);
});

test('snapping has a switch on the rail and Shift+S, and the choice is remembered', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.removeItem('survey:annotation-snapping'));
  const toggle = page.locator('button[data-snapping-toggle]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // Two boxes; drag the second near the first's top edge.
  const box = await page.locator(PAGE).boundingBox();
  const ax = box.x + box.width * 0.2;
  const ay = box.y + Math.min(box.height * 0.3, 300);
  const drawRect = (x, y) => newMark(page, async () => {
    await page.keyboard.press('r');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 140, y + 120, { steps: 6 });
    await page.mouse.up();
  });
  const first = await drawRect(ax, ay);
  const second = await drawRect(ax + 200, ay + 40);
  await page.keyboard.press('v');
  const rectOf = (markId) => page.evaluate((m) => {
    const r = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${m}"]`).getBoundingClientRect();
    return { left: r.left, top: r.top };
  }, markId);
  const rectTop = async (markId) => (await rectOf(markId)).top;
  const firstTop = await rectTop(first);

  // Drag the second box so its top lands 3px under the first's: with
  // snapping on it lines up (and a guide shows).
  const dragSecondBy = async (dy) => {
    const { left, top } = await rectOf(second);
    // On the box's left outline (an unfilled box is picked there), between
    // the corner and the side's resize grabber.
    const grab = { x: left + 1.5, y: top + 28 };
    await page.mouse.click(grab.x, grab.y);
    await page.waitForTimeout(400);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 5, grab.y + dy / 2, { steps: 4 });
    await page.mouse.move(grab.x + 10, grab.y + dy, { steps: 4 });
    const guides = await page.locator('[data-overlay-page="1"] [data-snap-guide-axis]').count();
    await page.mouse.up();
    await page.waitForTimeout(500);
    return guides;
  };
  const secondTop = await rectTop(second);
  const guidesOn = await dragSecondBy(firstTop + 3 - secondTop);
  expect(guidesOn, 'a guide shows while it snaps').toBeGreaterThan(0);
  // It was pulled off the spot it was let go (onto the first box's top, or
  // another mark's edge just as close).
  expect(Math.abs(await rectTop(second) - (firstTop + 3)), 'snapping pulled it').toBeGreaterThan(0.5);

  // Switch it off on the rail: the same drag stays where it is dropped.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('survey:annotation-snapping'))).toBe('off');
  await dragSecondBy(30);
  const guidesOff = await dragSecondBy(firstTop + 3 - (await rectTop(second)));
  expect(guidesOff, 'no guide with snapping off').toBe(0);
  expect(Math.abs(await rectTop(second) - (firstTop + 3)), 'dropped where it was let go').toBeLessThan(1.5);

  // Remembered across a reload.
  await page.reload();
  await expect(page.locator('button[data-snapping-toggle]')).toHaveAttribute('aria-pressed', 'false', { timeout: 60_000 });

  // Shift+S turns it back on, with a short note.
  await page.locator(PAGE).waitFor();
  await page.mouse.click(box.x + 10, box.y + box.height - 10);
  await page.keyboard.press('Shift+S');
  await expect(page.locator('button[data-snapping-toggle]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Snapping on')).toBeVisible();

  for (const markId of [first, second]) {
    await page.keyboard.press('v');
    const r = await page.evaluate((m) => {
      const el = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${m}"]`);
      const b = el?.getBoundingClientRect();
      return b ? { x: b.x + 1, y: b.y + b.height / 2 } : null;
    }, markId);
    if (!r) continue;
    await page.mouse.click(r.x, r.y);
    await deleteSelected(page, markId);
  }
});
