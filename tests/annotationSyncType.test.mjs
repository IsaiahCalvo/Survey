import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCrdtFanOutAnnotationType } from '../src/utils/annotationSyncType.js';

const SUPPORTED = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser'
];

test('resolveCrdtFanOutAnnotationType falls back from stale data.annotationType to Fabric type', () => {
  const resolved = resolveCrdtFanOutAnnotationType(
    { type: 'path', data: { annotationType: 'path', id: 'p1' } },
    SUPPORTED
  );
  assert.equal(resolved.dispatchable, true);
  assert.equal(resolved.annotationType, 'ink');
  assert.equal(resolved.rawType, 'path');
});

test('resolveCrdtFanOutAnnotationType maps supported Fabric annotations to DB types', () => {
  const cases = [
    [{ type: 'path' }, 'ink'],
    [{ type: 'rect' }, 'square'],
    [{ type: 'ellipse' }, 'circle'],
    [{ type: 'circle' }, 'circle'],
    [{ type: 'line' }, 'line'],
    [{ type: 'textbox' }, 'freetext'],
    [{ type: 'group', data: { type: 'counter' } }, 'counter'],
  ];

  for (const [fabricObj, expected] of cases) {
    const resolved = resolveCrdtFanOutAnnotationType(fabricObj, SUPPORTED);
    assert.equal(resolved.dispatchable, true, JSON.stringify(fabricObj));
    assert.equal(resolved.annotationType, expected, JSON.stringify(fabricObj));
  }
});

test('resolveCrdtFanOutAnnotationType preserves intentional highlight and callout exclusions', () => {
  assert.deepEqual(
    resolveCrdtFanOutAnnotationType({ type: 'path', data: { annotationType: 'highlight' } }, SUPPORTED),
    {
      dispatchable: false,
      annotationType: 'highlight',
      rawType: 'highlight',
      reason: 'highlight',
    }
  );

  const callout = resolveCrdtFanOutAnnotationType({ type: 'group', data: { type: 'callout' } }, SUPPORTED);
  assert.equal(callout.dispatchable, false);
  assert.equal(callout.annotationType, 'callout');
  assert.equal(callout.reason, 'callout');
});
