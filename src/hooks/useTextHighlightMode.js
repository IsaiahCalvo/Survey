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
 *
 * Nightly 'text-markup-tools' (owner 2026-11-13, "nothing can be missing"):
 * Drawboard's Underline, Squiggle, Strikethrough and Redact text tools work
 * the same way, so `kind` names the mark the release makes ('highlight',
 * 'underline', 'squiggly', 'strikeout' or 'redact'). While dragging, the
 * selection is tinted in that tool's colour.
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

// Nightly 'text-review-remove': 'remove' takes the review marks off the words
// instead of adding one.
export const TEXT_DRAG_KINDS = Object.freeze(['highlight', 'underline', 'squiggly', 'strikeout', 'redact', 'remove']);

/** The drag kind a mode value stands for: true (the first, highlight-only
 * build) and unknown strings read as 'highlight'; false/null read as null. */
export function textDragKindOf(mode) {
  if (!mode) return null;
  return TEXT_DRAG_KINDS.includes(mode) ? mode : 'highlight';
}

/** The live tint for a kind: highlight shows its own band; the line marks
 * show a lighter wash of their colour, since the line itself is drawn on
 * release; redact shows a dark wash. */
export function liveDragPaint(kind, paint) {
  if (kind === 'redact') return 'rgba(0, 0, 0, 0.35)';
  if (kind === 'remove') return 'rgba(148, 163, 184, 0.35)';
  if (kind && kind !== 'highlight') return liveHighlightPaint(paint?.color, 25);
  return liveHighlightPaint(paint?.color, paint?.opacity);
}

const CHROME = 'button, a, input, textarea, select, [role="toolbar"], [role="menu"], [role="menuitem"], [role="dialog"]';

/** True when a release lands on a control (the selection bar, a menu, a dialog). */
export function releasedOnChrome(event) {
  const target = event?.target;
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  return Boolean(el?.closest?.(CHROME));
}

export function useTextHighlightMode({ on, wrapperRef, kind = 'highlight', paint, getSelection, apply }) {
  const latest = useRef({ getSelection, apply });
  latest.current = { getSelection, apply };

  useEffect(() => {
    if (!on) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    ensureStyle();
    wrapper.setAttribute('data-text-highlight-mode', 'true');
    wrapper.style.setProperty('--text-highlight-live', liveDragPaint(kind, paint));
    let frame = 0;
    const onUp = (event) => {
      if (event.button !== 0) return;
      // A click on the selection bar or other chrome is not the end of a drag.
      if (releasedOnChrome(event)) return;
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
          if (kind !== 'redact' && kind !== 'remove' && live?.activeMarkupTypes?.includes?.(kind)) return;
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
  }, [on, wrapperRef, kind, paint?.color, paint?.opacity]);
}
