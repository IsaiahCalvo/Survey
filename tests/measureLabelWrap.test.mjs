import test from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_DEPTH_MAX, normalizeMeasureDepth, wrapMeasureLabelLine } from '../src/utils/measure/measureScale.js';

test('long measure labels wrap at spaces, and long words split', () => {
  const lines = wrapMeasureLabelLine('North wall of the main mechanical room behind the second stair core');
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => l.length <= 32));
  assert.equal(lines.join(' '), 'North wall of the main mechanical room behind the second stair core');
  assert.deepEqual(wrapMeasureLabelLine('x'.repeat(70)).map((l) => l.length), [32, 32, 6]);
  assert.deepEqual(wrapMeasureLabelLine('Short'), ['Short']);
});

test('depth past the cap is refused', () => {
  assert.equal(normalizeMeasureDepth(1e300), null);
  assert.equal(normalizeMeasureDepth(MEASURE_DEPTH_MAX), MEASURE_DEPTH_MAX);
  assert.equal(normalizeMeasureDepth('2.5'), 2.5);
  assert.equal(normalizeMeasureDepth(0), null);
});
