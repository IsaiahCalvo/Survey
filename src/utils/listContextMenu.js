// The right-click menu on a list row (owner 2026-11-12: "when I right-click on
// anything ... I should get a context menu with the same options that come up
// when I put them in edit mode. That goes for all list things.").
//
// Pure rules, no React, so node tests can import them. The menu itself is
// components/ListItemContextMenu.jsx (the shared .hub-menu look).
//
//   - A mouse right-click (or a pen's barrel button) opens it.
//   - A touch screen's own long-press `contextmenu` (Chrome on Windows and
//     Android send one) opens it too in the desktop layout, the way Windows
//     turns a held finger into a right-click in Drawboard. In the phone layout
//     a held finger is a drag (rearrange) and a slide shows the row actions,
//     so there it opens nothing.
//   - A text field that is being typed in keeps the browser's own menu (cut,
//     copy, paste, spelling).

const TEXT_FIELD = /^(INPUT|TEXTAREA)$/;

/** Is this contextmenu event on a text field the person is typing in? */
export function isTypingTarget(event, activeElement = typeof document !== 'undefined' ? document.activeElement : null) {
  const target = event?.target;
  if (!target) return false;
  const editable = TEXT_FIELD.test(target.tagName || '') || target.isContentEditable;
  if (!editable) return false;
  if (target.readOnly) return false;
  return target === activeElement;
}

/** What made this contextmenu event: 'touch' | 'pen' | 'mouse'. */
export function contextMenuPointerType(event) {
  const type = event?.pointerType || event?.nativeEvent?.pointerType;
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

/** Should this contextmenu event open the list row menu? */
export function shouldOpenListMenu(event, { mobileMode = false, activeElement } = {}) {
  if (!event) return false;
  if (isTypingTarget(event, activeElement)) return false;
  if (mobileMode && contextMenuPointerType(event) === 'touch') return false;
  return true;
}

/**
 * The shared contextmenu handler body. Returns the menu point, or null when
 * the event should be left alone (the browser's own menu, or nothing on a
 * phone). When it returns a point the event is already stopped.
 */
export function listMenuPointFrom(event, options = {}) {
  if (!shouldOpenListMenu(event, options)) {
    // On the phone the held finger is a drag: no browser menu either.
    if (options.mobileMode && !isTypingTarget(event, options.activeElement)) event?.preventDefault?.();
    return null;
  }
  event.preventDefault?.();
  event.stopPropagation?.();
  return { x: event.clientX, y: event.clientY };
}

/**
 * Run `fn` once the menu has closed and handed focus back to whatever had it
 * (the menu's focus trap returns focus on close, which would steal it from a
 * name field the Rename row just focused).
 */
export function afterMenuCloses(fn) {
  if (typeof requestAnimationFrame !== 'function') { setTimeout(fn, 0); return; }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}
