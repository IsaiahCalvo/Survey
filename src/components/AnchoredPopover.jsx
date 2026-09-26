import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeAnchoredPopoverPosition } from '../utils/responsiveToolbar.js';

/**
 * Puts a light popover in the page's top layer, right under the control that
 * opened it (w42, owner report 2026-09-26).
 *
 * Intended UX: a popover opens UNDER its opener, centred on it, slides sideways
 * only as far as it must to stay wholly inside the window, flips above the
 * opener only when there is no room below, and is never covered by the left or
 * right rail or any panel. The desktop colour pickers used to be drawn inside
 * the tool bar, centred under the whole settings row: on a narrow window they
 * opened off to the right of the swatch and slid under the right rail, whose
 * layer sits above the tool bar's. Reference behaviour matched: the setting
 * dropdowns beside them (Radix popovers, portalled, with collision padding).
 *
 * How: a zero-size `fixed` point is portalled into document.body (z-index
 * 6500, the layer every setting dropdown uses) and placed at the bottom-centre
 * of the opener, moved sideways (or above) by exactly what the maths in
 * computeAnchoredPopoverPosition says. The ONE child is the popover card
 * itself, styled the way both desktop pickers always were: absolute,
 * `top: 100%`, `left: 50%`, `translate(-50%, 0)` and a `marginTop` of `gap`
 * — so it hangs centred under the point. The card keeps its own data-*
 * markers, refs and animation, so the dismiss rules still find it.
 * `getAnchor()` returns the opener each time the position is worked out, so a
 * swatch that re-renders keeps its popover.
 */
export default function AnchoredPopover({ getAnchor, gap = 10, margin = 8, zIndex = 6500, children }) {
  const pointRef = useRef(null);
  const [point, setPoint] = useState(null);

  const place = useCallback(() => {
    const node = pointRef.current;
    const card = node?.firstElementChild;
    const anchor = getAnchor?.();
    if (!node || !card || !anchor || typeof window === 'undefined') return;
    // w44 review: an opener with no box (its row was hidden) has nowhere to
    // open under — hide the card instead of flying it to the window corner.
    if (!anchor.isConnected || anchor.getClientRects().length === 0) {
      setPoint((current) => (current === null ? current : null));
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const next = computeAnchoredPopoverPosition({
      anchorRect,
      popoverWidth: width,
      popoverHeight: height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gap,
      margin,
    });
    // The card hangs `gap` below the point, centred on it.
    const x = Math.round(next.left + width / 2);
    const y = Math.round(next.top - gap);
    // A move of a pixel or less is ignored: sub-pixel rounding of the opener
    // can flip the answer between two neighbouring pixels on alternate
    // passes (seen live: 365 / 366 after a 1px window resize), and taking
    // every flip re-ran this effect until React gave up and the app crashed.
    setPoint((current) => (
      current && Math.abs(current.x - x) <= 1 && Math.abs(current.y - y) <= 1 ? current : { x, y }
    ));
  }, [gap, getAnchor, margin]);

  // Before the first paint, and after every render (the opener may have moved:
  // a new tool changes the settings row).
  useLayoutEffect(() => { place(); });

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    let observer = null;
    const card = pointRef.current?.firstElementChild;
    if (typeof ResizeObserver !== 'undefined' && card) {
      // The card grows when its tab changes or the lazy picker arrives.
      observer = new ResizeObserver(() => place());
      observer.observe(card);
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
      ref={pointRef}
      data-anchored-popover="true"
      style={{
        position: 'fixed',
        left: point ? `${point.x}px` : 0,
        top: point ? `${point.y}px` : 0,
        width: 0,
        height: 0,
        // Hidden for the one layout pass before it is measured, so it never
        // flashes in the corner.
        visibility: point ? 'visible' : 'hidden',
        zIndex,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
