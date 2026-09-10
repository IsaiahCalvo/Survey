import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildLocalDocumentState } from '../services/localDocumentState.js';
import { createLocalDocumentDraftStore } from '../services/localDocumentDraftStore.js';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';

const LOCAL_ID = 'local:73000000-0000-4000-8000-000000000001';
const makePdf = () => Object.assign(new File(['%PDF-1.4\n%%EOF\n'], 'draft-index-fixture.pdf', {
  type: 'application/pdf', lastModified: 1,
}), { localId: LOCAL_ID, _surveyPdfId: LOCAL_ID, storageMode: 'local', localRevision: 1 });
const makeState = label => buildLocalDocumentState({ pdfId: LOCAL_ID,
  annotationsByPage: { 1: { objects: [{ id: label }] } }, items: {}, annotations: {},
  surveyMarkers: {}, callouts: [], pageNames: {}, bookmarks: [], spaces: [], regionOverlayDisabled: {} });
const idbRequest = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const idbTransaction = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => {};
});
const removeDatabase = dbName => new Promise((resolve, reject) => {
  const request = globalThis.indexedDB.deleteDatabase(dbName);
  request.onsuccess = resolve;
  request.onerror = () => reject(request.error || new Error('Fixture cleanup failed.'));
  request.onblocked = () => reject(new Error('Close other copies of this fixture, then retry cleanup.'));
});

async function seedV2(dbName) {
  const live = { sessionId: randomUUID(), writerId: randomUUID(), fileId: randomUUID() };
  const retainedFile = makePdf(); const retainedState = makeState('migrated-native-index-check');
  const open = globalThis.indexedDB.open(dbName, 2);
  open.onupgradeneeded = () => {
    const db = open.result;
    const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' });
    const bytes = db.createObjectStore('pdfBytes', { keyPath: 'sessionId' });
    bytes.createIndex('payloadId', 'payloadId');
    db.createObjectStore('snapshots', { keyPath: 'sessionId' });
    db.createObjectStore('sharedPdfBytes', { keyPath: 'payloadId' });
    for (let index = 0; index < 40; index += 1) sessions.add({
      sessionId: randomUUID(), writerId: randomUUID(), fileId: randomUUID(), sequence: 1, discarded: true,
    });
    sessions.add({ ...live, sourceLocalId: LOCAL_ID, baseCanonicalRevision: 1,
      name: retainedFile.name, size: retainedFile.size,
      type: 'application/pdf', created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:01.000Z', sequence: 1, discarded: false });
    bytes.add({ ...live, blob: retainedFile });
    open.transaction.objectStore('snapshots').add({ ...live, sequence: 1, state: retainedState });
  };
  const db = await idbRequest(open); db.close();
  return { ...live, retainedFile, retainedState };
}

export default function LocalDocumentDraftIndexHarness() {
  const dbName = useMemo(() => `survey-draft-index-fixture-${randomUUID()}`, []);
  const storeRef = useRef(null);
  const removedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ phase: 'idle', dbName, tombstones: 40 });
  const cleanup = async () => {
    storeRef.current?.close(); storeRef.current = null;
    await removeDatabase(dbName); removedRef.current = true;
    setStatus({ phase: 'removed', dbName });
  };
  useEffect(() => () => {
    storeRef.current?.close();
    if (!removedRef.current) void removeDatabase(dbName).catch(() => {});
  }, [dbName]);
  const run = async () => {
    setBusy(true); setStatus({ phase: 'running', dbName, tombstones: 40 });
    try {
      storeRef.current?.close(); storeRef.current = null; removedRef.current = false;
      await removeDatabase(dbName);
      const seeded = await seedV2(dbName);
      const first = createLocalDocumentDraftStore({ indexedDB: globalThis.indexedDB, dbName, timeoutMs: 2_000 });
      storeRef.current = first;
      const migrated = await first.listDrafts();
      const migratedDraft = await first.readDraft(seeded.sessionId, { expectedSequence: 1 });
      const migratedBytesMatch = await migratedDraft.file.text() === await seeded.retainedFile.text();
      const migratedStateMatch = JSON.stringify(migratedDraft.state) === JSON.stringify(seeded.retainedState);
      const writer = first.createWriter(makePdf());
      const receipt = await writer.capture(makeState('native-index-check'));
      const afterCapture = await first.listDrafts();
      await first.discardDraft(receipt.sessionId, { expectedSequence: receipt.sequence });
      let repeatDiscardCode = null;
      try { await first.discardDraft(receipt.sessionId, { expectedSequence: receipt.sequence }); }
      catch (error) { repeatDiscardCode = error?.code || 'error'; }
      first.close(); storeRef.current = null;
      const cold = createLocalDocumentDraftStore({ indexedDB: globalThis.indexedDB, dbName, timeoutMs: 2_000 });
      storeRef.current = cold;
      const reopened = await cold.listDrafts();
      const coldDraft = await cold.readDraft(seeded.sessionId, { expectedSequence: 1 });
      const coldBytesMatch = await coldDraft.file.text() === await seeded.retainedFile.text();
      const coldStateMatch = JSON.stringify(coldDraft.state) === JSON.stringify(seeded.retainedState);
      let db; let totalRows; let activeRows; let activeCount; let schemaVersion;
      try {
        db = await idbRequest(globalThis.indexedDB.open(dbName)); schemaVersion = db.version;
        const tx = db.transaction(['sessions', 'draftMeta'], 'readonly');
        totalRows = await idbRequest(tx.objectStore('sessions').count());
        activeRows = await idbRequest(tx.objectStore('sessions').index('active').count(1));
        activeCount = await idbRequest(tx.objectStore('draftMeta').get('activeCount'));
        await idbTransaction(tx);
      } finally { db?.close(); }
      const checks = { schemaVersion, tombstones: totalRows - activeRows,
        migratedActive: migrated.length, afterCaptureActive: afterCapture.length,
        reopenedActive: reopened.length, indexedActive: activeRows, recordedActive: activeCount?.value,
        repeatDiscardCode, migratedBytesMatch, migratedStateMatch, coldBytesMatch, coldStateMatch };
      const expected = { schemaVersion: 3, tombstones: 41, migratedActive: 1, afterCaptureActive: 2,
        reopenedActive: 1, indexedActive: 1, recordedActive: 1, repeatDiscardCode: 'discarded',
        migratedBytesMatch: true, migratedStateMatch: true, coldBytesMatch: true, coldStateMatch: true };
      if (Object.keys(expected).some(key => checks[key] !== expected[key])) {
        throw new Error(`Fixture checks did not match: ${JSON.stringify(checks)}`);
      }
      setStatus({ phase: 'passed', dbName, ...checks });
    } catch (error) {
      setStatus({ phase: 'failed', dbName, error: error?.message || String(error) });
    } finally { setBusy(false); }
  };
  return <main style={{ minHeight: '100vh', padding: 32, fontFamily: 'system-ui', background: '#f5f5f5', color: '#20242b' }}>
    <h1>Local draft active index fixture</h1>
    <p data-fixture-scope>Fixture only: native browser IndexedDB, unique temporary database, no auth or cloud call.</p>
    <button type="button" disabled={busy} onClick={() => { void run(); }}>Run checks</button>
    <button type="button" disabled={busy || status.phase === 'removed'} onClick={() => { setBusy(true); void cleanup()
      .catch(error => setStatus({ phase: 'cleanup-failed', dbName, error: error?.message || String(error) }))
      .finally(() => setBusy(false)); }} style={{ marginLeft: 8 }}>Remove fixture data</button>
    <pre data-local-document-draft-index-status style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(status, null, 2)}</pre>
  </main>;
}
