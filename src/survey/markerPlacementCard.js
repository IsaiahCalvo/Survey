/**
 * markerPlacementCard.js — where the new-Survey-Marker card opens
 * (components/SurveyMarkerPlacementDialog): beside the marker just drawn -
 * to its right, else its left, else below it - kept inside the window, so
 * the card never covers the marker it asks about. With no marker on screen
 * it is centred.
 *
 * @param {{left, top, right, bottom}|null} rect  the marker's screen box
 * @param {{width?: number, height?: number}} card the card's measured size
 * @param {{width: number, height: number}} viewport
 */
export const MARKER_CARD_WIDTH = 280;
const GAP = 12;
const EDGE = 8;

export function placeSurveyMarkerCard(rect, card, viewport) {
  const width = card?.width || MARKER_CARD_WIDTH;
  const height = card?.height || 0;
  const clampTop = (top) => Math.max(EDGE, Math.min(top, viewport.height - height - EDGE));
  const clampLeft = (left) => Math.max(EDGE, Math.min(left, viewport.width - width - EDGE));
  if (!rect) {
    return { left: clampLeft((viewport.width - width) / 2), top: clampTop((viewport.height - height) / 2) };
  }
  if (rect.right + GAP + width <= viewport.width - EDGE) return { left: rect.right + GAP, top: clampTop(rect.top) };
  if (rect.left - GAP - width >= EDGE) return { left: rect.left - GAP - width, top: clampTop(rect.top) };
  return { left: clampLeft(rect.left), top: clampTop(rect.bottom + GAP) };
}
