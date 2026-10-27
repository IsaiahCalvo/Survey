/**
 * SwipeActionsRow.jsx — slide a list row to act on it (owner 2026-10-27, from
 * the EDC tracker's account list; grew out of the 2026-10-02 phone
 * swipe-to-delete on Templates).
 *
 * Wraps one list row. Slide it LEFT and its actions show behind it on the
 * right, in the select-mode order with Delete at the far right (the rules and
 * numbers are src/utils/swipeActions.js):
 *
 *   [ row content .................... ]
 *   [ row content ....... ][Share][Delete]   (as many as fit ~60% of the
 *                                             row; the rest go under More)
 *
 *   - Finger or pen: the row follows 1:1. Let go past half the tray and it
 *     stays open; less and it shuts. Keep going past half the row (a short
 *     buzz where the phone can) and Delete stretches across - let go and the
 *     row is deleted. A hard flick does the same.
 *   - Trackpad (desktop): a two-finger sideways swipe over the row opens and
 *     shuts it the same way; it never deletes on its own.
 *   - Mouse: nothing new (rows keep their drag-to-reorder); the row's own
 *     menu and right-click stay the desktop way in.
 *
 * Delete folds the row away and then runs the list's own delete, which moves
 * things to Archive or offers Undo - never a confirm. If that path keeps the
 * row, it unfolds again. Other actions shut the row and run. "More" opens a
 * menu with the actions that did not fit.
 *
 * Only one row is open at a time; a touch anywhere else, a scroll, Escape or
 * a swipe on another row shuts it, and a tap on the open row only shuts it.
 * Rules that keep it out of the way:
 *   - it takes the gesture only after a clear sideways move (8px, more
 *     sideways than up/down); an up/down move first is a scroll;
 *   - a drag-to-reorder grip ([data-drag-rearrange-handle] / [data-drag-handle])
 *     keeps dragging;
 *   - a focused text field keeps its own caret drag;
 *   - touch-action: pan-y, so the page still scrolls under a finger;
 *   - a trackpad swipe inside a sideways-scrolling box scrolls that box.
 * Reduced motion: the row jumps open / shut and goes without folding.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icons.jsx';
import { useTooltip } from './Tooltip';
import ListItemContextMenu from './ListItemContextMenu';
import { activateOrExplain } from '../utils/disabledReasonToast.js';
import { watchLightPopover } from './dismissRules.js';
import {
  SWIPE_ACTION_WIDTH,
  SWIPE_COMPACT_ACTION_WIDTH,
  SWIPE_COMPACT_ROW_HEIGHT,
  SWIPE_FULL_HYSTERESIS,
  SWIPE_INTENT_SLOP,
  canFullSwipe,
  fullSwipeThreshold,
  layoutSwipeSlots,
  releaseVelocity,
  revealAmount,
  settleSwipe,
  swipeOffset,
  swipeSlotBudget,
} from '../utils/swipeActions.js';
import './SwipeActionsRow.css';

export { buildSwipeActions } from '../utils/swipeActions.js';

const SETTLE_MS = 260;
const COLLAPSE_MS = 220;
const WHEEL_IDLE_MS = 140;
const WHEEL_QUIET_MS = 260;

/* The one open row's close(), so opening another row closes it. */
let closeOpenRow = null;

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const isEditable = (el) => Boolean(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'));
const scrollsSideways = (el, stop) => {
  for (let node = el; node && node !== stop && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const { overflowX } = getComputedStyle(node);
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
  }
  return false;
};

export default function SwipeActionsRow({
  children,
  actions,
  label = '',
  disabled = false,
  className = '',
  as: Tag = 'div',
  ...rest
}) {
  const tip = useTooltip();
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const trayRef = useRef(null);
  // The row's measured size picks how many actions show and how wide.
  const [box, setBox] = useState({ width: 0, compact: false });
  const compact = box.compact;
  const slots = layoutSwipeSlots(actions, swipeSlotBudget(box.width, compact ? SWIPE_COMPACT_ACTION_WIDTH : SWIPE_ACTION_WIDTH));
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const full = canFullSwipe(slots);
  const off = disabled || slots.length === 0;
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const api = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || off || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      // A folding row (Delete) must not re-measure itself out of its fold.
      if (!entry || root.classList.contains('is-collapsing')) return;
      const width = Math.round(entry.contentRect.width);
      const isCompact = entry.contentRect.height > 0 && entry.contentRect.height < SWIPE_COMPACT_ROW_HEIGHT;
      setBox((prev) => (prev.width === width && prev.compact === isCompact ? prev : { width, compact: isCompact }));
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [off]);

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    const tray = trayRef.current;
    if (!root || !content || !tray || off) return undefined;
    let mounted = true;
    let offset = 0;
    let isOpen = false;
    let armed = false;
    let g = null;
    let w = null;
    let wheelTimer = 0;
    let wheelQuietUntil = 0;
    let hideTimer = 0;
    let swallowUntil = 0;
    let busy = false;

    const n = () => slotsRef.current.length;
    const actionWidth = () => (compact ? SWIPE_COMPACT_ACTION_WIDTH : SWIPE_ACTION_WIDTH);
    const reveal = () => n() * actionWidth();
    const rowWidth = () => root.offsetWidth || 320;

    const place = (x, animate) => {
      offset = x;
      root.classList.toggle('is-dragging', !animate);
      const aw = actionWidth();
      content.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
      const width = Math.max(0, -x);
      tray.style.width = `${width}px`;
      tray.style.setProperty('--swipe-reveal', String(armed ? 1 : revealAmount(width, n(), aw)));
      clearTimeout(hideTimer);
      if (x < 0) root.setAttribute('data-swipe-revealed', '');
      else if (!animate || reducedMotion()) root.removeAttribute('data-swipe-revealed');
      else hideTimer = setTimeout(() => { if (offset === 0) root.removeAttribute('data-swipe-revealed'); }, SETTLE_MS + 20);
    };
    const arm = (on, buzz) => {
      if (on === armed) return;
      armed = on;
      tray.toggleAttribute('data-full', on);
      if (on && buzz) { try { navigator.vibrate?.(8); } catch { /* no haptics */ } }
    };
    /* An open row is a light popover (dismissRules.js): a press elsewhere
       shuts it and still does its own job, a press on bare page only shuts
       it, and Escape shuts only the row, not the sheet or panel it sits in.
       A scroll shuts it too. */
    let unwatch = null;
    const onScroll = (e) => { if (!root.contains(e.target)) close(); };
    const listenOutside = (on) => {
      if (on && !unwatch) {
        const stop = watchLightPopover({
          contains: (el) => root.contains(el) || Boolean(el.closest('[role="menu"]')),
          close: () => close(),
        });
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        unwatch = () => { stop(); document.removeEventListener('scroll', onScroll, { capture: true }); };
      } else if (!on && unwatch) {
        unwatch();
        unwatch = null;
      }
    };
    function close() {
      if (closeOpenRow === close) closeOpenRow = null;
      listenOutside(false);
      arm(false);
      if (isOpen) { isOpen = false; if (mounted) setOpen(false); }
      if (offset !== 0) place(0, true);
    }
    const openRow = () => {
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
      arm(false);
      place(-reveal(), true);
      if (!isOpen) { isOpen = true; setOpen(true); }
      listenOutside(true);
    };
    const claim = () => { if (closeOpenRow && closeOpenRow !== close) closeOpenRow(); };
    const swallowClick = () => { swallowUntil = Date.now() + 450; };

    // Slide the row out, fold it shut, then run `run`. Unfolds if it stays.
    const collapse = (run) => {
      if (busy) return;
      busy = true;
      listenOutside(false);
      if (closeOpenRow === close) closeOpenRow = null;
      const restore = () => {
        busy = false;
        if (!mounted) return;
        root.classList.remove('is-collapsing');
        root.style.height = '';
        close();
      };
      const finish = async () => {
        try { await run?.(); } finally { setTimeout(restore, 60); }
      };
      if (reducedMotion()) { finish(); return; }
      arm(true);
      place(-(rowWidth() + 2), true);
      setTimeout(() => {
        if (!mounted) return;
        root.style.height = `${root.offsetHeight}px`;
        void root.offsetHeight;
        root.classList.add('is-collapsing');
        root.style.height = '0px';
        setTimeout(finish, COLLAPSE_MS);
      }, 120);
    };
    const runSlot = (slot, anchor) => {
      if (!slot || busy) return;
      if (slot.overflow) {
        const r = anchor?.getBoundingClientRect?.();
        close();
        setMenu({
          point: r ? { x: r.left, y: r.bottom + 4 } : { x: 16, y: 16 },
          items: slot.overflow.map((a) => ({
            label: a.label,
            danger: a.danger,
            onClick: () => activateOrExplain(a.reason, a.onSelect),
          })),
        });
        return;
      }
      if (slot.reason) { close(); activateOrExplain(slot.reason, null); return; }
      if (slot.danger) { collapse(slot.onSelect); return; }
      close();
      // The row itself anchors anything the action opens (a menu, a picker).
      slot.onSelect?.(content);
    };

    /* ---- finger / pen ---------------------------------------------------- */
    const onDown = (e) => {
      if (e.pointerType === 'mouse' || !e.isPrimary || busy) { g = null; return; }
      const t = e.target;
      if (t.closest?.('.swipe-row__tray')) { g = null; return; }
      if (t.closest?.('[data-drag-rearrange-handle], [data-drag-handle]')) { g = null; if (isOpen) close(); return; }
      const active = document.activeElement;
      if (isEditable(active) && (active === t || active.contains(t))) { g = null; return; }
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: offset, mode: 'pending', wasOpen: isOpen, samples: [[e.timeStamp, e.clientX]] };
    };
    const onMove = (e) => {
      if (!g || g.id !== e.pointerId || g.mode === 'scroll') return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (g.mode === 'pending') {
        if (Math.hypot(dx, dy) < SWIPE_INTENT_SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          g.mode = 'scroll';
          if (isOpen) close();
          return;
        }
        // Rightward on a shut row is not ours (the phone's edge-swipe back).
        if (dx > 0 && g.base === 0) { g.mode = 'scroll'; return; }
        g.mode = 'swipe';
        g.x0 = e.clientX;
        claim();
        try { root.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      }
      if (e.cancelable) e.preventDefault();
      const rw = rowWidth();
      const rv = reveal();
      const x = swipeOffset(g.base, e.clientX - g.x0, { reveal: rv, rowWidth: rw, full });
      if (full) {
        const line = fullSwipeThreshold(rv, rw);
        arm(-x > (armed ? line - SWIPE_FULL_HYSTERESIS : line), true);
      }
      place(x, false);
      g.samples.push([e.timeStamp, e.clientX]);
      if (g.samples.length > 12) g.samples.shift();
    };
    const onUp = (e) => {
      if (!g || g.id !== e.pointerId) return;
      const { mode, wasOpen, samples } = g;
      g = null;
      if (mode === 'swipe') {
        swallowClick();
        samples.push([e.timeStamp, e.clientX]);
        const verdict = settleSwipe({
          offset, velocity: releaseVelocity(samples), reveal: reveal(), rowWidth: rowWidth(), full, armed,
        });
        if (verdict === 'full') runSlot(slotsRef.current[n() - 1]);
        else if (verdict === 'open') openRow();
        else close();
      } else if (mode === 'pending' && wasOpen) {
        // A tap on the open row only closes it - no rename, no open.
        swallowClick();
        close();
      }
    };
    const onCancel = (e) => {
      if (!g || g.id !== e.pointerId) return;
      const { mode } = g;
      g = null;
      if (mode !== 'swipe') return;
      arm(false);
      if (-offset > reveal() / 2) openRow(); else close();
    };
    const onClickCapture = (e) => {
      if (Date.now() < swallowUntil && !e.target.closest?.('.swipe-row__tray')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    /* ---- trackpad: two-finger sideways swipe ----------------------------- */
    const endWheel = () => {
      if (!w) return;
      const { lastDx } = w;
      w = null;
      wheelQuietUntil = Date.now() + WHEEL_QUIET_MS;
      const travel = -offset;
      // A swipe that was still heading left opens a bit earlier than half.
      if (travel > reveal() * (lastDx > 0 ? 0.35 : 0.5)) openRow();
      else close();
    };
    const onWheel = (e) => {
      if (e.ctrlKey || busy) return;
      const dx = e.deltaX;
      if (!w) {
        // An up/down scroll over an open row shuts it (the list scrolls on).
        if (isOpen && Math.abs(e.deltaY) > Math.abs(dx)) { close(); return; }
        if (Math.abs(dx) < 2 || Math.abs(dx) <= Math.abs(e.deltaY)) return;
        if (Date.now() < wheelQuietUntil) { if (e.cancelable) e.preventDefault(); return; }
        if (scrollsSideways(e.target, root.parentElement)) return;
        w = { base: offset, acc: 0, lastDx: 0 };
        claim();
      }
      if (e.cancelable) e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      w.acc -= dx * unit;
      if (dx) w.lastDx = dx;
      place(swipeOffset(w.base, w.acc, { reveal: reveal(), rowWidth: rowWidth(), full: false }), false);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(endWheel, WHEEL_IDLE_MS);
    };

    root.addEventListener('pointerdown', onDown, { passive: true });
    root.addEventListener('pointermove', onMove, { passive: false });
    root.addEventListener('pointerup', onUp, { passive: true });
    root.addEventListener('pointercancel', onCancel, { passive: true });
    root.addEventListener('click', onClickCapture, true);
    root.addEventListener('wheel', onWheel, { passive: false });

    api.current = { runSlot };

    return () => {
      // Leaving (or Select mode turning the swipe off): the row sits shut.
      if (isOpen) setOpen(false);
      mounted = false;
      api.current = null;
      content.style.transform = '';
      tray.style.width = '';
      tray.removeAttribute('data-full');
      root.removeAttribute('data-swipe-revealed');
      root.classList.remove('is-dragging', 'is-collapsing');
      root.style.height = '';
      clearTimeout(hideTimer);
      clearTimeout(wheelTimer);
      listenOutside(false);
      if (closeOpenRow === close) closeOpenRow = null;
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onCancel);
      root.removeEventListener('click', onClickCapture, true);
      root.removeEventListener('wheel', onWheel);
    };
  }, [off, full, slots.length, compact]);

  const press = useCallback((index) => (e) => {
    e.stopPropagation();
    api.current?.runSlot(slotsRef.current[index], e.currentTarget);
  }, []);

  if (slots.length === 0) {
    return <Tag className={className || undefined} {...rest}>{children}</Tag>;
  }

  return (
    <Tag
      ref={rootRef}
      className={`swipe-row${off ? ' is-off' : ''}${className ? ` ${className}` : ''}`}
      data-swipe-open={open ? 'true' : undefined}
      data-swipe-compact={compact ? '' : undefined}
      {...rest}
      style={{ ...rest.style, '--swipe-action-w': `${compact ? SWIPE_COMPACT_ACTION_WIDTH : SWIPE_ACTION_WIDTH}px` }}
    >
      <div
        ref={trayRef}
        className="swipe-row__tray"
        role="group"
        aria-label={label ? `Actions for ${label}` : 'Row actions'}
        aria-hidden={open ? undefined : 'true'}
      >
        {slots.map((slot, index) => (
          <button
            key={slot.key}
            type="button"
            className="swipe-row__action"
            data-swipe-action={slot.key}
            data-tone={slot.danger ? 'danger' : 'neutral'}
            aria-label={slot.overflow ? 'More actions' : slot.label}
            aria-haspopup={slot.overflow ? 'menu' : undefined}
            aria-disabled={slot.reason ? true : undefined}
            {...tip(slot.reason || (slot.overflow ? 'More actions' : slot.label), 'below')}
            tabIndex={open ? 0 : -1}
            onClick={press(index)}
          >
            <span className="swipe-row__glyph" aria-hidden="true">
              <Icon name={slot.icon} size={20} color="currentColor" />
              <span className="swipe-row__label">{slot.label}</span>
            </span>
          </button>
        ))}
      </div>
      <div ref={contentRef} className="swipe-row__content">{children}</div>
      {menu ? <ListItemContextMenu point={menu.point} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </Tag>
  );
}
