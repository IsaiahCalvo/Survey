/**
 * useFocusTrap.js — the app's single modal keyboard-accessibility primitive.
 *
 * Named export `useFocusTrap(containerRef, isOpen, { onEscape, autoFocus })`.
 * While `isOpen`, it gives a dialog the four behaviours a keyboard-only user
 * needs, none of which the browser provides for a div-based overlay:
 *
 *   1. Tab / Shift-Tab cycle only through the container's focusable controls,
 *      so focus can never land on the page behind the overlay.
 *   2. Escape calls `onEscape` (usually the modal's own close handler).
 *   3. On open, focus moves to the first sensible control inside the dialog.
 *   4. On close, focus returns to whatever element opened the dialog.
 *
 * UX intent: a dialog is a hard modal context — everything behind it is inert
 * until it's dismissed, and dismissing it puts the user back exactly where they
 * were. Reference behaviour: the native <dialog showModal()> contract, which we
 * can't use directly because these overlays are portalled/animated divs.
 *
 * Opting out of the initial focus move (e.g. a purely informational banner)
 * is `autoFocus: false`. To choose which control gets that initial focus, mark
 * it `data-autofocus` — otherwise the first text field wins, then the first
 * focusable element of any kind (close buttons included, as a last resort).
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Visible + focusable only: display:none / hidden subtrees report a zero-size
// client rect, and aria-hidden branches are invisible to assistive tech.
const isReachable = (el) => (
  !el.hasAttribute('disabled')
  && el.getAttribute('aria-hidden') !== 'true'
  && !el.closest('[aria-hidden="true"]')
  && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
);

const focusableWithin = (container) => (
  container ? Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isReachable) : []
);

export const useFocusTrap = (containerRef, isOpen, { onEscape, autoFocus = true } = {}) => {
  // Callers commonly pass an inline arrow for onEscape, so the key effect below
  // re-runs on most renders. Opener capture and the initial focus move live in
  // their own isOpen-only effect so neither repeats mid-dialog.
  const openerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    openerRef.current = document.activeElement;

    // Move focus in. Deferred a frame so portals/animations have painted and
    // the container's children are actually measurable (isReachable needs a box).
    let focusFrame = 0;
    if (autoFocus) {
      focusFrame = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container || container.contains(document.activeElement)) return;
        const focusable = focusableWithin(container);
        const preferred = container.querySelector('[data-autofocus]')
          || focusable.find((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
          || focusable[0];
        preferred?.focus?.();
      });
    }

    return () => {
      if (focusFrame) cancelAnimationFrame(focusFrame);
      openerRef.current?.focus?.();
      openerRef.current = null;
    };
  }, [containerRef, isOpen, autoFocus]);

  useEffect(() => {
    if (!isOpen) return undefined;

    // Capture phase so the dialog wins over app-level hotkeys, and
    // stopPropagation so an Escape aimed at this dialog doesn't also cancel
    // whatever tool/selection is live underneath it.
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = focusableWithin(container);
      if (!focusable.length) {
        // Nothing to land on — keep focus pinned rather than letting it escape.
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it somehow started outside.
      if (!container.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [containerRef, isOpen, onEscape]);
};

export default useFocusTrap;
