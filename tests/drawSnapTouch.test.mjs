import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assistAngle, resolveDrawSnap, drawSnapEventOptions, isCoarseSnapPointer,
  DRAW_SNAP_SCREEN_PX, DRAW_SNAP_TOUCH_SCREEN_PX, TOUCH_ANGLE_ASSIST_DEG,
} from '../src/utils/drawSnap.js';

const at = (deg, len = 100) => ({ x: Math.cos((deg * Math.PI) / 180) * len, y: Math.sin((deg * Math.PI) / 180) * len });
const O = { x: 0, y: 0 };

test('assistAngle locks within the tolerance of a 45° step', () => {
  for (const d of [3, -4.9, 41, 48, 92, 177, -133]) {
    const p = assistAngle(O, at(d));
    assert.ok(p, `locks at ${d}`);
    const got = (Math.atan2(p.y, p.x) * 180) / Math.PI;
    const want = Math.round(d / 45) * 45;
    assert.ok(Math.abs(((got - want + 540) % 360) - 180) < 1e-9, `${d} -> ${got}`);
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 100) < 1e-9);
  }
  assert.equal(assistAngle(O, at(0)).y, 0);
});

test('assistAngle leaves free angles alone', () => {
  for (const d of [6, 20, 30, 39.5, 60, 112]) assert.equal(assistAngle(O, at(d)), null, `${d}`);
  assert.equal(assistAngle(O, O), null);
});

test('event options: mouse unchanged, touch and pen get radius + assist', () => {
  assert.equal(isCoarseSnapPointer({ pointerType: 'mouse' }), false);
  assert.equal(isCoarseSnapPointer({ pointerType: 'touch' }), true);
  assert.equal(isCoarseSnapPointer({ pointerType: 'pen' }), true);
  const m = drawSnapEventOptions({ pointerType: 'mouse' }, 0.5);
  assert.deepEqual(m, { shiftKey: false, stepDeg: 15, assistStepDeg: 45, tolPage: DRAW_SNAP_SCREEN_PX * 0.5, angleAssistDeg: 0, coarse: false });
  const t = drawSnapEventOptions({ pointerType: 'touch' }, 0.5);
  assert.equal(t.tolPage, DRAW_SNAP_TOUCH_SCREEN_PX * 0.5);
  assert.equal(t.angleAssistDeg, TOUCH_ANGLE_ASSIST_DEG);
  assert.ok(DRAW_SNAP_TOUCH_SCREEN_PX >= 12 && DRAW_SNAP_TOUCH_SCREEN_PX <= 16);
});

test('resolveDrawSnap: mouse without Shift is free, touch assists, endpoint wins', () => {
  const p = at(3);
  assert.deepEqual(resolveDrawSnap(O, p, drawSnapEventOptions({ pointerType: 'mouse' }, 1)).point, p);
  const t = resolveDrawSnap(O, p, drawSnapEventOptions({ pointerType: 'touch' }, 1));
  assert.equal(t.point.y, 0);
  const cand = [{ x: p.x + 10, y: p.y }];
  const hitTouch = resolveDrawSnap(O, p, { ...drawSnapEventOptions({ pointerType: 'touch' }, 1), candidates: cand });
  assert.deepEqual(hitTouch.endpoint, { x: p.x + 10, y: p.y, coarse: true });
  const missMouse = resolveDrawSnap(O, p, { ...drawSnapEventOptions({ pointerType: 'mouse' }, 1), candidates: cand });
  assert.equal(missMouse.endpoint, null);
});
