import test from 'node:test';
import assert from 'node:assert/strict';
import { clampScale } from '../src/utils/zoomController.js';

test('clampScale accepts 0.1 as the new floor (ZOOM-09)', () => {
  assert.equal(clampScale(0.1), 0.1);
});

test('clampScale clamps 0.05 up to the 0.1 floor', () => {
  assert.equal(clampScale(0.05), 0.1);
});

test('clampScale leaves 0.5 untouched', () => {
  assert.equal(clampScale(0.5), 0.5);
});

test('clampScale leaves 5.0 ceiling untouched', () => {
  assert.equal(clampScale(5.0), 5.0);
});

test('clampScale clamps 6.0 down to the 5.0 ceiling', () => {
  assert.equal(clampScale(6.0), 5.0);
});

test('clampScale returns DEFAULT manualScale (1.0) for NaN input', () => {
  assert.equal(clampScale(NaN), 1.0);
});

test('clampScale returns DEFAULT manualScale (1.0) for non-number input', () => {
  assert.equal(clampScale('not a number'), 1.0);
});
