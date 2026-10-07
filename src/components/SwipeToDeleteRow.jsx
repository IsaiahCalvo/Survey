/**
 * SwipeToDeleteRow.jsx — phone swipe-left-to-delete (owner 2026-10-02).
 *
 * Wraps one list row. A finger dragging the row LEFT moves it 1:1 and
 * uncovers a trash action behind it (a 96px zone, rubber-banding past it).
 * Let go past half the zone and it snaps open; less and it snaps shut. Tap
 * the trash and the row folds away, then `onDelete` runs - the same delete
 * the row's own button or menu uses, with whatever confirm that path has.
 * If that path keeps the row (a confirm dialog), the row unfolds again.
 *
 * Touch only, so a desktop pointer never sees any of it (no hover nudge).
 * Only one row is open at a time; a touch anywhere else, a vertical scroll,
 * or a swipe on another row closes it. A tap on the open row itself only
 * closes it (no rename / expand). Rules that keep it out of the way:
 *   - it takes the gesture only after a clear horizontal move:
 *     |dx| > 8px and |dx| > |dy|; a vertical move first is a scroll;
 *   - the drag-to-reorder grip ([data-drag-rearrange-handle]) keeps dragging;
 *   - a focused text field keeps its own caret drag;
 *   - the row has touch-action: pan-y, so the WebView still scrolls it.
 * Reduced motion: the row jumps open / shut and is removed without folding.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icons.jsx';
import './SwipeToDeleteRow.css';

export const SWIPE_DELETE_ZONE = 96;
export const SWIPE_INTENT_SLOP = 8;
const SETTLE_MS = 240;
const COLLAPSE_MS = 220;

/* The one open row's close(), so opening another row closes it. */
let closeOpenRow = null;

/* iOS-style rubber band: the further past the edge, the less it gives. */
export const rubberBand = (overshoot, dimension) => {
  const c = 0.55;
  return (c * dimension * overshoot) / (dimension + c * overshoot);
};

/* Where the row sits for a finger offset `dx` from a start offset `base`. */
export function swipeOffset(base, dx, zone = SWIPE_DELETE_ZONE) {
  const x = base + dx;
  if (x > 0) return rubberBand(x, zone / 3);
  if (x < -zone) return -zone - rubberBand(-zone - x, zone);
  return x;
}

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const isEditable = (el) => Boolean(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));

export default function SwipeToDeleteRow({
  children,
  onDelete,
  label = 'Delete',
  disabled = false,
  className = '',
}) {
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const actionRef = useRef(null);
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;
  const [open, setOpen] = useState(false);
  const api = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    const action = actionRef.current;
    if (!root || !content || !action) return undefined;
    let mounted = true;
    let offset = 0;
    let isOpen = false;
    let g = null;
    let hideTimer = 0;
    let swallowUntil = 0;

    const place = (x, animate) => {
      offset = x;
      root.classList.toggle('is-dragging', !animate);
      content.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
      // The red always fills exactly what the row uncovers, trash centred in it.
      action.style.width = `${Math.max(0, -x)}px`;
      clearTimeout(hideTimer);
      if (x < 0) root.setAttribute('data-swipe-revealed', '');
      else if (!animate || reducedMotion()) root.removeAttribute('data-swipe-revealed');
      else hideTimer = setTimeout(() => { if (offset === 0) root.removeAttribute('data-swipe-revealed'); }, SETTLE_MS + 20);
    };
    const outside = (e) => {
      if (root.contains(e.target)) return;
      close();
    };
    const listenOutside = (on) => {
      const fn = on ? document.addEventListener : document.removeEventListener;
      fn.call(document, 'touchstart', outside, { capture: true, passive: true });
      fn.call(document, 'pointerdown', outside, { capture: true, passive: true });
      fn.call(document, 'scroll', outside, { capture: true, passive: true });
    };
    function close() {
      if (closeOpenRow === close) closeOpenRow = null;
      listenOutside(false);
      if (isOpen) { isOpen = false; if (mounted) setOpen(false); }
      if (offset !== 0) place(0, true);
    }
    const openRow = () => {
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
      place(-SWIPE_DELETE_ZONE, true);
      if (!isOpen) { isOpen = true; setOpen(true); }
      listenOutside(true);
    };
    const swallowClick = () => { swallowUntil = Date.now() + 450; };

    const onStart = (e) => {
      if (disabled || e.touches.length !== 1) { g = null; return; }
      const t = e.target;
      if (t.closest?.('.swipe-row__action')) { g = null; return; }
      if (t.closest?.('[data-drag-rearrange-handle]')) { g = null; if (isOpen) close(); return; }
      const active = document.activeElement;
      if (isEditable(active) && (active === t || active.contains(t))) { g = null; return; }
      const p = e.touches[0];
      g = { x0: p.clientX, y0: p.clientY, base: offset, mode: 'pending', wasOpen: isOpen };
    };
    const onMove = (e) => {
      if (!g || g.mode === 'scroll') return;
      const p = e.touches[0];
      const dx = p.clientX - g.x0;
      const dy = p.clientY - g.y0;
      if (g.mode === 'pending') {
        if (Math.abs(dx) > SWIPE_INTENT_SLOP && Math.abs(dx) > Math.abs(dy)) {
          g.mode = 'swipe';
          if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
        } else if (Math.abs(dy) > SWIPE_INTENT_SLOP) {
          g.mode = 'scroll';
          if (isOpen) close();
          return;
        } else return;
      }
      if (e.cancelable) e.preventDefault();
      place(swipeOffset(g.base, dx), false);
    };
    const settle = () => {
      if (-offset > SWIPE_DELETE_ZONE / 2) openRow();
      else close();
    };
    const onEnd = (e) => {
      if (!g) return;
      const { mode, wasOpen } = g;
      g = null;
      if (mode === 'swipe') {
        if (e.cancelable) e.preventDefault();
        swallowClick();
        settle();
      } else if (mode === 'pending' && wasOpen) {
        // A tap on the open row only closes it - no rename, no expand.
        if (e.cancelable) e.preventDefault();
        swallowClick();
        close();
      }
    };
    const onCancel = () => {
      if (g && g.mode === 'swipe') settle();
      g = null;
    };
    const onClickCapture = (e) => {
      if (Date.now() < swallowUntil && !e.target.closest?.('.swipe-row__action')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: false });
    root.addEventListener('touchcancel', onCancel, { passive: true });
    root.addEventListener('click', onClickCapture, true);

    api.current = {
      close,
      collapse: () => {
        listenOutside(false);
        if (closeOpenRow === close) closeOpenRow = null;
        const restore = () => {
          if (!mounted) return;
          root.classList.remove('is-collapsing');
          root.style.height = '';
          close();
        };
        const remove = async () => {
          try { await onDeleteRef.current?.(); } finally {
            // Still here: the delete path kept the row (a confirm) - unfold.
            setTimeout(restore, 60);
          }
        };
        if (reducedMotion()) { remove(); return; }
        root.style.height = `${root.offsetHeight}px`;
        void root.offsetHeight;
        root.classList.add('is-collapsing');
        root.style.height = '0px';
        setTimeout(remove, COLLAPSE_MS);
      },
    };

    return () => {
      // Leaving (or Select mode turning the swipe off): the row sits shut.
      if (isOpen) setOpen(false);
      mounted = false;
      content.style.transform = '';
      root.removeAttribute('data-swipe-revealed');
      root.classList.remove('is-dragging');
      clearTimeout(hideTimer);
      listenOutside(false);
      if (closeOpenRow === close) closeOpenRow = null;
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onCancel);
      root.removeEventListener('click', onClickCapture, true);
    };
  }, [disabled]);

  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    api.current?.collapse();
  }, []);

  return (
    <div ref={rootRef} className={`swipe-row${className ? ` ${className}` : ''}`} data-swipe-open={open ? 'true' : undefined}>
      <button
        ref={actionRef}
        type="button"
        className="swipe-row__action"
        aria-label={label}
        title={label}
        aria-hidden={open ? undefined : 'true'}
        tabIndex={open ? 0 : -1}
        onClick={handleDelete}
      >
        <Icon name="trash" size={20} color="currentColor" />
      </button>
      <div ref={contentRef} className="swipe-row__content">{children}</div>
    </div>
  );
}
