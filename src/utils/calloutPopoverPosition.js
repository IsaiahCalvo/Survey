// Where a CalloutPopover card goes (owner 2026-10-27: "a window ... with a
// leader or tail that points to that button", not a drop-down).
//
// The card opens BESIDE its opener: to the right when it fits, else to the
// left, else under it. Beside, it centres on the opener's middle and slides up
// or down only as far as it must to stay inside the window; the tail stays on
// the opener's middle (kept off the card's rounded corners). Under, the same
// sideways.

const TAIL_INSET = 14;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function computeCalloutPopoverPosition({
  anchorRect,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
  gap = 10,
  margin = 8,
}) {
  const midX = anchorRect.left + anchorRect.width / 2;
  const midY = anchorRect.top + anchorRect.height / 2;
  const fitsRight = anchorRect.right + gap + cardWidth + margin <= viewportWidth;
  const fitsLeft = anchorRect.left - gap - cardWidth - margin >= 0;

  if (fitsRight || fitsLeft) {
    const side = fitsRight ? 'right' : 'left';
    const left = side === 'right' ? anchorRect.right + gap : anchorRect.left - gap - cardWidth;
    const top = clamp(midY - cardHeight / 2, margin, Math.max(margin, viewportHeight - margin - cardHeight));
    const tail = clamp(midY - top, TAIL_INSET, Math.max(TAIL_INSET, cardHeight - TAIL_INSET));
    return { side, left: Math.round(left), top: Math.round(top), tail: Math.round(tail) };
  }

  const below = anchorRect.bottom + gap + cardHeight + margin <= viewportHeight;
  const side = below ? 'bottom' : 'top';
  const left = clamp(midX - cardWidth / 2, margin, Math.max(margin, viewportWidth - margin - cardWidth));
  const top = below ? anchorRect.bottom + gap : Math.max(margin, anchorRect.top - gap - cardHeight);
  const tail = clamp(midX - left, TAIL_INSET, Math.max(TAIL_INSET, cardWidth - TAIL_INSET));
  return { side, left: Math.round(left), top: Math.round(top), tail: Math.round(tail) };
}
