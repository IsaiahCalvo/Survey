/**
 * dragThreshold.js — when a press with a shape tool becomes a drag
 * (Drawboard audit C4).
 *
 * Drawboard PDF creates a shape only once the pointer has moved MORE than
 * 6 px from the press, measured as the larger of |dx| and |dy| (bundle
 * `minDelta: 6`, Chebyshev distance). A shorter press is a click: it picks
 * the mark under it, or does nothing. Before this, a jittery click in Survey
 * left a 4 x 4 px rectangle behind.
 *
 * A fingertip wobbles more than a mouse or a pen tip, so touch gets 10 px
 * (the audit's recommended 8-10 px touch slop).
 *
 * Distances are SCREEN (client) pixels, so the feel is the same at every zoom.
 *
 * Freehand ink (pen, highlighter) has no threshold: Drawboard's ink uses
 * `minDelta 0, minDeltaTime 0`, so it starts inking on the press. Callers
 * simply do not ask this module about ink.
 */

export const SHAPE_DRAG_THRESHOLD_PX = Object.freeze({ mouse: 6, pen: 6, touch: 10 });

/** The shape-drag threshold for a pointer type (unknown types use mouse). */
export function shapeDragThresholdPx(pointerType) {
  return pointerType === 'touch' ? SHAPE_DRAG_THRESHOLD_PX.touch
    : pointerType === 'pen' ? SHAPE_DRAG_THRESHOLD_PX.pen
      : SHAPE_DRAG_THRESHOLD_PX.mouse;
}

/** Larger of |dx| and |dy| between two client points. */
export function chebyshevDistance(a, b) {
  if (!a || !b) return 0;
  return Math.max(Math.abs((b.x || 0) - (a.x || 0)), Math.abs((b.y || 0) - (a.y || 0)));
}

/**
 * Has a press that started at `start` and is now at `point` (client px)
 * travelled far enough to be a shape drag?
 */
export function hasPassedShapeDragThreshold(start, point, pointerType) {
  if (!start || !point) return false;
  return chebyshevDistance(start, point) > shapeDragThresholdPx(pointerType);
}
