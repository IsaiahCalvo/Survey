import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeCalloutPopoverPosition } from '../utils/calloutPopoverPosition.js';

/**
 * A small card that opens beside its opener with a tail pointing at it
 * (owner 2026-10-27, Spaces "Move or copy": "it should come off as a window
 * with a tooltip type of thing, with a leader or tail that points to that
 * button"). Placement: utils/calloutPopoverPosition.js. The card is portalled
 * to <body> so no rail or panel clips or covers it; it is hidden for the one
 * pass before it is measured, so it never flashes in the corner.
 *
 * Dismissal stays with the host (watchLightPopover), which finds the card
 * through the forwarded ref.
 */
const CalloutPopover = forwardRef(function CalloutPopover(
  { getAnchor, gap = 10, margin = 8, zIndex = 7000, className = '', children, ...rest },
  forwardedRef,
) {
  const cardRef = useRef(null);
  const [spot, setSpot] = useState(null);

  const setRefs = useCallback((node) => {
    cardRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const place = useCallback(() => {
    const card = cardRef.current;
    const anchor = getAnchor?.();
    if (!card || typeof window === 'undefined') return;
    if (!anchor || !anchor.isConnected || anchor.getClientRects().length === 0) {
      setSpot((current) => (current === null ? current : null));
      return;
    }
    const next = computeCalloutPopoverPosition({
      anchorRect: anchor.getBoundingClientRect(),
      cardWidth: card.offsetWidth,
      cardHeight: card.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gap,
      margin,
    });
    // A pixel of rounding either way is not a move (see AnchoredPopover).
    setSpot((current) => (
      current && current.side === next.side &&
      Math.abs(current.left - next.left) <= 1 &&
      Math.abs(current.top - next.top) <= 1 &&
      Math.abs(current.tail - next.tail) <= 1
        ? current
        : next
    ));
  }, [gap, getAnchor, margin]);

  useLayoutEffect(() => { place(); });

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && cardRef.current) {
      observer = new ResizeObserver(() => place());
      observer.observe(cardRef.current);
    }
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [place]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      {...rest}
      ref={setRefs}
      className={`callout-popover${className ? ` ${className}` : ''}`}
      data-callout-side={spot?.side || 'right'}
      style={{
        left: spot ? `${spot.left}px` : 0,
        top: spot ? `${spot.top}px` : 0,
        visibility: spot ? 'visible' : 'hidden',
        zIndex,
        '--callout-tail': spot ? `${spot.tail}px` : '50%',
      }}
    >
      {children}
    </div>,
    document.body,
  );
});

export default CalloutPopover;
