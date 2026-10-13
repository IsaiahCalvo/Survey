/**
 * touchContact.js — palm rejection by contact size (Drawboard audit C1).
 *
 * A resting palm or the side of a hand touches the glass with a much bigger
 * patch than a fingertip or a pencil. Drawboard PDF refuses any press wider
 * than 120 CSS px as a tool press (bundle `bIt`: `width/height > 120`), so a
 * hand resting on the page never inks. We use the same 120 px limit.
 *
 * The limit is on the contact's DIAMETER in both event families, so the touch
 * handlers (PdfjsViewerContainer) and the pointer handlers (SVG layer) always
 * agree about the same contact:
 *   - PointerEvent.width / height are already diameters.
 *   - Touch.radiusX / radiusY are radii (WebKit also has webkitRadiusX/Y),
 *     so they are doubled.
 * A real fingertip is about 15-50 px across; 120 px is about 3 cm on a phone.
 *
 * Only touch contacts are judged. A mouse or a pen is never a palm, and a
 * stylus Touch (iOS `touchType === 'stylus'`) is never one either.
 */

export const PALM_CONTACT_MIN_PX = 120;

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Contact diameter (CSS px) of a PointerEvent or Touch; 0 when unknown. */
export function contactSizePx(contact) {
  if (!contact) return 0;
  const width = num(contact.width);
  const height = num(contact.height);
  if (width || height) return Math.max(width, height);
  const radius = Math.max(
    num(contact.radiusX), num(contact.radiusY),
    num(contact.webkitRadiusX), num(contact.webkitRadiusY),
  );
  return radius * 2;
}

/**
 * Is this PointerEvent or Touch a palm (contact wider than the limit)?
 * Pointer events from a mouse or pen, and stylus touches, never are.
 */
export function isPalmContact(contact, limitPx = PALM_CONTACT_MIN_PX) {
  if (!contact) return false;
  const pointerType = contact.pointerType;
  if (pointerType && pointerType !== 'touch') return false;
  if (contact.touchType === 'stylus') return false;
  return contactSizePx(contact) > limitPx;
}

/**
 * The touches in a TouchList (or array) that are not palms, as an array.
 * The viewer counts only these when it decides between a one-finger tool
 * gesture and a two-finger pinch, so a palm landing beside a pen stroke is
 * not taken for a second finger.
 */
export function withoutPalmTouches(touches, limitPx = PALM_CONTACT_MIN_PX) {
  const out = [];
  if (!touches) return out;
  const n = Number(touches.length) || 0;
  for (let i = 0; i < n; i += 1) {
    const t = typeof touches.item === 'function' ? touches.item(i) : touches[i];
    if (t && !isPalmContact(t, limitPx)) out.push(t);
  }
  return out;
}
