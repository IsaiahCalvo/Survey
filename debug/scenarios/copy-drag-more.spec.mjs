/**
 * Owner 2026-10-22, Visio's Ctrl + drag to copy — the cases the first pass
 * left out, driven in the real app through the dev `?testPdf=` route:
 *
 *   1. A lone callout: Ctrl + drag on one that is not picked copies it, and
 *      Ctrl + drag inside a picked one's box copies it too.
 *   2. Across pages: a stroke Ctrl + dragged onto the next page is copied
 *      there and the original stays; letting go of Ctrl over the next page
 *      before the drop moves it there instead.
 *   3. A lone Survey Marker: Ctrl + drag copies it (a new survey item), the
 *      original drawn in place during the drag.
 */

import { test, expect } from '@playwright/test';

const TEST_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const pageSel = (n) => `.survey-pdfjs-page-div[data-page-number="${n}"]`;

function collectConsoleErrors(page) {
  const errors = [];
  const benign = [/DevTools/i, /favicon/i, /React does not recognize/i];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !benign.some((p) => p.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  return errors;
}

const markCount = (page, n) => page.evaluate((sel) => (
  document.querySelectorAll(`${sel} [data-annotation-index]`).length
), pageSel(n));

const calloutIds = (page) => page.evaluate(() => [...new Set(
  Array.from(document.querySelectorAll('[data-callout-id]')).map((el) => el.getAttribute('data-callout-id')),
)]);

async function openTestPdf(page) {
  await page.goto(TEST_PDF);
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(4000);
  await expect(page.locator(pageSel(1))).toBeVisible({ timeout: 15_000 });
}

async function pickSelect(page) {
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).first().click();
  await page.waitForTimeout(300);
}

async function ctrlDrag(page, x, y, dx, dy, { releaseCtrlBeforeDrop = false } = {}) {
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
  if (releaseCtrlBeforeDrop) {
    await page.keyboard.up('Control');
    await page.mouse.up();
  } else {
    await page.mouse.up();
    await page.keyboard.up('Control');
  }
  await page.waitForTimeout(400);
}

test('Ctrl + drag copies a lone callout', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openTestPdf(page);
  const box = await page.locator(pageSel(1)).boundingBox();
  await page.keyboard.press('q');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 260, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await calloutIds(page)).length, { timeout: 10_000 }).toBe(1);
  await page.keyboard.type('Note');
  await page.waitForTimeout(200);
  await pickSelect(page);
  // Click empty paper: the text is put away and nothing stays picked.
  await page.mouse.click(box.x + 60, box.y + box.height - 40);
  await page.waitForTimeout(300);

  // Not picked: Ctrl + drag on its text box copies it.
  const [firstId] = await calloutIds(page);
  const textBox = page.locator(`[data-callout-id="${firstId}"] [data-callout-part="textBox"]`).first();
  const tb = await textBox.boundingBox();
  await ctrlDrag(page, tb.x + tb.width / 2, tb.y + tb.height / 2, 60, 140);
  await expect.poll(async () => (await calloutIds(page)).length, { timeout: 5_000 }).toBe(2);
  const tbAfter = await textBox.boundingBox();
  expect(Math.abs(tbAfter.x - tb.x) < 2 && Math.abs(tbAfter.y - tb.y) < 2, 'the original stays put').toBe(true);

  // Picked (the copy is picked now): Ctrl + drag inside its box copies again.
  const ids = await calloutIds(page);
  const copyId = ids.find((id) => id !== firstId);
  const copyBox = await page.locator(`[data-callout-id="${copyId}"] [data-callout-part="textBox"]`).first().boundingBox();
  await ctrlDrag(page, copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2, 120, 0);
  await expect.poll(async () => (await calloutIds(page)).length, { timeout: 5_000 }).toBe(3);

  // Ctrl let go before the drop: a move, no new callout.
  const third = (await calloutIds(page)).find((id) => !ids.includes(id));
  const thirdBox = await page.locator(`[data-callout-id="${third}"] [data-callout-part="textBox"]`).first().boundingBox();
  await ctrlDrag(page, thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height / 2, 0, 80, { releaseCtrlBeforeDrop: true });
  expect((await calloutIds(page)).length, 'Ctrl let go before the drop moves').toBe(3);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await calloutIds(page)).length, { timeout: 5_000 }).toBe(2);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Ctrl + drag copies a mark onto the next page', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openTestPdf(page);
  // Put the gap between pages 1 and 2 in the middle of the screen.
  await page.evaluate((sel) => {
    const p2 = document.querySelector(sel);
    let el = p2.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    const r = p2.getBoundingClientRect();
    (el || document.scrollingElement).scrollTop += r.top - window.innerHeight / 2;
  }, pageSel(2));
  await page.waitForTimeout(1500);
  const p1 = await page.locator(pageSel(1)).boundingBox();
  const p2 = await page.locator(pageSel(2)).boundingBox();
  expect(p2.y, 'page 2 starts on screen').toBeLessThan(page.viewportSize().height - 200);
  const base1 = await markCount(page, 1);
  const base2 = await markCount(page, 2);

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.waitForTimeout(500);
  const sx = p1.x + p1.width / 2 - 50;
  const sy = p1.y + p1.height - 90;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(sx + i * 12, sy + (i % 2) * 6);
  await page.mouse.up();
  await expect.poll(() => markCount(page, 1), { timeout: 10_000 }).toBe(base1 + 1);
  // A point ON the stroke: where it started (round cap).
  const grab = { x: sx + 1, y: sy };

  await pickSelect(page);
  // Copy: Ctrl down at the drop, over page 2.
  await page.mouse.move(grab.x, grab.y);
  await page.keyboard.down('Control');
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(grab.x, grab.y + i * 22);
  // While over page 2 the original is still drawn on page 1.
  await page.screenshot({ path: 'debug/out/copy-drag-cross-page.png' }).catch(() => {});
  expect(await page.locator(`${pageSel(1)} [data-copy-drag-original="true"]`).count()).toBeGreaterThan(0);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect.poll(() => markCount(page, 2), { timeout: 5_000 }).toBe(base2 + 1);
  expect(await markCount(page, 1), 'the original stays on page 1').toBe(base1 + 1);

  // Ctrl let go over page 2 before the drop: the original moves there.
  await ctrlDrag(page, grab.x, grab.y, 0, 22 * 12, { releaseCtrlBeforeDrop: true });
  await page.screenshot({ path: 'debug/out/copy-drag-cross-page-move.png' }).catch(() => {});
  await expect.poll(async () => [await markCount(page, 1), await markCount(page, 2)], { timeout: 5_000 }).toEqual([base1, base2 + 2]);
  expect(await markCount(page, 1), 'moved off page 1').toBe(base1);

  expect(errors, errors.join(' | ')).toEqual([]);
});

test('Ctrl + drag copies a lone Survey Marker', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = collectConsoleErrors(page);
  await page.goto(`/?testPdf=${encodeURIComponent('print-fidelity.pdf')}&surveyTransitionE2E=1`);
  await page.locator(pageSel(1)).waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  const chooser = page.getByRole('heading', { name: /Choose (a )?survey template/ });
  await chooser.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  if (await chooser.count()) await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  // Its first module is open; the Walls category arms the marker tool.
  await page.getByRole('button', { name: /^Walls \d+$/ }).click();

  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  const sx = box.width / 612;
  const sy = box.height / 792;
  await page.mouse.move(box.x + 60 * sx, box.y + 120 * sy);
  await page.mouse.down();
  await page.mouse.move(box.x + 200 * sx, box.y + 200 * sy, { steps: 12 });
  await page.mouse.up();
  // It takes the next default name; a naming box, if any, is just closed.
  await page.keyboard.press('Enter').catch(() => {});
  const markers = () => layer.locator('[data-survey-marker-id]').evaluateAll((nodes) => (
    [...new Set(nodes.map((n) => n.getAttribute('data-survey-marker-id')))]
  ));
  await expect.poll(async () => (await markers()).length, { timeout: 10_000 }).toBe(1);

  await pickSelect(page);
  const cx = box.x + 130 * sx;
  const cy = box.y + 160 * sy;
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Control');
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(cx + i * 10, cy + i * 20);
  await page.screenshot({ path: 'debug/out/copy-drag-marker.png' }).catch(() => {});
  expect(await layer.locator('[data-copy-drag-original="true"]').count(), 'original drawn in place').toBeGreaterThan(0);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect.poll(async () => (await markers()).length, { timeout: 10_000 }).toBe(2);
  expect(errors, errors.join(' | ')).toEqual([]);
  await page.close();
});
