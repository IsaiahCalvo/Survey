import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';

const pageOne = '.survey-pdfjs-page-div[data-page-number="1"]';
const scroller = '.survey-pdfjs-viewer[id^="pdfjs-pdf-viewer"]';
async function load(page, fixture = 'e2e/prog-02-text-markup.pdf') {
  await page.goto(`/?testPdf=${fixture}`);
  await page.locator(pageOne).waitFor();
  await page.locator('[data-shape-kind]').first().waitFor();
}
async function textBox(page, text) {
  const span = page.locator(`${pageOne} .pdfjsTextLayer span`).filter({ hasText: text }).first();
  await expect(span).toBeVisible();
  return span.boundingBox();
}

test('marked words and lines keep native selection and copy; links keep native drags', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.keyboard.press('Shift+v');
  const box = await textBox(page, 'beneath');
  for (const clickCount of [2, 3, 2]) {
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height / 2, { clickCount });
    await page.waitForTimeout(400);
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected.trim()).not.toBe('');
    if (clickCount === 3) expect(selected).toContain('beneath');
    await page.evaluate(() => navigator.clipboard.writeText('__EMPTY__'));
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  const link = await textBox(page, 'https://example.com/survey-report');
  await page.mouse.move(link.x + 1, link.y + link.height / 2);
  await page.mouse.down();
  await page.mouse.move(link.x + link.width - 1, link.y + link.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toContain('https://example.com/survey-repor');
  await expect(page.locator('[data-resize-handle]')).toHaveCount(0);
  // A drag ending on the link must keep the whole native range, too.
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(link.x + link.width / 2, link.y + link.height / 2, { steps: 25 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toContain('beneath');
});

test('Text Select round trip preserves marquee painting and pen creation', async ({ page }) => {
  await load(page);
  for (let round = 0; round < 2; round += 1) {
    await page.keyboard.press('v');
    await page.mouse.move(460, 650);
    await page.mouse.down();
    await page.mouse.move(670, 740, { steps: 10 });
    await expect(page.locator('[data-marquee-selection-preview="true"]')).toBeVisible();
    await page.mouse.up();
    await page.keyboard.press('Shift+v');
  }
  await page.keyboard.press('p');
  const marks = page.locator(`${pageOne} [data-annotation-index]`);
  const before = await marks.count();
  await page.mouse.move(460, 680);
  await page.mouse.down();
  await page.mouse.move(640, 700, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => marks.count()).toBeGreaterThan(before);
});

test('faded rails leave right and bottom edge drags to the pen', async ({ page }) => {
  await load(page, 'e2e/prog-01-drawing-markup.pdf');
  await page.keyboard.press('p');
  for (let i = 0; i < 6; i += 1) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.mouse.move(700, 400);
  await expect(page.getByLabel('Viewport vertical scroll bar')).toHaveCSS('opacity', '0');
  const viewport = await page.locator(scroller).boundingBox();
  for (const axis of ['vertical', 'horizontal']) {
    await page.mouse.move(700, 400);
    await expect(page.getByLabel(`Viewport ${axis} scroll bar`)).toHaveCSS('opacity', '0');
    const start = axis === 'vertical' ? { x: viewport.x + viewport.width - 4, y: 400 } : { x: 700, y: viewport.y + viewport.height - 4 };
    const beforeScroll = await page.locator(scroller).evaluate(el => [el.scrollLeft, el.scrollTop]);
    const marks = page.locator('[data-annotation-index]');
    const beforeMarks = await marks.count();
    await page.mouse.move(start.x, start.y);
    await expect(page.getByLabel(`Viewport ${axis} scroll bar`)).toHaveCSS('pointer-events', 'none');
    await page.mouse.down();
    await page.mouse.move(start.x + (axis === 'horizontal' ? 128 : 0), start.y + (axis === 'vertical' ? 128 : 0), { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => marks.count()).toBeGreaterThan(beforeMarks);
    expect(await page.locator(scroller).evaluate(el => [el.scrollLeft, el.scrollTop])).toEqual(beforeScroll);
  }
});

test('expand Survey tooltip appears and clears on press', async ({ page }) => {
  await load(page);
  const button = page.getByRole('button', { name: 'Expand Survey panel', exact: true });
  await button.hover();
  const tooltip = page.locator('body > div[aria-hidden="true"]').filter({ hasText: 'Expand Survey panel' });
  await expect(tooltip).toBeVisible();
  await button.click();
  await expect(tooltip).toHaveCount(0);
});

async function exportedUnderlineCount(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click();
  const document = await PDFDocument.load(await readFile(await (await download).path()));
  const annotations = document.getPage(0).node.Annots();
  return Array.from({ length: annotations?.size() || 0 }, (_, i) => annotations.lookup(i))
    .filter(entry => entry.get(PDFName.of('Subtype'))?.toString() === '/Underline').length;
}

test('delete undo and redo keep imported underline export in sync with the page', async ({ page }) => {
  await load(page);
  await page.keyboard.press('v');
  const mark = page.locator('[data-shape-kind="text-markup-underline"]').first();
  const box = await mark.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-resize-handle]').first()).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(mark).toHaveCount(0);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  // A horizontal SVG stroke has a zero-height fill box in Playwright.
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveCSS('opacity', '1');
  expect(await exportedUnderlineCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(mark).toHaveCount(0);
  expect(await exportedUnderlineCount(page)).toBe(0);
});
