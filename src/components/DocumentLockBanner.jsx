// src/components/DocumentLockBanner.jsx
// KAL-49 — Document lock state surface. Renders:
//   1. A top banner when locked_at IS NOT NULL, naming who locked + when.
//   2. body[data-readonly="true"] flips on while locked, so the existing
//      ReadOnlyGate.css selectors dim the toolbar for free (no toolbar diff).
//   3. A capture-phase keydown listener that swallows mutation keys
//      (Delete/Backspace/Cmd+Z) while locked — mirrors ReadOnlyGate's pattern.
//   4. A locked-state banner. The lock/unlock action itself lives in the
//      Survey Hub document-row menus, not as viewer chrome.
//
// Why a separate component instead of folding into ReadOnlyGate:
//   ReadOnlyGate lives inside YDocProvider, gated by `accessRevoked` which is a
//   collaboration-permission concept (your access was revoked). Lock is a
//   document-state concept (the document is final). These can fire
//   independently — a revoked collaborator on an unlocked doc still sees the
//   ReadOnlyGate dim; an owner on a locked doc sees the lock banner. Keeping
//   them as siblings means each owns its own truth-source.
//
// Realtime: the component re-fetches lock state when the user explicitly
// toggles, and reads the latest state on mount. For KAL-49 v1 we deliberately
// do NOT subscribe to realtime updates of documents.locked_at — a future
// patch can add a Supabase Realtime channel to make the second-browser
// experience update without reload. v1 verification reloads after a lock.

import { useEffect, useState } from 'react';
import { fetchDocumentLockState } from '../services/documentLockService.js';

function formatLockedAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * @param {{
 *   documentId: string|null|undefined,
 *   documentOwnerId: string|null|undefined,
 *   viewerUserId: string|null|undefined,
 * }} props
 */
export default function DocumentLockBanner({
  documentId,
  viewerUserId,
}) {
  const [lockedAt, setLockedAt] = useState(null);
  const [lockedBy, setLockedBy] = useState(null);
  const [lockedLabel, setLockedLabel] = useState(null);
  const isLocked = lockedAt != null;

  // Initial fetch + refetch whenever the documentId changes.
  useEffect(() => {
    if (!documentId) {
      setLockedAt(null);
      setLockedBy(null);
      setLockedLabel(null);
      return;
    }
    let cancelled = false;
    fetchDocumentLockState(documentId).then((state) => {
      if (cancelled) return;
      setLockedAt(state.lockedAt);
      setLockedBy(state.lockedBy);
      setLockedLabel(state.lockedLabel);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // body[data-readonly] toggle while locked. ReadOnlyGate.css owns the visual
  // treatment — we just flip the same flag so the toolbar dims for free. We
  // do NOT unset it on unmount unless the lock is our reason (a sibling
  // ReadOnlyGate may also be setting it for an independent reason).
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!isLocked) return undefined;

    const prior = document.body?.getAttribute('data-readonly');
    document.body?.setAttribute('data-readonly', 'true');
    document.body?.setAttribute('data-kal49-locked', 'true');

    const onKeyDown = (e) => {
      // Cmd+S still passes through (saving local state on a locked doc is
      // benign — RLS will reject the write).
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const t = e.target;
        const tag = t?.tagName?.toLowerCase?.();
        const editable =
          tag === 'input' ||
          tag === 'textarea' ||
          t?.isContentEditable === true;
        if (editable) return;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      // Only clear data-readonly if we set it AND no other gate has claimed it
      // (signal via the kal49-locked attribute we added). ReadOnlyGate's own
      // effect manages its claim independently.
      document.body?.removeAttribute('data-kal49-locked');
      if (prior == null) {
        document.body?.removeAttribute('data-readonly');
      }
    };
  }, [isLocked]);

  // Don't render anything when there's no document.
  if (!documentId) return null;

  if (!isLocked) return null;

  // Locked: top banner visible to ALL roles.
  return (
    <div
      data-testid="kal49-lock-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: '#fff8c5',
        borderBottom: '1px solid #d4a72c',
        color: '#1f2328',
        padding: '8px 16px',
        fontSize: 13,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <strong>Document locked.</strong>{' '}
        Signed off {lockedAt ? `on ${formatLockedAt(lockedAt)}` : ''}
        {lockedBy ? ` by ${lockedBy === viewerUserId ? 'you' : lockedBy}` : ''}.
        {lockedLabel ? ` Label: "${lockedLabel}".` : ''}{' '}
        Edits are disabled.
      </div>
    </div>
  );
}
