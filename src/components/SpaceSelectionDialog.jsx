// src/components/SpaceSelectionDialog.jsx
//
// The shell of the survey's "Select space" picker (Survey panel → Select →
// Copy). PDFViewer still owns the list and the copy logic; this file only
// owns the window around it.
//
// WHY A PORTAL: the picker used to render inside the viewer's own subtree,
// under an ancestor with its own stacking context (z-index 5000). Its
// zIndex 10000 only counted inside that box, so the left rail, the right
// Survey rail and the toolbars painted over it and its top was hidden.
// Portalling to document.body puts it on the app's top layer, like
// ApplyRedactionsModal and the hub dialogs.
//
// Same family as the other dialogs: the one modal scrim (--overlay-scrim +
// 8px blur), a --surface-2 card, the dialog z-index token, and the shared
// keyboard primitive (useFocusTrap: Escape closes, Tab stays inside, focus
// returns to the Copy button). Clicking the scrim closes it, as before.

import { useRef } from 'react';
import BodyPortal from './BodyPortal';
import Icon from '../Icons';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS, SHADOWS, Z_INDEX } from '../theme';

export default function SpaceSelectionDialog({ open, onClose, title = 'Select space', children }) {
  const cardRef = useRef(null);
  useFocusTrap(cardRef, open, { onEscape: onClose });

  if (!open || typeof document === 'undefined') return null;

  return (
    <BodyPortal>
      <div
        onClick={onClose}
        data-testid="space-selection-scrim"
        style={{
          position: 'fixed',
          inset: 0,
          background: COLORS.modal.overlay,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: Z_INDEX.modalOverlay,
          animation: 'fadeIn 0.2s ease-out',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-ui)',
        }}
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="space-selection-title"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: COLORS.modal.surface,
            border: `1px solid ${COLORS.modal.border}`,
            borderRadius: 'var(--radius-dialog)',
            padding: '24px',
            width: '500px',
            maxWidth: '90vw',
            maxHeight: '80vh',
            overflow: 'auto',
            boxSizing: 'border-box',
            boxShadow: SHADOWS.xl,
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
          }}>
            <h2
              id="space-selection-title"
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: COLORS.modal.textPrimary,
                fontFamily: 'var(--font-ui)',
              }}
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close"
              className="btn btn-icon btn-icon-sm"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-3)',
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </BodyPortal>
  );
}
