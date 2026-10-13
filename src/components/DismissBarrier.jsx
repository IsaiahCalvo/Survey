import { useEffect, useRef } from 'react';
import {
  OPENER_OR_FIELD_SELECTOR,
  TYPING_SELECTOR,
  consumeEvent,
  elementOf,
  recentPressedControl,
  registerLightPopover,
  swallowRestOfPress,
} from './dismissRules.js';

const resolvesInside = (target, insideRefs, insideSelector) => {
  const element = elementOf(target);
  if (!element) return false;

  if (insideSelector && element.closest(insideSelector)) return true;
  return insideRefs.some((entry) => {
    const node = entry?.current || entry;
    return typeof node?.contains === 'function' && node.contains(element);
  });
};

// R3 (owner 2026-09-23): "the first click out of an input field should just be
// a dismissal of that input field." While you are typing in a field INSIDE the
// protected surface, the first outside press (or Escape) only leaves the field
// (it blurs, which commits what you typed); the surface stays open, and the
// next outside press closes it as usual.
const typingInside = (insideRefs, insideSelector) => {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (!active || !active.matches?.(TYPING_SELECTOR)) return null;
  return resolvesInside(active, insideRefs, insideSelector) ? active : null;
};

/**
 * The shared outside-press contract. THE RULES LIVE IN ./dismissRules.js
 * (R1–R6, owner 2026-09-23) and docs/DISMISS-RULES.md.
 *
 * mode="light" (default) — a dropdown, menu, picker or other light popover.
 *   R1: a press outside closes it and the SAME press still does its job (opens
 *   the other dropdown, switches tool, presses the button, selects the
 *   annotation, focuses the field). Nothing is consumed.
 *   R2: a press on the bare PDF page is handled by the shared window guard in
 *   dismissRules.js — it closes this popover and the press goes no further.
 *   R3: while you type in a field inside this popover, the first outside press
 *   only leaves the field — except a press on another popover opener, another
 *   text field or `passthroughSelector`, which leaves the field, closes this
 *   popover and works at once.
 *   R5: Escape (topmost only) is routed through the shared registry.
 *   A press on the opener of this very popover (the control whose press
 *   opened it, or an expanded control whose aria-controls names it) only
 *   closes it, so the opener's own click cannot reopen it.
 *
 * mode="typing" — the surface IS a field you type in (a search box). R3 for
 *   the whole surface: the first outside press only leaves the field, except
 *   openers/fields/`passthroughSelector`, which also work at once.
 *
 * mode="blocking" — R4: the first outside press is consumed through its
 *   trailing click and only closes the surface.
 */
export default function DismissBarrier({
  active = true,
  onDismiss,
  insideRefs = [],
  insideSelector = '',
  passthroughSelector = '',
  dismissOnEscape = true,
  mode = 'light',
}) {
  // The control whose press opened this surface (see recentPressedControl).
  const openerRef = useRef(null);
  useEffect(() => {
    openerRef.current = active ? recentPressedControl() : null;
  }, [active]);

  // Callers pass inline refs arrays and arrow functions, so these change on
  // every render. The listeners read the latest values from here and register
  // ONCE per open: re-registering on each render would move this surface to
  // the top of the shared stack and let Escape (R5) close the wrong one.
  const propsRef = useRef(null);
  propsRef.current = { onDismiss, insideRefs, insideSelector, passthroughSelector };
  const canDismiss = typeof onDismiss === 'function';

  useEffect(() => {
    if (!active || typeof document === 'undefined' || !canDismiss) return undefined;

    const inside = (target) => resolvesInside(target, propsRef.current.insideRefs, propsRef.current.insideSelector);
    const typingField = () => typingInside(propsRef.current.insideRefs, propsRef.current.insideSelector);
    const dismiss = (event) => propsRef.current.onDismiss?.(event);
    const passesOwn = (target) => {
      const selector = propsRef.current.passthroughSelector;
      return Boolean(selector && elementOf(target)?.closest(selector));
    };
    const passesThrough = (target) => {
      const element = elementOf(target);
      if (!element) return false;
      return passesOwn(element) || Boolean(element.closest(OPENER_OR_FIELD_SELECTOR));
    };
    // A press on this surface's own opener only closes it (a toggle). The
    // opener is the control whose press opened it, or an expanded opener that
    // names this surface through aria-controls.
    const isOwnOpenOpener = (target) => {
      const element = elementOf(target);
      if (!element) return false;
      const opener = openerRef.current;
      if (opener && opener.isConnected !== false && opener.contains(element)) return true;
      const expanded = element.closest('[aria-expanded="true"][aria-controls]');
      const controlled = expanded && document.getElementById(expanded.getAttribute('aria-controls'));
      return Boolean(controlled && inside(controlled));
    };

    const onPointerDown = (event) => {
      if (inside(event.target)) return;
      const through = passesThrough(event.target);
      const field = typingField();
      // R3 (typing inside this surface, press not an exception) is decided by
      // the shared window guard in dismissRules.js before this runs; this is
      // the same answer for a press that reached here some other way.
      if (field && !through) {
        consumeEvent(event);
        swallowRestOfPress(event);
        field.blur();
        return;
      }
      if (mode === 'typing' && !through) {
        consumeEvent(event);
        swallowRestOfPress(event);
        dismiss(event);
        return;
      }
      if (mode === 'blocking' || (mode === 'light' && isOwnOpenOpener(event.target))) {
        consumeEvent(event);
        swallowRestOfPress(event);
        dismiss(event);
        return;
      }
      // R1: close, and let this same press do its job.
      field?.blur();
      dismiss(event);
    };

    // A click with no pointerdown before it (keyboard activation, a synthetic
    // click) is still an outside press: close, and keep R1 passthrough.
    let sawPointerDown = false;
    const markPointerDown = () => { sawPointerDown = true; };
    const onClick = (event) => {
      if (sawPointerDown) { sawPointerDown = false; return; }
      if (inside(event.target)) return;
      if (mode === 'blocking') consumeEvent(event);
      dismiss(event);
    };

    const unregister = registerLightPopover({
      kind: mode === 'typing' ? 'typing' : 'popover',
      close: (event) => dismiss(event),
      contains: (target) => inside(target),
      typingField,
      passes: (target) => passesOwn(target),
      escape: dismissOnEscape,
    });

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerdown', markPointerDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      unregister();
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerdown', markPointerDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [active, canDismiss, dismissOnEscape, mode]);

  return null;
}
