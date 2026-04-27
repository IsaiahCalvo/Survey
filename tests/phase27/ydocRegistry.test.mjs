// tests/phase27/ydocRegistry.test.mjs
// Phase 27 Wave 0 scaffold — runs as test.skip until production code lands in Plan 27-02.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// UX/architecture rationale: the Y.Doc registry is the single owner of every Y.Doc
// instance in the app. It maps document_id → Y.Doc, hands out the same instance on
// repeated getOrCreateYDoc() calls (so two callers in the same tab share one doc),
// and refuses to destroy docs on release (Pitfall 21 — destroying a Y.Doc nukes
// every observer + every binding that ever attached to it). Tests pin the contract:
//   1. getOrCreateYDoc returns a Y.Doc instance.
//   2. Same id → same instance (===) on repeated calls.
//   3. Different ids → different instances.
//   4. releaseYDoc does NOT call .destroy() on the doc.
//   5. refCount tracks correctly across get/release.
//
// Skip condition: src/lib/collab/ydocRegistry.js has not been created yet. Plan 27-02
// is responsible for landing the registry plus the `_evictForTest` and
// `_getRefCountForTest` test-only helpers this file imports.

import { test } from 'node:test';
import { strictEqual, notStrictEqual, ok, doesNotThrow } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const REGISTRY_FILE = resolve(REPO_ROOT, 'src/lib/collab/ydocRegistry.js');

const skipReason = !existsSync(REGISTRY_FILE)
  ? 'src/lib/collab/ydocRegistry.js not yet created (Plan 27-02)'
  : false;

test(
  'getOrCreateYDoc returns a Y.Doc instance',
  { skip: skipReason },
  async () => {
    const { getOrCreateYDoc, _evictForTest } = await import(
      '../../src/lib/collab/ydocRegistry.js'
    );
    const doc = getOrCreateYDoc('doc-instance-1');
    ok(doc, 'expected a Y.Doc instance');
    strictEqual(doc.constructor.name, 'Doc', 'expected constructor.name === "Doc"');
    _evictForTest('doc-instance-1');
  }
);

test(
  'getOrCreateYDoc returns same instance on second call with same id',
  { skip: skipReason },
  async () => {
    const { getOrCreateYDoc, _evictForTest } = await import(
      '../../src/lib/collab/ydocRegistry.js'
    );
    const docA = getOrCreateYDoc('doc-same-id');
    const docB = getOrCreateYDoc('doc-same-id');
    strictEqual(docA, docB, 'expected the same Y.Doc instance for repeated calls with the same id');
    _evictForTest('doc-same-id');
  }
);

test(
  'getOrCreateYDoc returns different instances for different ids',
  { skip: skipReason },
  async () => {
    const { getOrCreateYDoc, _evictForTest } = await import(
      '../../src/lib/collab/ydocRegistry.js'
    );
    const docA = getOrCreateYDoc('doc-A');
    const docB = getOrCreateYDoc('doc-B');
    notStrictEqual(docA, docB, 'expected different Y.Doc instances for different ids');
    _evictForTest('doc-A');
    _evictForTest('doc-B');
  }
);

test(
  'releaseYDoc does not destroy the doc (Pitfall 21)',
  { skip: skipReason },
  async () => {
    const { getOrCreateYDoc, releaseYDoc, _evictForTest } = await import(
      '../../src/lib/collab/ydocRegistry.js'
    );
    const docId = 'doc-no-destroy';
    const doc = getOrCreateYDoc(docId);
    // UX: monkey-patch destroy so we can assert release path never reaches it.
    // Calling Y.Doc.destroy() invalidates every observer and binding (Pitfall 21).
    let destroyCalled = false;
    const originalDestroy = doc.destroy.bind(doc);
    doc.destroy = () => {
      destroyCalled = true;
      throw new Error('destroy should not be called by releaseYDoc');
    };
    doesNotThrow(() => releaseYDoc(docId), 'releaseYDoc must not call doc.destroy()');
    strictEqual(destroyCalled, false, 'expected destroy to NOT be called on release');
    // After release, the same id should still resolve to the same doc instance
    // (so observers/bindings registered earlier survive the release).
    const docAgain = getOrCreateYDoc(docId);
    strictEqual(docAgain, doc, 'expected same instance after release/re-get');
    // Restore + clean up
    doc.destroy = originalDestroy;
    _evictForTest(docId);
  }
);

test(
  'refCount tracks across get/release',
  { skip: skipReason },
  async () => {
    const {
      getOrCreateYDoc,
      releaseYDoc,
      _getRefCountForTest,
      _evictForTest,
    } = await import('../../src/lib/collab/ydocRegistry.js');
    const docId = 'doc-refcount';
    getOrCreateYDoc(docId);
    getOrCreateYDoc(docId);
    getOrCreateYDoc(docId);
    strictEqual(_getRefCountForTest(docId), 3, 'refCount should be 3 after 3 gets');
    releaseYDoc(docId);
    releaseYDoc(docId);
    strictEqual(_getRefCountForTest(docId), 1, 'refCount should be 1 after 2 releases');
    _evictForTest(docId);
  }
);
