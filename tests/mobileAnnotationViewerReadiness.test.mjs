import test from 'node:test';
import assert from 'node:assert/strict';

import { isFirstPageRasterSizeReady } from '../agent-cli/mobile-annotations/viewer.mjs';

test('first-page readiness rejects an untouched HTML canvas', () => {
  assert.equal(isFirstPageRasterSizeReady({ width: 300, height: 150 }), false);
});

test('first-page readiness rejects missing or zero-size rasters', () => {
  assert.equal(isFirstPageRasterSizeReady(), false);
  assert.equal(isFirstPageRasterSizeReady({ width: 0, height: 844 }), false);
});

test('first-page readiness accepts a rendered PDF canvas', () => {
  assert.equal(isFirstPageRasterSizeReady({ width: 780, height: 1009 }), true);
});
