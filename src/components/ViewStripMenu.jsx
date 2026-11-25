import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './RailFlyout.css';
import './ViewStripMenu.css';

/**
 * Nightly 'view-strip'. Owner 2026-11-24: the Page fit list stood almost as
 * tall as the rail; he wanted one card that holds the fits, the page views
 * and the view buttons (Paper, Thin PDF lines, Page grid ...).
 *
 * Owner 2026-11-25 (asked more than once): not a pop-up. It is a drawer that
 * slides out from behind the rail's left edge and back in, as tall as the
 * rail's lower block: its top level with the line over Zoom in, its foot on
 * the viewer's foot. The rows spread evenly down that height.
 *
 * The drawer is itself a rail (data-chrome-rail): a card one of its buttons
 * opens stands off the drawer's left edge, never over it, as the rail's own
 * cards stand off the rail.
 *
 * `renderButton({ open, ref, onClick })`; children are the drawer's body.
 */
export default function ViewStripMenu({ renderButton, children }) {
  // 'closed' | 'open' | 'closing' (still drawn while it slides back in).
  const [phase, setPhase] = useState('closed');
  const open = phase === 'open';
  const buttonRef = useRef(null);
  const cardRef = useRef(null);

  const close = () => setPhase((p) => {
    if (p !== 'open') return p;
    // With "Reduce motion" there is no slide, so no animationend to wait for.
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return still ? 'closed' : 'closing';
  });

  useEffect(() => {
    if (!open) return undefined;
    // Capture, as the cards inside do; a click in one of their cards is
    // inside this drawer too (they render inside it), so it stays open.
    const onPointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || cardRef.current?.contains(event.target)) return;
      close();
    };
    // Bubble, not capture: an open card inside takes Escape first (its own
    // capture handler stops it), so Escape closes that card, then this one.
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Fit the drawer to the rail's lower block: flush with the rail's left
  // edge, top on the block's top line, foot on its foot. Taller content (the
  // Columns row of a Grid) grows it upward instead of spilling.
  useLayoutEffect(() => {
    if (phase === 'closed') return undefined;
    const card = cardRef.current;
    const host = card?.offsetParent;
    if (!card || !host) return undefined;
    const rail = host.closest('[data-chrome-rail="true"]') || host;
    const place = () => {
      const hostRect = host.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      card.style.right = `${Math.round(hostRect.right - railRect.left)}px`;
      card.style.bottom = `${Math.round(hostRect.bottom - railRect.bottom)}px`;
      card.style.minHeight = `${Math.round(railRect.height)}px`;
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(rail);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [phase]);

  return (
    <div className="page-grid-menu">
      {renderButton({
        open,
        ref: buttonRef,
        onClick: () => (open ? close() : setPhase('open')),
      })}
      {phase !== 'closed' && (
        <div
          ref={cardRef}
          role="dialog"
          aria-label="View"
          data-chrome-rail="true"
          data-view-card="true"
          data-phase={phase}
          className="view-drawer"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && phase === 'closing') setPhase('closed');
          }}
        >
          <div className="view-drawer__head">
            <span className="view-drawer__title">View</span>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}
