import test from 'node:test';
import assert from 'node:assert/strict';
import { ANNOTATION_SNAPPING_KEY, readAnnotationSnapping, writeAnnotationSnapping } from '../src/utils/annotationPreferences.js';
import { isAnnotationSnapFree, isSnapFreeModifier, snapRotationDegrees } from '../src/utils/snapGuides.js';

test('annotation alignment can be disabled without changing rotation and explicit modifiers', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  try {
    assert.equal(readAnnotationSnapping(), true);
    writeAnnotationSnapping(false);
    assert.equal(values.get(ANNOTATION_SNAPPING_KEY), 'off');
    assert.equal(isAnnotationSnapFree({}), true);
    assert.equal(isSnapFreeModifier({}), false);
    assert.equal(snapRotationDegrees(88, { free: isSnapFreeModifier({}) }), 90);
    writeAnnotationSnapping(true);
    assert.equal(isAnnotationSnapFree({}), false);
    assert.equal(isAnnotationSnapFree({ altKey: true }), true);
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  }
});
