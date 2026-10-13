/**
 * viewerPageKeys.js — Home, End, Page Up and Page Down turn pages in the viewer
 * wherever keyboard focus happens to be resting.
 *
 * KAL-444 (2026-10-13). The shortcuts sheet lists these keys, and pressing them
 * showed they only worked after a click on the page: the browser scrolls the
 * focused scroll box, so on a fresh open (focus on the body) or after pressing
 * a toolbar button nothing moved. Intended UX: the keys act on the document
 * you are looking at, the way Drawboard PDF and Acrobat treat them.
 *
 * The browser keeps the keys whenever it already does the right thing or the
 * key belongs to something else:
 *   - focus inside a scroll box (the page scroller itself, a panel list, an
 *     open sheet): native scrolling of that box is what the user means;
 *   - focus in a text field, editor, menu, list, slider or dialog
 *     (isTypingTarget, the app's shared test for "this owns the keys");
 *   - any modifier held (Shift+End selects text, Ctrl+Home is the OS's).
 *
 * Pure JS (the DOM is reached only through the element passed in), so the Node
 * test runner can import it.
 */
import { isTypingTarget } from './annotationFamilyRules.js';

export const VIEWER_PAGE_KEYS = Object.freeze({
  Home: 'first',
  End: 'last',
  PageUp: 'previous',
  PageDown: 'next',
});

const defaultGetStyle = (el) => (
  typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
    ? window.getComputedStyle(el)
    : null
);

/** True when `el` or an ancestor below <body> is a box that scrolls vertically. */
export function insideScrollBox(el, getStyle = defaultGetStyle) {
  for (let node = el; node && node.parentElement; node = node.parentElement) {
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'BODY' || tag === 'HTML') return false;
    const style = getStyle(node);
    const overflowY = style ? String(style.overflowY || '') : '';
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return true;
    }
  }
  return false;
}

/**
 * The page move this keydown asks for ('first' | 'last' | 'previous' | 'next'),
 * or null when the browser or a widget should keep the key.
 */
export function viewerPageKeyAction(event, activeElement, getStyle = defaultGetStyle) {
  const action = event ? VIEWER_PAGE_KEYS[event.key] : null;
  if (!action) return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.defaultPrevented) return null;
  if (isTypingTarget(activeElement)) return null;
  if (insideScrollBox(activeElement, getStyle)) return null;
  return action;
}
