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

import { createPortal } from 'react-dom';
import './UndoToast.css';

export function UndoToast({ toast, onDismiss }) {
  if (!toast) return null;

  // UX: Undo button is the single action — 5/6s timer auto-dismisses on
  // its own; users do not need a separate "Dismiss" affordance per
  // CONTEXT.md (kept minimal).
  const handleUndoClick = () => {
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
    <div className="undo-toast" role="alert" aria-live="polite">
      <span className="undo-toast__message">{toast.message}</span>
      <button
        type="button"
        className="undo-toast__action"
        onClick={handleUndoClick}
      >
        Undo
      </button>
    </div>
  );
  return typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node;
}

