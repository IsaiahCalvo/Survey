// KAL-250 / DB-sync — shared per-open documents-row resolver.
//
// Opening a document used to read the same documents row ~6 times (lock state,
// tool preferences, cutover seal x2, owner id, fast-open watermark). The
// resolver collapses those into ONE select via a short-TTL, single-flight cache.
// These tests model the Supabase builder contract with a fake client that counts
// selects, and lock in the cache behavior the consolidation depends on.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDocumentMetadata,
  invalidateDocumentMetadata,
  __resetDocumentMetadataCacheForTests
} from '../../src/services/documentMetadataResolver.js';

const ROW = {
  user_id: 'owner-1',
  locked_at: '2026-06-03T10:00:00.000Z',
  locked_by: 'owner-1',
  locked_label: 'Editing',
  tool_preferences: { pen: { color: '#f00' } },
  cutover_completed_at: '2026-06-03T09:00:00.000Z',
  annotations_changed_at: '2026-06-03T11:00:00.000Z'
};

// Fake Supabase client: from('documents').select(cols).eq('id', id).maybeSingle()
// -> { data, error }. Counts select() invocations = actual DB round-trips.
function makeClient({ row = ROW, error = null } = {}) {
  let selectCount = 0;
  const builder = {
    select() { selectCount++; return builder; },
    eq() { return builder; },
    maybeSingle() { return Promise.resolve({ data: error ? null : row, error }); }
  };
  return { client: { from() { return builder; } }, selects: () => selectCount };
}

test('one resolve issues exactly one select and maps to camelCase', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client, selects } = makeClient();
  const meta = await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(selects(), 1);
  assert.equal(meta.userId, 'owner-1');
  assert.equal(meta.lockedLabel, 'Editing');
  assert.equal(meta.toolPreferences.pen.color, '#f00');
  assert.equal(meta.cutoverCompletedAt, '2026-06-03T09:00:00.000Z');
  assert.equal(meta.annotationsChangedAt, '2026-06-03T11:00:00.000Z');
});

test('sequential calls within the TTL share one select (cache hit)', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client, selects } = makeClient();
  await resolveDocumentMetadata('doc1', { supabase: client });
  await resolveDocumentMetadata('doc1', { supabase: client });
  await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(selects(), 1, 'the whole open window must collapse to one read');
});

test('concurrent calls share one in-flight select (single-flight)', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client, selects } = makeClient();
  const [a, b, c] = await Promise.all([
    resolveDocumentMetadata('doc1', { supabase: client }),
    resolveDocumentMetadata('doc1', { supabase: client }),
    resolveDocumentMetadata('doc1', { supabase: client })
  ]);
  assert.equal(selects(), 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('cache expires after the TTL window', async (t) => {
  __resetDocumentMetadataCacheForTests();
  t.mock.timers.enable({ apis: ['Date'] });
  const { client, selects } = makeClient();
  await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(selects(), 1);
  t.mock.timers.tick(6000); // past the 5s TTL
  await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(selects(), 2);
});

test('invalidate forces the next resolve to refetch', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client, selects } = makeClient();
  await resolveDocumentMetadata('doc1', { supabase: client });
  invalidateDocumentMetadata('doc1');
  await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(selects(), 2);
});

test('errors return all-null and are NOT cached (next call retries)', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client, selects } = makeClient({ error: { message: 'boom' } });
  const meta = await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(meta.userId, null);
  assert.equal(meta.cutoverCompletedAt, null);
  await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(selects(), 2, 'a transient failure must not poison the cache');
});

test('absent columns map to null', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client } = makeClient({ row: { user_id: 'u', cutover_completed_at: 'ts' } });
  const meta = await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(meta.userId, 'u');
  assert.equal(meta.cutoverCompletedAt, 'ts');
  assert.equal(meta.lockedAt, null);
  assert.equal(meta.toolPreferences, null);
  assert.equal(meta.annotationsChangedAt, null);
});

test('missing documentId or client returns all-null without a select', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client, selects } = makeClient();
  const a = await resolveDocumentMetadata(null, { supabase: client });
  assert.equal(a.userId, null);
  assert.equal(selects(), 0);
  const b = await resolveDocumentMetadata('doc1', { supabase: null });
  assert.equal(b.userId, null);
});

test('invalidate-after-seal drops a cached pre-seal null so the sealed value is seen', async () => {
  __resetDocumentMetadataCacheForTests();
  // Cold open: cutover not yet sealed.
  const cold = makeClient({ row: { ...ROW, cutover_completed_at: null } });
  const before = await resolveDocumentMetadata('doc1', { supabase: cold.client });
  assert.equal(before.cutoverCompletedAt, null);
  // The seal writes cutover_completed_at, then crdtBackfill invalidates.
  invalidateDocumentMetadata('doc1');
  const sealed = makeClient({ row: { ...ROW, cutover_completed_at: '2026-06-03T12:00:00.000Z' } });
  const after = await resolveDocumentMetadata('doc1', { supabase: sealed.client });
  assert.equal(after.cutoverCompletedAt, '2026-06-03T12:00:00.000Z');
});
