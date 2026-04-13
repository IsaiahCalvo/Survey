import test from 'node:test';
import assert from 'node:assert/strict';
import { snapAngleToNearest45 } from '../src/utils/svgTransformMath.js';

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
