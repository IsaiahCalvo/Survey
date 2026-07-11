import test from 'node:test';
import assert from 'node:assert/strict';
import { clampScale } from '../src/utils/zoomController.js';

test('clampScale accepts 0.01 as the zoom floor', () => {
  assert.equal(clampScale(0.01), 0.01);
});

test('clampScale clamps values below the 0.01 floor', () => {
  assert.equal(clampScale(0.005), 0.01);
});

test('clampScale leaves 0.1 untouched', () => {
  assert.equal(clampScale(0.1), 0.1);
});

test('clampScale leaves 0.5 untouched', () => {
  assert.equal(clampScale(0.5), 0.5);
});

test('clampScale leaves 5.0 ceiling untouched', () => {
  assert.equal(clampScale(5.0), 5.0);
});

test('clampScale leaves the PDF engine 40.0 ceiling untouched', () => {
  assert.equal(clampScale(40.0), 40.0);
});

test('clampScale clamps 41.0 down to the PDF engine 40.0 ceiling', () => {
  assert.equal(clampScale(41.0), 40.0);
});

test('clampScale returns DEFAULT manualScale (1.0) for NaN input', () => {
  assert.equal(clampScale(NaN), 1.0);
});

test('clampScale returns DEFAULT manualScale (1.0) for non-number input', () => {
  assert.equal(clampScale('not a number'), 1.0);
});
