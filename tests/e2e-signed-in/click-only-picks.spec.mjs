// A click only picks (owner 2026-11-10: "when I click on a survey marker ...
// the page kind of scrolls up a little ... and it shifts the survey marker up
// a little bit as well"). Drawboard is the model: a click selects, nothing
// moves. Two causes were found and fixed:
//  - the Survey bar that comes in when a marker is picked under Pan or Select
//    pushed the page down a bar's height (it now lies over the page; it still
//    pushes when it comes in for the armed Survey Marker tool);
//  - a press on a Survey Marker ran the drag's snap on release even when the
//    pointer never moved, so a marker near another mark jumped to line up with
//    it, and a press held while the page glided under it saved a move.
// This walk draws every kind of mark and Survey Marker on one sheet and, on
// the desktop layout, clicks each one with a mouse and a pen under Pan and
// Select, in survey mode and in regular mode: once to pick it, once more on
// the pick. After every click nothing has scrolled and no mark has moved.
// Spaces, tablet, phone web and phone app: click-only-picks-layouts.spec.mjs.
import { adminClient, expect, test } from './helpers.mjs';
import {
  button, cleanup, clickEach, drawEverything, openDoc, scrollPointTo, seed, spotsFor, zoomIn,
} from './clickOnlyPicks.shared.mjs';

test('desktop: every mark and Survey Marker, clicked with a mouse and a pen under Pan and Select, never moves and never scrolls', async ({ page }) => {
  test.setTimeout(420_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await page.addInitScript(() => { try { localStorage.setItem('survey.flag.smart-fill', '1'); } catch { /* none */ } });
    await openDoc(page, seeded);
    await page.waitForTimeout(1200);
    const list = await drawEverything(page, seeded);

    // --- Zoom in so the page scrolls both ways, the marks in view, and the
    // view scrolled down from the top (a bar that pushes needs room to push) ---
    await page.keyboard.press('v');
    await zoomIn(page, 3);
    const view = page.viewportSize();
    await scrollPointTo(page, 330, 330, view.width * 0.38, view.height * 0.5);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.querySelector('.survey-pdfjs-viewer')?.scrollTop || 0), 'scrolled down').toBeGreaterThan(40);

    const cdp = await page.context().newCDPSession(page);
    const failures = [];
    // Survey mode (panel open: Survey Markers, marks hidden), then regular
    // mode (panel closed: the marks).
    for (const mode of ['survey mode', 'regular mode']) {
      if (mode === 'regular mode') {
        // The Survey button brings the survey bar back; its Done leaves Survey.
        await button(page, 'Survey').click();
        await button(page, 'Leave Survey').click();
        await page.waitForTimeout(800);
      }
      await page.keyboard.press('v');
      await page.waitForTimeout(300);
      const shown = await spotsFor(page, list);
      console.log(`[click-only-picks] desktop ${mode}: ${shown.map((item) => item.label).join(', ')}`);
      if (mode === 'survey mode') expect(shown.filter((item) => item.marker).length, 'every Survey Marker').toBe(5);
      else expect(shown.filter((item) => !item.marker).length, 'every mark').toBe(12);
      for (const [tool, key] of [['Pan', 'm'], ['Select', 'v']]) {
        await page.keyboard.press(key);
        await page.waitForTimeout(300);
        for (const kind of ['mouse', 'pen']) {
          failures.push(...await clickEach(page, cdp, shown, kind, `desktop ${mode} ${tool}`));
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  } finally {
    await cleanup(admin, seeded);
  }
});
