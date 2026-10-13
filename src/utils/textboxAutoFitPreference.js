/**
 * textboxAutoFitPreference.js — Settings → Annotations → "Fit text boxes to
 * their text" (KAL-397, F19).
 *
 * Intended UX (Acrobat's Preferences → Annotations is the reference for where
 * the setting lives):
 *   - On (the default): a text box fits its text when you finish typing, and
 *     again each time you edit it, until you resize it by hand. A hand resize
 *     is deliberate, so from then on the box keeps that size (the text can
 *     still grow it taller, never shrink it).
 *   - Off: a text box keeps the size you give it. A box you drag out keeps the
 *     width and height you drew; edits can grow it, never shrink it.
 *
 * The per-box half of the rule lives on the mark as `data.autoFit: true`. It is
 * stamped only on a NEW text box made while the setting is On, and a hand
 * resize removes it. Boxes made before this setting existed never carry it, so
 * no older box is ever re-sized by an edit.
 *
 * Stored per device in localStorage, like the app's other annotation choices
 * (text markup overlap mode, eraser mode, last tools). Pure JS: the Node test
 * runner imports it, and every storage call is guarded (private windows and
 * blocked storage fall back to the default).
 */

export const TEXTBOX_AUTO_FIT_STORAGE_KEY = 'survey:textbox-auto-fit';
export const TEXTBOX_AUTO_FIT_DEFAULT = true;
/** Window event sent when the setting changes, so an open panel can follow. */
export const TEXTBOX_AUTO_FIT_CHANGE_EVENT = 'survey:textbox-auto-fit-change';

const defaultStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** The current setting (true = fit text boxes to their text). */
export function readTextboxAutoFit(storage = defaultStorage()) {
  try {
    const value = storage?.getItem(TEXTBOX_AUTO_FIT_STORAGE_KEY);
    if (value === 'off') return false;
    if (value === 'on') return true;
  } catch { /* blocked storage: use the default */ }
  return TEXTBOX_AUTO_FIT_DEFAULT;
}

/** Save the setting. Returns the value now in effect. */
export function writeTextboxAutoFit(on, storage = defaultStorage(), win = typeof window !== 'undefined' ? window : null) {
  const next = !!on;
  try {
    storage?.setItem(TEXTBOX_AUTO_FIT_STORAGE_KEY, next ? 'on' : 'off');
  } catch { /* blocked storage: the choice is not kept */ }
  try {
    if (win && typeof win.dispatchEvent === 'function' && typeof win.CustomEvent === 'function') {
      win.dispatchEvent(new win.CustomEvent(TEXTBOX_AUTO_FIT_CHANGE_EVENT, { detail: { on: next } }));
    }
  } catch { /* noop */ }
  return next;
}

/** True when this text box still fits itself to its text on each edit. */
export function boxFollowsAutoFit(annotation) {
  return annotation?.data?.autoFit === true;
}

/**
 * The width (outer, page units) the editor types a re-fitting box at: the
 * width it was first typed at, never narrower than the box is now. Null when
 * the box does not re-fit or is rotated (a rotated box keeps its width).
 */
export function autoFitEditWidth(annotation) {
  if (!boxFollowsAutoFit(annotation)) return null;
  if ((Number(annotation.angle) || 0) !== 0) return null;
  const now = (Number(annotation.width) || 0) * Math.abs(Number(annotation.scaleX) || 1);
  const typed = Number(annotation.data.autoFitWidth) || 0;
  return Math.max(now, typed) || null;
}

/**
 * A hand resize locks the box's size: drop the per-box flag. Mutates and
 * returns the object (the resize commit path works on a cloned object).
 */
export function clearAutoFitFlag(annotation) {
  if (annotation?.data && (Object.prototype.hasOwnProperty.call(annotation.data, 'autoFit')
    || Object.prototype.hasOwnProperty.call(annotation.data, 'autoFitWidth'))) {
    const { autoFit: _dropped, autoFitWidth: _droppedWidth, ...rest } = annotation.data;
    annotation.data = rest;
  }
  return annotation;
}
