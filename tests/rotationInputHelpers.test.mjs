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
