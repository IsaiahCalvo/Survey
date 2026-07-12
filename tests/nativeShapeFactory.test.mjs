import test from 'node:test';
import assert from 'node:assert/strict';

import { makeInternalPenPathSpec } from '../src/utils/nativeShapeFactory.js';

test('makeInternalPenPathSpec uses pen defaults that scale with zoom', () => {
  assert.deepEqual(makeInternalPenPathSpec(), {
    type: 'path',
    stroke: '#000000',
    strokeWidth: 1,
    fill: null,
    strokeUniform: undefined,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  });
});

test('makeInternalPenPathSpec accepts stroke overrides', () => {
  const spec = makeInternalPenPathSpec({ stroke: '#ff0000', strokeWidth: 3 });
  assert.equal(spec.stroke, '#ff0000');
  assert.equal(spec.strokeWidth, 3);
  assert.equal(spec.strokeUniform, undefined);
});
