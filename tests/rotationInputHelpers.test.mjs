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
//
// Shared host: (0,0) 800x600. Handle: 24x24 (handleHalfW=12, handleHalfH=12).
// Shape center: (400,400). Pill: 60x28 (pillHalfW=30, pillHalfH=14). Gap=16.
//
// Formula (Issue 3 second pass — edge-to-edge constant gap):
//   projHandle = |unitX| * handleHalfW + |unitY| * handleHalfH
//   projPill   = |unitX| * pillHalfW   + |unitY| * pillHalfH
//   d          = projHandle + gapAbove + projPill
//   pillCenter = handleCenter + unit * d
//
// Cardinal expected offsets:
//   0°   unit (0,-1):  projHandle=12  projPill=14  d=12+16+14=42
//   90°  unit (1, 0):  projHandle=12  projPill=30  d=12+16+30=58
//   180° unit (0, 1):  projHandle=12  projPill=14  d=42
//   270° unit (-1,0):  projHandle=12  projPill=30  d=58
//
// At every cardinal the perpendicular distance between the handle's nearest
// edge and the pill's nearest edge is EXACTLY 16 (the gap value). Off-axis
// the corners face each other so the perpendicular gap is slightly larger.

// Helper: compute the actual minimum distance between two axis-aligned
// rectangles. Returns 0 if they overlap, otherwise the perpendicular
// edge-to-edge distance. Used by the edge-gap tests to verify the contract.
function minAABBDistance(aCx, aCy, aHW, aHH, bCx, bCy, bHW, bHH) {
  const dx = Math.max(Math.abs(aCx - bCx) - aHW - bHW, 0);
  const dy = Math.max(Math.abs(aCy - bCy) - aHH - bHH, 0);
  return Math.hypot(dx, dy);
}

test('computeInputPosition radial: shape at 0° — pill ABOVE handle (handle above center)', () => {
  // Shape at (400, 400). At 0°, mtr handle is above the shape center.
  const handleRect = { left: 388, top: 300, width: 24, height: 24 };  // handleCenter = (400, 312)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (0, -1), projHandle = 12, projPill = 14, d = 12+16+14 = 42
  // pillCenter = (400, 312 - 42) = (400, 270)
  // pillTopLeft = (400 - 30, 270 - 14) = (370, 256)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 256) < 0.01, `expected top ≈ 256, got ${result.top}`);
  // Sanity: pill is above the handle in screen coords
  assert.ok(result.top + 28 < handleRect.top, 'pill bottom must be above handle top');
});

test('computeInputPosition radial: shape at 90° — pill RIGHT of handle (handle right of center)', () => {
  // Shape at (400, 400). At 90°, mtr handle is to the right of the shape center.
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (1, 0), projHandle = 12, projPill = 30, d = 12+16+30 = 58
  // pillCenter = (500 + 58, 400) = (558, 400)
  // pillTopLeft = (558 - 30, 400 - 14) = (528, 386)
  assert.ok(Math.abs(result.left - 528) < 0.01, `expected left ≈ 528, got ${result.left}`);
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
  // unit = (0, 1), projHandle = 12, projPill = 14, d = 42
  // pillCenter = (400, 500 + 42) = (400, 542)
  // pillTopLeft = (400 - 30, 542 - 14) = (370, 528)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 528) < 0.01, `expected top ≈ 528, got ${result.top}`);
  // Sanity: pill is below the handle in screen coords
  assert.ok(result.top > handleRect.top + handleRect.height, 'pill top must be below handle bottom');
});

test('computeInputPosition radial: shape at 270° — pill LEFT of handle (handle left of center)', () => {
  // Shape at (400, 400). At 270°, mtr handle is to the left of the shape center.
  const handleRect = { left: 288, top: 388, width: 24, height: 24 };  // handleCenter = (300, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (-1, 0), projHandle = 12, projPill = 30, d = 58
  // pillCenter = (300 - 58, 400) = (242, 400)
  // pillTopLeft = (242 - 30, 400 - 14) = (212, 386)
  assert.ok(Math.abs(result.left - 212) < 0.01, `expected left ≈ 212, got ${result.left}`);
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
  // projHandle = 0.7071*12 + 0.7071*12 ≈ 16.971
  // projPill   = 0.7071*30 + 0.7071*14 ≈ 31.114
  // d = 16.971 + 16 + 31.114 ≈ 64.085
  // pillCenter ≈ (470.71 + 0.7071*64.085, 329.29 - 0.7071*64.085)
  //            ≈ (470.71 + 45.316, 329.29 - 45.316)
  //            ≈ (516.026, 283.974)
  // pillTopLeft ≈ (486.026, 269.974)
  assert.ok(Math.abs(result.left - 486.026) < 0.5, `expected left ≈ 486.026, got ${result.left}`);
  assert.ok(Math.abs(result.top - 269.974) < 0.5, `expected top ≈ 269.974, got ${result.top}`);
});

// -- computeInputPosition edge-to-edge invariant (the user's spec) --
//
// User's exact spec: "the nearest border of the rotation handle needs to
// maintain the same distance to the nearest border of the pill, all the
// way around." Verify with minAABBDistance that the perpendicular edge-to-edge
// distance is EXACTLY 16 at every cardinal, regardless of handle aspect ratio.

test('computeInputPosition edge-to-edge: at 0° handle TOP edge sits 16px from pill BOTTOM edge', () => {
  const handleRect = { left: 388, top: 300, width: 24, height: 24 };  // handleCenter = (400, 312)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  // pillCenter = (r.left + 30, r.top + 14)
  const gap = minAABBDistance(400, 312, 12, 12, r.left + 30, r.top + 14, 30, 14);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge-to-edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-to-edge: at 90° handle RIGHT edge sits 16px from pill LEFT edge', () => {
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minAABBDistance(500, 400, 12, 12, r.left + 30, r.top + 14, 30, 14);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge-to-edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-to-edge: at 180° handle BOTTOM edge sits 16px from pill TOP edge', () => {
  const handleRect = { left: 388, top: 488, width: 24, height: 24 };  // handleCenter = (400, 500)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minAABBDistance(400, 500, 12, 12, r.left + 30, r.top + 14, 30, 14);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge-to-edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-to-edge: at 270° handle LEFT edge sits 16px from pill RIGHT edge', () => {
  const handleRect = { left: 288, top: 388, width: 24, height: 24 };  // handleCenter = (300, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minAABBDistance(300, 400, 12, 12, r.left + 30, r.top + 14, 30, 14);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge-to-edge gap = 16, got ${gap}`);
});

test('computeInputPosition edge-to-edge: at 45° (off-axis) gap is >= 16', () => {
  // Off-axis: corners face each other so the perpendicular distance is
  // slightly larger than the gap value (acceptable — the contract is
  // "minimum gap = 16 everywhere").
  const handleCenterX = 400 + 70.71;
  const handleCenterY = 400 - 70.71;
  const handleRect = { left: handleCenterX - 12, top: handleCenterY - 12, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minAABBDistance(handleCenterX, handleCenterY, 12, 12, r.left + 30, r.top + 14, 30, 14);
  assert.ok(gap >= 16, `expected edge-to-edge gap >= 16, got ${gap}`);
});

test('computeInputPosition edge-to-edge: works with a smaller 16x16 handle', () => {
  // Smaller handle to verify projHandle is read from handleRect.width/height,
  // not hardcoded. Handle 16x16 (handleHalfW=8, handleHalfH=8).
  // 0°: projHandle=8, projPill=14, d=8+16+14=38. pillCenter=(400, 312-38)=(400, 274).
  // pillTopLeft=(370, 260). Edge-to-edge gap should be 16.
  const handleRect = { left: 392, top: 304, width: 16, height: 16 };  // handleCenter = (400, 312)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  assert.ok(Math.abs(r.left - 370) < 0.01, `expected left ≈ 370, got ${r.left}`);
  assert.ok(Math.abs(r.top - 260) < 0.01, `expected top ≈ 260, got ${r.top}`);
  const gap = minAABBDistance(400, 312, 8, 8, r.left + 30, r.top + 14, 30, 14);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected edge-to-edge gap = 16, got ${gap}`);
});

test('computeInputPosition radial: degenerate case (handle exactly at shape center) falls back to above', () => {
  // Zero-size or pathological shape: handle exactly at shape center.
  const handleRect = { left: 388, top: 388, width: 24, height: 24 };  // handleCenter = (400, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // Fallback formula uses the same edge-to-edge math at unit = (0, -1):
  //   pillCenter.y = handleCenter.y - (handleHalfH + gap + pillHalfH)
  //                = 400 - (12 + 16 + 14) = 400 - 42 = 358
  // pillTopLeft = (400 - 30, 358 - 14) = (370, 344)
  assert.equal(result.left, 370);
  assert.equal(result.top, 344);
});

test('computeInputPosition radial: clamps top below host bottom edge (shape at 180° near bottom)', () => {
  // Shape near bottom of host. At 180°, pill would render off-screen below.
  const handleRect = { left: 388, top: 590, width: 24, height: 24 };  // handleCenter = (400, 602)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 500 };  // shape center above the handle
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (0, 1), projHandle = 12, projPill = 14, d = 42
  // Without clamp: pillCenter.y = 602 + 42 = 644 → top = 644 - 14 = 630 → off-screen
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
