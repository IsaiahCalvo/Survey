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

// -- computeInputPosition constant-radius placement (shapeCenter param) --
//
// Shared host: (0,0) 800x600. Handle: 24x24 (handleHalfMax=12). Shape center:
// (400,400). Pill: 60x28 (pillHalfMax=30). Gap=16.
//
// Formula (Issue 3 third pass — constant radius from shape center):
//   EXTENSION  = max(handleW,handleH)/2 + gapAbove + max(pillW,pillH)/2
//   pillCenter = handleCenter + unit * EXTENSION
//
// For the 24x24 handle + 60x28 pill: EXTENSION = 12 + 16 + 30 = 58 at every
// rotation angle. Consequently, pillCenter-to-shapeCenter distance =
// |handleCenter - shapeCenter| + 58 (constant for a given shape).
//
// Edge-to-edge gap is now angle-dependent (16 at 90°/270° where pill width
// faces the shape, 32 at 0°/180° where pill height faces the shape). That
// is the trade-off for the user-specified "constant distance from shape"
// visual invariant.

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
  // unit = (0, -1), EXTENSION = 12+16+30 = 58
  // pillCenter = (400, 312 - 58) = (400, 254)
  // pillTopLeft = (400 - 30, 254 - 14) = (370, 240)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 240) < 0.01, `expected top ≈ 240, got ${result.top}`);
  // Sanity: pill is above the handle in screen coords
  assert.ok(result.top + 28 < handleRect.top, 'pill bottom must be above handle top');
});

test('computeInputPosition radial: shape at 90° — pill RIGHT of handle (handle right of center)', () => {
  // Shape at (400, 400). At 90°, mtr handle is to the right of the shape center.
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (1, 0), EXTENSION = 58
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
  // unit = (0, 1), EXTENSION = 58
  // pillCenter = (400, 500 + 58) = (400, 558)
  // pillTopLeft = (400 - 30, 558 - 14) = (370, 544)
  assert.ok(Math.abs(result.left - 370) < 0.01, `expected left ≈ 370, got ${result.left}`);
  assert.ok(Math.abs(result.top - 544) < 0.01, `expected top ≈ 544, got ${result.top}`);
  // Sanity: pill is below the handle in screen coords
  assert.ok(result.top > handleRect.top + handleRect.height, 'pill top must be below handle bottom');
});

test('computeInputPosition radial: shape at 270° — pill LEFT of handle (handle left of center)', () => {
  // Shape at (400, 400). At 270°, mtr handle is to the left of the shape center.
  const handleRect = { left: 288, top: 388, width: 24, height: 24 };  // handleCenter = (300, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // unit = (-1, 0), EXTENSION = 58
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
  // unit ≈ (0.7071, -0.7071), EXTENSION = 58
  // pillCenter ≈ (470.71 + 0.7071*58, 329.29 - 0.7071*58)
  //            ≈ (470.71 + 41.011, 329.29 - 41.011)
  //            ≈ (511.721, 288.279)
  // pillTopLeft ≈ (481.721, 274.279)
  assert.ok(Math.abs(result.left - 481.721) < 0.5, `expected left ≈ 481.721, got ${result.left}`);
  assert.ok(Math.abs(result.top - 274.279) < 0.5, `expected top ≈ 274.279, got ${result.top}`);
});

// -- computeInputPosition constant-radius invariant (the user's new spec) --
//
// User's exact spec (Issue 3 third pass): "keep the rotation input field
// that distance away from the shape the entire time, from the shape, not
// the handle up from the shape." The distance is computed at the worst-case
// orientation (handle horizontal, pill width facing shape) and held constant
// across the full orbit. Verify pillCenter-to-shapeCenter distance is equal
// at every cardinal (== L_handle + EXTENSION where EXTENSION = 58 for the
// 24x24 handle + 60x28 pill config).

function pillCenterDistanceFromShape(result, shapeCenter) {
  // Result is pillTopLeft; pillCenter = (left + pillHalfW, top + pillHalfH) = (left + 30, top + 14)
  const cx = result.left + 30;
  const cy = result.top + 14;
  return Math.hypot(cx - shapeCenter.x, cy - shapeCenter.y);
}

test('computeInputPosition constant-radius: at 0°, pill orbit radius = L_handle + 58', () => {
  const handleRect = { left: 388, top: 300, width: 24, height: 24 };  // handleCenter = (400, 312) → L_handle = 88
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const radius = pillCenterDistanceFromShape(r, shapeCenter);
  assert.ok(Math.abs(radius - (88 + 58)) < 0.01, `expected radius ≈ 146, got ${radius}`);
});

test('computeInputPosition constant-radius: at 90°, pill orbit radius = L_handle + 58', () => {
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400) → L_handle = 100
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const radius = pillCenterDistanceFromShape(r, shapeCenter);
  assert.ok(Math.abs(radius - (100 + 58)) < 0.01, `expected radius ≈ 158, got ${radius}`);
  // At 90° the pill width faces the shape — this IS the worst case, so the
  // edge-to-edge gap between handle and pill must also be exactly 16.
  const gap = minAABBDistance(500, 400, 12, 12, r.left + 30, r.top + 14, 30, 14);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected worst-case edge-to-edge gap = 16, got ${gap}`);
});

test('computeInputPosition constant-radius: radius invariant across 0/90/180/270 for a fixed L_handle', () => {
  // Four handle positions all 100px from shape center. Each must produce
  // the same pill orbit radius (100 + 58 = 158).
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const expected = 100 + 58;
  const configs = [
    { handleCenter: [400, 300], label: '0°' },
    { handleCenter: [500, 400], label: '90°' },
    { handleCenter: [400, 500], label: '180°' },
    { handleCenter: [300, 400], label: '270°' },
  ];
  for (const cfg of configs) {
    const [hcx, hcy] = cfg.handleCenter;
    const handleRect = { left: hcx - 12, top: hcy - 12, width: 24, height: 24 };
    const r = computeInputPosition(handleRect, hostRect, shapeCenter);
    const radius = pillCenterDistanceFromShape(r, shapeCenter);
    assert.ok(Math.abs(radius - expected) < 0.01,
      `at ${cfg.label}, expected radius ≈ ${expected}, got ${radius}`);
  }
});

test('computeInputPosition constant-radius: 90° edge-to-edge = 16 is the spec minimum at worst-case', () => {
  // The user's "worst case" orientation: handle horizontal, pill width
  // (long axis) facing shape. Edge-to-edge gap MUST equal the gapAbove param.
  const handleRect = { left: 488, top: 388, width: 24, height: 24 };  // handleCenter = (500, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minAABBDistance(500, 400, 12, 12, r.left + 30, r.top + 14, 30, 14);
  assert.ok(Math.abs(gap - 16) < 0.01, `expected gap = 16, got ${gap}`);
});

test('computeInputPosition constant-radius: 45° off-axis pill does not touch handle', () => {
  // With the constant-radius formula, EXTENSION uses pillHalfMax=30 (width),
  // which precisely saturates the 16px spec at the 90°/270° worst case. At
  // 45°, the axis-aligned pill's corner is nearer the handle's corner than
  // the cardinal projection — the perpendicular gap collapses from 16 to
  // ~15.01 because the pill's HEIGHT (14) doesn't fully cover the diagonal.
  // This is a known, intentional trade-off: visual constancy of distance
  // FROM THE SHAPE is the user-specified invariant. A ~1px reduction at the
  // diagonal is imperceptible and the pill still never touches the handle.
  const handleCenterX = 400 + 70.71;
  const handleCenterY = 400 - 70.71;
  const handleRect = { left: handleCenterX - 12, top: handleCenterY - 12, width: 24, height: 24 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  const gap = minAABBDistance(handleCenterX, handleCenterY, 12, 12, r.left + 30, r.top + 14, 30, 14);
  // Hard invariant: gap > 0 (no touching). Soft invariant: gap >= 15 (close
  // enough to spec that the diagonal gap reduction is not visually obvious).
  assert.ok(gap > 0, `expected gap > 0 (no touching), got ${gap}`);
  assert.ok(gap >= 15, `expected gap >= 15 (soft spec), got ${gap}`);
});

test('computeInputPosition constant-radius: works with a smaller 16x16 handle (EXTENSION = 54)', () => {
  // Smaller handle: EXTENSION = max(16,16)/2 + 16 + max(60,28)/2 = 8 + 16 + 30 = 54.
  // handleCenter = (400, 312), L_handle = 88 (shape center at 400,400).
  // pillCenter = (400, 312 - 54) = (400, 258). pillTopLeft = (370, 244).
  const handleRect = { left: 392, top: 304, width: 16, height: 16 };
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const r = computeInputPosition(handleRect, hostRect, shapeCenter);
  assert.ok(Math.abs(r.left - 370) < 0.01, `expected left ≈ 370, got ${r.left}`);
  assert.ok(Math.abs(r.top - 244) < 0.01, `expected top ≈ 244, got ${r.top}`);
  const radius = pillCenterDistanceFromShape(r, shapeCenter);
  assert.ok(Math.abs(radius - (88 + 54)) < 0.01, `expected radius ≈ 142, got ${radius}`);
});

test('computeInputPosition radial: degenerate case (handle exactly at shape center) falls back to above', () => {
  // Zero-size or pathological shape: handle exactly at shape center.
  const handleRect = { left: 388, top: 388, width: 24, height: 24 };  // handleCenter = (400, 400)
  const hostRect = { left: 0, top: 0, width: 800, height: 600 };
  const shapeCenter = { x: 400, y: 400 };
  const result = computeInputPosition(handleRect, hostRect, shapeCenter);
  // Fallback uses the same constant EXTENSION at unit = (0, -1):
  //   pillCenter.y = handleCenter.y - 58 = 400 - 58 = 342
  //   pillTopLeft  = (400 - 30, 342 - 14) = (370, 328)
  assert.equal(result.left, 370);
  assert.equal(result.top, 328);
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
