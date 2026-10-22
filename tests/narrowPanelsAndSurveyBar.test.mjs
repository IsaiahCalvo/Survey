// Desktop/tablet pass 2026-10-21, items 1 and 4: side panels that leave no
// room for the page, the re-fit to the band between panels, and the Survey
// bar taking its own space above the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  leftPanelFitsBeside,
  resolveNarrowPanelYield,
  requestRightPanelYield,
  subscribeRightPanelYield,
} from '../src/sidebar/panelLayoutStore.js';
import { shouldRefitForBand } from '../src/utils/viewerSideOverlay.js';
import { computePushStripInset, resolvePushStripScroll } from '../src/utils/viewerTopOverlay.js';

const SURVEY_OPEN = { rightCover: 48 + 320 };
const RAIL_ONLY = { rightCover: 48 };

test('left panel and Survey panel cannot share an 820px window, can at 1024 and up', () => {
  assert.equal(leftPanelFitsBeside(820, SURVEY_OPEN), false);
  assert.equal(leftPanelFitsBeside(820, RAIL_ONLY), true);
  assert.equal(leftPanelFitsBeside(1024, SURVEY_OPEN), true);
  assert.equal(leftPanelFitsBeside(1440, SURVEY_OPEN), true);
});

test('the panel opened last stays, the other gives way', () => {
  // Survey panel opened beside an open left panel at 820: the left one closes.
  assert.equal(resolveNarrowPanelYield({ viewportWidth: 820, room: SURVEY_OPEN, leftOpen: true }), 'left');
  // Left panel opened beside the Survey panel: the Survey panel closes.
  assert.equal(resolveNarrowPanelYield({ viewportWidth: 820, room: SURVEY_OPEN, leftOpen: true, leftJustOpened: true }), 'right');
  // Nothing to do when they fit or the left panel is closed.
  assert.equal(resolveNarrowPanelYield({ viewportWidth: 1024, room: SURVEY_OPEN, leftOpen: true, leftJustOpened: true }), null);
  assert.equal(resolveNarrowPanelYield({ viewportWidth: 820, room: SURVEY_OPEN, leftOpen: false }), null);
  // Only the bare rail on the right and still too narrow: the left one closes.
  assert.equal(resolveNarrowPanelYield({ viewportWidth: 600, room: RAIL_ONLY, leftOpen: true, leftJustOpened: true }), 'left');
});

test('right panel yield requests reach subscribers until they unsubscribe', () => {
  let calls = 0;
  const off = subscribeRightPanelYield(() => { calls += 1; });
  requestRightPanelYield();
  off();
  requestRightPanelYield();
  assert.equal(calls, 1);
});

test('a fitted page now under a panel re-fits to the band', () => {
  // 820px tablet: viewer 724 wide, page 68..752, Survey panel covers the right 320.
  assert.equal(shouldRefitForBand({ pageLeft: 20, pageWidth: 684, viewportWidth: 724, insets: { left: 0, right: 320 }, lastBandW: 724 }), true);
  // Left half under a left panel.
  assert.equal(shouldRefitForBand({ pageLeft: -92, pageWidth: 684, viewportWidth: 724, insets: { left: 200, right: 0 }, lastBandW: 724 }), true);
});

test('a page still clear of the panels does not move', () => {
  // 1440: page 363..980 of a 1344 viewer, Survey panel covers 1024..1344.
  assert.equal(shouldRefitForBand({ pageLeft: 363, pageWidth: 617, viewportWidth: 1344, insets: { left: 0, right: 320 }, lastBandW: 1344 }), false);
  // Closing a panel after an ordinary fit keeps the view.
  assert.equal(shouldRefitForBand({ pageLeft: 100, pageWidth: 300, viewportWidth: 724, insets: { left: 0, right: 0 }, lastBandW: 404 }), false);
});

test('a band-driven re-fit grows back when the panel closes', () => {
  assert.equal(shouldRefitForBand({ pageLeft: 20, pageWidth: 364, viewportWidth: 724, insets: { left: 0, right: 0 }, lastBandW: 404, bandDriven: true }), true);
  assert.equal(shouldRefitForBand({ pageLeft: 20, pageWidth: 364, viewportWidth: 724, insets: { left: 0, right: 320 }, lastBandW: 404, bandDriven: true }), false);
});

test('degenerate input never asks for a re-fit', () => {
  assert.equal(shouldRefitForBand({ pageLeft: 0, pageWidth: 0, viewportWidth: 724 }), false);
  assert.equal(shouldRefitForBand({ pageLeft: 0, pageWidth: 300, viewportWidth: 300, insets: { left: 200, right: 200 } }), false);
});

test('the Survey bar pushes the view down by its height and gives it back', () => {
  // Appears (0 -> 36) while scrolled 60px: the view scrolls up 36px.
  const shown = resolvePushStripScroll({ scrollTop: 60, prevInset: 0, nextInset: 36, applied: 0 });
  assert.deepEqual(shown, { scrollTop: 24, applied: 36 });
  // Goes away: the 36px come back.
  assert.deepEqual(resolvePushStripScroll({ scrollTop: 24, prevInset: 36, nextInset: 0, applied: 36 }), { scrollTop: 60, applied: 0 });
});

test('the push stops at the top and only gives back what it took', () => {
  const shown = resolvePushStripScroll({ scrollTop: 10, prevInset: 0, nextInset: 36, applied: 0 });
  assert.deepEqual(shown, { scrollTop: 0, applied: 10 });
  assert.deepEqual(resolvePushStripScroll({ scrollTop: 0, prevInset: 36, nextInset: 0, applied: 10 }), { scrollTop: 10, applied: 0 });
  assert.deepEqual(resolvePushStripScroll({ scrollTop: 40, prevInset: 36, nextInset: 36, applied: 5 }), { scrollTop: 40, applied: 5 });
});

test('push strip inset counts only strips on the scroller top edge', () => {
  const scroller = { top: 69, bottom: 900, left: 48, right: 1392 };
  assert.equal(computePushStripInset(scroller, [{ top: 69, bottom: 105, left: 48, right: 1072 }]), 36);
  assert.equal(computePushStripInset(scroller, [{ top: 200, bottom: 240, left: 48, right: 400 }]), 0);
  assert.equal(computePushStripInset(scroller, [{ top: 69, bottom: 69, left: 48, right: 400 }]), 0);
  assert.equal(computePushStripInset(null, []), 0);
});
