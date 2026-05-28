import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countSnapshotItems, resolveSafeSnapshot } from '../src/utils/safeSnapshot.js';

test('counts annotation page snapshots by object count', () => {
  assert.equal(countSnapshotItems({
    1: { objects: [{ id: 'a' }, { id: 'b' }] },
    2: { objects: [{ id: 'c' }] },
  }, 'annotation-pages'), 3);
});

test('cloud snapshots preserve last known good view when incoming data is empty and not confirmed', () => {
  const current = { a: { id: 'a' } };
  const result = resolveSafeSnapshot({
    current,
    incoming: {},
    cloudBacked: true,
    kind: 'object-map',
    context: 'survey-hydrate',
  });

  assert.equal(result.preserved, true);
  assert.equal(result.value, current);
});

test('confirmed empty cloud snapshots are allowed to clear state', () => {
  const result = resolveSafeSnapshot({
    current: { a: { id: 'a' } },
    incoming: {},
    cloudBacked: true,
    confirmedEmpty: true,
    kind: 'object-map',
    context: 'confirmed-delete',
  });

  assert.equal(result.preserved, false);
  assert.deepEqual(result.value, {});
});

test('non-empty incoming snapshots replace stale current state', () => {
  const incoming = { b: { id: 'b' } };
  const result = resolveSafeSnapshot({
    current: { a: { id: 'a' } },
    incoming,
    cloudBacked: true,
    kind: 'object-map',
    context: 'hydrate',
  });

  assert.equal(result.preserved, false);
  assert.equal(result.value, incoming);
});
