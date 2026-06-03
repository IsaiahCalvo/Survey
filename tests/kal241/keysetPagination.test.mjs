// KAL-241 — keyset pagination cursor loop.
//
// The durable annotation hydrate read switched from OFFSET pagination to keyset
// (seek) pagination on the primary key. The loop that drives the cursor is the
// one place a bug could silently drop or duplicate an annotation on load, and it
// can't be exercised against the real database here, so these tests model the
// exact DB contract (rows ordered by a unique id, `id > cursor`, `LIMIT n`) and
// assert the loop returns every row exactly once.

import test from 'node:test';
import assert from 'node:assert/strict';

import { collectKeysetRows } from '../../src/services/annotationReadPagination.js';

// Build a fetchPage that faithfully simulates the keyset query against a fixed
// dataset: ascending unique id, return up to pageSize rows with id > cursor.
function makeFetchPage(dataset, pageSize, calls) {
  const sorted = [...dataset].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return async (cursorId) => {
    if (calls) calls.push(cursorId);
    const start = cursorId === null ? 0 : sorted.findIndex((r) => r.id > cursorId);
    const from = start === -1 ? sorted.length : start;
    return { data: sorted.slice(from, from + pageSize), error: null };
  };
}

// Ids that sort lexicographically in insertion order (mirrors string/uuid compare).
function rows(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(5, '0')}`, page_number: (i % 36) + 1 }));
}

test('returns empty for an empty dataset with a single fetch', async () => {
  const calls = [];
  const result = await collectKeysetRows({ pageSize: 1000, fetchPage: makeFetchPage([], 1000, calls) });
  assert.equal(result.error, null);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(calls, [null]); // one fetch, seeded with null, short page ends it
});

test('returns all rows once when the total is smaller than a page', async () => {
  const data = rows(7);
  const result = await collectKeysetRows({ pageSize: 1000, fetchPage: makeFetchPage(data, 1000) });
  assert.equal(result.error, null);
  assert.equal(result.rows.length, 7);
  assert.deepEqual(result.rows.map((r) => r.id), data.map((r) => r.id));
});

test('no skip / no duplicate when the total is an exact multiple of pageSize', async () => {
  const data = rows(30);
  const calls = [];
  const result = await collectKeysetRows({ pageSize: 10, fetchPage: makeFetchPage(data, 10, calls) });
  assert.equal(result.error, null);
  // Exhaustive: every id present exactly once.
  const ids = result.rows.map((r) => r.id);
  assert.equal(ids.length, 30);
  assert.equal(new Set(ids).size, 30);
  assert.deepEqual(ids, data.map((r) => r.id));
  // Exact-multiple boundary forces one extra (empty) fetch to terminate.
  assert.deepEqual(calls, [null, 'id-00009', 'id-00019', 'id-00029']);
});

test('no skip / no duplicate across many pages with a partial final page', async () => {
  const data = rows(2345);
  const result = await collectKeysetRows({ pageSize: 100, fetchPage: makeFetchPage(data, 100) });
  assert.equal(result.error, null);
  const ids = result.rows.map((r) => r.id);
  assert.equal(ids.length, 2345);
  assert.equal(new Set(ids).size, 2345);
  assert.deepEqual(ids, data.map((r) => r.id));
});

test('advances the cursor to the previous page last id', async () => {
  const data = rows(25);
  const calls = [];
  await collectKeysetRows({ pageSize: 10, fetchPage: makeFetchPage(data, 10, calls) });
  // null, then last id of page 1 (index 9), then last id of page 2 (index 19).
  // Page 3 has 5 rows (< pageSize) so the loop stops without another fetch.
  assert.deepEqual(calls, [null, 'id-00009', 'id-00019']);
});

test('short-circuits on error and keeps the rows gathered so far', async () => {
  const data = rows(40);
  let call = 0;
  const fetchPage = async (cursorId) => {
    call += 1;
    if (call === 3) return { data: null, error: { code: '57014', message: 'statement timeout' } };
    const base = makeFetchPage(data, 10);
    return base(cursorId);
  };
  const result = await collectKeysetRows({ pageSize: 10, fetchPage });
  assert.equal(result.error.code, '57014');
  assert.equal(result.rows.length, 20); // first two full pages survived
});

test('guards reject an invalid pageSize or fetchPage', async () => {
  await assert.rejects(() => collectKeysetRows({ pageSize: 0, fetchPage: async () => ({ data: [] }) }));
  await assert.rejects(() => collectKeysetRows({ pageSize: 10, fetchPage: null }));
});
