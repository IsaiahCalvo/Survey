/**
 * annotationPreferences.js — this device's annotation settings
 * (Settings -> Annotations).
 *
 * Kept in localStorage like the app's other device preferences
 * ('survey:text-markup-overlap-mode', 'eraserMode', ...). Every read and write
 * is wrapped: a private window or blocked storage falls back to the default.
 *
 * KAL-397 — "Fit text boxes to their text" (textbox auto-fit on commit):
 *   On (default, the behaviour the app always had for a new box): a new text
 *   box hugs its text when typing ends, and the box is marked
 *   data.textAutoFit = true. While that mark stays, re-editing the box fits it
 *   to the text again (it can shrink). Resizing the box by hand clears the
 *   mark (lockTextboxSizeAfterResize), so the size the user chose is kept from
 *   then on.
 *   Off: a commit never tightens. A new box keeps the width (and, when drawn
 *   by dragging, the height) the user gave it; it only grows to fit text.
 *
 * Pure JS (no React import) so the Node test runner can import it; the React
 * hook lives in useAnnotationPreference.js.
 */

export const ANNOTATION_SNAPPING_KEY = 'survey:annotation-snapping';
let snappingMemo = null;

export function readAnnotationSnapping() {
  try {
    const raw = storage()?.getItem(ANNOTATION_SNAPPING_KEY);
    if (raw === 'off') return false;
    if (raw === 'on') return true;
  } catch { /* blocked storage */ }
  return snappingMemo ?? true;
}

export function writeAnnotationSnapping(value) {
  const on = !!value;
  snappingMemo = on;
  try { storage()?.setItem(ANNOTATION_SNAPPING_KEY, on ? 'on' : 'off'); } catch { /* blocked storage */ }
  try { window.dispatchEvent(new CustomEvent(ANNOTATION_PREFERENCES_EVENT, { detail: { key: ANNOTATION_SNAPPING_KEY, value: on } })); } catch { /* no window */ }
  return on;
}

// Shift's angle step (owner 2026-10-29): 15° (default), 45° or 90°. Every
// Shift-snap reads it: line, arrow, polyline, polygon and measure segments,
// corner drags, region sides and rotation.
export const SNAP_ANGLE_KEY = 'survey:snap-angle';
export const SNAP_ANGLE_CHOICES = Object.freeze([15, 45, 90]);
export const SNAP_ANGLE_DEFAULT = 15;
let snapAngleMemo = null;

const asSnapAngle = (value) => {
  const n = Number(value);
  return SNAP_ANGLE_CHOICES.includes(n) ? n : null;
};

export function readSnapAngle() {
  try {
    const stored = asSnapAngle(storage()?.getItem(SNAP_ANGLE_KEY));
    if (stored) return stored;
  } catch { /* blocked storage */ }
  return snapAngleMemo ?? SNAP_ANGLE_DEFAULT;
}

export function writeSnapAngle(value) {
  const step = asSnapAngle(value) ?? SNAP_ANGLE_DEFAULT;
  snapAngleMemo = step;
  try { storage()?.setItem(SNAP_ANGLE_KEY, String(step)); } catch { /* blocked storage */ }
  try { window.dispatchEvent(new CustomEvent(ANNOTATION_PREFERENCES_EVENT, { detail: { key: SNAP_ANGLE_KEY, value: step } })); } catch { /* no window */ }
  return step;
}

export const TEXTBOX_AUTO_FIT_KEY = 'survey:textbox-auto-fit';
export const TEXTBOX_AUTO_FIT_DEFAULT = true;
export const ANNOTATION_PREFERENCES_EVENT = 'survey:annotation-preferences-changed';

const storage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

// The last value written in this page, so a session with blocked storage
// still honours a change made in Settings until it reloads.
let memo = null;

export function readTextboxAutoFit() {
  try {
    const raw = storage()?.getItem(TEXTBOX_AUTO_FIT_KEY);
    if (raw === 'off') return false;
    if (raw === 'on') return true;
  } catch { /* blocked storage: fall through */ }
  return memo ?? TEXTBOX_AUTO_FIT_DEFAULT;
}

export function writeTextboxAutoFit(value) {
  const on = !!value;
  memo = on;
  try {
    storage()?.setItem(TEXTBOX_AUTO_FIT_KEY, on ? 'on' : 'off');
  } catch { /* blocked storage: the change still applies to this page */ }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(ANNOTATION_PREFERENCES_EVENT, {
        detail: { key: TEXTBOX_AUTO_FIT_KEY, value: on },
      }));
    }
  } catch { /* no window (tests) */ }
  return on;
}

// Polyline "Curve" (Nightly, flag 'spline-polyline'): new polylines bend
// smoothly through their corners. Off unless the user turns it on.
export const POLYLINE_CURVE_KEY = 'survey:polyline-curve';
let curveMemo = null;

export function readPolylineCurve() {
  try {
    const raw = storage()?.getItem(POLYLINE_CURVE_KEY);
    if (raw === 'on') return true;
    if (raw === 'off') return false;
  } catch { /* blocked storage */ }
  return curveMemo ?? false;
}

export function writePolylineCurve(value) {
  const on = !!value;
  curveMemo = on;
  try { storage()?.setItem(POLYLINE_CURVE_KEY, on ? 'on' : 'off'); } catch { /* blocked storage */ }
  try { window.dispatchEvent(new CustomEvent(ANNOTATION_PREFERENCES_EVENT, { detail: { key: POLYLINE_CURVE_KEY, value: on } })); } catch { /* no window */ }
  return on;
}

/** Subscribe to changes from this page (Settings) and other windows. */
export function subscribeAnnotationPreferences(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') return () => {};
  const onLocal = () => listener();
  const onStorage = (event) => {
    if (!event || event.key == null || event.key === TEXTBOX_AUTO_FIT_KEY || event.key === ANNOTATION_SNAPPING_KEY || event.key === POLYLINE_CURVE_KEY || event.key === SNAP_ANGLE_KEY) listener();
  };
  window.addEventListener(ANNOTATION_PREFERENCES_EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ANNOTATION_PREFERENCES_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

const TEXT_TYPES = new Set(['textbox', 'i-text', 'text']);
export const isPlainTextAnnotation = (obj) => (
  !!obj && typeof obj === 'object' && TEXT_TYPES.has(String(obj.type || '').toLowerCase())
);

/**
 * A manual resize locks the box at the user's size: clear the auto-fit mark.
 * Mutates and returns `obj`. Only touches a box that carries the mark, so
 * older boxes (and imported ones) are left byte-identical.
 */
export function lockTextboxSizeAfterResize(obj) {
  if (!isPlainTextAnnotation(obj)) return obj;
  if (obj.data && typeof obj.data === 'object' && obj.data.textAutoFit === true) {
    obj.data = { ...obj.data, textAutoFit: false };
  }
  return obj;
}
