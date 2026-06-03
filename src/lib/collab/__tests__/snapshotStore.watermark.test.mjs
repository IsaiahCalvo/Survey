// src/lib/collab/__tests__/snapshotStore.watermark.test.mjs
//
// Covers the fast-open watermark (freshness stamp) that lets the open path skip
// the ~25-trip durable re-read when the row-sourced snapshot is provably current
// (DB-sync audit 2026-06-03, optimization #1).
//
// snapshotStore.js is pure (no supabase side-effects), so we import it directly
// and exercise the gzip+meta round-trip with a tiny in-memory fake client.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRowsWatermark,
  isSnapshotWatermarkCurrent,
  writeByPageSnapshot,
  readByPageSnapshot,
} from '../snapshotStore.js';

// Minimal fake of the supabase-js builder surface snapshotStore touches:
//   write:  client.from(t).upsert(row, opts) -> { error }
//   read:   client.from(t).select(cols).eq(col,val).maybeSingle() -> { data, error }
function makeFakeClient() {
  const store = new Map();
  return {
    _store: store,
    from() {
      let pendingId = null;
      const api = {
        upsert: async (row) => { store.set(row.document_id, row); return { error: null }; },
        select: () => api,
        eq: (_col, val) => { pendingId = val; return api; },
        maybeSingle: async () => ({ data: store.get(pendingId) || null, error: null }),
      };
      return api;
    },
  };
}

test('computeRowsWatermark: empty / non-array → zero count, null max', () => {
  assert.deepEqual(computeRowsWatermark([]), { rowCount: 0, maxUpdatedAt: null });
  assert.deepEqual(computeRowsWatermark(null), { rowCount: 0, maxUpdatedAt: null });
  assert.deepEqual(computeRowsWatermark(undefined), { rowCount: 0, maxUpdatedAt: null });
});

test('computeRowsWatermark: returns row count and the latest updated_at', () => {
  const rows = [
    { updated_at: '2026-06-01T10:00:00.000+00:00' },
    { updated_at: '2026-06-02T09:30:00.500+00:00' }, // latest
    { updated_at: '2026-05-31T23:59:59.000+00:00' },
  ];
  const wm = computeRowsWatermark(rows);
  assert.equal(wm.rowCount, 3);
  assert.equal(wm.maxUpdatedAt, '2026-06-02T09:30:00.500+00:00');
});

test('isSnapshotWatermarkCurrent: exact match → true', () => {
  const meta = { calloutsComplete: true, sourceRowCount: 42, sourceMaxUpdatedAt: '2026-06-02T09:30:00.500+00:00' };
  const live = { rowCount: 42, maxUpdatedAt: '2026-06-02T09:30:00.500+00:00', error: null };
  assert.equal(isSnapshotWatermarkCurrent(meta, live), true);
});

test('isSnapshotWatermarkCurrent: equal instant in a different string format → true', () => {
  // PostgREST may serialize the same instant slightly differently; compare by value.
  const meta = { calloutsComplete: true, sourceRowCount: 1, sourceMaxUpdatedAt: '2026-06-02T09:30:00+00:00' };
  const live = { rowCount: 1, maxUpdatedAt: '2026-06-02T09:30:00.000Z', error: null };
  assert.equal(isSnapshotWatermarkCurrent(meta, live), true);
});

test('isSnapshotWatermarkCurrent: row-count mismatch → false (insert/delete since snapshot)', () => {
  const meta = { calloutsComplete: true, sourceRowCount: 42, sourceMaxUpdatedAt: '2026-06-02T09:30:00.500+00:00' };
  const live = { rowCount: 43, maxUpdatedAt: '2026-06-02T09:30:00.500+00:00', error: null };
  assert.equal(isSnapshotWatermarkCurrent(meta, live), false);
});

test('isSnapshotWatermarkCurrent: newer max → false (edit since snapshot)', () => {
  const meta = { calloutsComplete: true, sourceRowCount: 42, sourceMaxUpdatedAt: '2026-06-02T09:30:00.500+00:00' };
  const live = { rowCount: 42, maxUpdatedAt: '2026-06-02T10:00:00.000+00:00', error: null };
  assert.equal(isSnapshotWatermarkCurrent(meta, live), false);
});

test('isSnapshotWatermarkCurrent: missing meta / not callout-complete / live error → false', () => {
  const live = { rowCount: 1, maxUpdatedAt: '2026-06-02T09:30:00.500+00:00', error: null };
  assert.equal(isSnapshotWatermarkCurrent(null, live), false);
  assert.equal(isSnapshotWatermarkCurrent({ sourceRowCount: 1, sourceMaxUpdatedAt: '2026-06-02T09:30:00.500+00:00' }, live), false);
  assert.equal(isSnapshotWatermarkCurrent({ calloutsComplete: false, sourceRowCount: 1, sourceMaxUpdatedAt: '2026-06-02T09:30:00.500+00:00' }, live), false);
  const meta = { calloutsComplete: true, sourceRowCount: 1, sourceMaxUpdatedAt: '2026-06-02T09:30:00.500+00:00' };
  assert.equal(isSnapshotWatermarkCurrent(meta, { rowCount: 1, maxUpdatedAt: '2026-06-02T09:30:00.500+00:00', error: new Error('boom') }), false);
  assert.equal(isSnapshotWatermarkCurrent(meta, null), false);
});

test('writeByPageSnapshot → readByPageSnapshot round-trips byPage, callouts, and meta', async () => {
  const client = makeFakeClient();
  const byPage = { 1: { version: 2, objects: [{ id: 'a' }] }, 3: { version: 2, objects: [{ id: 'b' }] } };
  const callouts = [{ id: 'c1', text: 'hi' }];
  const meta = { sourceMaxUpdatedAt: '2026-06-02T09:30:00.500+00:00', sourceRowCount: 2, calloutsComplete: true, schema: 1 };

  const w = await writeByPageSnapshot('doc-1', byPage, callouts, client, meta);
  assert.equal(w.ok, true);

  const r = await readByPageSnapshot('doc-1', client);
  assert.deepEqual(r.byPage, byPage);
  assert.deepEqual(r.callouts, callouts);
  assert.deepEqual(r.meta, meta);
});

test('readByPageSnapshot: legacy snapshot without meta → meta null (back-compat, no skip)', async () => {
  const client = makeFakeClient();
  const byPage = { 1: { version: 2, objects: [{ id: 'a' }] } };
  // Write WITHOUT meta (pre-watermark snapshot, e.g. agent-cli or older app build).
  const w = await writeByPageSnapshot('doc-2', byPage, [], client);
  assert.equal(w.ok, true);

  const r = await readByPageSnapshot('doc-2', client);
  assert.deepEqual(r.byPage, byPage);
  assert.equal(r.meta, null);
  // And such a snapshot must NEVER trigger a skip.
  assert.equal(isSnapshotWatermarkCurrent(r.meta, { rowCount: 1, maxUpdatedAt: null, error: null }), false);
});
