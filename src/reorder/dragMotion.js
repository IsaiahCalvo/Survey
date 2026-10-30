/**
 * dragMotion.js — the one glide every drag-to-reorder surface moves on.
 *
 * Owner 2026-10-30: "make all drag-and-drop consistent across animations …
 * make it feel professional, feel clean." The PDF tabs and the template
 * module tabs were the feel he liked; the other lists each ran their own
 * clock (Spaces had no glide at all, so rows jumped a whole row in one frame;
 * bookmarks and pages ran 180ms on two different curves).
 *
 * One rule now, horizontal and vertical alike: while an item is held, the
 * items it passes slide apart to open the gap it will land in (no dashed
 * outline, no faded copy left behind), and on release it settles into that
 * gap on the same glide. The duration is the --motion-drag token
 * (tokens.css, mirrored in MOTION_MS); the curve is --ease-out.
 */
import { MOTION_MS, prefersReducedMotion } from '../utils/motion.js';

export const DRAG_GLIDE_MS = MOTION_MS.drag;
export const DRAG_GLIDE_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';
// dnd-kit's useSortable `transition` option.
export const DRAG_GLIDE = Object.freeze({ duration: DRAG_GLIDE_MS, easing: DRAG_GLIDE_EASING });
// The same glide as a CSS transition value, for motion a surface draws itself.
export const DRAG_GLIDE_CSS = `${DRAG_GLIDE_MS}ms ${DRAG_GLIDE_EASING}`;

/** The glide, or null (no transition at all) under reduced motion. */
export function dragGlide(win) {
  return prefersReducedMotion(win) ? null : DRAG_GLIDE;
}

/**
 * The drop. Items held in place (no DragOverlay) are let go wherever the
 * pointer left them, a few px to a whole row off their gap, and dnd-kit put
 * them in it in ONE frame (frame captures 2026-10-30: 17-48px snaps in
 * Spaces). Call with the item's rect as it was drawn at release, after the
 * reorder has committed: it is drawn back there and glides into its gap.
 * Uses the `translate` property, so it adds to dnd-kit's own inline
 * `transform` instead of fighting it.
 */
export function settleDroppedItem(node, fromRect, win = typeof window !== 'undefined' ? window : undefined) {
  if (!node || !fromRect || typeof node.animate !== 'function') return null;
  if (prefersReducedMotion(win)) return null;
  const toRect = node.getBoundingClientRect();
  const dx = fromRect.left - toRect.left;
  const dy = fromRect.top - toRect.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return node.animate(
    [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }],
    { duration: DRAG_GLIDE_MS, easing: DRAG_GLIDE_EASING },
  );
}
