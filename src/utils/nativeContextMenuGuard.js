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
//   - a text field (input, textarea, contenteditable): spelling fixes come
//     first (owner 2026-11-12: "I definitely want spelling correction
//     throughout the entire app"). Only the browser knows which word is
//     misspelled and how to fix it, so:
//       * in a web browser the browser's own menu shows there, and only
//         there (it carries the spelling fixes, plus Cut / Copy / Paste);
//       * in the desktop app Chromium hands the misspelled word and its
//         fixes to the page (electron-main.js 'editable-context-menu'), and
//         Survey's own menu shows them above Cut / Copy / Paste / Select all;
//   - text the person selected: the app's own Copy menu;
//   - a link: Open link / Copy link;
//   - anything else (empty space, a toolbar, a label): no menu at all.
//
// A touch screen's long-press is left to the system on text (selection
// handles and the system's Cut / Copy / Paste bar are how fingers edit text)
// and gives nothing anywhere else.
//
// It also notes what had focus before each right-press, so a right-click on a
// click-to-rename name that was not being typed in (the Spaces title) is a
// right-click on its row (listContextMenu.isTypingTarget).
//
// Pure rules here (node tests import them); the menu is drawn by
// components/AppContextMenuHost.jsx, which listens for APP_CONTEXT_MENU_EVENT.

import { contextMenuPointerType, noteContextMenuPress, pointInsideSelection, textEntryFieldOf } from './listContextMenu.js';

export const APP_CONTEXT_MENU_EVENT = 'survey-app-context-menu';

// How long the desktop app's text-box menu waits for Chromium's spelling
// answer before it opens without fixes (the answer comes within a frame).
export const SPELLING_WAIT_MS = 400;

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
  desktopSpelling = hasDesktopSpelling(),
} = {}) {
  if (!event || event.defaultPrevented) return { block: false, menu: null };
  const field = textEntryFieldOf(event.target);
  if (touch) {
    // Fingers edit text with the system's own selection bar.
    if (field || pointInsideSelection(event, selection)) return { block: false, menu: null };
    return { block: true, menu: null };
  }
  if (field) {
    // The desktop app: let Chromium look up the word (it only does when the
    // event is left alone; it shows nothing itself), then Survey's menu
    // opens with its fixes. A web browser: its own menu, for its fixes.
    return desktopSpelling
      ? { block: false, menu: null, awaitSpelling: { kind: 'field', field } }
      : { block: false, menu: null, nativeField: field };
  }
  if (pointInsideSelection(event, selection)) {
    return { block: true, menu: { kind: 'selection', text: String(selection.toString()) } };
  }
  const link = linkOf(event.target);
  if (link) return { block: true, menu: { kind: 'link', href: link.href } };
  return { block: true, menu: null };
}

/** Is this the desktop app with the spelling bridge (preload.js)? */
export function hasDesktopSpelling(win = typeof window !== 'undefined' ? window : null) {
  return typeof win?.electronAPI?.onEditableContextMenu === 'function';
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

  // Note what had focus before the press focuses a field (see
  // listContextMenu.isTypingTarget). The press keeps its default: it selects
  // the word under the pointer, which the spelling fixes work from.
  const onMouseDown = (event) => {
    if (!isContextMenuPress(event)) return;
    noteContextMenuPress(win.document?.activeElement || null);
  };

  const focusField = (field) => {
    const active = win.document?.activeElement;
    if (active !== field && !field.contains?.(active)) {
      try { field.focus({ preventScroll: true }); } catch { /* not focusable */ }
    }
  };
  const openMenu = (detail) => {
    win.dispatchEvent(new win.CustomEvent(APP_CONTEXT_MENU_EVENT, { detail }));
  };

  // Desktop app: the text-box menu waits for Chromium's spelling answer
  // (it comes straight after the event); without one it opens anyway.
  let awaiting = null;
  const finishAwaiting = (spelling) => {
    if (!awaiting) return;
    const { detail, timer } = awaiting;
    awaiting = null;
    win.clearTimeout?.(timer);
    if (detail.field?.isConnected === false) return;
    openMenu(spelling ? { ...detail, spelling } : detail);
  };
  const stopSpelling = hasDesktopSpelling(win)
    ? win.electronAPI.onEditableContextMenu((info) => finishAwaiting(info || null))
    : null;

  const onContextMenu = (event) => {
    if (win.__nativeContextMenu === true) return;
    const plan = nativeMenuPlan(event, { desktopSpelling: hasDesktopSpelling(win) });
    if (plan.nativeField) { focusField(plan.nativeField); return; }
    if (plan.awaitSpelling) {
      focusField(plan.awaitSpelling.field);
      if (awaiting) win.clearTimeout?.(awaiting.timer);
      const detail = { ...plan.awaitSpelling, x: event.clientX, y: event.clientY };
      awaiting = { detail, timer: win.setTimeout(() => finishAwaiting(null), SPELLING_WAIT_MS) };
      return;
    }
    if (!plan.block) return;
    event.preventDefault();
    if (!plan.menu) return;
    openMenu({ ...plan.menu, x: event.clientX, y: event.clientY });
  };

  win.addEventListener('mousedown', onMouseDown, true);
  win.addEventListener('contextmenu', onContextMenu, false);
  const teardown = () => {
    win.removeEventListener('mousedown', onMouseDown, true);
    win.removeEventListener('contextmenu', onContextMenu, false);
    if (typeof stopSpelling === 'function') stopSpelling();
    if (awaiting) { win.clearTimeout?.(awaiting.timer); awaiting = null; }
    if (win.__nativeContextMenuGuardTeardown === teardown) win.__nativeContextMenuGuardTeardown = null;
  };
  win.__nativeContextMenuGuardTeardown = teardown;
  return teardown;
}
