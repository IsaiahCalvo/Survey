import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const activeTrapStack = [];
const NESTED_LAYER_SELECTOR = [
  '[data-modal-focus-layer="true"]',
  '[role="dialog"][aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
].join(',');

/** Keep keyboard focus inside a mounted modal and return it to its opener. */
export default function useModalFocusTrap({ active, containerRef, initialFocusRef, returnFocusRef, onClose }) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;

    const returnFocus = returnFocusRef?.current || document.activeElement;
    const trap = { containerRef };
    activeTrapStack.push(trap);
    const isTopmost = () => activeTrapStack[activeTrapStack.length - 1] === trap;
    const isLayerAboveTrap = (layer) => {
      const trapIndex = activeTrapStack.indexOf(trap);
      const registeredIndex = activeTrapStack.findIndex((entry) => (
        entry.containerRef.current === layer || layer.contains(entry.containerRef.current)
      ));
      if (registeredIndex >= 0) return registeredIndex > trapIndex;
      // Unregistered menus, listboxes, and pickers only exist while open and
      // therefore sit above their owning modal.
      return true;
    };
    const isAllowedNestedLayer = (target) => {
      const layer = target?.closest?.(NESTED_LAYER_SELECTOR);
      return Boolean(layer && layer !== containerRef.current && isLayerAboveTrap(layer));
    };
    const hasActiveNestedLayer = () => Array.from(document.querySelectorAll(NESTED_LAYER_SELECTOR))
      .some((layer) => layer !== containerRef.current && isLayerAboveTrap(layer));
    const focusInitial = () => {
      const target = initialFocusRef?.current
        || containerRef.current?.querySelector(FOCUSABLE_SELECTOR)
        || containerRef.current;
      target?.focus?.({ preventScroll: true });
    };
    let focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      if (isTopmost()) focusInitial();
    });

    const onKeyDown = (event) => {
      if (!isTopmost()) return;
      // Some real nested surfaces (the shared colour picker and portalled
      // menus) do not install their own modal trap. They still own keyboard
      // handling while mounted, regardless of where focus happened to remain
      // when they opened. Yield before trapping Tab or closing this dialog.
      if (hasActiveNestedLayer()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(containerRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [])
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        containerRef.current?.focus?.({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const onFocusIn = (event) => {
      if (!isTopmost()) return;
      if (containerRef.current?.contains(event.target)) return;
      if (isAllowedNestedLayer(event.target)) return;
      focusInitial();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      if (focusFrame) cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      const wasTopmost = isTopmost();
      const index = activeTrapStack.lastIndexOf(trap);
      if (index >= 0) activeTrapStack.splice(index, 1);
      requestAnimationFrame(() => {
        if (!wasTopmost || !returnFocus?.isConnected) return;
        const currentTop = activeTrapStack[activeTrapStack.length - 1];
        if (currentTop && !currentTop.containerRef.current?.contains(returnFocus)) return;
        returnFocus.focus?.({ preventScroll: true });
      });
    };
  }, [active, containerRef, initialFocusRef, returnFocusRef]);
}
