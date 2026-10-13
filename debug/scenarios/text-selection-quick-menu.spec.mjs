// KAL-240 — the floating quick menu on a finished PDF text selection.
// Desktop (mouse drag) and phone (touch, 390x844) flows: the menu appears
// next to the selection without covering it, each of its marks makes a real
// text-markup record that undoes / redoes and lands in the exported PDF, Copy
// copies, and Escape / a click elsewhere dismiss it.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';

const FIXTURE = 'text-selection-rotation-matrix.pdf';
const MENU = '[data-text-selection-quick-menu][data-visible="true"]';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

const lineSpans = (page, pageNumber = 1) => page.locator(
  `.survey-pdfjs-page-div[data-page-number="${pageNumber}"] .pdfjsTextLayer span`,
);
const marks = (page, type) => page.locator(`[data-shape-kind="text-markup-${type}"]`);

async function openDesktop(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?testPdf=${FIXTURE}`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Shift+v');
  await expect(lineSpans(page).nth(2)).toBeVisible();
}

// Drag from the start of one text line to partway along a later one.
async function dragSelect(page, fromIndex, toIndex, toFraction = 0.6) {
  const from = await lineSpans(page).nth(fromIndex).boundingBox();
  const to = await lineSpans(page).nth(toIndex).boundingBox();
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * toFraction, to.y + to.height / 2, { steps: 14 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).not.toBe('');
}

const selectionRect = (page) => page.evaluate(() => {
  const range = window.getSelection().getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
});

const overlaps = (a, b) => a.x < b.right && a.x + a.width > b.left && a.y < b.bottom && a.y + a.height > b.top;

async function exportedMarkups(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export annotated PDF', exact: true }).click();
  const pdf = await PDFDocument.load(await readFile(await (await download).path()));
  return pdf.getPages().flatMap((pdfPage, pageIndex) => {
    const annots = pdfPage.node.Annots();
    return Array.from({ length: annots?.size() || 0 }, (_, i) => annots.lookup(i)).map((annot) => ({
      page: pageIndex + 1,
      subtype: annot.get(PDFName.of('Subtype'))?.toString().slice(1),
      quadPoints: annot.get(PDFName.of('QuadPoints'))?.asArray?.().map((n) => n.asNumber()) || [],
      contents: annot.get(PDFName.of('Contents'))?.decodeText?.() || '',
    }));
  });
}

test.describe('desktop', () => {
  test('quick menu sits clear of the selection and its marks undo, redo and export', async ({ page }) => {
    await openDesktop(page);

    // Two-line selection: the menu appears once the drag ends.
    await dragSelect(page, 1, 2);
    const menu = page.locator(MENU);
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(overlaps(menuBox, await selectionRect(page))).toBe(false);
    for (const name of ['Add highlight on selected text', 'Add underline on selected text', 'Add squiggle on selected text', 'Add strike through on selected text', 'Copy selected text']) {
      await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath('desktop-menu.png') });

    // Highlight: one record over both lines, in the highlight colour.
    await menu.getByRole('button', { name: 'Add highlight on selected text', exact: true }).click();
    await expect(marks(page, 'highlight')).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
    await page.screenshot({ path: test.info().outputPath('desktop-highlighted.png') });

    await page.keyboard.press(undoKey);
    await expect(marks(page, 'highlight')).toHaveCount(0);
    await page.keyboard.press(redoKey);
    await expect(marks(page, 'highlight')).toHaveCount(1);

    // The other three marks, each on its own range.
    await dragSelect(page, 0, 0, 0.5);
    await page.locator(MENU).getByRole('button', { name: 'Add underline on selected text', exact: true }).click();
    await expect(marks(page, 'underline')).toHaveCount(1);
    await dragSelect(page, 1, 1, 0.5);
    await page.locator(MENU).getByRole('button', { name: 'Add squiggle on selected text', exact: true }).click();
    await expect(marks(page, 'squiggly')).toHaveCount(1);
    await dragSelect(page, 2, 2, 0.9);
    await page.locator(MENU).getByRole('button', { name: 'Add strike through on selected text', exact: true }).click();
    await expect(marks(page, 'strikeout')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('desktop-all-marks.png') });

    // Re-selecting the highlighted range offers to remove the highlight.
    await dragSelect(page, 1, 2);
    await expect(page.locator(MENU).getByRole('button', { name: 'Remove highlight on selected text', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    const exported = (await exportedMarkups(page)).filter((annot) => annot.page === 1);
    const byType = Object.fromEntries(['Highlight', 'Underline', 'Squiggly', 'StrikeOut']
      .map((subtype) => [subtype, exported.filter((annot) => annot.subtype === subtype)]));
    for (const [subtype, list] of Object.entries(byType)) expect(list.length, subtype).toBe(1);
    // One quad (8 numbers) per selected line: the highlight spans two lines.
    expect(byType.Highlight[0].quadPoints).toHaveLength(16);
    expect(byType.Highlight[0].contents).toContain('Selectable');
    for (const subtype of ['Underline', 'Squiggly', 'StrikeOut']) expect(byType[subtype][0].quadPoints).toHaveLength(8);
  });

  test('Escape and a click elsewhere dismiss the menu; Copy copies the selected text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDesktop(page);

    // First Escape closes only the menu; the selection stays for Ctrl+C.
    await dragSelect(page, 1, 2);
    await expect(page.locator(MENU)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection().toString())).not.toBe('');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe('');
    // That Escape had nothing left to close, so (Drawboard rule 10) it may
    // also have put the tool down; pick Text Select up again.
    await page.waitForTimeout(300);
    if (await page.locator('.pdfjsTextLayer.is-interactive').count() === 0) await page.keyboard.press('Shift+v');
    await expect(page.locator('.pdfjsTextLayer.is-interactive').first()).toBeAttached();

    // A click on blank paper dismisses it.
    await dragSelect(page, 1, 1, 0.8);
    await expect(page.locator(MENU)).toBeVisible();
    const paper = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    await page.mouse.click(paper.x + paper.width / 2, paper.y + paper.height * 0.7);
    await expect(page.locator(MENU)).toHaveCount(0);

    // A click on the tool bar's empty strip dismisses it too.
    await dragSelect(page, 1, 1, 0.8);
    await expect(page.locator(MENU)).toBeVisible();
    await page.mouse.click(300, 50);
    await expect(page.locator(MENU)).toHaveCount(0);

    // Copy.
    await dragSelect(page, 1, 1, 0.99);
    const selected = await page.evaluate(() => window.getSelection().toString());
    await page.locator(MENU).getByRole('button', { name: 'Copy selected text', exact: true }).click();
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
    await expect(marks(page, 'highlight')).toHaveCount(0);
  });

  test('a mark made on a rotated page exports onto the selected words', async ({ page }) => {
    await openDesktop(page);
    await page.locator('.survey-pdfjs-page-div[data-page-number="2"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const spans = lineSpans(page, 2);
    await expect(spans.nth(2)).toBeVisible();
    // Page 2 is /Rotate 90: its lines run down the screen.
    const from = await spans.nth(1).boundingBox();
    const to = await spans.nth(2).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.6, { steps: 14 });
    await page.mouse.up();
    const menu = page.locator(MENU);
    await expect(menu).toBeVisible();
    expect(overlaps(await menu.boundingBox(), await selectionRect(page))).toBe(false);
    await menu.getByRole('button', { name: 'Add highlight on selected text', exact: true }).click();
    await expect(marks(page, 'highlight')).toHaveCount(1);
    const highlight = (await exportedMarkups(page)).find((annot) => annot.page === 2 && annot.subtype === 'Highlight');
    expect(highlight).toBeTruthy();
    expect(highlight.quadPoints).toHaveLength(16);
    expect(highlight.contents).toContain('Selectable line');
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: IPHONE_UA,
  });

  // What an iOS long-press plus a handle drag leaves behind: a native range.
  // Headless Chromium cannot long-press-select, so the range is set directly
  // and the page sees the same selectionchange it would on the phone.
  const selectRange = (page, fromIndex, fromOffset, toIndex, toOffset) => page.evaluate(([a, ao, z, zo]) => {
    const spans = [...document.querySelectorAll('.survey-pdfjs-page-div[data-page-number="1"] .pdfjsTextLayer span')];
    const range = document.createRange();
    range.setStart(spans[a].firstChild, ao);
    range.setEnd(spans[z].firstChild, zo);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, [fromIndex, fromOffset, toIndex, toOffset]);

  test('touch: the menu sits under the selection, clear of it, and its marks work', async ({ page }) => {
    await page.goto(`/?testPdf=${FIXTURE}&mobileNav=tabs&nativeShell=expo`);
    await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor();
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).first().waitFor();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).first().tap();
    await page.locator('[aria-label="Text Select"]').first().tap();
    await expect(lineSpans(page).nth(2)).toBeVisible();

    await selectRange(page, 1, 11, 2, 14);
    const menu = page.locator(MENU);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-placement', 'below');
    const menuBox = await menu.boundingBox();
    const selection = await selectionRect(page);
    expect(overlaps(menuBox, selection)).toBe(false);
    // Clear of the end handle's knob, and phone-sized targets.
    expect(menuBox.y).toBeGreaterThanOrEqual(selection.bottom + 20);
    for (const button of await menu.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Inside the screen and clear of the tool rail floating over the viewer.
    const rail = await page.locator('.mobile-pdf-tools').boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('phone-menu.png') });

    await menu.getByRole('button', { name: 'Add highlight on selected text', exact: true }).tap();
    await expect(marks(page, 'highlight')).toHaveCount(1);
    await expect(page.locator(MENU)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('phone-highlighted.png') });
    await page.getByRole('button', { name: 'Undo', exact: true }).first().tap();
    await expect(marks(page, 'highlight')).toHaveCount(0);

    // Moving a handle (a new range) brings it back; a tap elsewhere dismisses it.
    await selectRange(page, 1, 0, 1, 10);
    await expect(page.locator(MENU)).toBeVisible();
    await page.locator(MENU).getByRole('button', { name: 'Add strike through on selected text', exact: true }).tap();
    await expect(marks(page, 'strikeout')).toHaveCount(1);
    await selectRange(page, 2, 0, 2, 10);
    await expect(page.locator(MENU)).toBeVisible();
    const paper = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    await page.touchscreen.tap(paper.x + paper.width / 2, paper.y + paper.height * 0.6);
    await expect(page.locator(MENU)).toHaveCount(0);
  });
});
