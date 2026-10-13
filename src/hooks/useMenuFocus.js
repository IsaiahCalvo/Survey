/**
 * useMenuFocus.js — the keyboard half of a dropdown menu (KAL-66).
 *
 * `useMenuFocus(menuRef, isOpen, { arrows = true })`
 *
 * `menuRef` may point at the menu itself or at a wrapper that holds it (the
 * first [role="menu"] / [role="listbox"] inside is used), or be a list of
 * refs. DismissBarrier takes
 * a `menu` prop that calls this with its first insideRef, so most menus get
 * it by adding one word.
 *
 * Dialogs use useFocusTrap (src/hooks/useFocusTrap.js). A menu is lighter: it
 * does not trap Tab, and DismissBarrier already closes it on Escape and on an
 * outside press. What it was missing for a keyboard user:
 *
 *   1. Opened from the keyboard, focus moves INTO the menu (the checked /
 *      current item, else the first item), so Enter on "More" then Down/Enter
 *      picks an item instead of Tab-hunting for it.
 *   2. Up / Down / Home / End move between the items (wrapping).
 *   3. When it closes and focus was left nowhere (the item you pressed is
 *      gone), focus goes back to the button that opened it — so Escape, or
 *      picking "Rename…", never drops you at the top of the page. If the item
 *      opened a dialog, that dialog's trap captures this opener too, and hands
 *      focus back to it when the dialog closes.
 *
 * Mouse and touch users see no change: steps 1 and 3 only run when the last
 * input was a key press (src/utils/keyboardModality.js).
 */
import { useEffect, useRef } from 'react';
import { lastInputWasKeyboard } from '../utils/keyboardModality.js';

const ITEM_SELECTOR = [
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  'button',
  'a[href]',
].join(', ');

const isFocusableItem = (el) => (
  !el.disabled
  && el.getAttribute('aria-disabled') !== 'true'
  && (el.tabIndex >= 0 || el.hasAttribute('tabindex'))
  && el.getClientRects().length > 0
);

const MENU_SELECTOR = '[role="menu"], [role="listbox"]';
const resolveMenu = (node) => {
  if (!node) return null;
  if (node.matches?.(MENU_SELECTOR)) return node;
  return Array.from(node.querySelectorAll?.(MENU_SELECTOR) || []).find((el) => el.getClientRects().length > 0) || node;
};

export const menuItemsWithin = (menu) => (
  menu ? Array.from(menu.querySelectorAll(ITEM_SELECTOR)).filter(isFocusableItem) : []
);

export function useMenuFocus(menuRef, isOpen, { arrows = true } = {}) {
  // Callers may pass a fresh ref-like object each render; read it at use time.
  const refHolder = useRef(menuRef);
  refHolder.current = menuRef;
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;
    const opener = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    // A ref, a DOM node, or a list of either (DismissBarrier's insideRefs):
    // the first one holding a menu that is on screen wins.
    const currentMenu = () => {
      const entries = Array.isArray(refHolder.current) ? refHolder.current : [refHolder.current];
      const nodes = entries
        .map((entry) => entry?.current || (typeof entry?.querySelectorAll === 'function' ? entry : null))
        .filter(Boolean);
      for (const node of nodes) {
        const found = resolveMenu(node);
        if (found !== node || node.matches?.(MENU_SELECTOR)) return found;
      }
      return nodes[0] || null;
    };
    const menu = currentMenu();
    let retry = 0;
    const focusIn = () => {
      const node = currentMenu();
      if (!node || node.contains(document.activeElement)) return true;
      const items = menuItemsWithin(node);
      const current = items.find((el) => (
        el.getAttribute('aria-checked') === 'true'
        || el.getAttribute('aria-selected') === 'true'
        || el.getAttribute('aria-current') === 'true'
      ));
      const target = current || items[0];
      target?.focus?.({ preventScroll: true });
      return Boolean(target) && document.activeElement === target;
    };
    // Retried briefly: some menus measure their position first and stay
    // hidden (unfocusable) for a frame or two.
    let tries = 0;
    const tryFocusIn = () => {
      retry = 0;
      if (focusIn() || tries >= 4) return;
      tries += 1;
      retry = setTimeout(tryFocusIn, tries === 1 ? 0 : 40);
    };
    if (lastInputWasKeyboard()) tryFocusIn();

    const onKeyDown = (event) => {
      if (!arrows) return;
      const target = event.target;
      if (target?.matches?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      const items = menuItemsWithin(currentMenu());
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      const at = items.indexOf(document.activeElement);
      let next = 0;
      if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
      else if (event.key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
      else if (event.key === 'End') next = items.length - 1;
      items[next].focus({ preventScroll: true });
    };
    // On the document (capture) rather than the menu node: a menu that mounts
    // a tick after its barrier still gets arrows. Only keys from inside count.
    const onDocKeyDown = (event) => {
      const node = currentMenu();
      if (node && node.contains(event.target)) onKeyDown(event);
    };
    document.addEventListener('keydown', onDocKeyDown, true);

    return () => {
      if (retry) clearTimeout(retry);
      document.removeEventListener('keydown', onDocKeyDown, true);
      if (!opener || opener.isConnected === false || !lastInputWasKeyboard()) return;
      const active = document.activeElement;
      const lost = !active || active === document.body || active.isConnected === false
        || Boolean(menu && menu !== opener && !menu.contains(opener) && menu.contains(active));
      if (lost) opener.focus?.({ preventScroll: true });
    };
  }, [isOpen, arrows]);
}

export default useMenuFocus;
