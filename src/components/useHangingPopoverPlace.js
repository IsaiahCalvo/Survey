import { useLayoutEffect, useState } from 'react';

const EDGE = 8;
const GAP = 6;

/**
 * Work out where a card that hangs off a bar fits (KAL-793, owner
 * 2026-11-17: the Line menu of a picked mark near the top of the page opened
 * up over the tool bars, out of sight). Pure, so it can be tested.
 *
 * `preferred` is the side the bar asks for ('above' | 'below'). The card
 * keeps it when it fits, flips to the other side when only that one fits,
 * and otherwise takes the roomier side and scrolls (maxHeight). It also
 * slides sideways (dx) to stay inside `bounds`.
 */
export function placeHangingPopover({ barRect, width, height, preferred = 'below', bounds, align = 'centre', edge = EDGE, gap = GAP }) {
  const roomAbove = barRect.top - gap - (bounds.top + edge);
  const roomBelow = (bounds.bottom - edge) - (barRect.bottom + gap);
  const other = preferred === 'above' ? 'below' : 'above';
  const roomOf = (side) => (side === 'above' ? roomAbove : roomBelow);
  let side = preferred;
  if (height > roomOf(preferred)) {
    if (height <= roomOf(other) || roomOf(other) > roomOf(preferred)) side = other;
  }
  const room = Math.max(0, Math.floor(roomOf(side)));
  const maxHeight = height > room ? Math.max(Math.min(120, height), room) : null;
  const left = align === 'start' ? barRect.left : barRect.left + barRect.width / 2 - width / 2;
  const minLeft = bounds.left + edge;
  const maxLeft = Math.max(minLeft, bounds.right - edge - width);
  const dx = Math.round(Math.max(minLeft, Math.min(maxLeft, left)) - left);
  return { side, dx, maxHeight };
}

/**
 * Hook form for a card drawn inside its bar (absolute, centred with
 * `left: 50%; translate: -50% 0`). Returns { side, style } to spread on the
 * card (`align: 'start'` for a card pinned to the bar's left edge).
 * `getBounds` gives the area it must stay in (default: the window).
 */
export function useHangingPopoverPlace(ref, { open, preferred = 'below', getBounds, align = 'centre', deps = [] }) {
  const [place, setPlace] = useState({ side: preferred, dx: 0, maxHeight: null });
  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const fit = () => {
      const card = ref.current;
      const bar = card?.parentElement;
      if (!card || !bar) return;
      // Measure at full height: the cap from the last pass would hide how tall it is.
      const lastMax = card.style.maxHeight;
      card.style.maxHeight = 'none';
      const height = card.scrollHeight;
      card.style.maxHeight = lastMax;
      const bounds = getBounds?.() || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const next = placeHangingPopover({
        barRect: bar.getBoundingClientRect(),
        width: card.offsetWidth,
        height,
        preferred,
        align,
        bounds: {
          left: Math.max(0, bounds.left),
          top: Math.max(0, bounds.top),
          right: Math.min(window.innerWidth, bounds.right),
          bottom: Math.min(window.innerHeight, bounds.bottom),
        },
      });
      setPlace((current) => (current.side === next.side && current.dx === next.dx && current.maxHeight === next.maxHeight
        ? current
        : next));
    };
    fit();
    // The bar follows the mark on scroll and zoom without a render.
    let frame = 0;
    const later = () => { if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; fit(); }); };
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);
    return () => {
      window.removeEventListener('resize', later);
      window.removeEventListener('scroll', later, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preferred, ...deps]);
  const style = open ? {
    ...(place.dx ? { translate: align === 'start' ? `${place.dx}px 0` : `calc(-50% + ${place.dx}px) 0` } : null),
    ...(place.maxHeight ? { maxHeight: `${place.maxHeight}px`, overflowY: 'auto' } : null),
  } : undefined;
  return { side: open ? place.side : preferred, style };
}
