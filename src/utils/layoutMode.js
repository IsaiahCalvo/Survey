/**
 * Phone layout or desktop layout — the one decision (owner 2026-10-13).
 *
 * Owner: "A touchscreen laptop needs to get a laptop layout, not a phone
 * layout. Just like an iPad gets a laptop layout, not a phone layout."
 *
 * The layout follows the size of the SCREEN, never touch ability and never
 * the window width:
 *   - phone layout: the screen's short side is under 600 CSS px (every phone,
 *     upright or turned sideways — turning a phone keeps its short side);
 *   - desktop layout: everything else — iPad (also iPadOS posing as a Mac),
 *     Android tablets, touchscreen laptops, desktops, and the Electron app
 *     always.
 * Touch still works in the desktop layout (pinch, two-finger pan, one-finger
 * drawing — PdfjsViewerContainer turns its touch handling on for any touch
 * screen); only the layout is decided here.
 *
 * A desktop window dragged very narrow stays desktop: its screen is still a
 * desktop screen. Swapping layouts mid-resize would throw away the open panels
 * and jump every control (and the w42 ruling was "never switch to the phone
 * layout on a desktop window").
 *
 * The rule is written once as a media query so the stylesheets and the code
 * can never disagree: CSS uses PHONE_LAYOUT_MEDIA (and DESKTOP_LAYOUT_MEDIA
 * for its desktop-only rules) verbatim, and the code asks matchMedia the same
 * question. `device-width` / `device-height` are the screen's size in CSS px
 * (iOS keeps them upright; Android swaps them when turned), so asking for
 * either side under 600 is "the short side is under 600" on both.
 * tests/layoutMode.test.mjs keeps every stylesheet on these strings.
 */

/** The screen's short side must be under this (CSS px) for the phone layout. */
export const PHONE_SCREEN_SHORT_SIDE_LIMIT = 600;

/** The phone layout as a media query (screens only, never print). */
export const PHONE_LAYOUT_MEDIA = 'screen and (max-device-width: 599px), screen and (max-device-height: 599px)';

/** Its exact opposite, for stylesheet rules that are desktop-only. */
export const DESKTOP_LAYOUT_MEDIA = 'screen and (min-device-width: 600px) and (min-device-height: 600px)';

/** Pure rule: is a screen of this size a phone? */
export function isPhoneScreen(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return false;
  return Math.min(w, h) < PHONE_SCREEN_SHORT_SIDE_LIMIT;
}

/** The Electron desktop app (always the desktop layout). */
export function isElectronApp(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  if (win.electronAPI) return true;
  return /\bElectron\//.test(win.navigator?.userAgent || '');
}

/** Should this window show the phone layout? */
export function isPhoneLayout(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || isElectronApp(win)) return false;
  if (typeof win.matchMedia === 'function') {
    try {
      return win.matchMedia(PHONE_LAYOUT_MEDIA).matches;
    } catch {
      // fall through to the screen size
    }
  }
  return isPhoneScreen(win.screen?.width, win.screen?.height);
}

/**
 * Calls onChange(isPhone) whenever the answer may have changed (the screen
 * changes when a window moves to another monitor, or in a device emulator).
 * Returns the unsubscribe function.
 */
export function subscribePhoneLayout(onChange, win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || typeof win.matchMedia !== 'function' || isElectronApp(win)) return () => {};
  let mq;
  try { mq = win.matchMedia(PHONE_LAYOUT_MEDIA); } catch { return () => {}; }
  const listener = () => onChange(isPhoneLayout(win));
  if (mq.addEventListener) mq.addEventListener('change', listener);
  else if (mq.addListener) mq.addListener(listener);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', listener);
    else if (mq.removeListener) mq.removeListener(listener);
  };
}

/**
 * Touch input available (a touch screen of any kind, even beside a mouse).
 * This turns touch gestures ON; it never picks the layout.
 */
export function hasTouchInput(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  if (Number(win.navigator?.maxTouchPoints) > 0) return true;
  try {
    return Boolean(win.matchMedia?.('(any-pointer: coarse)')?.matches);
  } catch {
    return false;
  }
}
