import test from 'node:test';
import assert from 'node:assert/strict';
import { ANNOTATION_SNAPPING_KEY, readAnnotationSnapping, writeAnnotationSnapping } from '../src/utils/annotationPreferences.js';
import { isAnnotationSnapFree, isSnapFreeModifier, snapRotationDegrees } from '../src/utils/snapGuides.js';

// Owner 2026-10-22 ("it just automatically wants to snap to everything"):
// the switch turns off every snap, rotation's right-angle magnet included.
// Keys held on purpose still work: Shift's 15° steps, Alt's free drag.
test('snapping can be switched off, rotation magnet included, without losing the held keys', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    assert.equal(readAnnotationSnapping(), true);
    writeAnnotationSnapping(false);
    assert.equal(values.get(ANNOTATION_SNAPPING_KEY), 'off');
    assert.equal(isAnnotationSnapFree({}), true);
    assert.equal(isSnapFreeModifier({}), false);
    assert.equal(snapRotationDegrees(88, { free: isSnapFreeModifier({}) }), 88, 'no right-angle magnet');
    assert.equal(snapRotationDegrees(88.4), 88, 'still whole degrees');
    assert.equal(snapRotationDegrees(52, { shift: true }), 45, 'Shift still steps');
    writeAnnotationSnapping(true);
    assert.equal(snapRotationDegrees(88), 90, 'the magnet is back');
    assert.equal(isAnnotationSnapFree({}), false);
    assert.equal(isAnnotationSnapFree({ altKey: true }), true);
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  }
});
