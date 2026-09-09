import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DocumentEntityCatalogAdoptionNotice from '../components/DocumentEntityCatalogAdoptionNotice.jsx';
import { useDocumentEntityCatalog } from '../hooks/useDocumentEntityCatalog.js';
import { buildLocalDocumentState, createLocalDocumentStateReader } from '../services/localDocumentState.js';
import { createLocalDocumentStore } from '../services/localDocumentStore.js';
import { randomUUID } from '../utils/randomUUIDPolyfill.js';

const TEMPLATE = Object.freeze({ id: 'fixture-template', name: 'Reviewed fixture list',
  updatedAt: '2026-09-09T12:00:00.000Z', entities: Object.freeze([
    Object.freeze({ id: 'general-contractor', name: 'General Contractor', color: '#d8a84e',
      opacity: 0.7, borderColor: '#8b6422', borderOpacity: 0.8, matchFill: false }),
    Object.freeze({ id: 'subcontractor', name: 'Subcontractor', color: '#5ba1f0',
      opacity: 0.5, borderColor: null, borderOpacity: null, matchFill: true }),
  ]) });

const deleteFixtureDatabase = dbName => new Promise((resolve, reject) => {
  let request;
  try { request = globalThis.indexedDB.deleteDatabase(dbName); }
  catch (error) { reject(error); return; }
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error || new Error('Fixture data could not be removed.'));
  request.onblocked = () => reject(new Error('Fixture data is still open in another tab.'));
});

function ActiveDocumentEntityCatalogHarness({ onRemoved }) {
  const dbName = useMemo(() => `survey-entity-catalog-fixture-${randomUUID()}`, []);
  const store = useMemo(() => createLocalDocumentStore({ indexedDB: globalThis.indexedDB,
    dbName, timeoutMs: 2_000 }), [dbName]);
  const live = useRef(true);
  const explicitlyRemoved = useRef(false);
  const [file, setFile] = useState(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const [status, setStatus] = useState('Creating a managed-local fixture…');
  const [assigned, setAssigned] = useState(null);
  const [failSave, setFailSave] = useState(false);
  useEffect(() => {
    live.current = true;
    void (async () => {
      try {
        const manifest = await store.importLocalDocument(new File([
          new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
        ], 'entity-catalog-fixture.pdf', { type: 'application/pdf' }));
        const opened = await store.openLocalDocument(manifest.localId);
        if (live.current) { setFile(opened); setStatus('Legacy choices are active. No list was copied.'); }
      } catch { if (live.current) setStatus('Fixture setup failed.'); }
    })();
    return () => {
      live.current = false; store.close();
      if (!explicitlyRemoved.current) {
        void deleteFixtureDatabase(dbName).catch(() => {});
      }
    };
  }, [dbName, store]);
  const readLocal = useCallback(value => {
    const raw = createLocalDocumentStateReader(value).getItem(`entityCatalog_${value.localId}`);
    return raw ? JSON.parse(raw) : null;
  }, []);
  const persistLocal = useCallback(async (value, catalog) => {
    if (failSave) throw new Error('Fixture quota failure. The legacy state was kept.');
    const state = buildLocalDocumentState({ pdfId: value.localId, entityCatalog: catalog });
    await store.saveLocalDocumentState(value.localId, state, { expectedRevision: value.localRevision });
    const reopened = await store.openLocalDocument(value.localId);
    if (!live.current) throw new Error('Fixture closed.');
    setFile(reopened);
  }, [failSave, store]);
  const isCurrent = useCallback(({ localId }) => live.current
    && localId === fileRef.current?.localId, []);
  const catalog = useDocumentEntityCatalog({ enabled: true, file,
    actorUserId: '11111111-1111-4111-8111-111111111111', template: TEMPLATE,
    readManagedLocal: readLocal, persistManagedLocal: persistLocal,
    isCurrent });
  const reload = async () => {
    const reopened = await store.openLocalDocument(file.localId);
    setFile(reopened); setStatus('Reloaded the same managed-local document.');
  };
  const removeFixtureData = async () => {
    live.current = false;
    store.close();
    setStatus('Removing this fixture data…');
    try {
      await deleteFixtureDatabase(dbName);
      explicitlyRemoved.current = true;
      onRemoved({ removed: true, message: 'This fixture database was removed.' });
    } catch {
      explicitlyRemoved.current = true;
      onRemoved({ removed: false,
        message: 'This fixture stopped, but its database could not be removed. Close other fixture tabs and reload.' });
    }
  };
  return <main style={{ minHeight: '100vh', padding: '32px', color: '#20242b',
    background: '#f5f5f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
    <h1>Document entity list fixture</h1>
    <p data-fixture-scope>Fixture only: native browser storage. No auth or cloud call.</p>
    <p data-fixture-status>{status}</p>
    <p data-catalog-mode>Mode: {catalog.mode}</p>
    <button type="button" disabled={!file || catalog.busy}
      onClick={() => { void catalog.requestAdoption(TEMPLATE).catch(() => {}); }}>Review list</button>
    <button type="button" disabled={!file} onClick={() => { void reload(); }} style={{ marginLeft: 8 }}>Reload document</button>
    <button type="button" disabled={!file || catalog.busy}
      data-document-entity-catalog-remove-fixture
      onClick={() => { void removeFixtureData(); }} style={{ marginLeft: 8 }}>Remove fixture data</button>
    <label style={{ display: 'block', margin: '14px 0' }}><input type="checkbox"
      checked={failSave} onChange={event => setFailSave(event.target.checked)} /> Test failed local save</label>
    <h2>Assignment choices</h2>
    {catalog.entities.map(entity => <button type="button" key={entity.id}
      onClick={() => setAssigned({ entityId: entity.id, entityName: entity.name, entityColor: entity.color })}
      style={{ marginRight: 8 }}>{entity.name}</button>)}
    <pre data-assigned-marker>{assigned ? JSON.stringify(assigned) : 'No assignment'}</pre>
    <DocumentEntityCatalogAdoptionNotice review={catalog.review} busy={catalog.busy}
      error={catalog.error} onConfirm={() => catalog.confirmAdoption().then(() => {
        setStatus('The reviewed list was saved before it became active.');
      }).catch(() => {})} onCancel={catalog.cancelAdoption} />
  </main>;
}

export default function DocumentEntityCatalogHarness() {
  const [result, setResult] = useState(null);
  if (result) return <main style={{ minHeight: '100vh', padding: '32px', color: '#20242b',
    background: '#f5f5f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
    <h1>Document entity list fixture</h1>
    <p data-document-entity-catalog-fixture-removed={result.removed ? 'true' : 'false'}>{result.message}</p>
  </main>;
  return <ActiveDocumentEntityCatalogHarness onRemoved={setResult} />;
}
