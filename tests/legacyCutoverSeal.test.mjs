import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { legacyIdsMissingFromDoc, sealCutoverIfCovered } from '../src/services/legacyCutoverSeal.js';

function docWith({ marks = [], legacy = [] } = {}) {
  const doc = new Y.Doc();
  for (const id of marks) doc.getMap('marks').set(id, new Y.Map());
  for (const id of legacy) doc.getMap('annotations').set(id, { p: 1, o: {} });
  return doc;
}

function fakeSupabase() {
  const calls = [];
  const builder = {
    update(values) { calls.push({ op: 'update', values }); return builder; },
    eq(col, val) { calls.push({ op: 'eq', col, val }); return builder; },
    is(col, val) { calls.push({ op: 'is', col, val }); return Promise.resolve({ error: null }); },
  };
  return { calls, from(table) { calls.push({ op: 'from', table }); return builder; } };
}

const rows = (...ids) => ({ rawRows: ids.map((annotation_id) => ({ annotation_id })), error: null });
const unsealed = async () => ({ cutoverCompletedAt: null });

test('missing ids: marks and the older annotations map both count as held', () => {
  const doc = docWith({ marks: ['a'], legacy: ['b'] });
  assert.deepEqual(legacyIdsMissingFromDoc(doc, [{ annotation_id: 'a' }, { annotation_id: 'b' }, { annotation_id: 'c' }]), ['c']);
});

test('seals when every legacy row is in the doc, only while still unsealed', async () => {
  const supabase = fakeSupabase();
  const invalidated = [];
  const result = await sealCutoverIfCovered({
    supabase, documentId: 'd1', doc: docWith({ marks: ['a', 'b'] }),
    resolveMetadata: unsealed, loadLegacyRows: async () => rows('a', 'b'),
    invalidateMetadata: (id) => invalidated.push(id), now: () => 'T',
  });
  assert.equal(result.status, 'sealed');
  assert.deepEqual(supabase.calls, [
    { op: 'from', table: 'documents' },
    { op: 'update', values: { cutover_completed_at: 'T' } },
    { op: 'eq', col: 'id', val: 'd1' },
    { op: 'is', col: 'cutover_completed_at', val: null },
  ]);
  assert.deepEqual(invalidated, ['d1']);
});

test('a document with no legacy rows seals', async () => {
  const result = await sealCutoverIfCovered({
    supabase: fakeSupabase(), documentId: 'd1', doc: docWith(),
    resolveMetadata: unsealed, loadLegacyRows: async () => rows(),
  });
  assert.equal(result.status, 'sealed');
});

test('a legacy row missing from the doc leaves it unsealed and writes nothing', async () => {
  const supabase = fakeSupabase();
  const result = await sealCutoverIfCovered({
    supabase, documentId: 'd1', doc: docWith({ marks: ['a'] }),
    resolveMetadata: unsealed, loadLegacyRows: async () => rows('a', 'legacy-only'),
  });
  assert.equal(result.status, 'legacy-marks-missing');
  assert.deepEqual(result.missing, ['legacy-only']);
  assert.equal(supabase.calls.length, 0);
});

test('already sealed or unreadable: no write', async () => {
  const supabase = fakeSupabase();
  const base = { supabase, documentId: 'd1', doc: docWith() };
  assert.equal((await sealCutoverIfCovered({ ...base, resolveMetadata: async () => ({ cutoverCompletedAt: 'x' }), loadLegacyRows: async () => rows() })).status, 'already-sealed');
  assert.equal((await sealCutoverIfCovered({ ...base, resolveMetadata: unsealed, loadLegacyRows: async () => ({ error: new Error('x') }) })).status, 'read-failed');
  assert.equal((await sealCutoverIfCovered({ ...base, resolveMetadata: unsealed, loadLegacyRows: async () => { throw new Error('x'); } })).status, 'read-failed');
  assert.equal((await sealCutoverIfCovered({ ...base, resolveMetadata: async () => { throw new Error('x'); }, loadLegacyRows: async () => rows() })).status, 'read-failed');
  assert.equal(supabase.calls.length, 0);
});
