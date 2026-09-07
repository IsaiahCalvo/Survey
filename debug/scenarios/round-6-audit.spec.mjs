import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

const scroller = '.survey-pdfjs-viewer[id^="pdfjs-pdf-viewer"]';
async function open(page, fixture = 'e2e/prog-02-text-markup.pdf') {
  await page.goto(`/?testPdf=${fixture}&eraserLifecycleE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1200);
}
async function selectText(page) {
  await page.keyboard.press('Shift+v');
  const box = await page.locator('[data-pdf-annotation-id="9R"]').first().boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-text-selection-action-bar]')).toBeVisible();
}

test('equal trackpad travel gives equal live zoom for every trackpad event chunk size', async ({ page }) => {
  const ratios = [];
  for (const chunk of [4, 8, 16, 24, 48, 96, 192]) {
    await open(page, 'spike-120-pages.pdf');
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    const before = (await surface.boundingBox()).width;
    await page.locator(scroller).evaluate((node, chunk) => {
      // Open as trackpad, then undo the opener within this same gesture.
      for (const deltaY of [-4, 4]) node.dispatchEvent(new WheelEvent('wheel', {
        deltaY, ctrlKey: true, clientX: 700, clientY: 400, bubbles: true, cancelable: true,
      }));
      for (let total = 0; total < 192; total += chunk) node.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -Math.min(chunk, 192 - total), ctrlKey: true,
        clientX: 700, clientY: 400, bubbles: true, cancelable: true,
      }));
    }, chunk);
    await page.waitForTimeout(900);
    ratios.push((await surface.boundingBox()).width / before);
  }
  console.log(JSON.stringify({ chunks: [4, 8, 16, 24, 48, 96, 192], ratios }));
  expect(new Set(ratios).size).toBe(1);
  for (const ratio of ratios) expect(ratio).toBeCloseTo(Math.exp(0.0029 * 192), 2);
});

test('Text Select selects imported links and immediate Delete removes the clicked mark', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Shift+v');
  const link = page.locator('[data-text-markup-link]').first();
  const box = await link.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-text-range-handle-hit-target]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  const mark = page.locator('[data-pdf-annotation-id="9R"]').first();
  const markBox = await mark.boundingBox();
  await page.mouse.click(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2);
  // No sleep or wait-for-handles: the next key must work on the first click.
  await page.keyboard.press('Delete');
  await expect(mark).toHaveCount(0);
});

test('text toolbar matches the rail height and contains the full focus outline', async ({ page }) => {
  await open(page);
  await selectText(page);
  await page.getByRole('button', { name: 'Set Underline color', exact: true }).click();
  const geometry = await page.evaluate(() => {
    const toolbar = document.querySelector('.text-selection-action-bar__toolbar');
    const mark = toolbar.querySelector('[data-focused="true"]');
    const row = toolbar.getBoundingClientRect();
    const focus = mark.getBoundingClientRect();
    const rail = document.querySelector('button[aria-label="Expand Survey panel"]').getBoundingClientRect();
    return { row: row.height, rail: rail.height, top: focus.top - row.top, bottom: row.bottom - focus.bottom,
      border: parseFloat(getComputedStyle(toolbar).borderBottomWidth) };
  });
  expect(geometry.row).toBe(geometry.rail);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.border);
  await page.keyboard.press('Escape');
  // Compare painted glyph bounds, not SVG/viewBox source strings.
  const heights = [];
  for (const name of ['Apply Underline', 'Apply Squiggle', 'Apply Strike Through', 'Apply Redact']) {
    const button = page.getByRole('button', { name, exact: true });
    const png = PNG.sync.read(await button.screenshot());
    let min = png.height, max = -1;
    for (let y = 2; y < png.height - 2; y++) for (let x = 3; x < png.width - 3; x++) {
      const i = (y * png.width + x) * 4;
      if (Math.min(...png.data.subarray(i, i + 3)) > 125) { min = Math.min(min, y); max = Math.max(max, y); }
    }
    heights.push(max - min + 1);
  }
  expect(heights[3]).toBeGreaterThanOrEqual(Math.max(...heights.slice(0, 3)) * 0.7);
});

for (const kind of ['underline', 'squiggly', 'highlight', 'strikeout']) {
  test(`resizing imported ${kind} holds the opposite authored edge`, async ({ page }) => {
    await open(page);
    await page.keyboard.press('v');
    const mark = page.locator(`[data-shape-kind="text-markup-${kind}"]`).first();
    const before = await mark.boundingBox();
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
    const handle = page.locator('[data-text-range-handle="mr"]');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const after = await mark.boundingBox();
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.2);
    expect(Math.abs(after.width - before.width)).toBeGreaterThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.2);
  });
}
