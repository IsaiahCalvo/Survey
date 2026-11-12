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
//   - A text field that is being typed in keeps its text menu with spelling
//     fixes, and text the person has selected gets Copy, instead of the row
//     menu (nativeContextMenuGuard.js decides which menu that is).

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

// What had focus just before the last right-press. The press itself focuses
// a text field (and selects the word under it, which the browser's spelling
// fixes need), so "focused now" cannot tell a field being typed in from a
// click-to-rename name that was only right-clicked. nativeContextMenuGuard.js
// notes each right-press here, before the browser moves focus.
let lastPress = null;
const PRESS_MEMORY_MS = 1500;

/** Note what had focus as a context-menu press began (window capture mousedown). */
export function noteContextMenuPress(activeElement, now = Date.now()) {
  lastPress = { focused: activeElement || null, at: now };
}

/** Forget the noted press (tests). */
export function forgetContextMenuPress() { lastPress = null; }

/**
 * Is this contextmenu event on a text field the person is typing in? A
 * field that only got focus from this right-press is not: a right-click on a
 * click-to-rename name in a list row (the Spaces title, owner 2026-11-12)
 * opens the row's menu. A field the person was already typing in keeps the
 * text menu with its spelling fixes.
 */
export function isTypingTarget(event, activeElement = typeof document !== 'undefined' ? document.activeElement : null, now = Date.now()) {
  const field = textEntryFieldOf(event?.target);
  if (!field) return false;
  const within = (node) => node != null && (node === field || (typeof field.contains === 'function' && field.contains(node)));
  if (lastPress && now - lastPress.at <= PRESS_MEMORY_MS) return within(lastPress.focused);
  return within(activeElement);
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
  // The right-press focused a name field it landed on; that was not the
  // start of typing, so let it go (the menu would hand focus back to it).
  const field = textEntryFieldOf(event.target);
  const active = options.activeElement !== undefined ? options.activeElement : (typeof document !== 'undefined' ? document.activeElement : null);
  if (field && active && (active === field || field.contains?.(active))) active.blur?.();
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
