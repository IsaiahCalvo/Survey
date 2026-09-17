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
// Realtime: the component reads the latest state on mount and subscribes to
// documents-row UPDATE events, so a lock/unlock from another session changes
// local writeability without a reload.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createDocumentLockStateSequence,
  fetchDocumentLockState,
  subscribeDocumentLockState,
} from '../services/documentLockService.js';
import { claimBodyReadOnly } from '../utils/readOnlyBodyReasons.js';

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
 *   onLockStateChange?: (isLocked: boolean) => void,
 * }} props
 */
export default function DocumentLockBanner({
  documentId,
  viewerUserId,
  onLockStateChange,
  isActive = true,
}) {
  const [lockedAt, setLockedAt] = useState(null);
  const [lockedBy, setLockedBy] = useState(null);
  const [lockedLabel, setLockedLabel] = useState(null);
  const isLocked = lockedAt != null;
  const onLockStateChangeRef = useRef(onLockStateChange);
  const bodyClaimTokenRef = useRef(Symbol('document-lock-readonly'));
  onLockStateChangeRef.current = onLockStateChange;

  // Publish the render-time lock truth before passive effects toggle the body
  // attributes. The sibling PDFViewer uses this to cancel any visible erase
  // before a now-forbidden gesture can be committed.
  useLayoutEffect(() => {
    onLockStateChangeRef.current?.(isLocked);
  }, [isLocked]);

  const applyLockState = (state) => {
    setLockedAt(state?.lockedAt ?? null);
    setLockedBy(state?.lockedBy ?? null);
    setLockedLabel(state?.lockedLabel ?? null);
  };

  // Explicit E2E-only seam. It drives the same state/callback path as a
  // Realtime payload, but is absent from ordinary dev pages and production.
  useEffect(() => {
    if (
      !import.meta.env.DEV
      || typeof window === 'undefined'
      || new URLSearchParams(window.location.search).get('eraserLifecycleE2E') !== '1'
    ) return undefined;
    const setLockedForLifecycleTest = (locked) => {
      applyLockState({
        lockedAt: locked ? new Date().toISOString() : null,
        lockedBy: null,
        lockedLabel: null,
      });
    };
    window.__eraserLifecycleSetDocumentLocked = setLockedForLifecycleTest;
    return () => {
      if (window.__eraserLifecycleSetDocumentLocked === setLockedForLifecycleTest) {
        delete window.__eraserLifecycleSetDocumentLocked;
      }
    };
  }, []);

  // Initial fetch plus Realtime updates from remote lock/unlock RPCs.
  useEffect(() => {
    if (!documentId) {
      applyLockState(null);
      return;
    }
    let cancelled = false;
    const sequence = createDocumentLockStateSequence(applyLockState);
    const initialGeneration = sequence.snapshot();
    // Subscribe first, then issue an explicitly uncached read. The generation
    // guard prevents a slower read from overwriting any newer Realtime event.
    const unsubscribe = subscribeDocumentLockState(documentId, (state) => {
      if (!cancelled) sequence.applyRealtime(state);
    });
    fetchDocumentLockState(documentId).then((state) => {
      if (cancelled) return;
      sequence.applyInitial(initialGeneration, state);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [documentId]);

  // body[data-readonly] toggle while locked. ReadOnlyGate.css owns the visual
  // treatment — we just flip the same flag so the toolbar dims for free. We
  // do NOT unset it on unmount unless the lock is our reason (a sibling
  // ReadOnlyGate may also be setting it for an independent reason).
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!isLocked || !isActive) return undefined;

    const releaseBodyClaim = claimBodyReadOnly(bodyClaimTokenRef.current, document);
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
      document.body?.removeAttribute('data-kal49-locked');
      releaseBodyClaim();
    };
  }, [isActive, isLocked]);

  // Don't render anything when there's no document.
  if (!documentId || !isActive) return null;

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
        background: 'var(--accent-light)',
        borderBottom: '1px solid var(--accent)',
        color: 'var(--accent-text)',
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
