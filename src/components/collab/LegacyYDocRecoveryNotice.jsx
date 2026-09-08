import { useEffect, useRef, useState } from 'react';
import { probeLegacyYDocRecovery, inspectLegacyYDocRecovery, buildLegacyYDocRecoveryExport } from '../../lib/collab/legacyYDocRecovery.js';
import { probeLegacyRecoveryArchives, listLegacyRecoveryArchives } from '../../lib/collab/legacyYDocRecoveryArchive.js';

function exportFailure(error) {
  if (error?.code === 'LEGACY_RECOVERY_LIMIT') return 'Export stopped at the safe size limit. No recovery file was downloaded; the original sources are unchanged.';
  if (/Unsupported recovery export/.test(error?.message || '')) return 'Export stopped because some stored data has an unsupported format. No recovery file was downloaded; the original sources are unchanged.';
  return 'The recovery export could not be made. No recovery file was downloaded; the original sources are unchanged.';
}

/** Metadata only until an explicit export. This notice never changes ownership,
 * merges data, or reports a save receipt to the document close gate. */
export default function LegacyYDocRecoveryNotice({ documentId, isActive = true, onState }) {
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sessionRef = useRef(null);
  const operationRef = useRef(null);
  const renderScopeRef = useRef(null);
  const downloadsRef = useRef(new Map());
  renderScopeRef.current = { documentId, isActive };

  useEffect(() => {
    const session = { documentId, controller: new AbortController() };
    sessionRef.current = session;
    setView(null); setBusy(false); setMessage('');
    const current = () => sessionRef.current === session && !session.controller.signal.aborted
      && renderScopeRef.current.documentId === documentId && renderScopeRef.current.isActive;
    if (documentId && isActive) {
      Promise.all([
        probeLegacyYDocRecovery(documentId, { signal: session.controller.signal }),
        probeLegacyRecoveryArchives(documentId, { signal: session.controller.signal })
          .catch(() => ({ state: 'read-failed' })),
      ]).then(([raw, archives]) => {
        if (!current()) return;
        const probe = { ...raw, archives,
          state: raw.state === 'present' || archives.state === 'present' ? 'present' : raw.state,
          hasReadFailure: raw.hasReadFailure || archives.state === 'read-failed' };
        setView(probe);
        try { onState?.(probe); } catch { /* parent reporting cannot break recovery */ }
      }, () => {
        if (!current()) return;
        const failed = { kind: 'probe', contentRead: false, documentId, state: 'read-failed', hasReadFailure: true,
          provenance: { actorUserId: null, attribution: 'unknown-legacy', automaticImportAllowed: false } };
        setView(failed);
        try { onState?.(failed); } catch { /* parent reporting cannot break recovery */ }
      });
    }
    return () => {
      session.controller.abort();
      operationRef.current?.controller.abort();
      operationRef.current = null;
      if (sessionRef.current === session) sessionRef.current = null;
      for (const [url, timer] of downloadsRef.current) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloadsRef.current.clear();
    };
  }, [documentId, isActive, onState]);

  const cancelExport = () => {
    operationRef.current?.controller.abort();
    operationRef.current = null;
    setBusy(false);
    setMessage('Export cancelled. The original sources are unchanged.');
  };

  const exportRecovery = async () => {
    const session = sessionRef.current;
    if (!session || operationRef.current || !isActive || session.documentId !== documentId) return;
    const operation = { controller: new AbortController() };
    operationRef.current = operation;
    const current = () => sessionRef.current === session && operationRef.current === operation
      && !session.controller.signal.aborted && !operation.controller.signal.aborted
      && renderScopeRef.current.documentId === documentId && renderScopeRef.current.isActive;
    setBusy(true); setMessage('Reading older local sources for export…');
    try {
      // Keep the service's default size/work caps; never raise them from UI.
      const bundle = await inspectLegacyYDocRecovery(documentId, { signal: operation.controller.signal });
      if (!current()) return;
      let archives;
      try { archives = await listLegacyRecoveryArchives(documentId, { signal: operation.controller.signal }); }
      catch (error) {
        if (error?.code === 'LEGACY_RECOVERY_LIMIT') throw error;
        archives = { state: 'read-failed', records: [] };
      }
      if (!current()) return;
      const partial = [bundle.registry, bundle.indexedDB, archives].some(source => !['present', 'absent'].includes(source?.state));
      const exported = await buildLegacyYDocRecoveryExport({ ...bundle, archives, recoveryReport: {
        scope: 'Unattributed legacy local sources only', partial,
        sourceStates: { registry: bundle.registry?.state || 'unknown', indexedDB: bundle.indexedDB?.state || 'unknown', archives: archives.state },
        isSyncReceipt: false,
      } }, { signal: operation.controller.signal });
      if (!current()) return;
      const blob = new Blob([JSON.stringify(exported)], { type: 'application/json' });
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadsRef.current.delete(url); }, 2000);
      downloadsRef.current.set(url, timer);
      const anchor = document.createElement('a');
      try {
        anchor.href = url;
        anchor.download = `survey-legacy-recovery-${String(documentId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}${partial ? '-partial' : ''}.json`;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
      } finally { anchor.remove(); }
      if (current()) setMessage(partial
        ? 'Partial recovery download started. Some sources could not be read. This is not a complete backup; keep the original sources.'
        : 'Recovery download started for the readable older sources. This does not mark this document synced or safe to close. Keep the original sources.');
    } catch (error) {
      if (current()) setMessage(exportFailure(error));
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setBusy(false); }
    }
  };

  if (!isActive || view?.documentId !== documentId || !(view?.state === 'present' || view?.hasReadFailure)) return null;
  return (
    <section aria-label="Older local copy" style={{ position: 'fixed', bottom: 48, right: 16, zIndex: 100021, width: 'min(420px, calc(100vw - 80px))', maxHeight: '40vh', overflowY: 'auto', padding: '10px 14px', background: 'var(--bg-secondary, #f5f5f5)', color: 'var(--text-primary, #222)', border: '1px solid var(--border-color, #ddd)', borderRadius: 8, fontSize: 13 }}>
      <p style={{ margin: '0 0 6px' }}>{view.hasReadFailure ? 'Some older local sources could not be checked.' : 'An older local copy is kept separately.'} Its owner is unknown. It will not be merged into this document.</p>
      <p style={{ margin: '0 0 8px' }}>Export reads local recovery data only. The file may contain private content; share it only with someone you trust.</p>
      <button type="button" onClick={exportRecovery} disabled={busy}>Export older local copy</button>
      {busy ? <button type="button" onClick={cancelExport} style={{ marginLeft: 8 }}>Cancel export</button> : null}
      {message ? <p role="status" style={{ margin: '8px 0 0' }}>{message}</p> : null}
    </section>
  );
}
