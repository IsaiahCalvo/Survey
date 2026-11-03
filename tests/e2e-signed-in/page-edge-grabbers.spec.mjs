// Owner 2026-11-02: a picked shape near the top of the page had its rotate
// grabber cut off by the page edge. Copy Drawboard (utils/pageEdgeRules.js):
// - grabbers draw past the page edge and can be grabbed there;
// - drawing a shape stops at the page edge;
// - resizing stops at the page edge;
// - the marks themselves are still clipped to the page.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const LAYER = 'svg[data-svg-annotation-layer="1"]';
const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);

async function newMark(page, draw) {
  const before = new Set(await markIds(page));
  await draw();
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  return (await markIds(page)).find((id) => !before.has(id));
}

// The mark's drawn shape on the page, in page units (the layer's viewBox).
const shapeBox = (page, id) => page.evaluate(({ markId, layer }) => {
  const svg = document.querySelector(layer);
  const el = svg.querySelector(`[data-annotation-id="${markId}"] rect, [data-annotation-id="${markId}"] path`);
  const s = svg.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = svg.viewBox.baseVal.width / s.width;
  return { left: (r.left - s.left) * k, top: (r.top - s.top) * k, width: r.width * k, height: r.height * k };
}, { markId: id, layer: LAYER });

async function drawBox(page, from, to) {
  return newMark(page, async () => {
    await page.keyboard.press('r');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  });
}

async function deleteSelected(page, id) {
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-overlay-page="1"] [data-annotation-id="${id}"]`)).toHaveCount(0);
  await page.waitForTimeout(600);
}

test('a shape near the top keeps its rotate grabber past the page edge, seen and grabbable', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const box = await page.locator(PAGE).boundingBox();
  const x0 = box.x + box.width * 0.4;
  const y0 = box.y + 26;
  const id = await drawBox(page, { x: x0, y: y0 }, { x: x0 + 160, y: y0 + 90 });
  await page.keyboard.press('v');
  await page.mouse.click(x0, y0 + 45);
  const mtr = page.locator(`${LAYER} [data-rotation-handle="mtr"] circle`).last();
  await expect(mtr).toBeVisible();
  const g = await mtr.boundingBox();
  const centre = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  expect(centre.y, 'the grabber sits above the page edge').toBeLessThan(box.y);

  // Nothing clips it: the browser finds the grabber under its own centre.
  const hit = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest?.('[data-rotation-handle="mtr"]')), centre);
  expect(hit, 'the grabber past the edge is hit-testable').toBe(true);

  // Grab it there and turn the shape a quarter.
  const before = await shapeBox(page, id);
  const mid = { x: x0 + 80, y: y0 + 45 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 60, mid.y - 30, { steps: 6 });
  await page.mouse.move(mid.x + 120, mid.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await shapeBox(page, id);
  // A wide box turned a quarter stands tall.
  expect(before.width, 'drawn wide').toBeGreaterThan(before.height);
  expect(after.height, 'the shape turned').toBeGreaterThan(after.width);
  await deleteSelected(page, id);
});

test('drawing and resizing stop at the page edge; the mark stays clipped to the page', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const box = await page.locator(PAGE).boundingBox();

  // Draw from inside the page up past its top edge: the box stops at the edge.
  const drawn = await drawBox(page, { x: box.x + 60, y: box.y + 120 }, { x: box.x + 150, y: box.y - 60 });
  const d = await shapeBox(page, drawn);
  expect(d.top, 'the drawn box stops at the top edge').toBeGreaterThanOrEqual(-0.5);
  expect(d.top).toBeLessThan(4);
  await deleteSelected(page, drawn);

  // Resize the top side of a box up past the edge: it stops at the edge.
  const x0 = box.x + box.width * 0.4;
  const y0 = box.y + 80;
  const id = await drawBox(page, { x: x0, y: y0 }, { x: x0 + 160, y: y0 + 90 });
  await page.keyboard.press('v');
  await page.mouse.click(x0, y0 + 45);
  const top = page.locator(`${LAYER} [data-resize-handle="mt"]`).last();
  await expect(top).toBeVisible();
  const t = await top.boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, box.y - 40, { steps: 6 });
  await page.mouse.move(t.x + t.width / 2, box.y - 120, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const r = await shapeBox(page, id);
  expect(r.top, 'the resized side stops at the top edge').toBeGreaterThanOrEqual(-0.5);
  expect(r.top).toBeLessThan(4);

  // The marks are still clipped to the page; the grabbers are not.
  const clip = await page.evaluate((sel) => {
    const svg = document.querySelector(sel);
    return {
      marks: svg.querySelector('[data-page-clip="marks"]')?.getAttribute('clip-path'),
      grabberClipped: Boolean(svg.querySelector('[data-resize-handle]')?.closest('[clip-path]')),
      lifted: getComputedStyle(svg.closest('.survey-pdfjs-page-div')).zIndex,
    };
  }, LAYER);
  expect(clip.marks).toMatch(/^url\(#svg-page-clip-1-/);
  expect(clip.grabberClipped).toBe(false);
  expect(clip.lifted, 'the picked page paints above its neighbours').toBe('50');
  await deleteSelected(page, id);
});
