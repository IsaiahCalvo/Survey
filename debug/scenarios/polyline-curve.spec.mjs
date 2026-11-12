import { test, expect } from '@playwright/test';

// Curved polyline (Nightly flag 'spline-polyline', owner 2026-10-26): the
// Curve switch bends new polylines through their clicked corners; handles
// stay on the corners; "+" adds a corner on the curve; the switch turns a
// picked polyline straight again.

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) ? route.continue() : route.abort());
  await page.addInitScript(() => { try { if (localStorage.getItem('survey.flag.spline-polyline') == null) localStorage.setItem('survey.flag.spline-polyline', '1'); } catch { /* blocked */ } });
  await page.goto('/?testPdf=order-pages.pdf');
  await expect(page.locator('.survey-pdfjs-page-div').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1000);
});

const vertexHandles = '[data-svg-annotation-layer="1"] circle[data-poly-vertex-index][stroke="#4a90e2"]';
// A curved polyline draws as true cubics (`M x y C ...`, owner 2026-11-12:
// no corners when bent). Its stored points are the cubics at t = k / 12, so
// both helpers read the path back into those samples.
const readShapePoints = (page) => page.locator('[data-svg-annotation-layer="1"] [data-shape-kind="polyline"]').first().evaluate((node) => {
  const geo = node.matches('polyline,path') ? node : node.querySelector('polyline,path');
  if (geo.tagName === 'polyline') return Array.from({ length: geo.points.numberOfItems }, (_, i) => { const p = geo.points.getItem(i); return [p.x, p.y]; });
  const nums = (geo.getAttribute('d').match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
  let from = [nums[0], nums[1]];
  const out = [from];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const c1 = [nums[i], nums[i + 1]]; const c2 = [nums[i + 2], nums[i + 3]]; const to = [nums[i + 4], nums[i + 5]];
    for (let k = 1; k <= 12; k += 1) {
      const t = k / 12; const mt = 1 - t;
      const at = (j) => mt ** 3 * from[j] + 3 * mt * mt * t * c1[j] + 3 * mt * t * t * c2[j] + t ** 3 * to[j];
      out.push([at(0), at(1)]);
    }
    from = to;
  }
  return out;
});
const shapePointCount = async (page) => (await readShapePoints(page)).length;

test('Curve bends a new polyline through its corners and can be turned off', async ({ page }) => {
  await page.keyboard.press('k');
  const curve = page.getByRole('switch', { name: 'Curve', exact: true });
  await expect(curve).toBeVisible();
  await expect(curve).toHaveAttribute('aria-checked', 'false');
  await curve.click();
  await expect(curve).toHaveAttribute('aria-checked', 'true');

  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  const width = Math.min(box.width, 600), height = Math.min(box.height, 800);
  const corners = [[0.2, 0.3], [0.4, 0.2], [0.6, 0.35], [0.75, 0.25]];
  for (const [x, y] of corners) await page.mouse.click(box.x + width * x, box.y + height * y);
  await page.keyboard.press('Enter');
  await page.screenshot({ path: 'test-results/polyline-curve-drawn.png' });

  // The drawn line holds the curve (3 spans x 12 samples + 1).
  await expect.poll(() => shapePointCount(page)).toBe(37);
  await page.keyboard.press('v');
  await expect(page.locator(vertexHandles)).toHaveCount(4);
  await expect(page.locator('[data-add-vertex]')).toHaveCount(3);

  // "+" adds a corner on the curve; Undo takes it back.
  const plus = await page.locator('[data-add-vertex="1"]').boundingBox();
  await page.mouse.move(plus.x + plus.width / 2, plus.y + plus.height / 2);
  await page.mouse.down();
  await page.mouse.move(plus.x + plus.width / 2, plus.y + plus.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(vertexHandles)).toHaveCount(5);
  await expect.poll(() => shapePointCount(page)).toBe(49);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator(vertexHandles)).toHaveCount(4);

  // Dragging a corner keeps the curve whole.
  const corner = await page.locator(vertexHandles).nth(2).boundingBox();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 + 30, corner.y + corner.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => shapePointCount(page)).toBe(37);
  await expect(page.locator(vertexHandles)).toHaveCount(4);
  await page.screenshot({ path: 'test-results/polyline-curve-edited.png' });

  // With the polyline picked, the switch shows it is curved and straightens it.
  const pickedCurve = page.getByRole('switch', { name: 'Curve', exact: true });
  await expect(pickedCurve).toHaveAttribute('aria-checked', 'true');
  await pickedCurve.click();
  await expect.poll(() => shapePointCount(page)).toBe(4);
  await expect(pickedCurve).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator(vertexHandles)).toHaveCount(4);
});

const pathPoints = readShapePoints;

test('Shift on a picked curve shows its handles; dragging one bends that span (Takeoff)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.keyboard.press('k');
  await page.getByRole('switch', { name: 'Curve', exact: true }).click();
  const box = await page.locator('[data-svg-annotation-layer="1"]').boundingBox();
  const width = Math.min(box.width, 600), height = Math.min(box.height, 800);
  for (const [x, y] of [[0.2, 0.3], [0.4, 0.2], [0.6, 0.35], [0.75, 0.25]]) await page.mouse.click(box.x + width * x, box.y + height * y);
  await page.keyboard.press('Enter');
  await expect.poll(() => shapePointCount(page)).toBe(37);
  await page.keyboard.press('v');
  await expect(page.locator(vertexHandles)).toHaveCount(4);

  // No handles until Shift is held; then two per span (3 spans).
  const handles = page.locator('circle[data-curve-handle]');
  await expect(handles).toHaveCount(0);
  await page.keyboard.down('Shift');
  await expect(handles).toHaveCount(6);
  await page.screenshot({ path: 'test-results/polyline-curve-handles.png' });

  const before = await pathPoints(page);
  const h = await page.locator('circle[data-curve-handle="1-c1"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 80, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(handles).toHaveCount(0);
  await page.screenshot({ path: 'test-results/polyline-curve-bent.png' });

  const after = await pathPoints(page);
  expect(after.length).toBe(before.length);
  // Span 2 keeps its shape; span 1 dips toward the drag.
  const moved = (i) => Math.hypot(after[i][0] - before[i][0], after[i][1] - before[i][1]);
  for (let i = 24; i < after.length; i += 1) expect(moved(i)).toBeLessThan(0.6);
  // Corner 1 stays smooth (owner 2026-11-12): span 0 turns with it, no kink.
  const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = Math.abs(heading(after[11], after[12]) - heading(after[12], after[13]));
  expect(Math.min(turn, 2 * Math.PI - turn)).toBeLessThan(0.35);
  expect(Math.max(...after.slice(13, 24).map((_, k) => moved(13 + k)))).toBeGreaterThan(8);
  expect(after[15][1]).toBeGreaterThan(before[15][1]);

  // A corner drag keeps the hand-set bend (the curve is not smoothed again).
  const bentMid = after[18];
  const corner = await page.locator(vertexHandles).nth(3).boundingBox();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 + 30, corner.y + corner.height / 2 - 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await pathPoints(page)).length).toBe(37);
  const afterCorner = await pathPoints(page);
  expect(Math.hypot(afterCorner[18][0] - bentMid[0], afterCorner[18][1] - bentMid[1])).toBeLessThan(0.6);

  // Undo twice: back to the smooth curve.
  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
  await page.keyboard.press(undo);
  await page.keyboard.press(undo);
  await expect.poll(async () => {
    const pts = await pathPoints(page);
    return Math.max(...pts.map((p, i) => Math.hypot(p[0] - before[i][0], p[1] - before[i][1])));
  }).toBeLessThan(0.6);
  expect(errors).toEqual([]);
});

test('Curve stays hidden without the Nightly flag', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('survey.flag.spline-polyline', '0'));
  await page.reload();
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.keyboard.press('k');
  await expect(page.getByRole('switch', { name: 'Curve', exact: true })).toHaveCount(0);
});
