import { test, expect } from '@playwright/test';

// Pinned tools dock moves (beta 'pinned-tools', owner 2026-11-09: "buttery
// smooth ... every permutation"). A move that changes the dock's shape
// (column <-> row) morphs a stand-in box from where the dock was to where it
// lands, and the drop veil fades out instead of vanishing.

const seed = (placement) => {
  localStorage.setItem('survey.flag.pinned-tools', '1');
  const pins = ['pen', 'highlighter', 'rect', 'ellipse', 'polyline', 'cloud'].map((kind, i) => ({ id: `p${i}`, kind, style: { color: '#e11d48' } }));
  localStorage.setItem('survey:pinned-tools.v1', JSON.stringify({ visible: true, placement, compact: false, pins }));
};

async function open(page, placement) {
  await page.route('**/*', (route) => (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) ? route.continue() : route.abort()));
  await page.addInitScript(seed, placement);
  await page.goto('/?testPdf=landscape-sheets.pdf');
  await page.locator('[data-pinned-tools-grip]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
}

const shellPlacement = (page) => page.locator('[data-pinned-dock-shell]').first().getAttribute('data-pinned-dock-shell');

for (const [from, to] of [['left', 'bottom'], ['bottom', 'right'], ['right', 'left'], ['bottom', 'left'], ['left', 'right'], ['right', 'bottom']]) {
  test(`dragging the dock ${from} -> ${to} lands smoothly`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await open(page, from);
    expect(await shellPlacement(page)).toBe(from);
    const grip = await page.locator('[data-pinned-tools-grip]').boundingBox();
    const area = await page.locator('[data-pinned-dock-shell]').evaluate((el) => { const r = el.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const target = { left: [area.x + 30, area.y + area.h / 2], right: [area.x + area.w - 30, area.y + area.h / 2], bottom: [area.x + area.w / 2, area.y + area.h - 20] }[to];
    const sx = grip.x + grip.width / 2;
    const sy = grip.y + grip.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) await page.mouse.move(sx + ((target[0] - sx) * i) / 20, sy + ((target[1] - sy) * i) / 20);
    await page.waitForTimeout(400);
    await page.mouse.up();
    const shapeChange = (from === 'bottom') !== (to === 'bottom');
    // Right after the drop: the veil is still fading, and a shape change
    // shows the stand-in box with the real dock hidden under it.
    await expect(page.locator('[data-pinned-dock-zones]')).toHaveCount(1);
    if (shapeChange) {
      await expect(page.locator('[data-pinned-dock-morph]')).toHaveCount(1);
      const veil = await page.locator('[data-pinned-dock-zones]').evaluate((el) => Number(getComputedStyle(el).opacity));
      expect(veil).toBeGreaterThan(0);
    }
    // Then everything settles: the stand-in is gone and the dock is shown.
    await expect(page.locator('[data-pinned-dock-morph]')).toHaveCount(0, { timeout: 2000 });
    await expect(page.locator('[data-pinned-dock-zones]')).toHaveCount(0, { timeout: 2000 });
    expect(await shellPlacement(page)).toBe(to);
    const dockStyle = await page.locator('.pinned-dock').first().evaluate((el) => ({ opacity: el.style.opacity, transform: el.style.transform, translate: el.style.translate }));
    expect(dockStyle).toEqual({ opacity: '', transform: '', translate: '' });
    await expect(page.locator('[data-pinned-tool]')).toHaveCount(6);
    expect(errors).toEqual([]);
  });
}

test('the dock menu moves it between a column and a row through the same morph', async ({ page }) => {
  await open(page, 'right');
  await page.locator('[data-pinned-tools-menu]').click();
  await expect(page.locator('[data-pinned-tools-settings]')).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Bottom' }).click();
  await expect(page.locator('[data-pinned-dock-morph]')).toHaveCount(1);
  await expect(page.locator('[data-pinned-dock-morph]')).toHaveCount(0, { timeout: 2000 });
  expect(await shellPlacement(page)).toBe('bottom');
});
