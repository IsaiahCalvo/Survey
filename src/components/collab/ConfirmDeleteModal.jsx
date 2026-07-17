// src/components/collab/ConfirmDeleteModal.jsx
//
// Phase 35 Plan 04 — two-variant confirmation modal for bulk delete:
//
//   1. collaborator-all-mine — non-owner about to delete every annotation
//      they themselves drew on this page. Heading: "Delete all N of your
//      annotations on this page?". Simple count modal — no per-author
//      breakdown (the user only owns their own marks).
//
//   2. owner-cross-author — document owner about to delete annotations from
//      multiple people (their own marks PLUS at least one other user's).
//      Heading: "Delete annotations from multiple people?". Body shows a
//      summary count line PLUS a comma-joined inline byAuthor breakdown:
//      "Alice — 18, Bob — 12, Carol — 5".
//
// Modal copy is locked verbatim per CONTEXT.md "Confirmation modal —
// collaborator's 'delete all of mine'" + "Confirmation modal — owner's
// 'delete everyone's'" sections. Do NOT edit the headings, the body lines,
// or the per-author breakdown format without first updating CONTEXT.md.
//
// Closed state: pass plan = null. Open state: pass plan = BulkDeletePlan
// returned by buildBulkDeletePlan (Plan 35-02). Plans with mode === 'no-op'
// or mode === 'owner-own-only' should NEVER reach this component — App.jsx's
// onRequestBulkDelete callback short-circuits those upstream.

import { useEffect, useRef } from 'react';
import './ConfirmDeleteModal.css';

export function ConfirmDeleteModal({ plan, onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  // UX: default focus on Cancel per CONTEXT.md "Cancel (default focus) and a
  // red 'Delete all 12' primary". Destructive action requires intentional
  // mouse-or-Tab to reach — keyboard Enter on the modal accidentally cannot
  // delete. Focus runs once when the modal opens (plan transitions from null
  // to non-null).
  const previouslyFocusedRef = useRef(null);
  useEffect(() => {
    if (plan && cancelRef.current) {
      previouslyFocusedRef.current = document.activeElement;
      cancelRef.current.focus();
    } else if (!plan && previouslyFocusedRef.current) {
      // Accessibility: return focus to whatever triggered the modal once it closes.
      previouslyFocusedRef.current.focus?.();
      previouslyFocusedRef.current = null;
    }
  }, [plan]);

  // UX: Escape key closes the modal — matches the universal "Esc cancels"
  // affordance the user expects. Only attached when the modal is open so we
  // don't intercept Esc on every render.
  useEffect(() => {
    if (!plan) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel?.();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [plan, onCancel]);

  if (!plan) return null;
  if (plan.mode === 'no-op' || plan.mode === 'owner-own-only') return null;

  const isCollaboratorOwnOnly = plan.mode === 'collaborator-all-mine';

  // ---------------------------------------------------------------------
  // Locked copy — collaborator variant
  // ---------------------------------------------------------------------
  // Heading: "Delete all N of your annotations on this page?"
  // Body:    "This will remove all N of your annotations on this page.
  //           Other users' marks will stay."
  // Primary: "Delete all N"
  const collaboratorHeading = `Delete all ${plan.count} of your annotations on this page?`;
  const collaboratorBody = `This will remove all ${plan.count} of your annotations on this page. Other users' marks will stay.`;
  const collaboratorPrimaryLabel = `Delete all ${plan.count}`;

  // ---------------------------------------------------------------------
  // Locked copy — owner cross-author variant
  // ---------------------------------------------------------------------
  // Heading: "Delete annotations from multiple people?"
  // Body:    "Delete N annotations? K yours, M from P other people."
  // Primary: "Delete N"
  const ownerHeading = 'Delete annotations from multiple people?';
  const ownIdsCount = Array.isArray(plan.ownIds) ? plan.ownIds.length : 0;
  const foreignIdsCount = Array.isArray(plan.foreignIds) ? plan.foreignIds.length : 0;
  const otherPeopleCount = plan.byAuthor ? Object.keys(plan.byAuthor).length : 0;
  const ownerSummary = `Delete ${plan.count} annotations? ${ownIdsCount} yours, ${foreignIdsCount} from ${otherPeopleCount} other people.`;
  const ownerPrimaryLabel = `Delete ${plan.count}`;

  // UX (locked 2026-04-30): owner cross-author breakdown renders as a
  // comma-joined inline string matching CONTEXT.md's example
  // "Alice — 18, Bob — 12, Carol — 5". Em dash (U+2014), single paragraph
  // (NOT a stacked unordered list). Per checker W6 — comma-joined inline
  // string, single inline paragraph.
  const byAuthorInline =
    !isCollaboratorOwnOnly && plan.byAuthor && Object.keys(plan.byAuthor).length > 0
      ? Object.entries(plan.byAuthor)
          .map(([, info]) => `${info?.name ?? 'Unknown'} — ${info?.count ?? 0}`)
          .join(', ')
      : null;

  const heading = isCollaboratorOwnOnly ? collaboratorHeading : ownerHeading;
  const body = isCollaboratorOwnOnly ? collaboratorBody : ownerSummary;
  const primaryLabel = isCollaboratorOwnOnly ? collaboratorPrimaryLabel : ownerPrimaryLabel;

  // UX: stop background pointer events from bleeding through the backdrop —
  // clicking the backdrop (outside the card) cancels the modal as a
  // secondary affordance to the Cancel button. Event-target check ensures
  // clicks INSIDE the card don't accidentally cancel.
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onCancel?.();
    }
  };

  return (
    <div
      className="confirm-delete-modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-heading"
      onClick={handleBackdropClick}
    >
      <div className="confirm-delete-modal__card">
        <h2
          className="confirm-delete-modal__heading"
          id="confirm-delete-heading"
        >
          {heading}
        </h2>
        <p className="confirm-delete-modal__body">{body}</p>
        {byAuthorInline && (
          <p className="confirm-delete-modal__breakdown-inline">
            {byAuthorInline}
          </p>
        )}
        <div className="confirm-delete-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-delete-modal__btn confirm-delete-modal__btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-delete-modal__btn confirm-delete-modal__btn--danger"
            onClick={onConfirm}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDeleteModal;
