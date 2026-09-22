/**
 * Phone on-screen keyboard: the shell must not move (owner bug 2026-09-22).
 *
 * "When you type into a text box or callout on the page, the on-screen keyboard
 * pushes/scrolls the WHOLE app shell up (header, rail and dock move) instead of
 * only the PDF page scrolling so the text stays visible."
 *
 * A headless browser cannot raise a real soft keyboard, so this drives the two
 * halves of the real thing against the real running app at 390x844:
 *
 *   1. THE REVEAL. What actually moved the chrome was the browser scrolling the
 *      document to show the focused field. The spec performs that scroll itself
 *      (window.scrollTo + a scroll on the scrolling element) and asserts the
 *      header, rail and dock rectangles are byte-identical afterwards. With the
 *      shell pinned there is no scroll range to give, so nothing moves.
 *
 *   2. THE INSET. It then writes exactly what src/mobile/keyboardViewport.js
 *      writes for a 336px keyboard — `--keyboard-inset` plus `data-keyboard-open`
 *      on <html> — and asserts (a) the chrome still has not moved and (b) the
 *      PDF scroller gained 336px of range, which is what lets a caret on the
 *      last line of the last page scroll clear of the keyboard.
 *
 * Run: PLAYWRIGHT_BASE_URL=http://127.0.0.1:5354 npx playwright test \
 *        --config debug/playwright.config.mjs debug/scenarios/mobile-keyboard-shell-lock.spec.mjs
 */

import { test, expect } from '@playwright/test';

const TEST_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const KEYBOARD_H = 336;

const chromeRects = (page) => page.evaluate(() => {
  const read = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(2), left: +r.left.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
  };
  return {
    header: read(document.querySelector('[data-mobile-pdf-header="true"]')),
    rail: read(document.querySelector('.mobile-pdf-tools')),
    dock: read(document.querySelector('.mobile-pdf-dock')),
  };
});

test('the on-screen keyboard never moves the phone chrome', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TEST_PDF);

  await page.locator('[data-mobile-pdf-header="true"]').waitFor({ timeout: 60_000 });
  await page.locator('.mobile-pdf-dock').waitFor();
  await page.locator('[data-mobile-pdf-surface="true"] [data-pdfjs-content="true"]').waitFor();

  const before = await chromeRects(page);
  expect(before.header).not.toBeNull();
  expect(before.rail).not.toBeNull();
  expect(before.dock).not.toBeNull();
  // The chrome is where the phone layout puts it: header at the top, dock at
  // the bottom of an 844px screen.
  expect(before.header.top).toBe(0);
  expect(before.dock.top + before.dock.height).toBeCloseTo(844, 0);

  // The shell is pinned: the document itself cannot scroll.
  const shell = await page.evaluate(() => ({
    bodyPosition: getComputedStyle(document.body).position,
    docScrollRange: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
  }));
  expect(shell.bodyPosition).toBe('fixed');
  expect(shell.docScrollRange).toBeLessThanOrEqual(0);

  // 1. THE REVEAL — exactly what the browser does when a field takes focus.
  await page.evaluate(() => {
    window.scrollTo(0, 400);
    document.scrollingElement.scrollTop = 400;
    document.body.scrollTop = 400;
  });
  expect(await chromeRects(page)).toEqual(before);

  // 2. THE INSET — what keyboardViewport.js publishes for a 336px keyboard.
  const scrollRangeBefore = await page.evaluate(() => {
    const s = document.querySelector('[data-mobile-pdf-surface="true"]');
    return s.scrollHeight - s.clientHeight;
  });

  await page.evaluate((kb) => {
    document.documentElement.style.setProperty('--keyboard-inset', `${kb}px`);
    document.documentElement.setAttribute('data-keyboard-open', 'true');
  }, KEYBOARD_H);

  expect(await chromeRects(page)).toEqual(before);

  const scrollRangeAfter = await page.evaluate(() => {
    const s = document.querySelector('[data-mobile-pdf-surface="true"]');
    return s.scrollHeight - s.clientHeight;
  });
  expect(scrollRangeAfter - scrollRangeBefore).toBeCloseTo(KEYBOARD_H, 0);

  // 3. EVERYTHING RETURNS when the keyboard closes.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--keyboard-inset', '0px');
    document.documentElement.removeAttribute('data-keyboard-open');
  });
  expect(await chromeRects(page)).toEqual(before);
  const scrollRangeClosed = await page.evaluate(() => {
    const s = document.querySelector('[data-mobile-pdf-surface="true"]');
    return s.scrollHeight - s.clientHeight;
  });
  expect(scrollRangeClosed).toBeCloseTo(scrollRangeBefore, 0);
});
