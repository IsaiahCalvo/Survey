// src/components/collab/UndoToast.jsx
//
// Phase 35 Plan 04 — bottom-anchored undo toast. Sits BELOW any active
// sync-status banner per CONTEXT.md "must sit below any active sync-status
// banner".
//
// UX contract (locked per CONTEXT.md "Single-annotation delete (regular case,
// all roles)" + "After confirm: 6-second undo toast"):
//   - Renders nothing when toast is null.
//   - Single message line + single Undo button.
//   - Auto-dismiss timing lives in useUndoToast (5s single / 6s bulk) — this
//     component is purely presentational.
//   - role="alert" + aria-live="polite" so screen readers announce without
//     hijacking focus from the user's current cursor position.
//   - Clicking Undo invokes toast.onUndo() exactly once and then calls
//     onDismiss to clear the toast (matches Plan 35-01 test #3 — onUndo
//     fires exactly once and the toast clears).
//
// Motion (Drawboard shell audit, Chunk A, 2026-10-13): it slides up 8px and
// fades in on the shared toast token (150 ms) and, when the queue clears it
// (timer, Undo, or a dismiss), plays the shared exit (120 ms) before it leaves
// the page. During the exit it shows the last message, takes no clicks and is
// hidden from assistive tech; a new toast replaces it at once. Under reduced
// motion there is no exit, it goes at once. While it is up, <html> carries
// data-undo-toast-open so the app-toast stack (ToastHost) stands above it on
// desktop instead of overlapping it.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { exitMs } from '../../utils/motion.js';
import './UndoToast.css';

// More than one UndoToast can be mounted (viewer + Home); count the visible
// ones so the <html> flag clears only when the last one goes.
let openCount = 0;
function markOpen(delta) {
  if (typeof document === 'undefined') return;
  openCount = Math.max(0, openCount + delta);
  if (openCount > 0) document.documentElement.setAttribute('data-undo-toast-open', '');
  else document.documentElement.removeAttribute('data-undo-toast-open');
}

export function UndoToast({ toast, onDismiss }) {
  // `shown` is what is on screen: the live toast, or the last one while it
  // plays its exit.
  const [shown, setShown] = useState(toast);
  const [leaving, setLeaving] = useState(false);
  const exitTimerRef = useRef(null);

  // Derived state: follow the queue in the same render (no extra frame where
  // the old toast is gone and the exit has not started).
  if (toast && (toast !== shown || leaving)) {
    setShown(toast);
    setLeaving(false);
  } else if (!toast && shown && !leaving) {
    if (exitMs('toast') > 0) setLeaving(true);
    else setShown(null);
  }

  useEffect(() => {
    if (!leaving) return undefined;
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setShown(null);
      setLeaving(false);
    }, exitMs('toast'));
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    };
  }, [leaving]);

  const visible = Boolean(shown);
  useEffect(() => {
    if (!visible) return undefined;
    markOpen(1);
    return () => markOpen(-1);
  }, [visible]);

  if (!shown) return null;

  // UX: Undo button is the single action — 5/6s timer auto-dismisses on
  // its own; users do not need a separate "Dismiss" affordance per
  // CONTEXT.md (kept minimal).
  const handleUndoClick = () => {
    if (leaving || !toast) return;
    if (typeof toast.onUndo === 'function') {
      toast.onUndo();
    }
    if (typeof onDismiss === 'function') {
      onDismiss();
    }
  };

  // KAL-461 (owner 2026-09-30: "toasts must never be hidden"): portalled to
  // <body>. Rendered in place it sat inside the viewer's own layer (a z 5000
  // stacking context), so its z-index could never lift it over a phone bottom
  // sheet: a delete made in an open sheet showed its Undo behind the sheet.
  const node = (
    <div
      className={`undo-toast${leaving ? ' undo-toast--leaving' : ''}`}
      role="alert"
      aria-live="polite"
      aria-hidden={leaving ? 'true' : undefined}
      data-state={leaving ? 'closing' : 'open'}
    >
      <span className="undo-toast__message">{shown.message}</span>
      <button
        type="button"
        className="undo-toast__action"
        onClick={handleUndoClick}
        disabled={leaving}
      >
        Undo
      </button>
    </div>
  );
  return typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node;
}
