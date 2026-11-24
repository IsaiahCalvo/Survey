import { useEffect, useRef, useState } from 'react';
import RailFlyout from './RailFlyout.jsx';

/**
 * Nightly 'view-strip'. Owner 2026-11-24: the Page fit list stood almost as
 * tall as the rail from Full screen up to the zoom buttons; he wanted one
 * small card that slides out and holds all of it, the view options (Paper,
 * Thin PDF lines, Page grid ...) included. So the rail's Page fit button opens
 * this card: Fit, Pages and Scroll as short rows of choices, then the view
 * buttons in one row, each opening its own card as it did in the rail.
 *
 * The card is itself a rail (data-chrome-rail): a card one of its buttons
 * opens stands off the card's left edge, never over it, as the rail's own
 * cards stand off the rail.
 *
 * `renderButton({ open, ref, onClick })`; children are the card's body.
 */
export default function ViewStripMenu({ renderButton, children }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const cardRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    // Capture, as the cards inside do; a click in one of their cards is
    // inside this card too (they render inside it), so it stays open.
    const onPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || cardRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    // Bubble, not capture: an open card inside takes Escape first (its own
    // capture handler stops it), so Escape closes that card, then this one.
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  return (
    <div className="page-grid-menu">
      {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v) })}
      {open && (
        <RailFlyout
          cardRef={cardRef}
          title="View"
          role="dialog"
          aria-label="View"
          data-chrome-rail="true"
          data-view-card="true"
          className="rail-flyout--view"
        >
          {children}
        </RailFlyout>
      )}
    </div>
  );
}
