// KAL-250 / DB-sync — shared per-open documents-row resolver.
//
// Opening a document used to read the same documents row ~6 times (lock state,
// cutover seal x2, owner id, and fast-open watermark). The
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
  cutover_completed_at: '2026-06-03T09:00:00.000Z',
  annotations_changed_at: '2026-06-03T11:00:00.000Z'
};

// Fake Supabase client: from('documents').select(cols).eq('id', id).maybeSingle()
// -> { data, error }. Counts select() invocations = actual DB round-trips.
function makeClient({ row = ROW, error = null } = {}) {
  let selectCount = 0;
  let selectedColumns = null;
  const builder = {
    select(columns) { selectCount++; selectedColumns = columns; return builder; },
    eq() { return builder; },
    maybeSingle() { return Promise.resolve({ data: error ? null : row, error }); }
  };
  return { client: { from() { return builder; } }, selects: () => selectCount, selectedColumns: () => selectedColumns };
}

test('one resolve issues exactly one select and maps to camelCase', async () => {
  __resetDocumentMetadataCacheForTests();
  const { client, selects, selectedColumns } = makeClient();
  const meta = await resolveDocumentMetadata('doc1', { supabase: client });
  assert.equal(selects(), 1);
  assert.equal(meta.userId, 'owner-1');
  assert.equal(meta.lockedLabel, 'Editing');
  assert.doesNotMatch(selectedColumns(), /tool_preferences/, 'shared document metadata must not carry private tool settings');
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
  assert.equal(Object.hasOwn(meta, 'toolPreferences'), false);
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

function deferredClient() {
  const pending = [];
  let onAuth;
  const client = {
    auth: { onAuthStateChange(callback) { onAuth = callback; } },
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle() { return new Promise((resolve) => pending.push(resolve)); },
      };
      return query;
    },
  };
  return { client, pending, auth: (event, id) => onAuth(event, id ? { user: { id } } : null) };
}

test('different clients never share cached or pending document metadata', async () => {
  __resetDocumentMetadataCacheForTests();
  const a = deferredClient();
  const b = deferredClient();
  const first = resolveDocumentMetadata('shared-id', { supabase: a.client });
  const second = resolveDocumentMetadata('shared-id', { supabase: b.client });
  assert.equal(a.pending.length, 1);
  assert.equal(b.pending.length, 1);
  a.pending[0]({ data: { ...ROW, user_id: 'a' }, error: null });
  b.pending[0]({ data: { ...ROW, user_id: 'b' }, error: null });
  assert.equal((await first).userId, 'a');
  assert.equal((await second).userId, 'b');
  assert.equal((await resolveDocumentMetadata('shared-id', { supabase: b.client })).userId, 'b');
});

test('an invalidated old read cannot fill cache or remove its newer pending read', async () => {
  __resetDocumentMetadataCacheForTests();
  const h = deferredClient();
  const old = resolveDocumentMetadata('doc1', { supabase: h.client });
  invalidateDocumentMetadata('doc1');
  const fresh = resolveDocumentMetadata('doc1', { supabase: h.client });
  h.pending[0]({ data: { ...ROW, locked_label: 'old' }, error: null });
  await old;
  const joined = resolveDocumentMetadata('doc1', { supabase: h.client });
  assert.equal(h.pending.length, 2, 'must join fresh pending read, not fetch or use old cache');
  h.pending[1]({ data: { ...ROW, locked_label: 'fresh' }, error: null });
  assert.equal((await fresh).lockedLabel, 'fresh');
  assert.equal((await joined).lockedLabel, 'fresh');
  assert.equal((await resolveDocumentMetadata('doc1', { supabase: h.client })).lockedLabel, 'fresh');
});

test('late old response cannot overwrite an already completed replacement', async () => {
  __resetDocumentMetadataCacheForTests();
  const h = deferredClient();
  const old = resolveDocumentMetadata('doc1', { supabase: h.client });
  invalidateDocumentMetadata('doc1');
  const fresh = resolveDocumentMetadata('doc1', { supabase: h.client });
  h.pending[1]({ data: { ...ROW, locked_label: 'fresh' }, error: null });
  await fresh;
  h.pending[0]({ data: { ...ROW, locked_label: 'old' }, error: null });
  await old;
  assert.equal((await resolveDocumentMetadata('doc1', { supabase: h.client })).lockedLabel, 'fresh');
});

test('auth boundaries clear cache and reject old-session responses without auth API calls', async () => {
  __resetDocumentMetadataCacheForTests();
  const h = deferredClient();
  const old = resolveDocumentMetadata('doc1', { supabase: h.client });
  h.auth('SIGNED_OUT');
  h.auth('SIGNED_IN', 'new-user');
  const fresh = resolveDocumentMetadata('doc1', { supabase: h.client });
  h.pending[0]({ data: ROW, error: null });
  assert.equal((await old).userId, null);
  h.pending[1]({ data: { ...ROW, user_id: 'new-user' }, error: null });
  await fresh;
  h.auth('TOKEN_REFRESHED', 'new-user');
  assert.equal((await resolveDocumentMetadata('doc1', { supabase: h.client })).userId, 'new-user');
  assert.equal(h.pending.length, 2, 'same-account token refresh retains useful cache');
  h.auth('SIGNED_OUT');
  const missing = resolveDocumentMetadata('doc1', { supabase: h.client });
  assert.equal(h.pending.length, 3);
  h.pending[2]({ data: null, error: null });
  assert.equal((await missing).userId, null);
});

test('short TTL cache has a fixed entry bound', async () => {
  __resetDocumentMetadataCacheForTests();
  const h = makeClient();
  for (let i = 0; i < 129; i++) await resolveDocumentMetadata(`doc-${i}`, { supabase: h.client });
  await resolveDocumentMetadata('doc-128', { supabase: h.client });
  assert.equal(h.selects(), 129, 'newest entry remains cached');
  await resolveDocumentMetadata('doc-0', { supabase: h.client });
  assert.equal(h.selects(), 130, 'oldest entry was evicted at the bound');
});

test('initial session notification does not discard the first open-time read', async () => {
  __resetDocumentMetadataCacheForTests();
  const h = deferredClient();
  const pending = resolveDocumentMetadata('doc1', { supabase: h.client });
  h.auth('INITIAL_SESSION', 'owner-1');
  h.pending[0]({ data: ROW, error: null });
  assert.equal((await pending).userId, 'owner-1');
  await resolveDocumentMetadata('doc1', { supabase: h.client });
  assert.equal(h.pending.length, 1);
});
