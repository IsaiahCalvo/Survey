import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { AuthContext } from '../contexts/AuthContext.jsx';
import { MSGraphContext } from '../contexts/MSGraphContext.jsx';
import App from '../AppShell.jsx';
import { prepareCheckedDocumentOpen } from '../services/checkedDocumentOpen.js';
import { purgeAnnotationDoc } from '../services/annotationDocSync.js';
import { updateSurveyMarkersV2 } from '../services/documentSurveyCrdtV2.js';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { createDocumentSurveyModelV2Fixture, MODEL2_FIXTURE_IDS } from './documentSurveyModelV2Fixture.js';

const templates = Object.freeze([{ id: 'fixture-template', name: 'Model 2 fixture survey', modules: [{
  id: 'fixture-module', name: 'Fixture module', categories: [{ id: 'fixture-category',
    name: 'Fixture marks', color: '#e05252', checklist: [
      { id: 'fixture-check-left', text: 'Left marker check' },
      { id: 'fixture-check-right', text: 'Right marker check' },
    ] }],
}] }]);
const auth = Object.freeze({ user: { id: MODEL2_FIXTURE_IDS.actorUserId, email: 'model2-fixture@example.invalid',
  user_metadata: { first_name: 'Model', last_name: 'Fixture', full_name: 'Model Fixture' } },
  loading: false, isAuthenticated: false, isSupabaseAvailable: false, plan: 'developer', tier: 'developer',
  features: { cloudSync: true, advancedSurvey: true, excelExport: true }, signOut: async () => {} });
const ms = Object.freeze({ account: null, graphClient: null, isAuthenticated: false, isLoading: false,
  needsReconnect: false, login: async () => {}, ensureFreshToken: async () => false });
const hex = bytes => `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
export default function DocumentSurveyModelV2Harness({ cleanupOnly = false }) {
  const backendRef = useRef(null), handleRef = useRef(null), staleExpectedRef = useRef(null),
    stalePreviousRef = useRef(null);
  const [open, setOpen] = useState(null), [mount, setMount] = useState(0);
  const [status, setStatus] = useState({ stage: 'loading' });
  const [cleanupRequested, setCleanupRequested] = useState(false);
  const [staleAction, setStaleAction] = useState(null);
  const refresh = useCallback(() => {
    const backend = backendRef.current, handle = handleRef.current;
    const server = backend?.inspect();
    const survey = handle?.contentModelVersion === 2 ? handle.getSurveyState() : null;
    const left = survey?.surveyMarkers?.['fixture-marker-left'];
    setStatus({ stage: handle ? 'ready' : 'opening', contentModelVersion: handle?.contentModelVersion ?? null,
      localRevision: handle?.getLocalRevision?.() ?? null, queueSize: handle?.getSyncStatus?.().queueSize ?? null,
      localMarkerCount: Object.keys(survey?.surveyMarkers || {}).length,
      leftMarkerX: left?.bounds?.x ?? null, stalePreviousX: stalePreviousRef.current,
      staleExpectedX: staleExpectedRef.current,
      staleSnapshotMatch: staleExpectedRef.current == null ? null : left?.bounds?.x === staleExpectedRef.current,
      ...server });
  }, []);
  const issueOpen = useCallback(async issuedBundle => {
    handleRef.current = null; setStatus({ stage: 'opening' });
    const bundle = issuedBundle || await backendRef.current.read();
    window.__surveyTransitionE2ETemplates = templates;
    setOpen(prepareCheckedDocumentOpen(bundle, MODEL2_FIXTURE_IDS.actorUserId));
    setMount(value => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      if (cleanupOnly) {
        await purgeAnnotationDoc(MODEL2_FIXTURE_IDS.documentId);
        if (active) setStatus({ stage: 'cleaned' });
        return;
      }
      const response = await fetch('/debug-fixtures/clickable-link-test.pdf');
      if (!response.ok) throw new Error(`Fixture PDF failed: ${response.status}`);
      const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: await response.blob() });
      if (!active) { backend.destroy(); return; }
      backendRef.current = backend; await issueOpen();
    })().catch(error => active && setStatus({ stage: 'error', error: error.message }));
    return () => { active = false; backendRef.current?.destroy(); };
  }, [cleanupOnly, issueOpen]);
  useEffect(() => {
    if (!cleanupRequested || open !== null) return;
    void purgeAnnotationDoc(MODEL2_FIXTURE_IDS.documentId).then(() => {
      backendRef.current?.destroy(); backendRef.current = null;
      setCleanupRequested(false); setStatus({ stage: 'cleaned' });
    }).catch(error => setStatus({ stage: 'error', error: error.message }));
  }, [cleanupRequested, open]);
  useEffect(() => {
    if (!staleAction || open !== null) return;
    let active = true;
    (async () => {
      const backend = backendRef.current;
      await purgeAnnotationDoc(MODEL2_FIXTURE_IDS.documentId);
      const staleBundle = await backend.read();
      const before = backend.inspect();
      if (before.walHead !== staleBundle.throughSeq) {
        throw new Error('Fixture changed while the stale checked bundle was captured.');
      }
      const doc = createDetachedYDoc('model2-browser-stale-snapshot');
      try {
        Y.applyUpdate(doc, staleBundle.annotationUpdate);
        const expectedX = staleAction.oldX === 132 ? 72 : 132;
        updateSurveyMarkersV2(doc, markers => ({ ...markers,
          'fixture-marker-left': { ...markers['fixture-marker-left'],
            bounds: { ...markers['fixture-marker-left'].bounds, x: expectedX } } }));
        const stored = (await Promise.resolve(backend.client.rpc('store_annotation_snapshot_v3', {
          p_document_id: MODEL2_FIXTURE_IDS.documentId,
          p_generation_id: MODEL2_FIXTURE_IDS.generationId,
          p_content_model_version: 2, p_at_seq: staleBundle.throughSeq,
          p_snapshot: hex(Y.encodeStateAsUpdate(doc)), p_encoding_version: 1,
          p_writer_id: 'browser-stale-snapshot-writer',
          p_writer_epoch: String(BigInt(staleBundle.snapshotBase.writerEpoch) + 1n),
          p_expected_at_seq: staleBundle.snapshotBase.atSeq,
          p_expected_writer_id: staleBundle.snapshotBase.writerId,
          p_expected_writer_epoch: staleBundle.snapshotBase.writerEpoch,
        }))).data;
        if (stored?.stored !== true) throw new Error('Fixture did not store the newer same-head snapshot.');
        stalePreviousRef.current = staleAction.oldX; staleExpectedRef.current = expectedX;
      } finally { doc.destroy(); }
      if (active) { setStaleAction(null); await issueOpen(staleBundle); }
    })().catch(error => {
      if (active) { setStaleAction(null); setStatus({ stage: 'error', error: error.message }); }
    });
    return () => { active = false; };
  }, [issueOpen, open, staleAction]);
  const onGenerationSession = useCallback(record => {
    handleRef.current = record?.handle || null;
    if (record?.handle) {
      record.handle.onChange(refresh); record.handle.onSyncStatus(refresh);
      queueMicrotask(refresh);
    }
  }, [refresh]);
  const controls = useMemo(() => ({
    async flush() { await handleRef.current?.drain(); await handleRef.current?.flushLocalDurability(); refresh(); },
    offline(value) { backendRef.current?.setOffline(value); refresh(); },
    async reopen() { await handleRef.current?.destroy(); await issueOpen(); },
    async staleSameHead() {
      const oldX = handleRef.current?.getSurveyState?.().surveyMarkers?.['fixture-marker-left']?.bounds?.x;
      if (!Number.isFinite(oldX)) throw new Error('The fixture marker is not ready.');
      await handleRef.current.destroy();
      handleRef.current = null;
      setStaleAction({ oldX });
      setOpen(null);
    },
    async cleanup() { await handleRef.current?.destroy(); handleRef.current = null;
      setCleanupRequested(true); setOpen(null); },
  }), [issueOpen, refresh]);
  const run = useCallback(async action => {
    try { await action(); } catch (error) { setStatus(current => ({ ...current,
      stage: 'error', error: error?.message || String(error) })); }
  }, []);
  if (!open) return <main data-model2-fixture-state={status.stage}>{status.error || status.stage}</main>;
  return <AuthContext.Provider value={auth}><MSGraphContext.Provider value={ms}>
      <div style={{ height: '100vh' }}>
        <App key={mount} devInitialCheckedBundle={open.checkedBundle}
          annotationDocClient={backendRef.current.client} devOnGenerationSession={onGenerationSession} />
        <details aria-label="Model 2 fixture controls" style={{ position: 'fixed', bottom: 8, left: 8,
          zIndex: 20000, background: '#111827', color: 'white', padding: 8,
          width: 'min(86vw, 360px)', maxHeight: '45vh', overflow: 'auto', fontSize: 11 }}>
          <summary style={{ cursor: 'pointer' }}>Model 2 fixture: {status.stage}; markers {status.markerCount ?? '—'};
            annotations {status.annotationCount ?? '—'}</summary>
          <output data-model2-fixture-status style={{ display: 'block', whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere', margin: '6px 0' }}>{JSON.stringify(status)}</output><div>
            <button onClick={() => void run(controls.flush)}>Flush</button>
            <button onClick={() => controls.offline(true)}>Go offline</button>
            <button onClick={() => controls.offline(false)}>Go online</button>
            <button onClick={() => void run(controls.reopen)}>Reopen</button>
            <button onClick={() => void run(controls.staleSameHead)}>Test stale same-head open</button>
            <button onClick={() => void run(controls.cleanup)}>Remove fixture data</button>
          </div>
        </details>
      </div>
  </MSGraphContext.Provider></AuthContext.Provider>;
}
