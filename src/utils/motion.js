// src/utils/motion.js
//
// The JS side of the motion tokens (src/styles/tokens.css, MOTION block).
// Drawboard shell audit, Chunk A (2026-10-13): menus 100 ms, dialogs 150 ms,
// toasts 150 ms, panels 200 ms, folding sections 300 ms; exits a little faster.
// JS needs the exit numbers to know how long to keep a closing element in the
// page (MotionPresence, ToastHost, UndoToast). tests/motionTokens.test.mjs
// checks these against tokens.css so the two cannot drift apart.

export const MOTION_MS = Object.freeze({
  menu: 100,
  menuExit: 80,
  dialog: 150,
  dialogExit: 120,
  toast: 150,
  toastExit: 120,
  panel: 200,
  collapse: 300,
  state: 150,
  // Drag to reorder: the gap opening and the dropped item settling.
  drag: 200,
});

// How long a toast stays (Drawboard: info / success 3 s, error / warning 9 s).
export const TOAST_DURATION_MS = Object.freeze({
  info: 3000,
  success: 3000,
  warn: 9000,
  error: 9000,
});

/** True when the person asked the system for less motion. */
export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : undefined) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/**
 * Milliseconds to keep something on screen while it animates out: the token
 * value, or 0 under reduced motion (gone at once).
 */
export function exitMs(kind = 'dialog', win) {
  if (prefersReducedMotion(win)) return 0;
  const key = `${kind}Exit`;
  return Number.isFinite(MOTION_MS[key]) ? MOTION_MS[key] : MOTION_MS.dialogExit;
}

/**
 * How long a toast of `type` stays before it leaves by itself. A caller may
 * pass its own `duration` (ms); 0, null-ish-but-explicit `Infinity` or a
 * negative number means "stays until dismissed".
 */
export function toastDurationMs(type, duration) {
  if (duration === Infinity) return Infinity;
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    return duration > 0 ? duration : Infinity;
  }
  return TOAST_DURATION_MS[type] ?? TOAST_DURATION_MS.info;
}
