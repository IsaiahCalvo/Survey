import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRegionOverlayStates, serializeRegionOverlayStates } from '../useRegionOverlayVisibility.js';

test('serializeRegionOverlayStates: Map -> JSON object string', () => {
  const map = new Map([['s1-p1', true], ['s1-p2', false]]);
  assert.equal(serializeRegionOverlayStates(map), '{"s1-p1":true,"s1-p2":false}');
});

test('serializeRegionOverlayStates: empty Map -> {}', () => {
  assert.equal(serializeRegionOverlayStates(new Map()), '{}');
});

test('parseRegionOverlayStates: round-trips a serialized Map', () => {
  const map = new Map([['s1-p1', true], ['s2-p3', false]]);
  const back = parseRegionOverlayStates(serializeRegionOverlayStates(map));
  assert.equal(back.get('s1-p1'), true);
  assert.equal(back.get('s2-p3'), false);
  assert.equal(back.size, 2);
});

test('parseRegionOverlayStates: only strict boolean true means disabled', () => {
  // stored non-boolean-true values coerce to false (v === true)
  const m = parseRegionOverlayStates('{"a":true,"b":false,"c":1,"d":"true"}');
  assert.equal(m.get('a'), true, 'true stays true');
  assert.equal(m.get('b'), false, 'false stays false');
  assert.equal(m.get('c'), false, 'numeric 1 is NOT true');
  assert.equal(m.get('d'), false, 'string "true" is NOT true');
});

test('parseRegionOverlayStates: null/empty stored -> empty Map', () => {
  assert.equal(parseRegionOverlayStates(null).size, 0);
  assert.equal(parseRegionOverlayStates('').size, 0);
  assert.equal(parseRegionOverlayStates(undefined).size, 0);
});

test('parseRegionOverlayStates: invalid JSON -> empty Map (no throw)', () => {
  const orig = console.error;
  console.error = () => {}; // silence the expected error log for clean test output
  try {
    const m = parseRegionOverlayStates('{not valid json');
    assert.equal(m.size, 0);
  } finally {
    console.error = orig;
  }
});
