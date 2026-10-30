import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

// Save skips the red "Could not save a local copy" toast for a drawing too big
// for the browser backup only while the shared document keeps the work: its
// store on this device (hasLocalStore) or nothing left to upload.
const open = (enableLocal) => openAnnotationDoc({
  actorUserId: 'actor-a',
  documentId: `doc-local-store-${enableLocal}`,
  supabase: null,
  clientId: 'c',
  writerId: 'c',
  enableLocal,
  enableRealtime: false,
  doc: new Y.Doc(),
  localPersistenceFactory: async () => ({ synced: true, destroy() {} }),
});

test('hasLocalStore says whether this device keeps its own copy of the edits', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  const withStore = await open(true);
  const withoutStore = await open(false);
  try {
    assert.equal(withStore.hasLocalStore(), true);
    assert.equal(withoutStore.hasLocalStore(), false);
  } finally {
    await withStore.destroy().catch(() => {});
    await withoutStore.destroy().catch(() => {});
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('Save shows the local-copy toast only when the shared document does not hold the work', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const at = src.indexOf("showToast('Could not save a local copy.");
  assert.ok(at > 0);
  assert.match(src.slice(at - 200, at), /if \(!annotationDocHoldsWorkRef\.current\(\)\) \{\s*$/);
  assert.match(src, /annotationDocHoldsWorkRef\.current = \(\) => Boolean\([\s\S]{0,200}cloudSyncStatus\?\.healthy[\s\S]{0,80}annotationDocHasLocalStore\(\) \|\| cloudSyncQueueSize === 0/);
});
