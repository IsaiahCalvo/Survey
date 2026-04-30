// src/components/collab/CleanupResidueReviewPanel.jsx
// Phase 35 Plan 05 — cleanup-banner Review surface.
//
// UX: surfaced when the document owner clicks 'Review' on the
// sync_residue_cleanup banner. Shows the count + first 5 annotation IDs from
// the audit so the owner can confirm what's being cleaned up before
// committing. 'Clean up all N' dispatches the same handler the banner's
// primary action uses (deleteAnnotations on the audited residueIds in
// YDocProvider).
//
// CONTEXT.md says "side-panel list" but Claude's Discretion clause permits
// simpler — checker W5 just requires that an actual Review surface ships, not
// paper-over with copy. A small modal-adjacent card with the count + sample
// IDs satisfies that requirement and matches the existing collab surface
// chrome (ConfirmDeleteModal, ExcelLockedModal). The typical residue count
// is small per the audit, so first 5 IDs is a representative sample.
//
// Sources:
//   - .planning/phases/35-per-user-delete-authority-confirm-before-wipe/35-CONTEXT.md
//     "Two actions: 'Review' (open a side-panel list)" decision + AC #9
//   - .planning/phases/35-per-user-delete-authority-confirm-before-wipe/35-05-PLAN.md
//     Task 3 — minimal Review surface, count + first 5 IDs + Clean up + Close

import React from 'react';
import './CleanupResidueReviewPanel.css';

/**
 * Phase 35 cleanup-banner Review surface. Shows the count + first 5 annotation
 * IDs from the audit so the owner can decide whether to clean up. 'Clean up
 * all' dispatches the same handler the banner's primary action uses.
 *
 * UX: small inline panel (modal-adjacent), NOT a full side panel. CONTEXT.md
 * says "side-panel list" but the discretion clause permits simpler — owner
 * just needs visible confirmation of what's being cleaned. First 5 IDs is
 * a representative sample (the typical residue count is small per the audit).
 *
 * @param {object} props
 * @param {boolean} props.isOpen - controls mount; when false, renders null.
 * @param {string[]} props.residueIds - full list of annotation IDs flagged
 *   by the audit. Panel renders count + first 5 IDs + "...and N more" tail.
 * @param {() => void} props.onClose - dismisses the panel without acting.
 * @param {() => void} props.onCleanupAll - dispatches deleteAnnotations on
 *   the full residueIds list (same handler the banner's Clean up button
 *   uses; YDocProvider owns the wiring).
 */
export function CleanupResidueReviewPanel({ isOpen, residueIds, onClose, onCleanupAll }) {
  if (!isOpen) return null;
  const ids = Array.isArray(residueIds) ? residueIds : [];
  const sample = ids.slice(0, 5);
  const remainder = Math.max(0, ids.length - sample.length);

  return (
    <div
      className="cleanup-residue-review__backdrop"
      // role="dialog" + aria-modal="true" — same accessibility shape as
      // ConfirmDeleteModal so screen readers treat the panel as a focused
      // dialog instead of a passive announcement.
      role="dialog"
      aria-modal="true"
      aria-labelledby="cleanup-residue-review-heading"
    >
      <div className="cleanup-residue-review__card">
        <h3
          className="cleanup-residue-review__heading"
          id="cleanup-residue-review-heading"
        >
          {ids.length} annotation{ids.length === 1 ? '' : 's'} to clean up
        </h3>
        <p className="cleanup-residue-review__body">
          These annotations were left in the cloud after an earlier sync issue. They&apos;re attributed to you and can be safely removed.
        </p>
        <ul className="cleanup-residue-review__sample-list">
          {sample.map((id) => (
            <li key={id} className="cleanup-residue-review__sample-row">
              <code>{id}</code>
            </li>
          ))}
          {remainder > 0 && (
            <li className="cleanup-residue-review__sample-row cleanup-residue-review__sample-row--more">
              …and {remainder} more
            </li>
          )}
        </ul>
        <div className="cleanup-residue-review__actions">
          {/* UX: Close on the left (secondary), Clean up all on the right
              (primary destructive). Same right-aligned destructive
              convention as ConfirmDeleteModal. */}
          <button
            type="button"
            className="cleanup-residue-review__action cleanup-residue-review__action--secondary"
            onClick={onClose}
            aria-label="Close review panel"
          >
            Close
          </button>
          <button
            type="button"
            className="cleanup-residue-review__action cleanup-residue-review__action--primary"
            onClick={onCleanupAll}
            aria-label={`Clean up all ${ids.length} annotations`}
          >
            Clean up all {ids.length}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CleanupResidueReviewPanel;
