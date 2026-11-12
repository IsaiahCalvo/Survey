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
//   - A text field that is being typed in, or text the person has selected,
//     gets the app's own Cut / Copy / Paste menu instead (nativeContextMenuGuard.js
//     and components/AppContextMenuHost.jsx). The browser's menu never shows.

// Inputs a person types text into (not a checkbox, a slider or a button).
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Is this element a field a person types text into (not read-only)? */
export function isTextEntryField(element) {
  if (!element || typeof element !== 'object') return false;
  if (element.disabled || element.readOnly) return false;
  const tag = String(element.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has(String(element.type ?? element.getAttribute?.('type') ?? '').toLowerCase());
  return Boolean(element.isContentEditable);
}

/** The text field this event's target sits in (itself, or a contenteditable host), or null. */
export function textEntryFieldOf(target) {
  if (!target || typeof target !== 'object') return null;
  if (isTextEntryField(target)) return target;
  if (target.isContentEditable && typeof target.closest === 'function') {
    const host = target.closest('[contenteditable]:not([contenteditable="false"])');
    if (host && isTextEntryField(host)) return host;
  }
  return null;
}

/**
 * Is this contextmenu event on a text field the person is typing in? A
 * right-press on a field that was NOT focused does not focus it
 * (nativeContextMenuGuard.js), so a click-to-rename name in a list row (the
 * Spaces name, owner 2026-11-12) opens the row's menu, while a field the
 * person is already typing in gets the in-app Cut / Copy / Paste menu.
 */
export function isTypingTarget(event, activeElement = typeof document !== 'undefined' ? document.activeElement : null) {
  const field = textEntryFieldOf(event?.target);
  if (!field) return false;
  return field === activeElement || (typeof field.contains === 'function' && activeElement != null && field.contains(activeElement));
}

/**
 * Does this event land on text the person has selected? Then the in-app Copy
 * menu answers it, not the row's menu.
 */
export function pointInsideSelection(event, selection = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null) {
  if (!event || !selection || selection.isCollapsed || !selection.rangeCount) return false;
  if (!String(selection.toString?.() || '').trim()) return false;
  const { clientX: x, clientY: y } = event;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const rects = selection.getRangeAt(i)?.getClientRects?.() || [];
    for (const rect of rects) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
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
  if (pointInsideSelection(event)) return false;
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
