/**
 * zoomToArea — Ctrl+Shift+drag (⌘+Shift on a Mac) draws a box and the view
 * zooms so the box fills it (Nightly flag 'zoom-to-area', Drawboard PDF Pro
 * trial audit 2026-11-09). Pure helpers; PdfjsViewerContainer runs them.
 */

/** Smallest box side, in screen pixels, that counts as an area (less = a slip). */
export const ZOOM_AREA_MIN_PX = 8;

const MARK_SELECTOR = '[data-annotation-index], [data-stack-index], [data-survey-marker-id], [data-callout-id], [data-selection-quick-bar], [data-annotation-context-menu]';

/** True for a mouse or pen press with Ctrl/⌘ and Shift held that starts on bare page or viewer. */
export function isZoomToAreaStart(event) {
  if (!event || event.button !== 0) return false;
  if (event.pointerType === 'touch') return false;
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false;
  // On a mark, Ctrl+drag keeps its own meaning (drag a copy).
  const target = event.target;
  if (target && typeof target.closest === 'function' && target.closest(MARK_SELECTOR)) return false;
  return true;
}

/** The box between two client points, as { left, top, width, height }. */
export function boxBetween(a, b) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * The zoom for a drawn box. `box` and `view` are in the scroller's own
 * client space (view = the part you can see: below tool strips, between side
 * panels). Returns null for a box too small to mean anything, otherwise
 * { scale, anchor: {x, y} (the box centre), shift: {dx, dy} (how far the
 * anchor must move to land in the middle of the view) }.
 */
export function zoomToAreaPlan({ box, view, scale }) {
  if (!box || !view || !(scale > 0)) return null;
  if (!(box.width >= ZOOM_AREA_MIN_PX) || !(box.height >= ZOOM_AREA_MIN_PX)) return null;
  if (!(view.width > 0) || !(view.height > 0)) return null;
  const factor = Math.min(view.width / box.width, view.height / box.height);
  const anchor = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  return {
    scale: scale * factor,
    anchor,
    shift: { dx: anchor.x - (view.left + view.width / 2), dy: anchor.y - (view.top + view.height / 2) },
  };
}
