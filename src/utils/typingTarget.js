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
export function isTypingTarget(element) {
  if (!element) return false;
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
