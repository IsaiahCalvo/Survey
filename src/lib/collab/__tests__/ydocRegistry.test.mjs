// src/lib/collab/__tests__/ydocRegistry.test.mjs
// Phase 27 — Co-located registry tests covering HMR-stash + per-doc isolation.
// Public-API tests live at tests/phase27/ydocRegistry.test.mjs.
//
// UX/architecture rationale: this co-located file documents the INTERNAL HMR
// contract for future contributors who modify the registry. The Plan 27-01
// scaffold at tests/phase27/ydocRegistry.test.mjs covers the public-API
// contract from outside; this file covers the globalThis stash, the refCount
// floor, the throw conditions, and the per-doc isolation guarantee. Run via
// `node --test 'src/lib/collab/__tests__/*.test.mjs'` (npm test's glob is
// scoped to tests/, so this file only runs when explicitly invoked — that's
// intentional, the public-API contract test in tests/phase27/ is what gates CI).
import { test } from 'node:test';
import { strictEqual, notStrictEqual, ok, throws } from 'node:assert';
import {
  getOrCreateYDoc,
  releaseYDoc,
  _evictForTest,
  _getRefCountForTest,
} from '../ydocRegistry.js';

test('HMR-stash: registry survives module re-import via globalThis.__ydocRegistry__', () => {
  _evictForTest('hmr-test');
  const doc1 = getOrCreateYDoc('hmr-test');
  // Simulate HMR replay by reading the module's stash directly:
  const stash = globalThis.__ydocRegistry__;
  ok(stash instanceof Map, 'globalThis.__ydocRegistry__ is a Map');
  ok(stash.has('hmr-test'), 'doc-1 entry preserved on globalThis');
  strictEqual(stash.get('hmr-test').doc, doc1, 'same instance referenced from globalThis');
  _evictForTest('hmr-test');
});

test('refCount tracking: get/release pair', () => {
  _evictForTest('refcount-test');
  strictEqual(_getRefCountForTest('refcount-test'), 0, 'starts at 0');
  getOrCreateYDoc('refcount-test');
  strictEqual(_getRefCountForTest('refcount-test'), 1);
  getOrCreateYDoc('refcount-test');
  strictEqual(_getRefCountForTest('refcount-test'), 2);
  releaseYDoc('refcount-test');
  strictEqual(_getRefCountForTest('refcount-test'), 1);
  releaseYDoc('refcount-test');
  strictEqual(_getRefCountForTest('refcount-test'), 0);
  // Releasing below 0 does not go negative (UX: defensive — extra releases on
  // a stale documentId during hot reload should be no-ops, never blow up state).
  releaseYDoc('refcount-test');
  strictEqual(_getRefCountForTest('refcount-test'), 0, 'refCount floored at 0');
  _evictForTest('refcount-test');
});

test('throws on empty/null/undefined documentId', () => {
  throws(() => getOrCreateYDoc(null), /documentId required/);
  throws(() => getOrCreateYDoc(undefined), /documentId required/);
  throws(() => getOrCreateYDoc(''), /documentId required/);
  throws(() => getOrCreateYDoc(123), /documentId required/);
});

test('per-doc isolation: different ids return different Y.Doc instances', () => {
  _evictForTest('iso-a');
  _evictForTest('iso-b');
  const docA = getOrCreateYDoc('iso-a');
  const docB = getOrCreateYDoc('iso-b');
  notStrictEqual(docA, docB, 'different doc-ids → different Y.Doc instances');
  strictEqual(docA.guid, 'iso-a');
  strictEqual(docB.guid, 'iso-b');
  _evictForTest('iso-a');
  _evictForTest('iso-b');
});

test('releaseYDoc does NOT destroy the doc (Pitfall 21)', () => {
  _evictForTest('no-destroy-test');
  const doc = getOrCreateYDoc('no-destroy-test');
  let destroyCalled = false;
  const originalDestroy = doc.destroy.bind(doc);
  doc.destroy = () => { destroyCalled = true; originalDestroy(); };
  releaseYDoc('no-destroy-test');
  strictEqual(destroyCalled, false, 'destroy must NOT be called by releaseYDoc');
  // Doc is still usable (UX: observers + bindings registered on this doc keep working).
  const sameDoc = getOrCreateYDoc('no-destroy-test');
  strictEqual(sameDoc, doc, 'same instance after release+get');
  _evictForTest('no-destroy-test');
});
