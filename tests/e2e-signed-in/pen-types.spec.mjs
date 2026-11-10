// Nightly 'pen-types' (Drawboard PDF's three pens, measured live 2026-11-10,
// endings-and-pens.md). Basic keeps one width; Calligraphy is thick going
// down (1.75w) and thin going sideways (0.5w); Pro with a mouse thins out
// when moved fast. The pick is a Pen setting (remembered) in a pill on the
// desktop bar and three tiles in the phone sheet.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  localStorage.removeItem('survey.penType');
  if (value) localStorage.setItem('survey.flag.pen-types', '1');
  else localStorage.removeItem('survey.flag.pen-types');
}, on);

async function openSheet(page, sheet, { tap = false } = {}) {
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
  if (tap) await row.tap(); else await row.click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (tap) { if (await openFile.isVisible().catch(() => false)) await openFile.tap(); } else await openFile.click();
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { box: await surface.boundingBox(), marks: surface.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

// A straight stroke from (x, y) to (x2, y2) in `steps` moves, `pause` ms apart.
async function stroke(page, box, x, y, x2, y2, { steps = 30, pause = 16 } = {}) {
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(box.x + x + ((x2 - x) * i) / steps, box.y + y + ((y2 - y) * i) / steps);
    if (pause) await page.waitForTimeout(pause);
  }
  await page.mouse.up();
}

const bbox = (mark) => mark.evaluate((g) => { const b = g.getBBox(); return { w: b.width, h: b.height }; });

test('Basic keeps one width; Calligraphy is fat down and thin across; Pro thins when fast', async ({ page }) => {
  test.setTimeout(200_000);
  await flagOn(page, true);
  const sheet = await seedSheet('Pen types desktop');
  try {
    const { box, marks } = await openSheet(page, sheet);
    await page.keyboard.press('p');
    const pill = page.getByRole('button', { name: 'Pen type', exact: true }).filter({ visible: true }).first();
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Basic');

    // Basic, across: its height is the width (w) plus nothing else.
    await stroke(page, box, 80, 120, 260, 120);
    await expect(marks).toHaveCount(1);
    const w = (await bbox(marks.nth(0))).h;
    expect(w).toBeGreaterThan(1);

    await pill.click();
    const tiles = page.locator('[data-pen-types="true"]').filter({ visible: true }).first();
    expect(await tiles.getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
      'Basic: Fixed width', 'Pro: Variable width', 'Calligraphy: Dynamic width',
    ]);
    await tiles.locator('[data-pen-type="calligraphy"]').click();
    await expect(pill).toContainText('Calligraphy');
    await stroke(page, box, 330, 100, 330, 300); // down
    await stroke(page, box, 80, 360, 260, 360); // across
    await expect(marks).toHaveCount(3);
    const down = await bbox(marks.nth(1));
    const across = await bbox(marks.nth(2));
    expect(down.w / w).toBeGreaterThan(1.5);
    expect(down.w / w).toBeLessThan(2.0);
    expect(across.h / w).toBeLessThan(0.75);

    // Pro with a mouse: a fast stroke ends thinner than a slow one.
    await pill.click();
    await page.locator('[data-pen-types="true"] [data-pen-type="pro"]').filter({ visible: true }).first().click();
    await stroke(page, box, 80, 440, 260, 440, { steps: 90, pause: 12 }); // slow
    await stroke(page, box, 80, 520, 460, 520, { steps: 4, pause: 0 }); // fast
    await expect(marks).toHaveCount(5);
    const slow = await bbox(marks.nth(3));
    const fast = await bbox(marks.nth(4));
    expect(slow.h / w).toBeGreaterThan(0.85);
    expect(fast.h).toBeLessThan(slow.h);
    expect(await page.evaluate(() => localStorage.getItem('survey.penType'))).toBe('pro');
  } finally {
    await sheet.remove();
  }
});

test('without the flag the Pen has no type pill', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOn(page, false);
  const sheet = await seedSheet('Pen types off');
  try {
    await openSheet(page, sheet);
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Width', exact: false }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pen type', exact: true })).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`pen types, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("the Pen's settings sheet holds the three pens and keeps the pick", async ({ page }) => {
      test.setTimeout(150_000);
      await flagOn(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Pen types ${layout.native ? 'app' : 'web'}`);
      try {
        await openSheet(page, sheet, { tap: true });
        await page.getByRole('button', { name: 'Draw', exact: true }).filter({ visible: true }).first().tap();
        await page.getByRole('button', { name: 'Pen', exact: true }).filter({ visible: true }).last().tap();
        await page.getByRole('button', { name: 'More Pen settings' }).filter({ visible: true }).first().tap();
        const tiles = page.locator('[data-pen-types="true"]').filter({ visible: true }).first();
        await expect(tiles).toBeVisible();
        await expect(tiles.locator('[data-pen-type="basic"]')).toHaveAttribute('aria-checked', 'true');
        const b = await tiles.boundingBox();
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(390);
        await tiles.locator('[data-pen-type="calligraphy"]').tap();
        await expect(tiles.locator('[data-pen-type="calligraphy"]')).toHaveAttribute('aria-checked', 'true');
        expect(await page.evaluate(() => localStorage.getItem('survey.penType'))).toBe('calligraphy');
      } finally {
        await sheet.remove();
      }
    });
  });
}
