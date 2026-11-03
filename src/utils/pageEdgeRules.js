/**
 * pageEdgeRules.js — what happens when a mark meets the page edge
 * (owner 2026-11-02: "copy Drawboard"; read live from pdf.drawboard.com).
 *
 * Drawboard PDF, checked live with a plain rectangle:
 *   - Grabbers (resize, rotate, the frame) always draw past the page edge and
 *     stay grabbable; they are never cut off. (SVGAnnotationLayer keeps them
 *     out of the page clip; styles.css lifts the picked page above its
 *     neighbours.)
 *   - Drawing a shape stops at the page edge: the drag-out end is held inside
 *     the page (clampPointToPage).
 *   - Resizing stops at the page edge: the dragged side cannot pass it
 *     (clampResizeEdge). A side that already sat past the edge is never
 *     pulled back in.
 *   - Turning is free; the part past the edge shows while the mark turns and
 *     is hidden by the page clip once it is let go.
 *
 * Survey keeps two of its own rules where Drawboard is worse:
 *   - Moving keeps the whole selection on the page (moveCommit.clampMoveDelta).
 *     Drawboard lets the centre reach the edge, which can hide half a mark.
 *   - Arrow-key nudges stay on the page (clampNudgeDelta). Drawboard lets a
 *     nudged mark leave the page entirely, where it can no longer be seen.
 *
 * Pure JS — the Node test runner imports this directly.
 */

const isPageSize = (w, h) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;

/** A page-unit point held inside the page. Bad input comes back unchanged. */
export function clampPointToPage(point, pageWidth, pageHeight) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
  if (!isPageSize(pageWidth, pageHeight)) return point;
  const x = Math.max(0, Math.min(pageWidth, point.x));
  const y = Math.max(0, Math.min(pageHeight, point.y));
  return x === point.x && y === point.y ? point : { ...point, x, y };
}

/**
 * Where a dragged side of an upright box may go on one axis.
 *   edge       the side's wanted position (page units)
 *   pageSize   the page's size on this axis
 *   startLow / startHigh  the box's own sides at drag start, so a box that
 *              already hung past the edge is never yanked back in
 *   centre     set when the box grows from its centre (Alt): the opposite
 *              side mirrors this one, so it must stay on the page too
 */
export function clampResizeEdge(edge, { pageSize, startLow, startHigh, centre = null } = {}) {
  if (!Number.isFinite(edge) || !(Number.isFinite(pageSize) && pageSize > 0)) return edge;
  let lo = Math.min(0, Number.isFinite(startLow) ? startLow : 0);
  let hi = Math.max(pageSize, Number.isFinite(startHigh) ? startHigh : pageSize);
  if (Number.isFinite(centre)) {
    // Opposite side = 2*centre - edge, also within [lo, hi].
    const mirroredLo = 2 * centre - hi;
    const mirroredHi = 2 * centre - lo;
    lo = Math.max(lo, mirroredLo);
    hi = Math.min(hi, mirroredHi);
    if (lo > hi) return centre;
  }
  return Math.max(lo, Math.min(hi, edge));
}
