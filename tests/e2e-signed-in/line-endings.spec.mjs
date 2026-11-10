// Nightly 'line-endings' (Drawboard PDF's Endings, measured live 2026-11-10,
// endings-and-pens.md): a Start | End switch over all ten heads for the Line
// and Arrow tools, drawn at Drawboard's sizes. An Arrow starts with no head at
// the start and an open arrow at the end (arms 8 x the width at 30 degrees, the
// line running to the tip); a Line starts with none. A picked line takes a new
// head as one Undo step. Without the flag the arrow ends pill is unchanged.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  localStorage.removeItem('survey.lineEndings');
  if (value) localStorage.setItem('survey.flag.line-endings', '1');
  else localStorage.removeItem('survey.flag.line-endings');
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
  return { surface, box: await surface.boundingBox(), marks: surface.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

async function drag(page, box, x, y, x2, y2) {
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + (x + x2) / 2, box.y + (y + y2) / 2, { steps: 4 });
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 4 });
  await page.mouse.up();
}

// One drawn line's body and heads, in page units, read off the SVG.
const readLine = (mark) => mark.evaluate((g) => {
  const body = g.querySelector('line');
  const heads = [...g.querySelectorAll('path, circle, polygon, polyline')]
    .filter((el) => !el.closest('[data-hover-halo]'))
    .map((el) => {
      const d = el.getAttribute('d') || '';
      const nums = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
      const points = [];
      for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
      return { tag: el.tagName, closed: /Z\s*$/.test(d), fill: el.getAttribute('fill'), points, width: Number(el.getAttribute('stroke-width')) };
    });
  return {
    width: Number(body?.getAttribute('stroke-width')),
    x1: Number(body?.getAttribute('x1')), y1: Number(body?.getAttribute('y1')),
    x2: Number(body?.getAttribute('x2')), y2: Number(body?.getAttribute('y2')),
    heads,
  };
});

const endings = (page) => page.locator('[data-line-endings="true"]').filter({ visible: true }).first();

test('Arrow draws an open arrow at 8 x its width; Start | End picks; a picked arrow changes as one Undo step; Line has no heads', async ({ page }) => {
  test.setTimeout(200_000);
  await flagOn(page, true);
  const sheet = await seedSheet('Line endings desktop');
  try {
    const { box, marks } = await openSheet(page, sheet);
    await page.keyboard.press('a');
    const pill = page.getByRole('button', { name: 'Endings', exact: true }).filter({ visible: true }).first();
    await expect(pill).toBeVisible();
    await expect(page.getByRole('button', { name: 'Arrow ends', exact: true })).toHaveCount(0);

    await drag(page, box, 100, 200, 300, 200);
    await expect(marks).toHaveCount(1);
    const first = await readLine(marks.first());
    const v = first.heads.find((h) => h.tag === 'path' && h.points.length === 3 && !h.closed);
    expect(v, 'an open arrow at the end').toBeTruthy();
    const [arm1, tip, arm2] = v.points;
    const arm = Math.hypot(arm1.x - tip.x, arm1.y - tip.y);
    expect(arm).toBeCloseTo(8 * first.width, 1);
    expect(Math.hypot(arm2.x - tip.x, arm2.y - tip.y)).toBeCloseTo(8 * first.width, 1);
    expect(Math.abs(first.x2 - tip.x)).toBeLessThan(0.01);
    expect(first.heads.length, 'no head at the start').toBe(1);

    // Start takes a closed arrow: the arrow just drawn (still picked) and the
    // tool both take it, so the next arrow carries both heads.
    await pill.click();
    const picker = endings(page);
    await expect(picker.locator('.line-endings__row [data-line-ending]')).toHaveCount(5);
    await picker.getByRole('button', { name: 'All endings' }).click();
    await expect(picker.locator('.line-endings__grid [data-line-ending]')).toHaveCount(10);
    expect(await picker.locator('.line-endings__grid [data-line-ending]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
      'None', 'Slash', 'Square', 'Open arrow', 'Reverse open arrow', 'Circle', 'Closed arrow', 'Reverse closed arrow', 'Diamond', 'Butt',
    ]);
    await picker.locator('[data-line-ending-side="start"]').click();
    await picker.locator('.line-endings__grid [data-line-ending="solidTriangle"]').click();
    await expect(picker.locator('.line-endings__grid [data-line-ending="solidTriangle"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await drag(page, box, 100, 300, 300, 300);
    await expect(marks).toHaveCount(2);
    const second = await readLine(marks.nth(1));
    const filled = second.heads.find((h) => h.closed && h.fill && h.fill !== 'none');
    expect(filled, 'a filled closed arrow at the start').toBeTruthy();
    const xs = filled.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6.2 * second.width, 1);

    // Pick the first arrow and give its end a diamond, then Undo.
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(pill).toBeVisible();
    await pill.click();
    await endings(page).locator('[data-line-ending-side="end"]').click();
    await endings(page).getByRole('button', { name: 'All endings' }).click();
    await endings(page).locator('.line-endings__grid [data-line-ending="diamond"]').click();
    await expect.poll(async () => (await readLine(marks.first())).heads.some((h) => h.closed && h.points.length === 4)).toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await readLine(marks.first())).heads.some((h) => h.points.length === 3 && !h.closed)).toBe(true);

    // A Line starts with no heads.
    await page.keyboard.press('l');
    await drag(page, box, 100, 420, 300, 420);
    await expect(marks).toHaveCount(3);
    expect((await readLine(marks.nth(2))).heads).toHaveLength(0);
  } finally {
    await sheet.remove();
  }
});

test('without the flag the Arrow keeps the arrow ends pill and its filled head', async ({ page }) => {
  test.setTimeout(150_000);
  await flagOn(page, false);
  const sheet = await seedSheet('Line endings off');
  try {
    const { box, marks } = await openSheet(page, sheet);
    await page.keyboard.press('a');
    await expect(page.getByRole('button', { name: 'Arrow ends', exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Endings', exact: true })).toHaveCount(0);
    await drag(page, box, 100, 200, 300, 200);
    await expect(marks).toHaveCount(1);
    expect(await marks.first().locator('polygon').count()).toBeGreaterThan(0);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`line endings, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("the Arrow's settings sheet holds the Start | End grid and keeps the pick", async ({ page }) => {
      test.setTimeout(150_000);
      await flagOn(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Line endings ${layout.native ? 'app' : 'web'}`);
      try {
        await openSheet(page, sheet, { tap: true });
        await page.getByRole('button', { name: 'Shapes', exact: true }).filter({ visible: true }).first().tap();
        await page.getByRole('button', { name: 'Arrow', exact: true }).filter({ visible: true }).last().tap();
        await page.getByRole('button', { name: 'More Arrow settings' }).filter({ visible: true }).first().tap();
        const picker = endings(page);
        await expect(picker).toBeVisible();
        await expect(picker.locator('.line-endings__row [data-line-ending="vShape"]')).toHaveAttribute('aria-pressed', 'true');
        const pickerBox = await picker.boundingBox();
        expect(pickerBox.x).toBeGreaterThanOrEqual(0);
        expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(390);
        await picker.locator('[data-line-ending-side="start"]').tap();
        await picker.getByRole('button', { name: 'All endings' }).tap();
        await picker.locator('.line-endings__grid [data-line-ending="horizontalLine"]').tap();
        await expect(picker.locator('.line-endings__grid [data-line-ending="horizontalLine"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('survey.lineEndings')).arrow)).toEqual({ start: 'horizontalLine', end: 'vShape' });
      } finally {
        await sheet.remove();
      }
    });
  });
}
