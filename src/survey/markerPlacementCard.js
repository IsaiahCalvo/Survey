import { getMarkHitTolerancePx, MARK_HIT_TOLERANCE_FINE_PX } from '../utils/handleHitPad.js';

/**
 * markerPlacementCard.js — where the new-Survey-Marker card opens
 * (components/SurveyMarkerPlacementDialog): beside the marker just drawn -
 * to its right, else its left, else below it - kept inside the window, so
 * the card never covers the marker it asks about. With no marker on screen
 * it is centred. It also stays out of the bottom band where the toasts sit
 * (ToastHost.css): a toast that opens with the card (Smart fill's old "Find
 * more" one did) used to lie over its lowest rows.
 *
 * @param {{left, top, right, bottom}|null} rect  the marker's screen box
 * @param {{width?: number, height?: number}} card the card's measured size
 * @param {{width: number, height: number}} viewport
 * @param {{inputKind?: 'mouse'|'pen'|'touch'}} [options] the input that drew
 *   it: a pen or finger grabs a mark from further off its ink than a mouse
 *   (utils/handleHitPad.js), so the card keeps that much further away.
 */
export const MARKER_CARD_WIDTH = 280;
const GAP = 12;
const EDGE = 8;
// Toast stack: 24px off the bottom, one ~48px toast, plus a gap.
export const TOAST_BAND = 88;

export function placeSurveyMarkerCard(rect, card, viewport, { inputKind = 'mouse' } = {}) {
  const gap = GAP + getMarkHitTolerancePx(inputKind) - MARK_HIT_TOLERANCE_FINE_PX;
  const width = card?.width || MARKER_CARD_WIDTH;
  const height = card?.height || 0;
  const bottom = viewport.height - height - EDGE - TOAST_BAND >= EDGE ? TOAST_BAND : 0;
  const clampTop = (top) => Math.max(EDGE, Math.min(top, viewport.height - height - EDGE - bottom));
  const clampLeft = (left) => Math.max(EDGE, Math.min(left, viewport.width - width - EDGE));
  if (!rect) {
    return { left: clampLeft((viewport.width - width) / 2), top: clampTop((viewport.height - height) / 2) };
  }
  if (rect.right + gap + width <= viewport.width - EDGE) return { left: rect.right + gap, top: clampTop(rect.top) };
  if (rect.left - gap - width >= EDGE) return { left: rect.left - gap - width, top: clampTop(rect.top) };
  return { left: clampLeft(rect.left), top: clampTop(rect.bottom + gap) };
}
