import { expect, test } from '@playwright/test';

const SCROLLER = '.survey-pdfjs-viewer[id^="pdfjs-pdf-viewer"]';
const scrollState = page => page.locator(SCROLLER).evaluate(node => [node.scrollLeft, node.scrollTop]);
const railFor = (page, axis) => page.getByLabel(`Viewport ${axis} scroll bar`);
async function thumbState(page, axis) {
  return railFor(page, axis).getByLabel('Scrollbar shuttle').evaluate(node => {
    const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
  });
}

test('visible and faded edge bands pass drawing, selection, wheel and zoom to the page', async ({ page }) => {
  await page.goto('/?testPdf=e2e/prog-01-drawing-markup.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.locator('[data-shape-kind]').first().waitFor();
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForTimeout(500);
  const viewport = await page.locator(SCROLLER).boundingBox();
  for (const axis of ['vertical', 'horizontal']) for (const visible of [true, false]) {
    await page.keyboard.press('p');
    await page.mouse.move(700, 400);
    await page.locator(SCROLLER).evaluate(node => node.dispatchEvent(new Event('scroll')));
    if (!visible) await expect(railFor(page, axis)).toHaveCSS('opacity', '0');
    const start = axis === 'vertical' ? { x: viewport.x + viewport.width - 4, y: 400 }
      : { x: 700, y: viewport.y + viewport.height - 4 };
    const before = await scrollState(page);
    const marks = page.locator('[data-annotation-index]');
    const count = await marks.count();
    await page.mouse.move(start.x, start.y);
    if (visible) await expect(railFor(page, axis)).toHaveCSS('opacity', '1');
    await page.mouse.down();
    await page.mouse.move(start.x + (axis === 'horizontal' ? 100 : 0), start.y + (axis === 'vertical' ? 100 : 0), { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => marks.count()).toBeGreaterThan(count);
    expect(await scrollState(page)).toEqual(before);
    await page.keyboard.press('v');
    await page.locator(SCROLLER).evaluate(node => node.dispatchEvent(new Event('scroll')));
    if (!visible) await expect(railFor(page, axis)).toHaveCSS('opacity', '0');
    await page.mouse.click(start.x + (axis === 'horizontal' ? 50 : 0), start.y + (axis === 'vertical' ? 50 : 0));
    await expect(page.locator('.svg-selection-overlay').first()).toBeVisible();
    expect(await scrollState(page)).toEqual(before);
    await page.mouse.move(start.x, start.y);
    await page.mouse.wheel(0, 40);
    await expect.poll(() => scrollState(page)).not.toEqual(before);
    const zoom = await page.getByLabel('Edit zoom percentage').textContent();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -30);
    await page.keyboard.up('Control');
    await expect.poll(() => page.getByLabel('Edit zoom percentage').textContent()).not.toBe(zoom);
    await page.waitForTimeout(500);
  }
});

test('thumb hover, motionless release and regrab stay active; rail wheel listeners do not churn', async ({ page }) => {
  await page.addInitScript(() => {
    window.__railWheelBindings = { add: 0, remove: 0 };
    for (const [method, key] of [['addEventListener', 'add'], ['removeEventListener', 'remove']]) {
      const original = EventTarget.prototype[method];
      EventTarget.prototype[method] = function(type, ...args) {
        if (type === 'wheel' && this.getAttribute?.('aria-label')?.startsWith('Viewport ')) window.__railWheelBindings[key]++;
        return original.call(this, type, ...args);
      };
    }
  });
  await page.goto('/?testPdf=spike-120-pages.pdf');
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.getByRole('button', {name: 'Draw', exact: true}).waitFor();
  await page.waitForTimeout(1200);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await scrollState(page))[1]).toBeGreaterThanOrEqual(399);
  const rail = railFor(page, 'vertical');
  await expect(rail).toHaveCSS('opacity', '1');
  let thumb = await thumbState(page, 'vertical');
  await page.mouse.move(thumb.x, thumb.y);
  await page.waitForTimeout(1100);
  expect((await thumbState(page, 'vertical')).width).toBeGreaterThanOrEqual(5.5);
  await expect(rail).toHaveCSS('opacity', '1');
  const bindings = await page.evaluate(() => window.__railWheelBindings);
  await page.mouse.down();
  await page.mouse.move(thumb.x, thumb.y + 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await expect(rail).toHaveCSS('opacity', '1');
  expect((await thumbState(page, 'vertical')).width).toBeGreaterThanOrEqual(5.5);
  const first = await scrollState(page);
  await page.mouse.down();
  await page.mouse.move(thumb.x, thumb.y + 80, { steps: 8 });
  await page.mouse.up();
  expect((await scrollState(page))[1]).toBeGreaterThan(first[1]);
  expect(await page.evaluate(() => window.__railWheelBindings)).toEqual(bindings);
  thumb = await thumbState(page, 'vertical');
  await page.mouse.move(thumb.x, thumb.y);
  const beforeWheel = await scrollState(page);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => scrollState(page)).not.toEqual(beforeWheel);
  for (const modifier of ['Control', 'Meta']) {
    thumb = await thumbState(page, 'vertical');
    await page.mouse.move(thumb.x, thumb.y);
    const zoom = await page.getByLabel('Edit zoom percentage').textContent();
    await page.keyboard.down(modifier);
    await page.mouse.wheel(0, -100);
    await page.keyboard.up(modifier);
    await expect.poll(() => page.getByLabel('Edit zoom percentage').textContent()).not.toBe(zoom);
  }
  await page.mouse.move(700, 450);
  await expect(rail).toHaveCSS('opacity', '0');
});

for (const delay of [701, 760, 820, 950]) {
  test(`pen press on thumb ${delay}ms after scroll respects its painted lifetime`, async ({ page }) => {
    await page.goto('/?testPdf=e2e/prog-01-drawing-markup.pdf');
    await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
    await page.locator('[data-shape-kind]').first().waitFor();
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForTimeout(600);
    await page.keyboard.press('p');
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(100);
    const thumb = await thumbState(page, 'vertical');
    const before = await scrollState(page);
    const marks = page.locator('[data-annotation-index]');
    const count = await marks.count();
    // Start the hold in the page, so setup and locator reads do not consume it.
    await page.locator(SCROLLER).evaluate(async (node, delay) => {
      node.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => setTimeout(resolve, delay));
    }, delay);
    const opacity = await railFor(page, 'vertical').evaluate(node => Number(getComputedStyle(node).opacity));
    if (delay < 900) expect(opacity).toBeGreaterThan(0);
    else expect(opacity).toBe(0);
    await page.mouse.move(thumb.x, thumb.y);
    await page.mouse.down();
    await page.mouse.move(thumb.x, thumb.y + 40, { steps: 6 });
    await page.mouse.up();
    if (delay < 900) {
      await expect.poll(() => scrollState(page)).not.toEqual(before);
      await expect(railFor(page, 'vertical')).toHaveCSS('opacity', '1');
      await page.waitForTimeout(350);
      expect(await marks.count()).toBe(count);
    } else {
      await expect.poll(() => marks.count()).toBeGreaterThan(count);
      expect(await scrollState(page)).toEqual(before);
    }
  });
}
