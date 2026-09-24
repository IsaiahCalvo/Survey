import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compensateScrollTopForRoom,
  computeTopOverlayInset,
  getViewerTopOverlays,
  registerViewerTopOverlay,
  resolvePageLandingScrollTop,
  resolveTopRoom,
  resolveVerticalPlacement,
  subscribeViewerTopOverlays,
} from '../src/utils/viewerTopOverlay.js';

/*
 * Owner 2026-09-23: "If a toolbar ever comes down, or even two toolbars ... the
 * page is getting blocked by the toolbar and I can't get to the top of the page.
 * I don't really need the page pushed down so much as I should be able to
 * scroll up and move the top of the page out from underneath." (Drawboard PDF
 * reference.) The strips keep overlaying the canvas; the viewer adds matching
 * scroll room above page 1 and never moves the page when strips come and go.
 *
 * Measured live 2026-09-23 at 1280x800 (desktop): scroller 69..800; Shapes
 * sub-row 69..105 (36px) -> scrollTop 0 -> 36, page 1 stays at y=83.2, and
 * scrolled to the very top page 1 sits at 119.2 (14px gap below the strip).
 * Text tool with formatting: two strips 69..141 (72px), page still does not
 * move. Phone 390x844: tool strip 34..78 (44px), page 1 at 84.4 when scrolled
 * to the top.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const scroller = { top: 69, bottom: 800, left: 48, right: 1232 };
const strip = (top, bottom, left = 48, right = 1232) => ({ top, bottom, left, right });

// Where page 1's top edge is painted on screen for a given layout state.
const pageTopOnScreen = ({ padTop, pageTop, scrollTop }) => scroller.top + padTop + pageTop - scrollTop;

test('the measured top room is the live height of the strips over the viewer', () => {
  assert.equal(computeTopOverlayInset(scroller, [strip(69, 69)]), 0, 'an empty host adds nothing');
  assert.equal(computeTopOverlayInset(scroller, [strip(69, 105)]), 36, 'one tool sub-row');
  assert.equal(computeTopOverlayInset(scroller, [strip(69, 141)]), 72, 'sub-row + text formatting bar');
  assert.equal(
    computeTopOverlayInset(scroller, [strip(69, 105), strip(69, 141)]),
    72,
    'overlapping strips count once, by the lowest edge',
  );
  assert.equal(
    computeTopOverlayInset({ top: 34, bottom: 798, left: 36, right: 390 }, [strip(34, 78, 36, 390)]),
    44,
    'phone tool strip',
  );
});

test('only strips attached to the top edge and spanning the viewer count', () => {
  assert.equal(computeTopOverlayInset(scroller, [strip(69, 400, 900, 1232)]), 0, 'a narrow popover is not a strip');
  assert.equal(computeTopOverlayInset(scroller, [strip(300, 340)]), 0, 'a bar lower down is not a top strip');
  assert.equal(computeTopOverlayInset(scroller, [null, undefined]), 0);
  assert.equal(computeTopOverlayInset(null, [strip(69, 105)]), 0);
  assert.equal(
    computeTopOverlayInset(scroller, [strip(0, 790)]),
    731 - 80,
    'always leaves a usable window uncovered',
  );
});

test('strips appearing or growing take effect at once and the page does not move', () => {
  const raw = 25000; // a long document (overflows the 731px viewer)
  for (const [from, to, scrollTop] of [[0, 36, 0], [0, 36, 1200], [36, 72, 1236], [0, 72, 5]]) {
    const room = resolveTopRoom({ room: from, inset: to, scrollTop });
    assert.equal(room, to);
    const before = resolveVerticalPlacement({ containerHeight: 731, rawTotalHeight: raw, topRoom: from });
    const after = resolveVerticalPlacement({ containerHeight: 731, rawTotalHeight: raw, topRoom: room });
    const nextScrollTop = compensateScrollTopForRoom(scrollTop, from, room);
    assert.equal(
      pageTopOnScreen({ padTop: after.padTop, pageTop: 14, scrollTop: nextScrollTop }),
      pageTopOnScreen({ padTop: before.padTop, pageTop: 14, scrollTop }),
      `room ${from}->${to} at scrollTop ${scrollTop} must not move the page`,
    );
  }
});

test('scrolled to the very top, the page top sits fully below the strips', () => {
  const placement = resolveVerticalPlacement({ containerHeight: 731, rawTotalHeight: 25000, topRoom: 72 });
  const top = pageTopOnScreen({ padTop: placement.padTop, pageTop: 14, scrollTop: 0 });
  assert.ok(top >= scroller.top + 72, `page top ${top} must be at or below the strips' bottom ${scroller.top + 72}`);
});

test('a short (fitting) document gets the same room and is held still too', () => {
  const containerHeight = 731;
  const raw = 731 - 2; // repro-fixture: one page that just fits
  const none = resolveVerticalPlacement({ containerHeight, rawTotalHeight: raw, topRoom: 0 });
  assert.equal(none.contentHeight, raw, 'with no strips the layout is exactly the old one');
  const withRoom = resolveVerticalPlacement({ containerHeight, rawTotalHeight: raw, topRoom: 36 });
  const scrollHeight = withRoom.padTop + withRoom.contentHeight;
  assert.equal(scrollHeight, containerHeight + 36, 'scroll range is exactly the room');
  const held = compensateScrollTopForRoom(0, 0, 36);
  assert.ok(held <= scrollHeight - containerHeight, 'the compensating scroll offset is reachable');
  assert.equal(
    pageTopOnScreen({ padTop: withRoom.padTop, pageTop: 14, scrollTop: held }),
    pageTopOnScreen({ padTop: none.padTop, pageTop: 14, scrollTop: 0 }),
  );
});

test('strips going away never move the page: on-screen room waits until it scrolls off', () => {
  // Mid document: all 72px of room is above the screen, so it is given back at once.
  assert.equal(resolveTopRoom({ room: 72, inset: 0, scrollTop: 1236 }), 0);
  assert.equal(compensateScrollTopForRoom(1236, 72, 0), 1164);
  // Scrolled to the very top: the room is on screen, so it stays...
  assert.equal(resolveTopRoom({ room: 36, inset: 0, scrollTop: 0 }), 36);
  // ...and is handed back as it scrolls off (live: wheel 20 -> page moved 20).
  assert.equal(resolveTopRoom({ room: 36, inset: 0, scrollTop: 20 }), 16);
  assert.equal(compensateScrollTopForRoom(20, 36, 16), 0);
  assert.equal(resolveTopRoom({ room: 16, inset: 0, scrollTop: 30 }), 0);
  // A smaller strip set keeps its own room.
  assert.equal(resolveTopRoom({ room: 72, inset: 36, scrollTop: 500 }), 36);
  assert.equal(resolveTopRoom({ room: 72, inset: 36, scrollTop: 10 }), 62);
});

test('go to page lands the page top just below the strips', () => {
  const placement = resolveVerticalPlacement({ containerHeight: 731, rawTotalHeight: 25000, topRoom: 72 });
  const pageTop = 14 + 716.8 * 2; // page 3
  const scrollTop = resolvePageLandingScrollTop({
    padTop: placement.padTop, pageTop, fixedTopInset: 0, overlayInset: 72,
  });
  assert.equal(pageTopOnScreen({ padTop: placement.padTop, pageTop, scrollTop }), scroller.top + 72);
  // No strips: unchanged from before (page top flush with the viewer top).
  assert.equal(
    resolvePageLandingScrollTop({ padTop: 0, pageTop, fixedTopInset: 0, overlayInset: 0 }),
    pageTop,
  );
});

test('strips register and unregister, and become search occluders', () => {
  const attrs = new Map();
  const element = {
    setAttribute: (key, value) => attrs.set(key, value),
    hasAttribute: (key) => attrs.has(key),
  };
  let calls = 0;
  const unsubscribe = subscribeViewerTopOverlays(() => { calls += 1; });
  const release = registerViewerTopOverlay(element);
  assert.ok(getViewerTopOverlays().includes(element));
  assert.equal(attrs.get('data-viewer-occluder'), 'bar', 'search centres below the strips');
  release();
  assert.ok(!getViewerTopOverlays().includes(element));
  assert.equal(calls, 2);
  unsubscribe();
});

test('the viewer, the desktop host and the phone strips are wired to the room', () => {
  const viewer = read('../src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /resolveVerticalPlacement\(\{\s*containerHeight: containerH,\s*rawTotalHeight: rawTotalH,\s*topRoom,/);
  assert.match(viewer, /height: layout\.contentHeight/);
  assert.match(
    viewer,
    /useLayoutEffect\(\(\) => \{\s*const previous = appliedTopRoomRef\.current;[\s\S]*?compensateScrollTopForRoom\(el\.scrollTop, previous, topRoom\)/,
    'the scroll offset is compensated in the same layout pass as the room change',
  );
  assert.match(viewer, /const padTopFor = \(sc\) => centerPadFor\(sc\) \+ topRoomRef\.current;/, 'zoom anchoring includes the room');
  assert.match(viewer, /overlayInset: topInsetRef\.current/, 'go to page lands below the strips');
  assert.match(viewer, /subscribeViewerTopOverlays\(syncObserved\)/);

  const shell = read('../src/AppShell.jsx');
  assert.match(shell, /id="chrome-sub-toolbar-host"\s*ref=\{subToolbarHostRef\}/);
  assert.match(shell, /const subToolbarHostRef = useViewerTopOverlayRef\(\);/);

  const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
  const body = chrome.slice(
    chrome.indexOf('export function MobileToolProperties'),
    chrome.indexOf('export function MobilePdfViewerToolRail'),
  );
  // Every root strip's opening tag (attribute order free) carries the ref.
  const roots = body.match(/<div\s[^>]*?className="mobile-pdf-properties[ "][^>]*>/g) || [];
  assert.ok(roots.length >= 7, `expected every phone strip root, found ${roots.length}`);
  roots.forEach((root) => assert.match(root, /ref=\{topOverlayRef\}/, `phone strip must register: ${root.slice(0, 90)}`));
  const groups = body.match(/<div\s[^>]*?className="mobile-pdf-properties__[^>]*>/g) || [];
  groups.forEach((group) => assert.doesNotMatch(group, /topOverlayRef/, 'only the strip root registers, never a group inside it'));
});
