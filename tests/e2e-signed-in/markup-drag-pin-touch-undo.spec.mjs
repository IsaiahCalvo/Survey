// Per-frame checks for three drag reports (owner 2026-10-22):
// - a counter pin pressed on its tail moves (the turn grabber used to sit on
//   the tail, so that press turned the pin instead);
// - a finger that holds on a selected mark (menu) or whose touch the browser
//   cancels never leaves the mark drawn somewhere it was not saved;
// - after a move and Undo, Pan mode paints the pin back home.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);

/** The mark's box relative to the page (so a page pan does not count as a move). */
const markOffset = (page, id) => page.evaluate(([markId, pageSel]) => {
  const el = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`);
  const pageEl = document.querySelector(pageSel);
  if (!el || !pageEl) return null;
  const r = el.getBoundingClientRect();
  const p = pageEl.getBoundingClientRect();
  return { x: r.x - p.x, y: r.y - p.y, w: r.width, h: r.height };
}, [id, PAGE]);

/** Records the mark's page-relative box on every animation frame until stopped. */
const startFrameLog = (page, id) => page.evaluate(([markId, pageSel]) => {
  window.__frames = [];
  window.__sampling = true;
  const tick = () => {
    if (!window.__sampling) return;
    const el = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`);
    const pageEl = document.querySelector(pageSel);
    const r = el?.getBoundingClientRect();
    const p = pageEl?.getBoundingClientRect();
    window.__frames.push(r && p && r.width > 1 && r.height > 1 ? { x: r.x - p.x, y: r.y - p.y } : null);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, [id, PAGE]);
const stopFrameLog = (page) => page.evaluate(() => { window.__sampling = false; return window.__frames; });

async function placeCounter(page, fx, fy) {
  const box = await page.locator(PAGE).boundingBox();
  const before = new Set(await markIds(page));
  await page.keyboard.press('c');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  const id = (await markIds(page)).find((m) => !before.has(m));
  await page.keyboard.press('v');
  await page.waitForTimeout(800);
  // The number sits in the middle of the bubble.
  const centre = await page.evaluate((markId) => {
    const r = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] text`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  // A counter's radius is 14 page units.
  const radius = (14 * box.width) / 612;
  return { id, centre, radius };
}

async function deleteMark(page, id, at) {
  await page.keyboard.press('v');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-overlay-page="1"] [data-annotation-id="${id}"]`)).toHaveCount(0);
  await page.waitForTimeout(1500);
}

test('a counter pin pressed on its tail follows the mouse on every frame', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const { id, centre, radius } = await placeCounter(page, 0.85, 0.75);

  await page.mouse.click(centre.x, centre.y);
  const grabber = page.locator('[data-handle-hit-pad="counter-rotate"]');
  await expect(grabber).toBeVisible();
  const g = await grabber.boundingBox();
  const angle = Math.atan2(g.y + g.height / 2 - centre.y, g.x + g.width / 2 - centre.x);
  // On the tail: past the bubble (radius) and short of its tip (1.5 radii).
  const tail = { x: centre.x + Math.cos(angle) * radius * 1.3, y: centre.y + Math.sin(angle) * radius * 1.3 };
  const start = await markOffset(page, id);

  await startFrameLog(page, id);
  await page.mouse.move(tail.x, tail.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(tail.x + i * 5, tail.y + i * 3);
    await page.waitForTimeout(25);
  }
  const during = await markOffset(page, id);
  const frames = await stopFrameLog(page);
  await page.mouse.up();

  expect(frames.length).toBeGreaterThan(8);
  expect(frames.filter((f) => f === null).length, 'frames where the pin was not painted').toBe(0);
  expect(during.x - start.x, 'the pin followed the pointer right').toBeGreaterThan(60 - 8);
  expect(during.y - start.y, 'the pin followed the pointer down').toBeGreaterThan(36 - 8);
  await expect.poll(async () => (await markOffset(page, id)).x - start.x).toBeGreaterThan(60 - 8);

  // The turn grabber still turns the pin in place.
  const moved = await markOffset(page, id);
  const g2 = await grabber.boundingBox();
  // A point of the grabber the selection's quick bar does not cover.
  const [gx, gy] = await page.evaluate(({ x, y, width, height }) => {
    for (let dy = 0.5; dy < 1; dy += 0.1) {
      for (const dx of [0.5, 0.3, 0.7, 0.2, 0.8]) {
        const px = x + width * dx;
        const py = y + height * dy;
        if (document.elementFromPoint(px, py)?.closest?.('[data-counter-rotate-grabber]')) return [px, py];
      }
    }
    return [x + width / 2, y + height / 2];
  }, g2);
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 60, gy + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const g3 = await grabber.boundingBox();
  expect(Math.hypot(g3.x - g2.x, g3.y - g2.y), 'the grabber swung round').toBeGreaterThan(10);
  const turned = await markOffset(page, id);
  const centreShift = Math.hypot((turned.x + turned.w / 2) - (moved.x + moved.w / 2), (turned.y + turned.h / 2) - (moved.y + moved.h / 2));
  expect(centreShift, 'turning keeps the pin roughly in place').toBeLessThan(radius * 1.5);

  const at = await page.evaluate((markId) => {
    const r = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] text`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  await page.keyboard.press('Escape');
  await deleteMark(page, id, at);
});

test('after a move and Undo, Pan mode paints the pin back home on every frame', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const { id, centre } = await placeCounter(page, 0.15, 0.93);
  const home = await markOffset(page, id);

  await page.mouse.click(centre.x, centre.y);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 200, centre.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await markOffset(page, id)).x - home.x).toBeGreaterThan(180);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.abs((await markOffset(page, id)).x - home.x)).toBeLessThan(2);

  await startFrameLog(page, id);
  await page.keyboard.press('m');
  await page.waitForTimeout(400);
  const box = await page.locator(PAGE).boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5 - i * 6);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const frames = await stopFrameLog(page);

  expect(frames.length).toBeGreaterThan(8);
  const wrong = frames.filter((f) => !f || Math.abs(f.x - home.x) > 2 || Math.abs(f.y - home.y) > 2);
  expect(wrong.length, 'frames where the pin was not at home').toBe(0);

  await page.keyboard.press('v');
  const at = await page.evaluate((markId) => {
    const r = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] text`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  await deleteMark(page, id, at);
});

// The phone opens a document with one tap on its row.
async function openOnPhone(page) {
  await page.getByText('E2E Sample Drawing.pdf', { exact: true }).filter({ visible: true }).first().tap();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (await openFile.isVisible().catch(() => false)) await openFile.tap();
  await expect(page.locator(MARKS).first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(2000);
}

test.describe('phone finger on a selected pen stroke', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  for (const how of ['hold-then-drag', 'browser-cancels']) {
    test(`${how}: the stroke is never left drawn where it was not saved`, async ({ page }) => {
      await signIn(page, E2E_ACCOUNTS.owner);
      await openOnPhone(page);
      await page.getByRole('button', { name: 'Rectangle Select' }).tap();

      // The seeded purple pen stroke: a point halfway along its ink.
      const strokeId = '67R';
      const on = await page.evaluate((markId) => {
        const g = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`);
        const path = [...g.querySelectorAll('path')].find((p) => p.getTotalLength?.() > 50);
        const pt = path.getPointAtLength(path.getTotalLength() * 0.5);
        const m = path.getScreenCTM();
        return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
      }, strokeId);
      await page.touchscreen.tap(on.x, on.y);
      await page.waitForTimeout(500);
      const home = await markOffset(page, strokeId);

      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
      });
      await startFrameLog(page, strokeId);
      await touch('touchStart', on.x, on.y);
      if (how === 'hold-then-drag') await page.waitForTimeout(600);
      for (let i = 1; i <= 12; i += 1) {
        await touch('touchMove', on.x + i * 4, on.y - i * 3);
        await page.waitForTimeout(30);
      }
      if (how === 'browser-cancels') await touch('touchCancel');
      else await touch('touchEnd');
      await page.waitForTimeout(800);
      const frames = await stopFrameLog(page);

      const away = (f) => !f || Math.abs(f.x - home.x) > 2 || Math.abs(f.y - home.y) > 2;
      if (how === 'hold-then-drag') {
        // Held still = the menu; the press is not a move.
        await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
        expect(frames.filter(away).length, 'frames where the held stroke moved').toBe(0);
        await page.keyboard.press('Escape');
      } else {
        // The browser took the touch: nothing is saved, and nothing stays moved.
        expect(frames.filter(away).length, 'the stroke did follow the finger first').toBeGreaterThan(0);
        expect(away(frames[frames.length - 1]), 'the stroke is back home once the touch is cancelled').toBe(false);
      }
      await page.reload();
      await openOnPhone(page);
      const saved = await markOffset(page, strokeId);
      expect(Math.abs(saved.x - home.x) + Math.abs(saved.y - home.y), 'the stroke was not saved moved').toBeLessThan(3);
    });
  }
});
