import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext.jsx';
import { MSGraphContext } from '../contexts/MSGraphContext.jsx';
import App from '../AppShell.jsx';
import { prepareCheckedDocumentOpen } from '../services/checkedDocumentOpen.js';
import { purgeAnnotationDoc } from '../services/annotationDocSync.js';
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
export default function DocumentSurveyModelV2Harness({ cleanupOnly = false }) {
  const backendRef = useRef(null), handleRef = useRef(null);
  const [open, setOpen] = useState(null), [mount, setMount] = useState(0);
  const [status, setStatus] = useState({ stage: 'loading' });
  const [cleanupRequested, setCleanupRequested] = useState(false);
  const refresh = useCallback(() => {
    const backend = backendRef.current, handle = handleRef.current;
    const server = backend?.inspect();
    const survey = handle?.contentModelVersion === 2 ? handle.getSurveyState() : null;
    setStatus({ stage: handle ? 'ready' : 'opening', contentModelVersion: handle?.contentModelVersion ?? null,
      localRevision: handle?.getLocalRevision?.() ?? null, queueSize: handle?.getSyncStatus?.().queueSize ?? null,
      localMarkerCount: Object.keys(survey?.surveyMarkers || {}).length, ...server });
  }, []);
  const issueOpen = useCallback(async () => {
    handleRef.current = null; setStatus({ stage: 'opening' });
    const bundle = await backendRef.current.read();
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
            <button onClick={() => void run(controls.cleanup)}>Remove fixture data</button>
          </div>
        </details>
      </div>
  </MSGraphContext.Provider></AuthContext.Provider>;
}
