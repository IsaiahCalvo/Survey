// Pan axis rules (owner 2026-10-27; numbers from Drawboard PDF's web bundle,
// checked live): rails for near-straight drags / touchpad scrolls, and no
// sideways movement for a page that fits. docs/VIEWER-PAN-ZOOM-RULES.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXIS_SNAP_RESET_MS,
  DRAG_AXIS_SNAP,
  WHEEL_AXIS_SNAP,
  createAxisSnap,
  limitHorizontalDelta,
  resolveHorizontalPanRange,
} from '../src/utils/panAxisRules.js';

const drag = (snap, dx, dy, steps, t0 = 0) => {
  let x = 0;
  let y = 0;
  for (let i = 0; i < steps; i += 1) {
    const out = snap.step(dx, dy, t0 + i * 16);
    x += out.dx;
    y += out.dy;
  }
  return { x, y };
};

test('a drag up to ~17 degrees off vertical runs straight down', () => {
  for (const share of [0, 0.1, 0.15, 0.25]) {
    const snap = createAxisSnap(DRAG_AXIS_SNAP);
    const moved = drag(snap, 8 * share, 8, 20);
    assert.equal(moved.x, 0, `share ${share}`);
    assert.equal(moved.y, 160);
    assert.equal(snap.axis(), 'vertical');
  }
});

test('a clearly diagonal drag moves freely on both axes', () => {
  const snap = createAxisSnap(DRAG_AXIS_SNAP);
  const moved = drag(snap, 8, 8, 20);
  assert.equal(snap.axis(), 'free');
  assert.equal(moved.x, 160);
  assert.equal(moved.y, 160);
});

test('a near-horizontal drag snaps to the horizontal rail from its first step', () => {
  const snap = createAxisSnap(DRAG_AXIS_SNAP);
  const moved = drag(snap, 8, 1.2, 20);
  assert.equal(snap.axis(), 'horizontal');
  assert.equal(moved.x, 160);
  assert.equal(moved.y, 0);
});

test('breaking off a rail needs more than joining one (hysteresis)', () => {
  const snap = createAxisSnap(DRAG_AXIS_SNAP);
  drag(snap, 8, 8, 10);
  assert.equal(snap.axis(), 'free');
  // Turning to 25% sideways from free: above the 20% snap ratio, stays free.
  drag(snap, 2, 8, 30, 160);
  assert.equal(snap.axis(), 'free');
  // Under 20%: joins the vertical rail.
  drag(snap, 1, 8, 30, 640);
  assert.equal(snap.axis(), 'vertical');
});

test('the rail resets to vertical after a pause, and release keeps the rail', () => {
  const snap = createAxisSnap(DRAG_AXIS_SNAP);
  drag(snap, 8, 0, 5);
  assert.equal(snap.axis(), 'horizontal');
  assert.deepEqual(snap.release(1.5, 0.3), { vx: 1.5, vy: 0 });
  snap.step(0, 0, 64 + AXIS_SNAP_RESET_MS + 1);
  assert.equal(snap.axis(), 'vertical');
  assert.deepEqual(snap.release(0.3, 1.5), { vx: 0, vy: 1.5 });
});

test('touchpad rails are firmer: a 40% sideways drift still scrolls straight', () => {
  const snap = createAxisSnap(WHEEL_AXIS_SNAP);
  const moved = drag(snap, 5, 12, 15);
  assert.equal(moved.x, 0);
  assert.equal(snap.axis(), 'vertical');
});

test('a page wider than the band between the panels keeps the whole scroll range', () => {
  const range = resolveHorizontalPanRange({
    scrollLeft: 300, maxLeft: 900, pageLeft: -300, pageWidth: 1800, viewportWidth: 1300,
  });
  assert.deepEqual(range, { lo: 0, hi: 900, fits: false });
  assert.equal(limitHorizontalDelta(40, 300, range), 40);
});

test('a page that fits and is fully in view is locked sideways', () => {
  // Fit page, no panels, no scroll room.
  let range = resolveHorizontalPanRange({ scrollLeft: 0, maxLeft: 0, pageLeft: 357, pageWidth: 590, viewportWidth: 1304 });
  assert.deepEqual(range, { lo: 0, hi: 0, fits: true });
  // Pages panel open (260 px room each way), page clear of it.
  range = resolveHorizontalPanRange({
    scrollLeft: 260, maxLeft: 260, pageLeft: 357, pageWidth: 590, viewportWidth: 1304, insetLeft: 260,
  });
  assert.deepEqual(range, { lo: 260, hi: 260, fits: true });
  assert.equal(limitHorizontalDelta(-120, 260, range), 0);
  assert.equal(limitHorizontalDelta(120, 260, range), 0);
});

test('a fitting page under a panel only slides out until it clears it', () => {
  // A 272 px panel opened on the right over a page whose right edge is at 1200.
  const range = resolveHorizontalPanRange({
    scrollLeft: 400, maxLeft: 672, pageLeft: 500, pageWidth: 700, viewportWidth: 1304, insetRight: 272,
  });
  // Needs 1200 - 1032 = 168 px of scroll to clear the panel; never the other way.
  assert.deepEqual(range, { lo: 400, hi: 568, fits: true });
  assert.equal(limitHorizontalDelta(500, 400, range), 168);
  assert.equal(limitHorizontalDelta(-50, 400, range), 0);
});

test('a page sliding out from under a panel stops a page margin clear of it', () => {
  const range = resolveHorizontalPanRange({
    scrollLeft: 260, maxLeft: 260, pageLeft: 142, pageWidth: 900, viewportWidth: 1304, insetLeft: 260, margin: 20,
  });
  // Left edge 142 -> 280 (panel edge 260 + 20).
  assert.deepEqual(range, { lo: 122, hi: 260, fits: true });
  // A band only 10 px wider than the page: the gap shrinks to fit.
  const tight = resolveHorizontalPanRange({
    scrollLeft: 260, maxLeft: 260, pageLeft: 200, pageWidth: 1034, viewportWidth: 1304, insetLeft: 260, margin: 20,
  });
  assert.equal(tight.lo, 260 - (265 - 200));
});

test('a page exactly as wide as the band fits (no half-pixel wobble)', () => {
  const range = resolveHorizontalPanRange({ scrollLeft: 0, maxLeft: 0.3, pageLeft: 0.2, pageWidth: 1304.3, viewportWidth: 1304 });
  assert.equal(range.fits, true);
  assert.equal(range.hi - range.lo <= 0.3, true);
});
