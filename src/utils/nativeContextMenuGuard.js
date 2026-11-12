// The browser's own right-click menu never shows in Survey (owner 2026-11-12:
// "I don't want that really ever showing up ... either disable it or make a
// proper context menu show up ... If it's just empty space, no right-click
// menu should show up.").
//
// Every surface that has real actions opens its own menu first (list rows via
// listContextMenu.js, marks and pages via contextMenuDiagnostics.js, tabs,
// home rows, the pinned dock ...) and calls preventDefault. This guard runs
// last, on window in the bubble phase, and answers whatever is left:
//
//   - a text field (input, textarea, contenteditable): the app's own
//     Cut / Copy / Paste / Select all menu;
//   - text the person selected: the app's own Copy menu;
//   - a link: Open link / Copy link;
//   - anything else (empty space, a toolbar, a label): no menu at all.
//
// A touch screen's long-press is left to the system on text (selection
// handles and the system's Cut / Copy / Paste bar are how fingers edit text)
// and gives nothing anywhere else.
//
// It also keeps a right-press from focusing a field that was not focused, so
// a right-click on a click-to-rename name (the Spaces title) is a right-click
// on its row, not the start of typing.
//
// Pure rules here (node tests import them); the menu is drawn by
// components/AppContextMenuHost.jsx, which listens for APP_CONTEXT_MENU_EVENT.

import { contextMenuPointerType, pointInsideSelection, textEntryFieldOf } from './listContextMenu.js';

export const APP_CONTEXT_MENU_EVENT = 'survey-app-context-menu';

const isApple = () => typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

/** Did a touch screen make this contextmenu (a held finger)? */
export function isTouchContextMenu(event, doc = typeof document !== 'undefined' ? document : null) {
  if (contextMenuPointerType(event) === 'touch') return true;
  if (event?.sourceCapabilities?.firesTouchEvents) return true;
  // Safari sends a plain MouseEvent: fall back to the input in use right now
  // (utils/inputModality.js keeps <html data-input>).
  if (event?.pointerType == null && event?.nativeEvent?.pointerType == null) {
    return doc?.documentElement?.dataset?.input === 'touch';
  }
  return false;
}

/** The link this event is on, or null. */
export function linkOf(target) {
  const link = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
  if (!link) return null;
  const raw = String(link.getAttribute?.('href') ?? link.href ?? '').trim();
  // A "#" or javascript: link is a button in disguise: nothing to open or copy.
  if (!raw || raw === '#' || /^javascript:/i.test(raw)) return null;
  return { element: link, href: link.href || raw };
}

/**
 * What to do with a contextmenu event nobody else answered.
 * Returns { block: boolean, menu: null | { kind: 'field', field }
 *   | { kind: 'selection', text } | { kind: 'link', href } }.
 */
export function nativeMenuPlan(event, {
  touch = isTouchContextMenu(event),
  selection = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null,
} = {}) {
  if (!event || event.defaultPrevented) return { block: false, menu: null };
  const field = textEntryFieldOf(event.target);
  if (touch) {
    // Fingers edit text with the system's own selection bar.
    if (field || pointInsideSelection(event, selection)) return { block: false, menu: null };
    return { block: true, menu: null };
  }
  if (field) return { block: true, menu: { kind: 'field', field } };
  if (pointInsideSelection(event, selection)) {
    return { block: true, menu: { kind: 'selection', text: String(selection.toString()) } };
  }
  const link = linkOf(event.target);
  if (link) return { block: true, menu: { kind: 'link', href: link.href } };
  return { block: true, menu: null };
}

/** Is this mousedown the press that opens a context menu (right button, or Control-click on a Mac)? */
export function isContextMenuPress(event, apple = isApple()) {
  if (!event) return false;
  if (event.button === 2) return true;
  return apple && event.button === 0 && event.ctrlKey === true;
}

/**
 * Install once on window. Returns a teardown. `window.__nativeContextMenu =
 * true` (a debugging switch) lets the browser's menu through again.
 */
export function installNativeContextMenuGuard(win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.addEventListener !== 'function') return () => {};
  if (typeof win.__nativeContextMenuGuardTeardown === 'function') win.__nativeContextMenuGuardTeardown();

  const onMouseDown = (event) => {
    if (win.__nativeContextMenu === true || !isContextMenuPress(event)) return;
    const field = textEntryFieldOf(event.target);
    if (!field) return;
    const active = win.document?.activeElement;
    if (field === active || (active && field.contains?.(active))) return;
    // Not focused: a right-press does not start typing here.
    event.preventDefault();
  };

  const onContextMenu = (event) => {
    if (win.__nativeContextMenu === true) return;
    const plan = nativeMenuPlan(event);
    if (!plan.block) return;
    event.preventDefault();
    if (!plan.menu) return;
    if (plan.menu.kind === 'field') {
      const { field } = plan.menu;
      if (win.document?.activeElement !== field && !field.contains?.(win.document?.activeElement)) {
        try { field.focus({ preventScroll: true }); } catch { /* not focusable */ }
      }
    }
    win.dispatchEvent(new win.CustomEvent(APP_CONTEXT_MENU_EVENT, {
      detail: { ...plan.menu, x: event.clientX, y: event.clientY },
    }));
  };

  win.addEventListener('mousedown', onMouseDown, true);
  win.addEventListener('contextmenu', onContextMenu, false);
  const teardown = () => {
    win.removeEventListener('mousedown', onMouseDown, true);
    win.removeEventListener('contextmenu', onContextMenu, false);
    if (win.__nativeContextMenuGuardTeardown === teardown) win.__nativeContextMenuGuardTeardown = null;
  };
  win.__nativeContextMenuGuardTeardown = teardown;
  return teardown;
}
