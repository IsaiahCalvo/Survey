import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapAngleToNearest45,
  clampInverseScale,
  MAX_VISUAL_INVERSE_SCALE,
} from '../src/utils/svgTransformMath.js';

test('snapAngleToNearest45 snaps 44° to 45° within 3° threshold', () => {
  assert.equal(snapAngleToNearest45(44, 3), 45);
});

test('snapAngleToNearest45 leaves 41° unchanged outside 3° threshold', () => {
  assert.equal(snapAngleToNearest45(41, 3), 41);
});

test('snapAngleToNearest45 leaves 23° unchanged (far from any 45° increment)', () => {
  assert.equal(snapAngleToNearest45(23, 3), 23);
});

test('snapAngleToNearest45 wraps 358° → 0° via % 360 defensive guard', () => {
  assert.equal(snapAngleToNearest45(358, 3), 0);
});

test('snapAngleToNearest45 leaves exact 0° unchanged', () => {
  assert.equal(snapAngleToNearest45(0, 3), 0);
});

test('snapAngleToNearest45 leaves exact 45° unchanged', () => {
  assert.equal(snapAngleToNearest45(45, 3), 45);
});

test('snapAngleToNearest45 snaps 47° down to 45°', () => {
  assert.equal(snapAngleToNearest45(47, 3), 45);
});

test('snapAngleToNearest45 leaves 49° unchanged (just outside 3° band — inclusive threshold)', () => {
  // NOTE: 48° is exactly 3° from 45° and IS inclusive (<=), so it snaps.
  // 49° is the real "just outside" case. The plan's Test 8 said 48 but the
  // implementation uses <= threshold, so this was fixed during execution
  // (Rule 1 deviation — inconsistency between plan's test data and plan's spec).
  assert.equal(snapAngleToNearest45(49, 3), 49);
});

test('snapAngleToNearest45 snaps 317° to 315°', () => {
  assert.equal(snapAngleToNearest45(317, 3), 315);
});

test('snapAngleToNearest45 leaves exact 135° unchanged', () => {
  assert.equal(snapAngleToNearest45(135, 3), 135);
});

// --- clampInverseScale: zoom-out balloon fix (BUG 1) ---------------------

test('clampInverseScale is a no-op at rest (inverseScale ≈ 1)', () => {
  // At rest the at-rest appearance MUST be byte-for-byte identical.
  assert.equal(clampInverseScale(1), 1);
  assert.equal(clampInverseScale(0.99), 0.99);
});

test('clampInverseScale is a no-op when zoomed IN (inverseScale < 1)', () => {
  // Zoom-in shrinks handles via inverseScale < 1; the cap must never bite there.
  assert.equal(clampInverseScale(0.5), 0.5);
  assert.equal(clampInverseScale(0.1), 0.1);
});

test('clampInverseScale leaves values up to the cap unchanged', () => {
  assert.equal(clampInverseScale(2), 2);
  assert.equal(clampInverseScale(MAX_VISUAL_INVERSE_SCALE), MAX_VISUAL_INVERSE_SCALE);
});

test('clampInverseScale caps runaway zoom-out values at the max', () => {
  // The bug: zooming out grows inverseScale without bound, ballooning handles.
  assert.equal(clampInverseScale(4), MAX_VISUAL_INVERSE_SCALE);
  assert.equal(clampInverseScale(50), MAX_VISUAL_INVERSE_SCALE);
  assert.equal(clampInverseScale(1000), MAX_VISUAL_INVERSE_SCALE);
});

test('clampInverseScale honors a custom max', () => {
  assert.equal(clampInverseScale(10, 2), 2);
  assert.equal(clampInverseScale(1.5, 2), 1.5);
});

test('clampInverseScale falls back to 1 for non-finite / non-positive input', () => {
  assert.equal(clampInverseScale(0), 1);
  assert.equal(clampInverseScale(-3), 1);
  assert.equal(clampInverseScale(NaN), 1);
  assert.equal(clampInverseScale(undefined), 1);
  assert.equal(clampInverseScale(Infinity), 1);
});
