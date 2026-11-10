// Keys pressed while a picked mark is held mid-move or mid-resize wait for
// the release (R4-C K1, 2026-11-10). Before: Ctrl+Z took back a different
// mark and the release cleared Redo for good; Delete mid-resize threw
// "Cannot read properties of undefined (reading 'type')".
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.evaluate((sel) => [...new Set([...document.querySelectorAll(sel)]
  .map((el) => el.getAttribute('data-annotation-id')))].filter((x) => x && !x.startsWith('creation-preview')), MARKS);
const markBox = (page, id) => page.evaluate((markId) => {
  const r = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`)?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}, id);

async function drawRect(page, from, to) {
  await page.keyboard.press('r');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

test.use({ viewport: { width: 1400, height: 900 } });

test('Undo, Delete and Duplicate wait while a mark is held mid-drag', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  const sheet = await seedSheet('Keys during drag');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    await page.waitForTimeout(1200);
    const open = page.getByRole('button', { name: 'Open file' });
    if (await open.isVisible().catch(() => false)) await open.click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const box = await pageDiv.boundingBox();
    const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

    await pageDiv.click({ position: { x: 5, y: 5 } });
    await drawRect(page, at(0.2, 0.2), at(0.35, 0.35));
    await drawRect(page, at(0.6, 0.6), at(0.75, 0.75));
    await expect.poll(async () => (await markIds(page)).length).toBe(2);
    const [first, second] = await markIds(page);

    // Pick the first on its left outline, then hold a move from that outline.
    await page.keyboard.press('v');
    await page.waitForTimeout(300);
    const a = await markBox(page, first);
    const grab = { x: a.x + 1, y: a.y + a.height / 2 };
    await page.mouse.click(grab.x, grab.y);
    await expect(page.locator('[data-overlay-page="1"] .svg-selection-overlay').first()).toBeVisible();
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 60, grab.y + 40, { steps: 6 });
    await expect(page.locator('[data-selection-gesture="true"]').first()).toBeAttached();
    for (const key of ['Control+z', 'Delete', 'Control+d']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
    }
    await page.mouse.move(grab.x + 120, grab.y + 80, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    // Nothing was taken back, deleted or copied: both marks, the first moved.
    expect((await markIds(page)).sort()).toEqual([first, second].sort());
    const moved = await markBox(page, first);
    expect(moved.x - a.x).toBeGreaterThan(80);

    // One Undo takes back the move; the second mark stays.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Math.abs((await markBox(page, first)).x - a.x)).toBeLessThan(3);
    expect((await markIds(page)).length).toBe(2);

    // Delete while resizing from a side handle: held until release, no error.
    await page.mouse.click(a.x + 1, a.y + a.height / 2);
    await page.waitForTimeout(300);
    const handle = page.locator('[data-overlay-page="1"] [data-resize-handle="mr"]').first();
    await expect(handle).toBeVisible();
    {
      const h = await handle.boundingBox();
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + 60, h.y + h.height / 2, { steps: 6 });
      await page.keyboard.press('Delete');
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(400);
      expect((await markIds(page)).length).toBe(2);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await sheet.remove();
  }
});
