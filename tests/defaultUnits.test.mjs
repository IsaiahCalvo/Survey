import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { readUnits, writeUnits, UNITS_KEY } = await import('../src/utils/annotationPreferences.js');

test('units default to imperial and save metric', () => {
  assert.equal(readUnits(), 'imperial');
  assert.equal(writeUnits('metric'), 'metric');
  assert.equal(store.get(UNITS_KEY), 'metric');
  assert.equal(readUnits(), 'metric');
});

test('an unknown value falls back to imperial', () => {
  store.set(UNITS_KEY, 'cubits');
  assert.equal(readUnits(), 'metric'); // last good write is remembered
  assert.equal(writeUnits('cubits'), 'imperial');
  assert.equal(readUnits(), 'imperial');
});
