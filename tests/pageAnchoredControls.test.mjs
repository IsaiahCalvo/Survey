// pageAnchoredControls.test.mjs — the one placement rule for controls that
// belong to a mark on the page (the text / callout editor's tick and cross).
//
// Owner 2026-10-04: "the X and checkmark to commit it to the canvas are
// colliding with the text box of the callout. That shouldn't happen." and
// "When I pan around and scroll, that X and check mark don't move perfectly
// with the page ... they lag behind a little bit."
//
// 1. Placement (pure): outside the mark's visible box with a fixed gap, below
//    it first, above it near the bottom edge, never across a callout leader.
// 2. Lag guard (source): the pair is drawn INSIDE the page by the browser, not
//    moved to the page from a scroll listener / animation frame.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  PAGE_CONTROL_GAP_PX,
  TEXT_DESCENDER_RATIO,
  placeBesideMark,
  segmentIntersectsRect,
  textEditMarkRect,
} from '../src/utils/pageAnchoredControls.js';

const PAIR_W = 96;
const PAIR_H = 44;
const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const placedRect = (p) => rect(p.left, p.top, p.left + PAIR_W, p.top + PAIR_H);
const PAGE = rect(6, 6, 1200, 1500);

test('the mark is the box the renderers DRAW: descender strip and border ink included', () => {
  // A 16pt callout at 785% (the owner's screenshot): the drawn box is
  // fontSize * 0.35 taller than the stored box, which at that zoom is 44px -
  // the strip the tick/cross used to sit on.
  const s = 7.85;
  const m = textEditMarkRect({ left: 10, top: 20, width: 160, height: 40, fontSize: 16, inkPad: 1, scaleX: s, scaleY: s });
  assert.equal(TEXT_DESCENDER_RATIO, 0.35);
  assert.ok(Math.abs(m.bottom - (20 + 40 + 16 * 0.35 + 1) * s) < 1e-6, 'bottom = stored bottom + descender + ink');
  assert.ok(Math.abs(m.left - (10 - 1) * s) < 1e-6);
  assert.ok(Math.abs(m.right - (10 + 160 + 1) * s) < 1e-6);
  assert.ok(m.bottom - (20 + 40) * s > 44, 'the strip the pair used to cover is over 44px at 785%');
});

test('a rotated box is bounded by its rotated corners', () => {
  const m = textEditMarkRect({ left: 0, top: 0, width: 100, height: 20, angle: 90, fontSize: 0 });
  // 100x20 turned a quarter about its centre (50, 10): 20 wide, 100 tall.
  assert.ok(Math.abs(m.width - 20) < 1e-6 && Math.abs(m.height - 100) < 1e-6);
  assert.ok(Math.abs(m.left - 40) < 1e-6 && Math.abs(m.top - -40) < 1e-6);
});

test('with room, the pair sits centred under the mark at the house gap', () => {
  const mark = rect(300, 200, 600, 260);
  const p = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area: PAGE });
  assert.equal(p.side, 'below');
  assert.equal(p.top, 260 + PAGE_CONTROL_GAP_PX);
  assert.equal(p.left + PAIR_W / 2, 450);
});

test('the pair never covers the mark, wherever the mark is and whatever is visible', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2000; i += 1) {
    const w = 20 + rnd() * 1400;
    const h = 10 + rnd() * 900;
    const x = rnd() * 1300 - 100;
    const y = rnd() * 1600 - 100;
    const mark = rect(x, y, x + w, y + h);
    const ax = rnd() * 600;
    const ay = rnd() * 800;
    const area = rect(ax, ay, ax + 200 + rnd() * 1000, ay + 120 + rnd() * 900);
    const leader = rnd() < 0.5 ? [{ a: { x: x + w / 2, y: y + h }, b: { x: x + w / 2 + rnd() * 80 - 40, y: y + h + 200 } }] : [];
    const p = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area, avoid: leader });
    assert.ok(!overlaps(placedRect(p), mark), `pair ${JSON.stringify(p)} overlaps mark ${JSON.stringify(mark)}`);
  }
});

test('near the bottom of what is visible (or of the page) it flips above the mark', () => {
  const area = rect(6, 6, 384, 600); // e.g. a phone with the keyboard up
  const mark = rect(100, 500, 300, 560);
  const p = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area });
  assert.equal(p.side, 'above');
  assert.equal(p.top + PAIR_H, 500 - PAGE_CONTROL_GAP_PX);
});

test("a callout leader leaving straight down pushes the pair off it (owner: never on the leader)", () => {
  const mark = rect(300, 200, 420, 240);
  const leader = [{ a: { x: 360, y: 240 }, b: { x: 360, y: 420 } }];
  const p = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area: PAGE, avoid: leader });
  const r = placedRect(p);
  assert.ok(!segmentIntersectsRect(leader[0].a, leader[0].b, r), `pair ${p.side} sits on the leader`);
  assert.equal(p.side, 'above');
});

test('with no room above or below, it goes beside the mark', () => {
  const area = rect(0, 0, 1000, 300);
  const mark = rect(200, 40, 400, 260);
  const p = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area });
  assert.equal(p.side, 'right');
  assert.equal(p.left, 400 + PAGE_CONTROL_GAP_PX);
});

test('under a box wider than the screen it rides a lane the browser slides it along', () => {
  const area = rect(500, 0, 890, 2000);
  const mark = rect(0, 100, 2000, 200);
  const p = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area });
  assert.equal(p.side, 'below-slid');
  assert.deepEqual(p.span, { left: 0, width: 2000 }, 'the lane spans the mark (CSS sticky does the sliding)');
});

test('it keeps its side while that still fits: no flip-flop as the page scrolls past an edge', () => {
  const mark = rect(300, 200, 420, 240);
  const area = rect(0, 0, 1000, 1000);
  const p = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area, keepSide: 'above' });
  assert.equal(p.side, 'above');
  const q = placeBesideMark({ mark, width: PAIR_W, height: PAIR_H, area: rect(0, 230, 1000, 1000), keepSide: 'above' });
  assert.equal(q.side, 'below', 'a side that no longer fits is left');
});

// ---------------------------------------------------------------------------
// Lag guard. The root cause of the trailing tick/cross (and, before c771820,
// of the Spaces areas and their +/- controls) was a position:fixed layer
// outside the PDF scroller moved to the page from a scroll listener / per-frame
// loop -> React state: the browser draws the page in its new place first.
// ---------------------------------------------------------------------------
const overlaySrc = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');
const regionSrc = readFileSync(new URL('../src/RegionSelectionTool.jsx', import.meta.url), 'utf8');

test('lag guard: the tick/cross is drawn inside the page, never a fixed layer chasing it', () => {
  assert.doesNotMatch(overlaySrc, /createPortal/, 'no body portal');
  assert.doesNotMatch(overlaySrc, /position: 'fixed'/, 'no fixed layer');
  assert.doesNotMatch(overlaySrc, /followLoop/, 'no per-frame chase loop');
  assert.doesNotMatch(overlaySrc, /getBoundingClientRect\(\)[\s\S]{0,400}setActionAnchor/, 'its spot is not read off the screen each scroll');
  // Placed in page px by the shared rule; scroll only re-picks the side.
  assert.match(overlaySrc, /placeBesideMark\(\{/);
  assert.match(overlaySrc, /textEditMarkRect\(\{/);
  // A tap on it is a tap, not the start of a page pan (iPhone click).
  assert.match(overlaySrc, /data-pan-interactive="true"/);
});

test('lag guard: the Spaces area editor stays inside the page too (c771820)', () => {
  assert.match(regionSrc, /canvasRect && targetElement && createPortal\(/);
  assert.match(regionSrc, /\), targetElement\)\}/, 'portalled INTO the page target');
});
