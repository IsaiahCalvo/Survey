import test from 'node:test';
import assert from 'node:assert/strict';
import { measureKeyBadge, measureKindForKey } from '../src/utils/measure/measureKeys.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const ev = (code, extra = {}) => ({ code, key: '¬', altKey: true, shiftKey: true, metaKey: false, ctrlKey: false, ...extra });

test('Alt+Shift letters pick measure kinds by key code', () => {
  assert.equal(measureKindForKey(ev('KeyL')), 'length');
  assert.equal(measureKindForKey(ev('KeyP')), 'perimeter');
  assert.equal(measureKindForKey(ev('KeyA')), 'area');
  assert.equal(measureKindForKey(ev('KeyQ')), null);
  assert.equal(measureKindForKey(ev('KeyV')), null);
  assert.equal(measureKindForKey(ev('KeyQ'), { depth: true }), 'polylength');
  assert.equal(measureKindForKey(ev('KeyV'), { depth: true }), 'volume');
});

test('other chords never pick a measure', () => {
  assert.equal(measureKindForKey(ev('KeyL', { altKey: false })), null);
  assert.equal(measureKindForKey(ev('KeyL', { shiftKey: false })), null);
  assert.equal(measureKindForKey(ev('KeyL', { ctrlKey: true })), null);
  assert.equal(measureKindForKey(ev('KeyL', { metaKey: true })), null);
  assert.equal(measureKindForKey(ev('KeyX')), null);
  // No code (some virtual keyboards): the plain letter works.
  assert.equal(measureKindForKey({ key: 'l', altKey: true, shiftKey: true }), 'length');
});

test('menu badges', () => {
  assert.equal(measureKeyBadge('area'), 'Alt+Shift+A');
  assert.equal(measureKeyBadge('volume'), null);
  assert.equal(measureKeyBadge('volume', { depth: true }), 'Alt+Shift+V');
  assert.equal(measureKeyBadge('scale'), null);
});

test('flag is a Nightly beta', () => {
  assert.equal(FEATURE_FLAGS['measure-keys']?.stage, 'beta');
});
