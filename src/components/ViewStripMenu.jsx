import { useEffect, useRef, useState } from 'react';
import RailFlyout from './RailFlyout.jsx';

/**
 * Nightly 'view-strip' (owner 2026-11-23: "the right rail ... is way too big
 * ... a lot of those things can be one button that slides out"). One View
 * button in the right rail; pressed, a row of the rail's view buttons (Paper,
 * Thin PDF lines, Page grid, Snapping, Dark pages, Hide marks, Show pins)
 * slides out beside it, each working exactly as it did in the rail.
 *
 * The row is a RailFlyout card that is itself a rail (data-chrome-rail): a
 * card one of its buttons opens stands off the row's left edge, never over
 * the row, as the rail's own cards stand off the rail.
 *
 * `renderButton({ open, ref, onClick })`.
 */
export default function ViewStripMenu({ renderButton, children }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const cardRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    // Capture, as the cards inside do; a click in one of their cards is
    // inside the row too (they render inside it), so it keeps the row open.
    const onPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || cardRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    // Bubble, not capture: an open card inside takes Escape first (its own
    // capture handler stops it), so Escape closes the card, then the row.
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
          role="toolbar"
          aria-label="View"
          aria-orientation="horizontal"
          data-chrome-rail="true"
          data-view-strip="true"
          className="rail-flyout--strip"
        >
          {children}
        </RailFlyout>
      )}
    </div>
  );
}
