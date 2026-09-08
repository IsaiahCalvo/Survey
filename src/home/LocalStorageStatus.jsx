import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocalStorageStatus, requestLocalStoragePersistence } from '../services/localStorageStatus.js';

const bytes = value => value < 1024 * 1024 ? `${Math.ceil(value / 1024).toLocaleString()} KB` : `${(value / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
export default function LocalStorageStatus({ active = true }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [requestResult, setRequestResult] = useState('');
  const scope = useRef(null); const pending = useRef(null); const requesting = useRef(false);
  const readGeneration = useRef(0);
  const refresh = useCallback(async (fresh = false) => {
    // Permission can change while an older estimate is pending. Keep one
    // read in flight, but reject its old result and queue a fresh read after it.
    if (fresh) readGeneration.current++;
    const current = scope.current;
    if (!current) return;
    if (pending.current) return pending.current;
    const generation = readGeneration.current;
    const task = readLocalStorageStatus(window).then(value => {
      if (scope.current === current && readGeneration.current === generation) setStatus(value);
    })
      .finally(() => {
        if (pending.current === task) pending.current = null;
        if (scope.current && (scope.current !== current || readGeneration.current !== generation)) return refresh();
      });
    pending.current = task;
    return task;
  }, []);
  useEffect(() => {
    if (!active) return;
    const current = {}; scope.current = current;
    // A request may have settled while this panel was hidden. Restore the
    // live request state instead of retaining its last rendered busy flag.
    setBusy(requesting.current);
    setRequestResult('');
    let timer;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 1500); };
    void refresh();
    window.addEventListener('focus', schedule);
    window.addEventListener('local-document-store-changed', schedule);
    window.addEventListener('local-document-draft-changed', schedule);
    window.addEventListener('survey-offline-assets-status', schedule);
    return () => {
      clearTimeout(timer); if (scope.current === current) scope.current = null;
      window.removeEventListener('focus', schedule);
      window.removeEventListener('local-document-store-changed', schedule);
      window.removeEventListener('local-document-draft-changed', schedule);
      window.removeEventListener('survey-offline-assets-status', schedule);
    };
  }, [active, refresh]);
  const request = async () => {
    if (requesting.current || !scope.current) return;
    const current = scope.current; requesting.current = true; setBusy(true);
    try {
      const result = await requestLocalStoragePersistence(window);
      if (scope.current === current) setRequestResult(result);
      // Even a request from an earlier visible scope changes this origin's
      // permission. Refresh the current scope; never publish old request text.
      await refresh(true);
    } finally { requesting.current = false; if (scope.current) setBusy(false); }
  };
  return <section aria-label="Local storage status" style={{ marginBottom: 16, padding: 12, border: '1px solid var(--ink-500)', borderRadius: 8, fontSize: 13 }}>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <strong style={{ flex: 1, minWidth: 160 }}>Storage on this device</strong>
      <button type="button" className="btn" onClick={() => { void refresh(); }}>Check storage</button>
      {status?.canRequest && status.persistence !== 'granted' ? <button type="button" className="btn" disabled={busy} onClick={() => { void request(); }}>{busy ? 'Requesting…' : 'Request persistent storage'}</button> : null}
    </div>
    <p role="status" style={{ marginBottom: 8 }}>
      {!status ? 'Checking storage…' : status.native ? 'Files are stored in this app profile.' : status.persistence === 'granted' ? 'Persistent browser storage granted.' : status.persistence === 'best-effort' ? 'Storage is best-effort. The browser may remove it under storage pressure.' : 'Browser persistence status is unavailable.'}
      {status?.usage !== null && status?.usage !== undefined ? ` About ${bytes(status.usage)} used${status.quota !== null ? ` of a ${bytes(status.quota)} estimated limit` : ''}.` : ''}
    </p>
    <p style={{ margin: 0, color: 'var(--ink-200)' }}>Files, recovery snapshots and caches share this storage. Estimates do not guarantee free space. Keep an exported recovery file outside this profile; clearing app data or losing the device can remove all local copies.</p>
    {status?.pressure ? <p role="alert">Storage is nearing its estimated limit. Export recovery files and free space before adding large copies. Save remains available.</p> : null}
    {requestResult === 'denied' ? <p role="status">The browser did not grant persistence. Keep a separate recovery file.</p> : requestResult === 'unknown' ? <p role="status">The request could not be confirmed. Check storage again.</p> : null}
  </section>;
}
