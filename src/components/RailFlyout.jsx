import { useLayoutEffect, useRef } from 'react';
import './RailFlyout.css';

/**
 * A pop-up that flies out of the desktop right rail: Page fit, Page grid
 * (owner 2026-11-10: the rail's pop-ups "don't look integrated or
 * professional"). Both used to float on their own terms: the fit list hung
 * off its button with no title, and the grid card was centred on its button,
 * so half of it covered the rail it came from.
 *
 * Intended UX, like Drawboard's View settings card: one card look for every
 * rail pop-up, a short title, standing a fixed gap left of the rail's edge
 * (never over the rail), its bottom level with the button that opened it, and
 * growing out of that corner. Put it inside a positioned wrapper that also
 * holds the button.
 */
export default function RailFlyout({ title, headerEnd = null, cardRef = null, className = '', gap = 8, children, ...rest }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const card = ref.current;
    const host = card?.offsetParent;
    if (!card || !host) return;
    // The rail column's left edge, not the button's: every rail pop-up then
    // stands the same distance off the rail, whatever the button's width.
    const rail = host.closest('[data-chrome-rail="true"]') || host;
    const hostRect = host.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    card.style.right = `${Math.round(hostRect.right - railRect.left + gap)}px`;
    // Bottom level with the button; slid down only if the top would leave
    // the window.
    const top = hostRect.bottom - card.offsetHeight;
    card.style.bottom = top < 8 ? `${Math.round(top - 8)}px` : '0px';
  });

  const setRef = (node) => {
    ref.current = node;
    if (typeof cardRef === 'function') cardRef(node);
    else if (cardRef) cardRef.current = node;
  };

  return (
    <div ref={setRef} className={`rail-flyout${className ? ` ${className}` : ''}`} {...rest}>
      {title && (
        <div className="rail-flyout__head">
          <span className="rail-flyout__title">{title}</span>
          {headerEnd}
        </div>
      )}
      {children}
    </div>
  );
}
