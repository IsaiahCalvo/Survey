import test from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import {
  classifyCalloutShrink,
  diffCalloutIds,
  getRecentCalloutRemovalIntent,
  markCalloutRemovalIntent,
} from '../src/utils/calloutRemovalIntent.js';

test('diffCalloutIds finds removed callouts', () => {
  deepEqual(
    diffCalloutIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }]),
    ['a']
  );
});

test('classifyCalloutShrink treats undo-backed removal as normal', () => {
  const result = classifyCalloutShrink({
    priorCount: 1,
    currentCount: 0,
    deletedIds: ['callout-1'],
    intent: { source: 'undo', calloutIds: ['callout-1'], atMs: 1000 },
  });

  equal(result.expected, true);
  equal(result.level, 'normal');
});

test('classifyCalloutShrink warns when callouts disappear without intent', () => {
  const result = classifyCalloutShrink({
    priorCount: 1,
    currentCount: 0,
    deletedIds: ['callout-1'],
    intent: null,
  });

  equal(result.expected, false);
  equal(result.level, 'warning');
});

test('classifyCalloutShrink escalates unexplained multi-callout wipe', () => {
  const result = classifyCalloutShrink({
    priorCount: 3,
    currentCount: 0,
    deletedIds: ['a', 'b', 'c'],
    intent: null,
  });

  equal(result.expected, false);
  equal(result.level, 'high-warning');
});

test('callout removal intent expires', () => {
  const target = {};
  markCalloutRemovalIntent({ source: 'delete', calloutIds: ['a'], atMs: 1000 }, target);

  equal(getRecentCalloutRemovalIntent(target, 2000)?.source, 'delete');
  equal(getRecentCalloutRemovalIntent(target, 7000), null);
});
