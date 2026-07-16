import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRegionOverlayStates, serializeRegionOverlayStates } from '../useRegionOverlayVisibility.js';

test('region overlay state round-trips through storage JSON', () => {
  const original = new Map([['s1-p1', true], ['s1-p2', false]]);
  const restored = parseRegionOverlayStates(serializeRegionOverlayStates(original));
  assert.deepEqual([...restored], [...original]);
});

test('only strict true disables a region overlay', () => {
  const parsed = parseRegionOverlayStates('{"a":true,"b":false,"c":1,"d":"true"}');
  assert.equal(parsed.get('a'), true);
  assert.equal(parsed.get('b'), false);
  assert.equal(parsed.get('c'), false);
  assert.equal(parsed.get('d'), false);
});

test('invalid region overlay state safely becomes an empty Map', () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(parseRegionOverlayStates('{bad json').size, 0);
    assert.equal(parseRegionOverlayStates(null).size, 0);
  } finally {
    console.error = originalError;
  }
});
