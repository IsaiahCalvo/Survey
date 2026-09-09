import { useEffect, useRef, useState } from 'react';

export default function PageReplacementRecoveryNotice({ recovery = null, onClear = null }) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const identity = recovery
    ? `${recovery.actorUserId}:${recovery.documentId}:${recovery.candidateOperationId}:${recovery.revision}`
    : null;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    setReviewing(false); setBusy(false); setError('');
  }, [identity]);
  if (!recovery) return null;

  const clear = async () => {
    if (busy || typeof onClear !== 'function') return;
    const startedFor = identity;
    setBusy(true); setError('');
    try {
      await onClear(recovery);
      if (identityRef.current === startedFor) setBusy(false);
    }
    catch {
      if (identityRef.current !== startedFor) return;
      setError('The expired request was kept. Reopen this document and try again.');
      setBusy(false);
    }
  };

  return (
    <section role="status" aria-label="Expired page change" data-page-replacement-recovery="expired"
      style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 5100, maxWidth: 560, padding: '12px 14px', borderRadius: 8,
        width: 'min(560px, calc(100% - 24px))', boxSizing: 'border-box',
        background: '#2a2115', color: '#fff', border: '1px solid #8d6b32',
        boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}>
      <div style={{ fontSize: 14, lineHeight: 1.4 }}>
        This page change expired before the server published it. Your open document and local work stay in place.
      </div>
      {reviewing ? <>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.35 }}>
          Clear only this expired request to allow a later page action. This will not run a page change.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" disabled={busy} onClick={() => { setReviewing(false); setError(''); }}>
            Keep blocked
          </button>
          <button type="button" disabled={busy} onClick={() => { void clear(); }}>
            {busy ? 'Clearing…' : 'Clear expired request'}
          </button>
        </div>
      </> : <button type="button" style={{ marginTop: 10 }} onClick={() => setReviewing(true)}>
        Review reset
      </button>}
      {error ? <div role="alert" style={{ marginTop: 8, fontSize: 13 }}>{error}</div> : null}
    </section>
  );
}
