import { useEffect } from 'react';

const eventTargetElement = (target) => (
  target instanceof Element ? target : target?.parentElement || null
);

const resolvesInside = (target, insideRefs, insideSelector) => {
  const element = eventTargetElement(target);
  if (!element) return false;

  if (insideSelector && element.closest(insideSelector)) return true;
  return insideRefs.some((entry) => {
    const node = entry?.current || entry;
    return typeof node?.contains === 'function' && node.contains(element);
  });
};

const consume = (event) => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
};

/**
 * Capture-phase outside-dismiss contract.
 *
 * The first pointer gesture outside a protected surface is consumed through
 * its trailing click. This matters because closing state during pointerdown
 * otherwise unmounts the listener before click, allowing the same physical
 * tap to activate the row or control underneath. Explicit controls may opt
 * into passthrough: they dismiss first but keep their intentional click.
 */
export default function DismissBarrier({
  active = true,
  onDismiss,
  insideRefs = [],
  insideSelector = '',
  passthroughSelector = '',
  dismissOnEscape = true,
}) {
  useEffect(() => {
    if (!active || typeof document === 'undefined' || typeof onDismiss !== 'function') return undefined;

    let trailingClickCleanup = null;
    const clearTrailingClick = () => {
      trailingClickCleanup?.();
      trailingClickCleanup = null;
    };
    const armTrailingClickBlocker = () => {
      clearTrailingClick();
      let timeoutId;
      const onTrailingClick = (event) => {
        consume(event);
        clearTrailingClick();
      };
      trailingClickCleanup = () => {
        document.removeEventListener('click', onTrailingClick, true);
        window.clearTimeout(timeoutId);
      };
      document.addEventListener('click', onTrailingClick, true);
      timeoutId = window.setTimeout(clearTrailingClick, 900);
    };
    const onPointerDown = (event) => {
      if (resolvesInside(event.target, insideRefs, insideSelector)) return;
      if (passthroughSelector && eventTargetElement(event.target)?.closest(passthroughSelector)) {
        onDismiss(event);
        return;
      }
      consume(event);
      armTrailingClickBlocker();
      onDismiss(event);
    };
    const onClick = (event) => {
      if (resolvesInside(event.target, insideRefs, insideSelector)) return;
      if (passthroughSelector && eventTargetElement(event.target)?.closest(passthroughSelector)) {
        onDismiss(event);
        return;
      }
      consume(event);
      onDismiss(event);
    };
    const onKeyDown = (event) => {
      if (!dismissOnEscape || event.key !== 'Escape') return;
      consume(event);
      onDismiss(event);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      // Deliberately leave an armed trailing-click blocker alive. Dismissal
      // usually unmounts this component during pointerdown; removing the
      // blocker here would let that same physical gesture click through.
    };
  }, [active, dismissOnEscape, insideRefs, insideSelector, onDismiss, passthroughSelector]);

  return null;
}
