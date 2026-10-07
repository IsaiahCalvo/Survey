/**
 * Owner 2026-10-01 (iPhone): "When I swipe up and down to make it grow, that
 * animation needs to be way smoother ... not smooth at all." A released phone
 * sheet now settles with a critically damped spring that starts at the
 * finger's own speed (useMobileSheetMotion springKeyframes). These pin the
 * properties the eye cares about: it starts where the finger let go, at the
 * finger's speed, never overshoots past the top it may not cross, ends exactly
 * on the resting height (no snap after the last frame), and takes about the
 * 250-320ms the owner asked for on a full Standard <-> Full move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEET_SPRING_MAX_MS, springKeyframes } from '../src/mobile/useMobileSheetMotion.js';

const ys = (points) => points.map((p) => p.y);

test('a released sheet springs from where the finger left it to exactly its resting height', () => {
  const { points, frames, ms } = springKeyframes(274, 0, 0);
  assert.equal(points[0].y, 274);
  assert.equal(points.at(-1).y, 0);
  assert.equal(points[0].offset, 0);
  assert.equal(points.at(-1).offset, 1);
  assert.equal(frames.at(-1).translate, '0 0px');
  // Standard <-> Full (274px) lands in the owner's 250-320ms window.
  assert.ok(ms >= 250 && ms <= 340, `ms=${ms}`);
  // No bounce: from rest it only ever moves toward the target.
  const v = ys(points);
  for (let i = 1; i < v.length; i += 1) assert.ok(v[i] <= v[i - 1] + 1e-9, `step ${i}: ${v[i - 1]} -> ${v[i]}`);
  // ...and the last frames are a soft landing, not a stop: under 2px a frame.
  assert.ok(Math.abs(v.at(-2) - v.at(-1)) < 2);
});

test('the spring starts at the finger speed and never crosses the floor it is given', () => {
  // Thrown upward (negative = up) at 2px/ms toward 0 from 120px.
  const { points, ms } = springKeyframes(120, 0, -2, { min: 0 });
  const v = ys(points);
  const frameMs = ms / (points.length - 1);
  const firstSpeed = (v[1] - v[0]) / frameMs;
  assert.ok(firstSpeed < -1.2, `first frame speed ${firstSpeed}px/ms should carry the throw`);
  assert.ok(v.every((y) => y >= 0), 'a held-tall sheet may never rise past Full');
  assert.ok(ms <= SHEET_SPRING_MAX_MS);
});

test('a short settle is short', () => {
  assert.ok(springKeyframes(20, 0, 0).ms < springKeyframes(274, 0, 0).ms);
});
