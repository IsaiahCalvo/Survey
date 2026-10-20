/**
 * inputModality.js — which input is the user ACTUALLY using right now:
 * 'mouse', 'pen' or 'touch'.
 *
 * Intended UX (Drawboard touch audit 2026-10-13, TOUCH.md T3 / M1): selection
 * grabbers get a finger-sized invisible catch area when a finger is in use and
 * a tight one when a mouse is. Until now the size came from the device's
 * PRIMARY pointer (`(pointer: coarse)`), read once: a touch laptop reports a
 * fine pointer, so a finger there got the 20 px mouse pads; an iPad with a
 * mouse reports a coarse pointer, so the mouse got 44 px pads that resized a
 * mark when the user meant to start a box-select next to it. Drawboard does
 * not adapt at all (34 px for every pointer); this follows the press instead.
 *
 * How it decides:
 *   - before any press: the primary pointer media — coarse -> 'touch',
 *     fine -> 'mouse' (so a phone/iPad starts finger-sized, a desktop tight);
 *   - every pointerdown: that press's `pointerType`;
 *   - a hovering mouse or pen (pointermove with no button down that actually
 *     moved on screen) also switches, so pads are already the right size
 *     BEFORE the press that will use them. A finger cannot hover, so touch
 *     switches on its press only.
 *
 * The answer is published two ways:
 *   - `<html data-input="mouse|pen|touch">` for CSS;
 *   - `subscribeInputModality` / `getInputModality` for React
 *     (hooks/useInputModality.js, a useSyncExternalStore wrapper).
 *
 * Listeners are window CAPTURE listeners, so the value is updated before any
 * component's own pointerdown handler runs, and nothing here ever stops or
 * changes an event (gestures, palm rejection and Pencil-only mode are
 * untouched).
 */

export const INPUT_MODALITIES = Object.freeze(['mouse', 'pen', 'touch']);

const ROOT_ATTRIBUTE = 'data-input';

let current = null;
let installed = false;
const listeners = new Set();
// Last screen position of a hovering mouse / pen. Browsers can send a
// pointermove for a pointer that did not move (layout shifted under a resting
// cursor); a hover only counts as "the user picked this input up" when the
// pointer really moved.
let lastHover = null;

/** Normalise a PointerEvent.pointerType to one of INPUT_MODALITIES, or null. */
export function normalizeInputModality(pointerType) {
  const type = String(pointerType || '').toLowerCase();
  return INPUT_MODALITIES.includes(type) ? type : null;
}

/** The guess before any press: what the primary pointer media says. */
export function detectInitialInputModality(win = typeof window !== 'undefined' ? window : undefined) {
  try {
    if (win && typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches) {
      return 'touch';
    }
  } catch {
    // matchMedia unavailable: fall through to the mouse default.
  }
  return 'mouse';
}

function writeRootAttribute(modality) {
  try {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (root && root.getAttribute(ROOT_ATTRIBUTE) !== modality) root.setAttribute(ROOT_ATTRIBUTE, modality);
  } catch {
    // No DOM (tests, SSR): the React store still works.
  }
}

/** Current modality: 'mouse' | 'pen' | 'touch'. */
export function getInputModality() {
  if (current === null) current = detectInitialInputModality();
  return current;
}

/** Set the modality (no-op when unchanged). Returns true when it changed. */
export function setInputModality(next) {
  const modality = normalizeInputModality(next);
  if (!modality) return false;
  if (modality === getInputModality()) return false;
  current = modality;
  writeRootAttribute(modality);
  listeners.forEach((listener) => {
    try { listener(modality); } catch { /* one bad listener must not block the rest */ }
  });
  return true;
}

/** Subscribe to changes; returns the unsubscribe function. */
export function subscribeInputModality(listener) {
  if (typeof listener !== 'function') return () => {};
  installInputModalityTracking();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * What one pointer event says about the input in use, or null when it says
 * nothing. Exported for tests.
 *   pointerdown          -> its pointerType
 *   pointermove (hover)  -> 'mouse' / 'pen' when no button is down and the
 *                           pointer moved since the last hover we saw
 */
export function modalityFromPointerEvent(event) {
  if (!event) return null;
  const modality = normalizeInputModality(event.pointerType);
  if (!modality) return null;
  if (event.type === 'pointerdown') {
    if (modality !== 'touch') lastHover = { type: modality, x: event.screenX, y: event.screenY };
    return modality;
  }
  if (event.type !== 'pointermove' || modality === 'touch') return null;
  // A drag in progress already switched on its pointerdown.
  if (Number(event.buttons) > 0) return null;
  const x = Number(event.screenX);
  const y = Number(event.screenY);
  const prev = lastHover;
  lastHover = { type: modality, x, y };
  if (prev && prev.type === modality && prev.x === x && prev.y === y) return null;
  return modality;
}

function handlePointerEvent(event) {
  // Cheap path for the stream of hover moves of the input already in use.
  if (event.type === 'pointermove' && normalizeInputModality(event.pointerType) === current) {
    lastHover = { type: current, x: event.screenX, y: event.screenY };
    return;
  }
  const modality = modalityFromPointerEvent(event);
  if (modality) setInputModality(modality);
}

/**
 * Start tracking (idempotent). Called by the first subscriber; also safe to
 * call at app start so the root attribute exists before React mounts.
 */
export function installInputModalityTracking(win = typeof window !== 'undefined' ? window : undefined) {
  if (installed || !win || typeof win.addEventListener !== 'function') return;
  installed = true;
  writeRootAttribute(getInputModality());
  const options = { capture: true, passive: true };
  win.addEventListener('pointerdown', handlePointerEvent, options);
  win.addEventListener('pointermove', handlePointerEvent, options);
}

/** Test helper: forget all state. */
export function resetInputModalityForTests() {
  current = null;
  installed = false;
  lastHover = null;
  listeners.clear();
}
