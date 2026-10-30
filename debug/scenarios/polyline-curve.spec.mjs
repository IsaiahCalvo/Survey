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
const shapePointCount = (page) => page.locator('[data-svg-annotation-layer="1"] [data-shape-kind="polyline"]').first().evaluate((node) => {
  const geo = node.matches('polyline,path') ? node : node.querySelector('polyline,path');
  if (geo.tagName === 'polyline') return geo.points.numberOfItems;
  return (geo.getAttribute('d').match(/[ML]/g) || []).length;
});

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

test('Curve stays hidden without the Nightly flag', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('survey.flag.spline-polyline', '0'));
  await page.reload();
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.keyboard.press('k');
  await expect(page.getByRole('switch', { name: 'Curve', exact: true })).toHaveCount(0);
});
