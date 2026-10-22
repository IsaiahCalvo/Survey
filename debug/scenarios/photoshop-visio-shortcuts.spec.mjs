/**
 * Owner 2026-10-22: Photoshop's on-page brush drag and Visio's Ctrl + drag to
 * copy, driven in the real app through the dev `?testPdf=` route.
 *
 *   1. Pen armed, Alt + right-drag to the right: a preview dot with the
 *      values shows, nothing is drawn, no right-click menu opens, and the
 *      toolbar Width goes up. Up / down then changes the opacity.
 *   2. Ctrl + Alt + left-drag (the Mac keys) does the same.
 *   3. Rectangle Select, a picked stroke dragged with Ctrl held: the stroke
 *      stays and a copy lands where it was dropped; while dragging, the
 *      original is still drawn in place.
 *   4. A plain drag still moves (no copy); Ctrl let go before the drop moves.
 *   5. Ctrl + drag on a mark that is not picked copies it too; Undo removes
 *      the copy.
 */

import { test, expect } from '@playwright/test';

const TEST_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

function collectConsoleErrors(page) {
  const errors = [];
  const benign = [/DevTools/i, /favicon/i, /React does not recognize/i];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !benign.some((p) => p.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  return errors;
}

const markCount = (page) => page.evaluate((sel) => (
  document.querySelectorAll(`${sel} [data-annotation-index]`).length
), PAGE);

const markBoxes = (page) => page.evaluate((sel) => (
  Array.from(document.querySelectorAll(`${sel} [data-annotation-index]`)).map((el) => {
    const r = el.getBoundingClientRect();
    return { index: Number(el.getAttribute('data-annotation-index')), x: r.x, y: r.y, w: r.width, h: r.height };
  })
), PAGE);

const widthLabel = (page) => page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('[aria-label]'))
    .find((node) => /^(Width|Size): /.test(node.getAttribute('aria-label') || ''));
  return el ? el.getAttribute('aria-label') : null;
});

async function drawStroke(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(x + i * 12, y + Math.sin(i) * 10);
  await page.mouse.up();
}

test('Photoshop brush drag and Visio copy-drag', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(TEST_PDF);
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(5000);
  const page1 = page.locator(PAGE);
  await expect(page1).toBeVisible({ timeout: 15_000 });
  const box = await page1.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(box.height / 2, 300);

  // ── 1. Pen + Alt + right-drag ──
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.waitForTimeout(800);
  const strokeX = cx - 150;
  const strokeY = cy - 120;
  // A point ON the stroke (a press beside a thin stroke misses it).
  const onStroke = (dx = 0, dy = 0) => ({ x: strokeX + 48 + dx, y: strokeY + Math.sin(4) * 10 + dy });
  await drawStroke(page, strokeX, strokeY);
  await expect.poll(() => markCount(page), { timeout: 10_000 }).toBe(1);
  const widthBefore = await widthLabel(page);

  await page.mouse.move(cx, cy);
  await page.keyboard.down('Alt');
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(cx + i * 10, cy + 1);
  const hud = page.locator('[data-brush-adjust-hud]');
  await expect(hud).toHaveCount(1);
  const hudText = await hud.textContent();
  await page.screenshot({ path: 'debug/out/brush-adjust-hud.png' }).catch(() => {});
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Alt');
  await expect(hud).toHaveCount(0);
  const widthAfter = await widthLabel(page);
  expect(hudText).toMatch(/Width [\d.]+ pt · Opacity \d+%/);
  expect(widthAfter, `width ${widthBefore} -> ${widthAfter}`).not.toBe(widthBefore);
  expect(await markCount(page), 'the gesture never draws a stroke').toBe(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'debug/out/brush-adjust-after.png' }).catch(() => {});
  expect(await page.locator('[role="menu"]:visible').count(), 'no right-click menu').toBe(0);

  // Up = more solid, down = more see-through.
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Alt');
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(cx + 1, cy + i * 8);
  const downText = await hud.textContent();
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Alt');
  expect(downText).toMatch(/Opacity (\d+)%/);
  expect(Number(/Opacity (\d+)%/.exec(downText)[1])).toBeLessThan(100);

  // ── 2. Mac keys: Ctrl + Alt + left-drag ──
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(cx - i * 10, cy + 1);
  await expect(hud).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  expect(await markCount(page), 'the Mac keys never draw either').toBe(1);

  // ── 3. Select the stroke, Ctrl + drag = copy ──
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
  await page.waitForTimeout(500);
  const [stroke] = await markBoxes(page);
  const { x: sx, y: sy } = onStroke();
  await page.mouse.click(sx, sy);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'debug/out/copy-drag-picked.png' }).catch(() => {});
  await page.keyboard.down('Control');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(sx + i * 8, sy + i * 6);
  // While dragging: the original is still drawn where it is.
  await page.screenshot({ path: 'debug/out/copy-drag-midway.png' }).catch(() => {});
  expect(await page.locator(`${PAGE} [data-copy-drag-original="true"]`).count()).toBeGreaterThan(0);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect.poll(() => markCount(page), { timeout: 5_000 }).toBe(2);
  const afterCopy = await markBoxes(page);
  const stayed = afterCopy.find((b) => Math.abs(b.x - stroke.x) < 2 && Math.abs(b.y - stroke.y) < 2);
  const copied = afterCopy.find((b) => Math.abs(b.x - (stroke.x + 80)) < 6 && Math.abs(b.y - (stroke.y + 60)) < 6);
  expect(stayed, 'the original stays put').toBeTruthy();
  expect(copied, `the copy lands where it was dropped: ${JSON.stringify(afterCopy)}`).toBeTruthy();

  // ── 4. A plain drag of the (picked) copy moves it, no new mark ──
  const { x: cx2, y: cy2 } = onStroke(80, 60);
  await page.mouse.move(cx2, cy2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(cx2 + i * 6, cy2);
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await markCount(page), 'a plain drag moves').toBe(2);

  // Ctrl let go before the drop = a move.
  const moved = (await markBoxes(page)).find((b) => Math.abs(b.x - (copied.x + 36)) < 6);
  expect(moved, 'the copy moved 36 px').toBeTruthy();
  await page.keyboard.down('Control');
  const m = onStroke(116, 60);
  await page.mouse.move(m.x, m.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(m.x, m.y + i * 6);
  await page.keyboard.up('Control');
  await page.mouse.move(m.x, m.y + 40);
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await markCount(page), 'Ctrl let go before the drop moves').toBe(2);

  // ── 5. Ctrl + drag on a mark that is not picked copies it ──
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const { x: ox, y: oy } = onStroke();
  await page.keyboard.down('Control');
  await page.mouse.move(ox, oy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(ox, oy + i * 12);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect.poll(() => markCount(page), { timeout: 5_000 }).toBe(3);

  await page.keyboard.press('Control+z');
  await expect.poll(() => markCount(page), { timeout: 5_000 }).toBe(2);

  expect(errors, errors.join(' | ')).toEqual([]);
});
