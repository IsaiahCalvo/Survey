import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAP_ANGLE_KEY, SNAP_ANGLE_DEFAULT, readSnapAngle, writeSnapAngle } from '../src/utils/annotationPreferences.js';
import { resolveDrawSnap, drawSnapEventOptions } from '../src/utils/drawSnap.js';
import { snapRotationDegrees } from '../src/utils/snapGuides.js';
import { addPolyDraftPoint, createPolyDraft, updatePolyDraftPreview } from '../src/utils/polyDraft.js';
import { resolveRegionPolygonPoint } from '../src/utils/regionPolygonEdit.js';

// Owner 2026-10-29: Shift snaps to 15° by default (Line and Polygon used 45°),
// and Settings picks 15°, 45° or 90° for every Shift-snap.
const O = { x: 0, y: 0 };
const at = (deg, r = 100) => ({ x: Math.cos((deg * Math.PI) / 180) * r, y: Math.sin((deg * Math.PI) / 180) * r });
const angleOf = (p) => Math.round((Math.atan2(p.y, p.x) * 180) / Math.PI);
const shift = (pointerType = 'mouse') => drawSnapEventOptions({ shiftKey: true, pointerType }, 1);

function withStorage(fn) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) } });
  try { return fn(values); } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
    writeSnapAngle(SNAP_ANGLE_DEFAULT);
  }
}

test('Shift snaps lines and polygon sides to 15° by default', () => withStorage(() => {
  assert.equal(readSnapAngle(), 15);
  assert.equal(angleOf(resolveDrawSnap(O, at(32), shift()).point), 30);
  const draft = createPolyDraft('polygon', O);
  assert.equal(angleOf(updatePolyDraftPreview(draft, at(32), { shiftKey: true }).preview), 30);
  assert.equal(angleOf(addPolyDraftPoint(draft, at(32), { shiftKey: true }).points[1]), 30);
  assert.equal(snapRotationDegrees(52, { shift: true }), 45);
  assert.equal(snapRotationDegrees(38, { shift: true }), 45);
}));

test('Settings can pick 45° or 90° for every Shift-snap', () => withStorage((values) => {
  writeSnapAngle(45);
  assert.equal(values.get(SNAP_ANGLE_KEY), '45');
  assert.equal(angleOf(resolveDrawSnap(O, at(32), shift()).point), 45);
  assert.equal(angleOf(updatePolyDraftPreview(createPolyDraft('polyline', O), at(32), { shiftKey: true }).preview), 45);
  assert.equal(angleOf(resolveRegionPolygonPoint([O], at(32), { shiftKey: true }).point), 45);
  assert.equal(snapRotationDegrees(38, { shift: true }), 45);
  writeSnapAngle(90);
  assert.equal(angleOf(resolveDrawSnap(O, at(50), shift()).point), 90);
  assert.equal(angleOf(resolveRegionPolygonPoint([O], at(50), { shiftKey: true }).point), 90);
  assert.equal(snapRotationDegrees(50, { shift: true }), 90);
  writeSnapAngle(15);
  assert.equal(angleOf(resolveRegionPolygonPoint([O], at(32), { shiftKey: true }).point), 30);
}));

test('only 15, 45 and 90 are kept; anything else reads as 15', () => withStorage((values) => {
  values.set(SNAP_ANGLE_KEY, '30');
  assert.equal(readSnapAngle(), 15);
  assert.equal(writeSnapAngle(7), 15);
}));

test('the touch assist never pulls to steps finer than 45°', () => withStorage(() => {
  // 33° is 3° off a 30° step but 12° off 45°: a finger draws it freely.
  const free = resolveDrawSnap(O, at(33), drawSnapEventOptions({ pointerType: 'touch' }, 1)).point;
  assert.equal(angleOf(free), 33);
  assert.equal(angleOf(resolveDrawSnap(O, at(43), drawSnapEventOptions({ pointerType: 'touch' }, 1)).point), 45);
}));
