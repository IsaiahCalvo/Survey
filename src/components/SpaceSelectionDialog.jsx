// src/components/SpaceSelectionDialog.jsx
//
// The shell of the survey's "Copy to a module" picker (Survey panel → Select →
// Copy). PDFViewer still owns the list and the copy logic; this file only
// owns the window around it.
//
// WHY A PORTAL: the picker used to render inside the viewer's own subtree,
// under an ancestor with its own stacking context (z-index 5000), so the
// rails and toolbars painted over it. Portalled to document.body it sits on
// the app's top layer.
//
// The window is DialogCard, the app's one dialog look (owner 2026-10-26: every
// dialog follows the same design): scrim, card, title, close X, focus trap
// (Escape closes, Tab stays inside, focus returns to the Copy button). The
// module list is the body; picking a module copies, so there is no footer.

import BodyPortal from './BodyPortal';
import DialogCard from './DialogCard.jsx';
import { Z_INDEX } from '../theme';

export default function SpaceSelectionDialog({ open, onClose, title = 'Select space', children }) {
  if (!open || typeof document === 'undefined') return null;

  return (
    <BodyPortal>
      <DialogCard
        title={title}
        message="Pick the module to copy them into."
        onClose={onClose}
        width={500}
        zIndex={Z_INDEX.modalOverlay}
        cardProps={{ 'data-testid': 'space-selection-dialog' }}
      >
        {children}
      </DialogCard>
    </BodyPortal>
  );
}
