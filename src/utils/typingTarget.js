// Kept apart from annotationFamilyRules.js (which re-exports it): the keyboard
// shortcut code loads with the home screen, and importing it from there
// dragged the drag / merge geometry into the first visit (launch audit
// 2026-10-30).

const ARROW_OWNING_WIDGETS = [
  'menu', 'menubar', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
  'listbox', 'option', 'combobox', 'slider', 'spinbutton', 'scrollbar',
  'tab', 'tablist', 'radio', 'radiogroup', 'grid', 'tree', 'treegrid',
  'dialog', 'alertdialog',
].map((role) => `[role="${role}"]`).join(',');

/**
 * True when keyboard focus is somewhere that owns typing or arrow keys (an
 * input, a text area, a select, a contentEditable editor, the Fabric hidden
 * textarea, a menu / listbox / slider / tab / dialog widget) — arrow keys
 * must work there, never move the selection.
 */
export function isTypingTarget(element, now = Date.now()) {
  if (!element) return false;
  if (isOrphanTyping(element, now)) return true;
  const tag = String(element.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (element.isContentEditable === true) return true;
  if (element.contentEditable === 'true') return true;
  if (typeof element.closest === 'function') {
    if (element.closest('.fabric-hidden-textarea')) return true;
    if (element.closest('[contenteditable="true"]')) return true;
    // Widgets that use the arrow keys themselves: toolbar dropdowns and
    // menus, the colour picker's sliders, tabs, radio groups, dialogs.
    // (Review 2026-09-28: the nudge swallowed ArrowDown in the stroke
    // dropdown and the hue slider while a mark was selected.)
    if (element.closest(ARROW_OWNING_WIDGETS)) return true;
  }
  return false;
}

// The field someone was typing in can vanish under them: another person
// deletes the mark whose note they are editing and the panel unmounts. Focus
// falls to <body>, so the rest of the word would fire single-key tool
// shortcuts (audit r5b #21: " more" armed the Eraser). Keys that reach
// <body> right after the typed-in field left the page still count as typing,
// until a pause or a click.
const ORPHAN_TYPING_MS = 1500;
let lastField = null;
let lastFieldKeyAt = 0;

function isPageRoot(element) {
  if (typeof document === 'undefined') return false;
  return element === document.body || element === document.documentElement;
}

/**
 * True when focus has fallen to the page because the field being typed in was
 * removed a moment ago. Handlers with their own form-field test call this.
 */
export function isOrphanTyping(element, now = Date.now()) {
  if (!lastField || !isPageRoot(element)) return false;
  if (lastField.isConnected !== false) return false;
  return now - lastFieldKeyAt <= ORPHAN_TYPING_MS;
}

/** Note a keydown (window capture). Exported for tests. */
export function noteTypingKey(target, now = Date.now()) {
  if (!target) return;
  if (isOrphanTyping(target, now)) { lastFieldKeyAt = now; return; }
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true) {
    lastField = target;
    lastFieldKeyAt = now;
  } else {
    // A key pressed outside any field (Escape then Delete) means the person
    // left the field themselves.
    forgetTypingField();
  }
}

/**
 * Was the person typing in a field that was taken off the page under them,
 * with no click or outside key since? The Properties panel uses this to say
 * that someone else deleted the mark being edited.
 */
export function typedFieldJustLeft(withinMs = 10000, now = Date.now()) {
  return Boolean(lastField && lastField.isConnected === false && now - lastFieldKeyAt <= withinMs);
}

/** A click anywhere ends the orphan-typing grace. Exported for tests. */
export function forgetTypingField() {
  lastField = null;
  lastFieldKeyAt = 0;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', (event) => noteTypingKey(event?.target), true);
  window.addEventListener('pointerdown', forgetTypingField, true);
}
