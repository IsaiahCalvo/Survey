// src/components/collab/ConfirmDeleteModal.jsx
//
// Confirmation modal for deleting a whole counter series ("Delete Count 1?").
//
// RULED 2026-09-28 owner: open editing + lock. The Phase 35 cross-author
// variants ("Delete all N of your annotations on this page?" and "Delete
// annotations from multiple people?") are gone: deleting anyone's marks never
// asks. The only confirmation left is this one — removing EVERY pin of a
// count across the document in one go (the counter series menu's "Delete
// count"), which is a different action from deleting marks.
//
// Closed state: pass plan = null. Open state: pass the counter-series plan
// built by PDFViewer's handleDeleteCounterSeries (mode === 'counter-series').
// Any other plan renders nothing.

import { useRef } from 'react';
import Icon from '../../Icons.jsx';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import './ConfirmDeleteModal.css';

export function ConfirmDeleteModal({ plan, onConfirm, onCancel }) {
  const cardRef = useRef(null);

  // Match the app's shared modal contract: trap Tab, Escape cancels, restore
  // focus to the opener, and keep Cancel as the safe default focus target.
  useFocusTrap(cardRef, Boolean(plan), { onEscape: onCancel });

  if (!plan) return null;
  if (plan.mode !== 'counter-series') return null;

  const heading = `Delete ${plan.seriesLabel || 'this count'}?`;
  const body = `This will delete all ${plan.count} pins in this count across the document. This can be undone.`;
  const primaryLabel = 'Delete count';

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
      onClick={handleBackdropClick}
    >
      <div
        ref={cardRef}
        className="confirm-delete-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-delete-modal__content">
          <div className="confirm-delete-modal__copy">
            <h2
              className="confirm-delete-modal__heading"
              id="confirm-delete-heading"
            >
              {heading}
            </h2>
            <p className="confirm-delete-modal__body">{body}</p>
          </div>
          <button
            type="button"
            className="confirm-delete-modal__close"
            title="Close"
            aria-label="Close"
            onClick={onCancel}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="confirm-delete-modal__actions">
          <button
            data-autofocus
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

