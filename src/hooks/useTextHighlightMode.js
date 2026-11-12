/**
 * useTextHighlightMode — the Text group's "Highlight text" (Nightly
 * 'text-highlight-tool', Drawboard PDF Pro push 2026-11-12,
 * drawboard-trial/pdf-pro/apps-side-by-side.md A6).
 *
 * It rides Select text: while it is on, the live text selection is painted in
 * the highlight colour, so the band follows the pointer letter by letter as
 * you drag, and letting go makes it a highlight (one save, one Undo step,
 * through the same action the selection bar's Highlight runs). A selection
 * that is already highlighted is left alone (no accidental removal).
 */
import { useEffect, useRef } from 'react';

const STYLE_ID = 'survey-text-highlight-mode-style';

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [data-text-highlight-mode='true'] .pdfjsTextLayer ::selection { background: var(--text-highlight-live, rgba(245, 194, 41, 0.4)); }
    [data-text-highlight-mode='true'] .pdfjsTextLayer ::-moz-selection { background: var(--text-highlight-live, rgba(245, 194, 41, 0.4)); }
  `;
  document.head.appendChild(style);
}

/** '#rrggbb' + 0..100 opacity → 'rgba(r, g, b, a)'. */
export function liveHighlightPaint(color, opacity) {
  const hex = String(color || '').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return 'rgba(245, 194, 41, 0.4)';
  const n = parseInt(full, 16);
  const a = Math.max(0.15, Math.min(1, (Number(opacity) || 40) / 100));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function useTextHighlightMode({ on, wrapperRef, paint, getSelection, apply }) {
  const latest = useRef({ getSelection, apply });
  latest.current = { getSelection, apply };

  useEffect(() => {
    if (!on) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    ensureStyle();
    wrapper.setAttribute('data-text-highlight-mode', 'true');
    wrapper.style.setProperty('--text-highlight-live', liveHighlightPaint(paint?.color, paint?.opacity));
    let frame = 0;
    const onUp = (event) => {
      if (event.button !== 0) return;
      cancelAnimationFrame(frame);
      // Two frames: the viewer reads the finished selection first.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const selection = window.getSelection?.();
          if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
          const node = selection.anchorNode;
          const el = node?.nodeType === 1 ? node : node?.parentElement;
          if (!el || !wrapper.contains(el) || !el.closest('.pdfjsTextLayer')) return;
          const live = latest.current.getSelection?.();
          if (live?.activeMarkupTypes?.includes?.('highlight')) return;
          latest.current.apply?.();
        });
      });
    };
    window.addEventListener('pointerup', onUp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerup', onUp);
      wrapper.removeAttribute('data-text-highlight-mode');
      wrapper.style.removeProperty('--text-highlight-live');
    };
  }, [on, wrapperRef, paint?.color, paint?.opacity]);
}
