// Stage 2 — recoverable trash + tombstones (pure logic + durable store).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRASH_RETENTION_DAYS,
  makeTombstone,
  isTombstoneExpired,
  selectExpiredKeys,
  addTombstone,
  removeTombstone,
  purgeExpired,
  listActiveTrash,
} from '../src/services/surveyMarkerTrash.js';
import {
  trashKey,
  loadTrash,
  saveTrash,
  clearTrash,
} from '../src/services/surveyMarkerTrashStore.js';

const placed = { id: 'm1', name: 'Exit', pageNumber: 3, bounds: { x: 1, y: 2, width: 4, height: 4 } };

test('makeTombstone preserves the full marker payload + deletion metadata', () => {
  const t = makeTombstone(placed, { deletedAt: '2026-06-08T00:00:00.000Z', deletedBy: 'u1' });
  assert.deepEqual(t.marker, placed);
  assert.equal(t.deletedAt, '2026-06-08T00:00:00.000Z');
  assert.equal(t.deletedBy, 'u1');
  assert.equal(t.origin, 'app');
});

test('restore reinstates the exact marker (geometry intact)', () => {
  const t = makeTombstone(placed, { deletedAt: '2026-06-08T00:00:00.000Z' });
  // "restore" is just reading the payload back out
  assert.deepEqual(t.marker, placed);
  assert.equal(t.marker.pageNumber, 3);
  assert.deepEqual(t.marker.bounds, { x: 1, y: 2, width: 4, height: 4 });
});

test('retention window is 30 days; fresh tombstones are not expired', () => {
  assert.equal(TRASH_RETENTION_DAYS, 30);
  const t = makeTombstone(placed, { deletedAt: '2026-06-08T00:00:00.000Z' });
  assert.equal(isTombstoneExpired(t, { now: '2026-06-20T00:00:00.000Z' }), false); // 12 days
  assert.equal(isTombstoneExpired(t, { now: '2026-07-09T00:00:00.000Z' }), true); // 31 days
});

test('selectExpiredKeys / purgeExpired drop only past-retention tombstones', () => {
  const tombs = {
    fresh: makeTombstone(placed, { deletedAt: '2026-06-08T00:00:00.000Z' }),
    old: makeTombstone({ id: 'm2' }, { deletedAt: '2026-04-01T00:00:00.000Z' }),
  };
  const now = '2026-06-20T00:00:00.000Z';
  assert.deepEqual(selectExpiredKeys(tombs, { now }), ['old']);
  const { tombstones, purgedKeys } = purgeExpired(tombs, { now });
  assert.deepEqual(purgedKeys, ['old']);
  assert.deepEqual(Object.keys(tombstones), ['fresh']);
});

test('add/remove tombstone are immutable', () => {
  const base = {};
  const t = makeTombstone(placed, { deletedAt: '2026-06-08T00:00:00.000Z' });
  const added = addTombstone(base, 'm1', t);
  assert.deepEqual(base, {}, 'input not mutated');
  assert.deepEqual(Object.keys(added), ['m1']);
  const removed = removeTombstone(added, 'm1');
  assert.deepEqual(Object.keys(removed), []);
});

test('listActiveTrash returns recoverable tombstones newest-first', () => {
  const tombs = {
    a: makeTombstone({ id: 'a' }, { deletedAt: '2026-06-08T00:00:00.000Z' }),
    b: makeTombstone({ id: 'b' }, { deletedAt: '2026-06-09T00:00:00.000Z' }),
    expired: makeTombstone({ id: 'c' }, { deletedAt: '2026-01-01T00:00:00.000Z' }),
  };
  const list = listActiveTrash(tombs, { now: '2026-06-20T00:00:00.000Z' });
  assert.deepEqual(list.map((x) => x.key), ['b', 'a']);
});

// --- durable store ---

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('trash store round-trips the tombstone map per document', () => {
  const s = fakeStorage();
  const tombs = { m1: makeTombstone(placed, { deletedAt: '2026-06-08T00:00:00.000Z', deletedBy: 'u1' }) };
  saveTrash('doc1', tombs, s);
  assert.deepEqual(loadTrash('doc1', s), tombs);
  assert.deepEqual(loadTrash('doc2', s), {}, 'separate document has its own trash');
});

test('trash store: missing id or storage is safe', () => {
  assert.equal(trashKey(null), null);
  assert.deepEqual(loadTrash(null, fakeStorage()), {});
  const s = fakeStorage();
  saveTrash('doc1', { m1: 1 }, s);
  clearTrash('doc1', s);
  assert.deepEqual(loadTrash('doc1', s), {});
});
