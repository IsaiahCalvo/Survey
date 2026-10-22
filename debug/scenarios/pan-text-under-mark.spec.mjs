// Pan over text: a mark on top wins (owner 2026-10-22).
//
// WHY: under Pan, a mouse resting on PDF text shows the I-beam and its drag
// selects text (utils/panTextSelect.js, owner 2026-10-14). The text layer sits
// under the marks but takes the hover itself, so a mark lying ON text showed
// the I-beam too and a drag on it selected the text under it. The owner: "It
// should only show the text cursor if there's no annotation already over it."
// Fixed in #1144. This draws a highlighter stroke across one line of text,
// leaves another bare, then under Pan checks:
//   - resting on the mark over text: the grab hand + the blue hover halo, no
//     I-beam, and a drag pans (selects no text);
//   - resting on the bare text: the I-beam, and a drag selects, as before;
//   - from the I-beam straight onto the mark, a press-drag pans;
//   - a click on the mark still selects it;
//   - the Select tool shows no I-beam over the mark either;
//   - Text Select still selects the text beside the mark.
//
// Needs a browser, so NOT in the CI shards. Run it by hand:
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 npx playwright test \
//     --config debug/playwright.config.mjs debug/scenarios/pan-text-under-mark.spec.mjs
// (PW_CHROMIUM_PATH=/path/to/chrome if Playwright's own Chromium is missing).
// Only local fake data: a test PDF; every request that is not to the local
// dev server is blocked.
import { test, expect } from '@playwright/test';

const TEXT_PDF = 'text-search-glyph-lab.pdf';

test.use({
  video: 'off',
  screenshot: 'off',
  actionTimeout: 15_000,
  viewport: { width: 1440, height: 900 },
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ mode: 'serial', timeout: 600_000 });

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('Pan: a mark on top of text shows the grab hand and halo, never the I-beam', async ({ page, context }) => {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  const cdp = await context.newCDPSession(page);
  const mouse = (type, x, y, o = {}) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...o,
  });
  const move = (x, y) => mouse('mouseMoved', x, y, { button: 'none', buttons: 0 });
  const drag = async (x0, y0, x1, y1, n = 12) => {
    await move(x0, y0);
    await mouse('mousePressed', x0, y0);
    for (let i = 1; i <= n; i += 1) {
      await mouse('mouseMoved', x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
      await sleep(16);
    }
    await mouse('mouseReleased', x1, y1);
  };
  const arm = async (key) => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.move(5, 5);
    await page.keyboard.press(key);
    await sleep(400);
  };
  const scroller = () => page.locator('[data-touch-pdf-surface="false"]');
  const pos = () => page.evaluate(() => {
    const sc = document.querySelector('[data-touch-pdf-surface="false"]');
    return { x: sc.scrollLeft, y: sc.scrollTop };
  });
  const cursorAt = (x, y) => page.evaluate(({ px, py }) => {
    const el = document.elementFromPoint(px, py);
    return el ? getComputedStyle(el).cursor : null;
  }, { px: x, py: y });
  const selected = () => page.evaluate(() => String(window.getSelection?.() || ''));
  const halos = () => page.locator('svg[data-svg-annotation-layer] [data-hover-halo], svg[data-svg-annotation-layer] [data-hover-glow]').count();
  const marks = () => page.locator('svg[data-svg-annotation-layer] [data-annotation-index]').count();

  await page.goto(`/?testPdf=${encodeURIComponent(TEXT_PDF)}`);
  await expect(page.locator('[data-touch-pdf-surface="false"] .survey-pdfjs-page-div').first()).toBeVisible({ timeout: 300_000 });
  await sleep(2500);
  for (let i = 0; i < 2; i += 1) { await page.keyboard.press('Control+='); await sleep(400); }
  await sleep(800);

  // Two text runs on screen: the first gets a highlighter stroke, the second
  // stays bare. The text layer mounts with the Pan tool on a mouse device.
  await arm('m');
  await sleep(600);
  const runs = await page.evaluate(() => [...document.querySelectorAll('.pdfjsTextLayer span')]
    .filter((e) => e.textContent.trim().length > 6)
    .map((e) => e.getBoundingClientRect())
    .filter((q) => q.width > 80 && q.top > 140 && q.bottom < innerHeight - 140)
    .map((q) => ({ x: q.left, y: q.top + q.height / 2, w: q.width, h: q.height })));
  expect(runs.length, 'two lines of text on screen').toBeGreaterThan(1);
  const marked = runs[0];
  const bare = runs.find((r) => Math.abs(r.y - marked.y) > 40) || runs[1];

  // Highlighter across the first run.
  await arm('h');
  const before = await marks();
  await drag(marked.x + 2, marked.y, marked.x + marked.w - 2, marked.y, 16);
  await sleep(900);
  expect(await marks(), 'the highlighter stroke was added').toBeGreaterThan(before);

  await arm('m');
  await sleep(500);
  const onMark = { x: Math.round(marked.x + marked.w / 2), y: Math.round(marked.y) };

  // 1. Rest on the mark over text: grab hand + halo, no I-beam.
  await move(5, 400);
  await sleep(250);
  await move(onMark.x, onMark.y);
  await sleep(120);
  await move(onMark.x + 1, onMark.y);
  await sleep(500);
  const markCursor = await cursorAt(onMark.x + 1, onMark.y);
  const markPanText = await scroller().getAttribute('data-pan-text');
  const markHalos = await halos();
  console.log('[pan-text-under-mark] on mark', { markCursor, markPanText, markHalos });
  expect(markCursor, 'a mark over text shows the grab hand').toBe('grab');
  expect(markPanText, 'no I-beam state over a mark').not.toBe('on');
  expect(markHalos, 'the mark shows its blue hover halo').toBeGreaterThan(0);

  // 2. A drag from the mark pans and selects no text.
  const a = await pos();
  await drag(onMark.x + 1, onMark.y, onMark.x - 120, onMark.y - 140);
  await sleep(900);
  const b = await pos();
  const dragSelection = await selected();
  console.log('[pan-text-under-mark] drag from mark', { dx: b.x - a.x, dy: b.y - a.y, dragSelection });
  expect(dragSelection, 'a drag on the mark selects no text').toBe('');
  expect(Math.abs(b.x - a.x) + Math.abs(b.y - a.y), 'a drag on the mark pans').toBeGreaterThan(40);
  // Put the page back where it was.
  await page.evaluate(({ x, y }) => {
    const sc = document.querySelector('[data-touch-pdf-surface="false"]');
    sc.scrollLeft = x; sc.scrollTop = y;
  }, a);
  await sleep(700);

  // 3. Bare text beside it: the I-beam after the rest, and a drag selects.
  await move(5, 400);
  await sleep(250);
  await move(Math.round(bare.x + 6), Math.round(bare.y));
  await sleep(450);
  const bareCursor = await cursorAt(Math.round(bare.x + 6), Math.round(bare.y));
  console.log('[pan-text-under-mark] bare text', { bareCursor });
  expect(bareCursor, 'bare text still shows the I-beam after the rest').toBe('text');
  await drag(Math.round(bare.x + 2), Math.round(bare.y), Math.round(bare.x + bare.w - 4), Math.round(bare.y));
  await sleep(500);
  expect((await selected()).length, 'a drag on bare text still selects it').toBeGreaterThan(2);

  // 4. From the I-beam straight onto the mark: the press is the mark's, not the text's.
  await move(onMark.x, onMark.y);
  await sleep(40);
  const c = await pos();
  await drag(onMark.x, onMark.y, onMark.x - 120, onMark.y - 140);
  await sleep(900);
  const d = await pos();
  const fastSelection = await selected();
  console.log('[pan-text-under-mark] fast onto mark', { dx: d.x - c.x, dy: d.y - c.y, fastSelection });
  expect(Math.abs(d.x - c.x) + Math.abs(d.y - c.y), 'leaving the I-beam onto a mark: the drag pans').toBeGreaterThan(40);
  await page.evaluate(({ x, y }) => {
    const sc = document.querySelector('[data-touch-pdf-surface="false"]');
    sc.scrollLeft = x; sc.scrollTop = y;
  }, c);
  await sleep(700);

  // 5. A click on the mark still selects it.
  await move(onMark.x, onMark.y);
  await sleep(300);
  await mouse('mousePressed', onMark.x, onMark.y);
  await mouse('mouseReleased', onMark.x, onMark.y);
  await sleep(700);
  const picked = await page.locator('svg[data-svg-annotation-layer] :is([data-handle], [data-resize-handle], [data-rotation-handle])').count();
  console.log('[pan-text-under-mark] click selects', { picked });
  expect(picked, 'a click on the mark selects it').toBeGreaterThan(0);
  // Selected, resting on it still shows no I-beam.
  await move(onMark.x + 2, onMark.y);
  await sleep(450);
  const selectedCursor = await cursorAt(onMark.x + 2, onMark.y);
  console.log('[pan-text-under-mark] selected mark', { selectedCursor });
  expect(selectedCursor, 'a selected mark over text shows no I-beam').not.toBe('text');

  // 6. Select: the mark over text takes the hover too (no I-beam).
  await arm('v');
  await move(5, 400);
  await sleep(250);
  await move(onMark.x, onMark.y);
  await sleep(450);
  const selectCursor = await cursorAt(onMark.x, onMark.y);
  console.log('[pan-text-under-mark] select tool', { selectCursor });
  expect(selectCursor, 'Select over a mark on text shows no I-beam').not.toBe('text');
  // 7. Text Select still selects the bare text beside the mark.
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.move(5, 5);
  await page.keyboard.press('Shift+V');
  await sleep(800);
  await drag(Math.round(bare.x + 2), Math.round(bare.y), Math.round(bare.x + bare.w - 4), Math.round(bare.y));
  await sleep(500);
  expect((await selected()).length, 'Text Select still selects text').toBeGreaterThan(2);
});
