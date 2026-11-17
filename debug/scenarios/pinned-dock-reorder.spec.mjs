import { test, expect } from '@playwright/test';

// Pinned tools: drag to rearrange (owner 2026-11-15, KAL-601). Drag replaces
// "Move to start": a pin behind "+N" drags out of its grid onto the dock, a
// finger holds a pin before it lifts, and hidden, the dock leaves its pin in
// the left rail.

test.use({ video: 'off' });

const PIN_IDS = Array.from({ length: 10 }, (_, i) => `p${i}`);

const seed = (ids) => {
  localStorage.setItem('survey.flag.pinned-tools', '1');
  const kinds = ['pen', 'highlighter', 'rect', 'ellipse', 'polyline', 'cloud', 'arrow', 'line', 'text', 'callout'];
  const pins = ids.map((id, i) => ({ id, kind: kinds[i], style: { color: '#e11d48' } }));
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem('survey:pinned-tools.v1', JSON.stringify({ visible: true, placement: 'bottom', compact: true, pins }));
    sessionStorage.setItem('seeded', '1');
  }
};

async function open(page) {
  await page.route('**/*', (route) => (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) ? route.continue() : route.abort()));
  await page.addInitScript(seed, PIN_IDS);
  await page.goto('/?testPdf=landscape-sheets.pdf');
  await page.locator('[data-pinned-tools-grip]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
}

const savedOrder = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('survey:pinned-tools.v1')).pins.map((p) => p.id));

test('a pin menu has no "Move to start"', async ({ page }) => {
  await open(page);
  await page.locator('.pinned-dock [data-pin-id="p2"]').click({ button: 'right' });
  const menu = page.locator('[data-pinned-tools-pin-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Duplicate')).toBeVisible();
  await expect(menu.getByText('Move to start')).toHaveCount(0);
});

test('a pin behind "+N" drags out of its grid onto the dock', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await open(page);
  await expect(page.locator('[data-pinned-tools-more]')).toBeVisible();
  await page.locator('[data-pinned-tools-more]').click();
  const gridPin = page.locator('[data-pinned-tools-more-menu] [data-pin-id="p8"]');
  await expect(gridPin).toBeVisible();
  const from = await gridPin.boundingBox();
  const first = await page.locator('.pinned-dock [data-pin-slot="p0"]').boundingBox();
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  const tx = first.x + 4;
  const ty = first.y + first.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 15; i += 1) await page.mouse.move(sx + ((tx - sx) * i) / 15, sy + ((ty - sy) * i) / 15);
  await expect(page.locator('[data-pin-ghost]')).toHaveCount(1);
  await expect(page.locator('[data-pinned-tools-more-menu]')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('[data-pin-ghost]')).toHaveCount(0);
  expect((await savedOrder(page))[0]).toBe('p8');
  await expect(page.locator('.pinned-dock [data-pin-slot]').first()).toHaveAttribute('data-pin-slot', 'p8');
  expect(errors).toEqual([]);
});

test('a finger holds a pin, then drags it along the dock', async ({ page }) => {
  await open(page);
  const box = await page.locator('.pinned-dock [data-pin-id="p0"]').boundingBox();
  const third = await page.locator('.pinned-dock [data-pin-slot="p2"]').boundingBox();
  const fire = (type, x, y) => page.evaluate(({ type, x, y }) => {
    const target = type === 'pointerdown'
      ? document.querySelector('.pinned-dock [data-pin-id="p0"]')
      : window;
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y }));
  }, { type, x, y });
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  // A quick swipe does nothing.
  await fire('pointerdown', x0, y);
  await fire('pointermove', x0 + 40, y);
  await fire('pointerup', x0 + 40, y);
  expect((await savedOrder(page)).slice(0, 3)).toEqual(['p0', 'p1', 'p2']);
  // Held a moment, then moved: it lands past p2.
  await fire('pointerdown', x0, y);
  await page.waitForTimeout(400);
  const tx = third.x + third.width - 2;
  for (let i = 1; i <= 8; i += 1) await fire('pointermove', x0 + ((tx - x0) * i) / 8, y);
  await fire('pointerup', tx, y);
  expect((await savedOrder(page)).slice(0, 3)).toEqual(['p1', 'p2', 'p0']);
});

test('hidden, the dock leaves its pin in the left rail', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-pinned-tools-show="rail"]')).toHaveCount(0);
  await page.locator('[data-pinned-tools-toggle]').click();
  await expect(page.locator('[data-pinned-tools-dock]')).toHaveCount(0, { timeout: 3000 });
  const railPin = page.locator('.left-rail__column [data-pinned-tools-show="rail"]');
  await expect(railPin).toBeVisible();
  await page.screenshot({ path: 'debug/screenshots/pinned-rail-pin.png' });
  await railPin.click();
  await expect(page.locator('[data-pinned-tools-dock]')).toHaveCount(1);
  await expect(page.locator('[data-pinned-tools-show="rail"]')).toHaveCount(0);
});
