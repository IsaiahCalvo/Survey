import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTypedDegrees,
  computeInputPosition,
} from '../src/utils/rotationInputHelpers.js';

// -- normalizeTypedDegrees --

test('normalizeTypedDegrees accepts "45" and returns 45', () => {
  assert.equal(normalizeTypedDegrees('45'), 45);
});

test('normalizeTypedDegrees accepts "0" and returns 0', () => {
  assert.equal(normalizeTypedDegrees('0'), 0);
});

test('normalizeTypedDegrees accepts "359" and returns 359', () => {
  assert.equal(normalizeTypedDegrees('359'), 359);
});

test('normalizeTypedDegrees wraps "360" to 0', () => {
  assert.equal(normalizeTypedDegrees('360'), 0);
});

test('normalizeTypedDegrees wraps "405" to 45', () => {
  assert.equal(normalizeTypedDegrees('405'), 45);
});

test('normalizeTypedDegrees wraps negative "-5" to 355', () => {
  assert.equal(normalizeTypedDegrees('-5'), 355);
});

test('normalizeTypedDegrees wraps "-360" to 0', () => {
  assert.equal(normalizeTypedDegrees('-360'), 0);
});

test('normalizeTypedDegrees wraps "720" (double) to 0', () => {
  assert.equal(normalizeTypedDegrees('720'), 0);
});

test('normalizeTypedDegrees returns null for non-numeric "abc"', () => {
  assert.equal(normalizeTypedDegrees('abc'), null);
});

test('normalizeTypedDegrees returns null for empty string', () => {
  assert.equal(normalizeTypedDegrees(''), null);
});

test('normalizeTypedDegrees returns null for whitespace-only string', () => {
  assert.equal(normalizeTypedDegrees('  '), null);
});

test('normalizeTypedDegrees returns null for null', () => {
  assert.equal(normalizeTypedDegrees(null), null);
});

test('normalizeTypedDegrees returns null for undefined', () => {
  assert.equal(normalizeTypedDegrees(undefined), null);
});

test('normalizeTypedDegrees rounds "45.7" to 46 (integer-only contract)', () => {
  assert.equal(normalizeTypedDegrees('45.7'), 46);
});

test('normalizeTypedDegrees accepts a numeric value (not just string)', () => {
  assert.equal(normalizeTypedDegrees(45), 45);
});

// -- computeInputPosition --

test('computeInputPosition centers input above handle in middle of host', () => {
  const handleRect = { left: 200, top: 200, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const result = computeInputPosition(handleRect, hostRect);
  // handleCenterX = 212; computedLeft = 212 - 30 = 182
  // computedTop = 200 - 16 - 28 = 156
  assert.equal(result.left, 182);
  assert.equal(result.top, 156);
});

test('computeInputPosition clamps top to edgeMargin when handle near top edge', () => {
  const handleRect = { left: 200, top: 2, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const result = computeInputPosition(handleRect, hostRect);
  // computedTop = 2 - 16 - 28 = -42; clamped to 4
  assert.equal(result.top, 4);
});

test('computeInputPosition clamps left to host right edge when handle near right edge', () => {
  const handleRect = { left: 790, top: 200, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const result = computeInputPosition(handleRect, hostRect);
  // handleCenterX = 802; computedLeft = 802 - 30 = 772
  // max allowed = 800 - 60 - 4 = 736
  assert.equal(result.left, 736);
});

test('computeInputPosition clamps left to edgeMargin when handle near left edge', () => {
  const handleRect = { left: 10, top: 200, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const result = computeInputPosition(handleRect, hostRect);
  // handleCenterX = 22; computedLeft = 22 - 30 = -8; clamped to 4
  assert.equal(result.left, 4);
});

test('computeInputPosition handles non-zero hostRect origin (handle in screen space, host offset)', () => {
  const handleRect = { left: 300, top: 300, width: 24, height: 24 };
  const hostRect = { left: 100, top: 100, width: 800, height: 600 };
  const result = computeInputPosition(handleRect, hostRect);
  // handleCenterX = 312; computedLeft = (312 - 100) - 30 = 182
  // computedTop = (300 - 100) - 16 - 28 = 156
  assert.equal(result.left, 182);
  assert.equal(result.top, 156);
});

// -- computeInputPosition radial placement (shapeCenter param) --

// Shared host: (0,0) 800x600. Handle: 24x24. Shape center: (400,400).
// Pill: 60x28, halfW=30, halfH=14, gapAbove=16
//
// New formula (Issue 3 fix — support function of an AABB):
//   projHalfExtent = |unitX| * halfW + |unitY| * halfH
//   d              = projHalfExtent + gapAbove
//   pillCenter     = handleCenter + unit * d
//
// Cardinal expected offsets (d = projHalfExtent + 16):
//   0°    unit (0,-1):  proj=14  d=30
//   90°   unit (1, 0):  proj=30  d=46
//   180°  unit (0, 1):  proj=14  d=30
//   270°  unit (-1,0):  proj=30  d=46
//
// The pill's NEAREST EDGE is exactly 16px from the handle center at every
// cardinal — the user's expected behavior ("same distance anywhere around
// the shape").

// Helper: compute the actual minimum distance from a point to an axis-aligned
// rectangle. Used by the edge-gap tests to verify the pill's nearest edge is
// exactly `gapAbove` from the handle center.
function minDistPointToRect(px, py, rectLeft, rectTop, rectWidth, rectHeight) {
  const dx = Math.max(rectLeft - px, 0, px - (rectLeft + rectWidth));
  const dy = Math.max(rectTop - py, 0, py - (rectTop + rectHeight));
  return Math.hypot(dx, dy);
}

test('computeInputPosition radial: shape at 0° — pill ABOVE handle (handle above center)', () => {
  // Shape at (400, 400). At 0°, mtr handle is above the shape center.
  const handleRect = { left: 388, top: 300, width: 24, height: 24 };  // handleCenter = (400, 312)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (0, -1), proj = |0|*30 + |-1|*14 = 14, d = 30
  // pillCenter = (400, 312 - 30) = (400, 282)
  // pillTopLeft = (400 - 30, 282 - 14) = (370, 268)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 268) < 0.01, `expected top ≈ 268, got ${result.top}`);
  // Sanity: pill is above the handle in screen coords
  assert.ok(result.top + 28 < handleRect.top, 'pill bottom must be above handle top');
});

test('computeInputPosition radial: shape at 90° — pill RIGHT of handle (handle right of center)', () => {
  // Shape at (400, 400). At 90°, mtr handle is to the right of the shape center.
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (1, 0), proj = |1|*30 + |0|*14 = 30, d = 46
  // pillCenter = (500 + 46, 400) = (546, 400)
  // pillTopLeft = (546 - 30, 400 - 14) = (516, 386)
  assert.ok(Math.abs(result.left - 516) < 0.01, `expected left ≈ 516, got ${result.left}`);
  assert.ok(Math.abs(result.top - 386) < 0.01, `expected top ≈ 386, got ${result.top}`);
  // Sanity: pill is to the right of the handle in screen coords
  assert.ok(result.left > handleRect.left + handleRect.width, 'pill left must be right of handle right');
});

test('computeInputPosition radial: shape at 180° — pill BELOW handle (handle below center)', () => {
  // Shape at (400, 400). At 180°, mtr handle is below the shape center.
  const handleRect = { left: 388, top: 488, width: 24, height: 24 };  // handleCenter = (400, 500)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (0, 1), proj = 14, d = 30
  // pillCenter = (400, 500 + 30) = (400, 530)
  // pillTopLeft = (400 - 30, 530 - 14) = (370, 516)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 516) < 0.01, `expected top ≈ 516, got ${result.top}`);
  // Sanity: pill is below the handle in screen coords
  assert.ok(result.top > handleRect.top + handleRect.height, 'pill top must be below handle bottom');
});

test('computeInputPosition radial: shape at 270° — pill LEFT of handle (handle left of center)', () => {
  // Shape at (400, 400). At 270°, mtr handle is to the left of the shape center.
  const handleRect = { left: 288, top: 388, width: 24, height: 24 };  // handleCenter = (300, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (-1, 0), proj = 30, d = 46
  // pillCenter = (300 - 46, 400) = (254, 400)
  // pillTopLeft = (254 - 30, 400 - 14) = (224, 386)
  assert.ok(Math.abs(result.left - 224) < 0.01, `expected left ≈ 224, got ${result.left}`);
  assert.ok(Math.abs(result.top - 386) < 0.01, `expected top ≈ 386, got ${result.top}`);
  // Sanity: pill is to the left of the handle in screen coords
  assert.ok(result.left + 60 < handleRect.left, 'pill right must be left of handle left');
});

test('computeInputPosition radial: shape at 45° (off-axis) — pill on diagonal away from center', () => {
  // Shape at (400, 400). At 45°, mtr handle is up-right of the shape center.
  // Use (100/√2, -100/√2) ≈ (70.71, -70.71) as the (handleCenter - shapeCenter) vector.
  const handleCenterX = 400 + 70.71;  // ≈ 470.71
  const handleCenterY = 400 - 70.71;  // ≈ 329.29
  const handleRect = { left: handleCenterX - 12, top: handleCenterY - 12, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit ≈ (0.7071, -0.7071)
  // proj = 0.7071*30 + 0.7071*14 = 0.7071 * 44 ≈ 31.114
  // d = 47.114
  // pillCenter ≈ (470.71 + 0.7071*47.114, 329.29 - 0.7071*47.114)
  //            ≈ (470.71 + 33.317, 329.29 - 33.317)
  //            ≈ (504.027, 295.973)
  // pillTopLeft ≈ (474.027, 281.973)
  assert.ok(Math.abs(result.left - 474.027) < 0.5, `expected left ≈ 474.027, got ${result.left}`);
  assert.ok(Math.abs(result.top - 281.973) < 0.5, `expected top ≈ 281.973, got ${result.top}`);
});

// -- computeInputPosition edge-gap invariant (support function correctness) --
//
// The user's contract: "Whatever distance we have when it's on top of the
// shape, we want that same distance anywhere around the shape." The support
// function gives an EXACT 16px gap at all 4 cardinals, and a slightly larger
// gap at off-axis directions (max ~20px at the diagonals — accepted).

test('computeInputPosition edge-gap: at 0° the pill TOP edge is exactly 16px from handle center', () => {
  const handleRect = { left: 388, top: 300, width: 24, height: 24 };  // handleCenter = (400, 312)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minDistPointToRect(400, 312, r.left, r.top, 60, 28);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-gap: at 90° the pill LEFT edge is exactly 16px from handle center', () => {
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minDistPointToRect(500, 400, r.left, r.top, 60, 28);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-gap: at 180° the pill BOTTOM edge is exactly 16px from handle center', () => {
  const handleRect = { left: 388, top: 488, width: 24, height: 24 };  // handleCenter = (400, 500)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minDistPointToRect(400, 500, r.left, r.top, 60, 28);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-gap: at 270° the pill RIGHT edge is exactly 16px from handle center', () => {
  const handleRect = { left: 288, top: 388, width: 24, height: 24 };  // handleCenter = (300, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minDistPointToRect(300, 400, r.left, r.top, 60, 28);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-gap: at 45° (diagonal) the pill nearest-edge gap is in [16, 22]', () => {
  // The 45° corner case: support function gives proj ≈ 31.1, so pillCenter
  // is ~47.1 from handle center along the unit vector. The actual minimum
  // distance from handle center to the pill rectangle is slightly larger
  // than 16 because the pill's CORNER is what's nearest to the handle
  // (not its edge). This is the support function being correct.
  const handleCenterX = 400 + 70.71;
  const handleCenterY = 400 - 70.71;
  const handleRect = { left: handleCenterX - 12, top: handleCenterY - 12, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minDistPointToRect(handleCenterX, handleCenterY, r.left, r.top, 60, 28);
  assert.ok(gap >= 16, `expected edge gap >= 16, got ${gap}`);
  assert.ok(gap <= 22, `expected edge gap <= 22, got ${gap}`);
});

test('computeInputPosition radial: degenerate case (handle exactly at shape center) falls back to above', () => {
  // Zero-size or pathological shape: handle exactly at shape center.
  const handleRect = { left: 388, top: 388, width: 24, height: 24 };  // handleCenter = (400, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // Fallback: pillCenter = (400, 400 - 14 - 16) = (400, 370)
  // pillTopLeft = (400 - 30, 370 - 14) = (370, 356)
  assert.equal(result.left, 370);
  assert.equal(result.top, 356);
});

test('computeInputPosition radial: clamps top below host bottom edge (shape at 180° near bottom)', () => {
  // Shape near bottom of host. At 180°, pill would render off-screen below.
  const handleRect = { left: 388, top: 590, width: 24, height: 24 };  // handleCenter = (400, 602) — already off-screen but realistic for clamp test
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 500 };  // shape center above the handle
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // Without clamp: pillCenter.y ≈ 602 + 49.106 = 651.106 → top ≈ 637.106 → off-screen
  // Clamp: top = hostRect.height - inputHeight - edgeMargin = 600 - 28 - 4 = 568
  assert.equal(result.top, 568);
});

test('computeInputPosition LEGACY: omitting shapeCenter still returns the original 0°-above placement', () => {
  // Regression: the original 5 tests above (which omit shapeCenter) must
  // continue to pass byte-identically. This test re-asserts the canonical
  // case to make the legacy fallback contract explicit.
  const handleRect = { left: 200, top: 200, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const result = computeInputPosition(handleRect, hostRect);  // shapeCenter omitted
  // Same as the first test in this suite.
  assert.equal(result.left, 182);
  assert.equal(result.top, 156);
});
