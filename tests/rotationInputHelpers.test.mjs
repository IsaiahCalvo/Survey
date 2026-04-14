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
// Half-diagonal of a 60x28 pill = √(30² + 14²) = √(900+196) = √1096 ≈ 33.106
// Offset = halfDiag + gapAbove(16) ≈ 49.106
//
// At 0° (shape upright), handle is ABOVE shape center: handleCenter.y < shapeCenter.y
// At 90°,                handle is to the RIGHT of shape center
// At 180°,               handle is BELOW shape center
// At 270°,               handle is to the LEFT of shape center
//
// We verify the pill sits OUTSIDE the handle along the (center → handle) ray.

test('computeInputPosition radial: shape at 0° — pill ABOVE handle (handle above center)', () => {
  // Shape at (400, 400). At 0°, mtr handle is above the shape center.
  const handleRect = { left: 388, top: 300, width: 24, height: 24 };  // handleCenter = (400, 312)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // vec = (0, -88), unit = (0, -1), offset ≈ 49.106
  // pillCenter = (400, 312 - 49.106) = (400, 262.894)
  // pillTopLeft = (400 - 30, 262.894 - 14) = (370, 248.894)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 248.894) < 0.01, `expected top ≈ 248.894, got ${result.top}`);
  // Sanity: pill is above the handle in screen coords
  assert.ok(result.top + 28 < handleRect.top, 'pill bottom must be above handle top');
});

test('computeInputPosition radial: shape at 90° — pill RIGHT of handle (handle right of center)', () => {
  // Shape at (400, 400). At 90°, mtr handle is to the right of the shape center.
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // vec = (100, 0), unit = (1, 0), offset ≈ 49.106
  // pillCenter = (500 + 49.106, 400) = (549.106, 400)
  // pillTopLeft = (549.106 - 30, 400 - 14) = (519.106, 386)
  assert.ok(Math.abs(result.left - 519.106) < 0.01, `expected left ≈ 519.106, got ${result.left}`);
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
  // vec = (0, 100), unit = (0, 1), offset ≈ 49.106
  // pillCenter = (400, 500 + 49.106) = (400, 549.106)
  // pillTopLeft = (400 - 30, 549.106 - 14) = (370, 535.106)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 535.106) < 0.01, `expected top ≈ 535.106, got ${result.top}`);
  // Sanity: pill is below the handle in screen coords
  assert.ok(result.top > handleRect.top + handleRect.height, 'pill top must be below handle bottom');
});

test('computeInputPosition radial: shape at 270° — pill LEFT of handle (handle left of center)', () => {
  // Shape at (400, 400). At 270°, mtr handle is to the left of the shape center.
  const handleRect = { left: 288, top: 388, width: 24, height: 24 };  // handleCenter = (300, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // vec = (-100, 0), unit = (-1, 0), offset ≈ 49.106
  // pillCenter = (300 - 49.106, 400) = (250.894, 400)
  // pillTopLeft = (250.894 - 30, 400 - 14) = (220.894, 386)
  assert.ok(Math.abs(result.left - 220.894) < 0.01, `expected left ≈ 220.894, got ${result.left}`);
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
  // unit ≈ (0.7071, -0.7071), offset ≈ 49.106
  // pillCenter ≈ (470.71 + 34.72, 329.29 - 34.72) ≈ (505.43, 294.57)
  // pillTopLeft ≈ (475.43, 280.57)
  assert.ok(Math.abs(result.left - 475.43) < 0.5, `expected left ≈ 475.43, got ${result.left}`);
  assert.ok(Math.abs(result.top - 280.57) < 0.5, `expected top ≈ 280.57, got ${result.top}`);
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
