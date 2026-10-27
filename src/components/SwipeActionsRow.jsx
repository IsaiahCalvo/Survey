/**
 * SwipeActionsRow.jsx — slide a list row to act on it. A copy of the EDC
 * tracker's account list the owner shared (2026-10-27): the same gesture,
 * numbers and motion (the rules are src/utils/swipeActions.js).
 *
 *   slide left:   [ row content ......... ][  Delete  ]
 *   slide right:  [  Share  ][ row content ......... ]
 *
 *   - One action per side: Delete on the right (danger fill), one everyday
 *     action (Duplicate, Move, Copy or Share) on the left. Everything else
 *     stays in the row's own menu.
 *   - The action is a solid block riding the row's edge; its icon fades and
 *     grows in, then its label. Let go past half of it and the row sits
 *     open; less and it shuts. Keep going past ~56% of the row (a short buzz
 *     where the phone can) and the block takes the whole strip - let go and
 *     the action runs. A hard flick does the same.
 *   - Finger, pen AND mouse (desktop): press and drag the row sideways, as
 *     in the HTML. On a row the browser drags itself ([draggable], drag a
 *     document onto a project) a mouse drag that starts sideways swipes and
 *     any other drag keeps dragging.
 *   - No-bounce springs: 0.26s to open / shut, 0.4s to slide away.
 *
 * Delete slides the row out, folds it shut, then runs the list's own delete
 * (Archive or Undo - never a confirm). If that keeps the row, it comes back.
 * Only one row is open at a time; a press elsewhere, a scroll, Escape or a
 * swipe on another row shuts it, and a tap on the open row only shuts it.
 * It keeps out of the way: it takes the gesture only after a clear sideways
 * move (8px, more sideways than up/down); a reorder grip keeps dragging; a
 * focused text field keeps its caret; touch-action: pan-y keeps scrolling.
 * Reduced motion: the row jumps open / shut and goes without folding.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icons.jsx';
import { useTooltip } from './Tooltip';
import { activateOrExplain } from '../utils/disabledReasonToast.js';
import { watchLightPopover } from './dismissRules.js';
import {
  SWIPE_ACTION_WIDTH,
  SWIPE_COMPACT_ROW_HEIGHT,
  SWIPE_FULL_HYSTERESIS,
  SWIPE_INTENT_SLOP,
  SWIPE_SPRING,
  canFullSwipe,
  fullSwipeThreshold,
  layerFrame,
  releaseVelocity,
  settleSwipe,
  splitSwipeSides,
  springAt,
  swipeOffset,
  swipeSide,
} from '../utils/swipeActions.js';
import './SwipeActionsRow.css';

export { buildSwipeActions } from '../utils/swipeActions.js';

const FOLD_DELAY_MS = 120;
const FOLD_MS = 400;
/* The phone's own back gesture starts this close to the screen's left edge. */
const EDGE_BACK_PX = 24;

/* The one open row's close(), so opening another row closes it. */
let closeOpenRow = null;

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const isEditable = (el) => Boolean(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'));

/* A value moved by a no-bounce spring, one frame at a time. */
function makeSpring(apply) {
  let value = 0;
  let frame = 0;
  let done = null;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; done = null; };
  return {
    get: () => value,
    jump(v) { stop(); value = v; apply(); },
    stop,
    to(target, { duration, velocity = 0, onComplete } = {}) {
      stop();
      if (reducedMotion() || Math.abs(target - value) < 0.5) {
        value = target;
        apply();
        onComplete?.();
        return;
      }
      const from = value;
      const start = performance.now();
      done = onComplete || null;
      const step = (now) => {
        const s = springAt({ from, to: target, velocity, duration, t: (now - start) / 1000 });
        if (Math.abs(s.value - target) < 0.5 && Math.abs(s.velocity) < 10) {
          value = target;
          apply();
          const finish = done;
          frame = 0;
          done = null;
          finish?.();
          return;
        }
        value = s.value;
        apply();
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
  };
}

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
  const sides = splitSwipeSides(actions);
  const sidesRef = useRef(sides);
  sidesRef.current = sides;
  const count = sides.leading.length + sides.trailing.length;
  const off = disabled || count === 0;
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const api = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || off || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      // A folding row (Delete) must not re-measure itself out of its fold.
      if (!entry || root.hasAttribute('data-removing')) return;
      const h = entry.contentRect.height;
      setCompact(h > 0 && h < SWIPE_COMPACT_ROW_HEIGHT);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [off]);

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content || off) return undefined;
    let mounted = true;
    let g = null;
    let armed = false;
    let coverRank = null;
    let coverSide = null;
    let isOpen = false;
    let removing = false;
    let swallowUntil = 0;
    let foldTimer = 0;

    const list = (side) => (side === 'leading' ? sidesRef.current.leading : sidesRef.current.trailing);
    const rowWidth = () => root.offsetWidth || 320;
    const layers = () => root.querySelectorAll(':scope > .swipe-row__layer');

    const paint = () => {
      const x = xs.get();
      const c = cs.get();
      content.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
      root.toggleAttribute('data-swipe-revealed', x !== 0);
      layers().forEach((el) => {
        const side = el.dataset.side;
        const n = list(side).length;
        const rank = Number(el.dataset.rank);
        const f = layerFrame({ x, side, rank, count: n, coverRank: coverSide === side ? coverRank : null, cover: c });
        el.style.transform = `translate3d(${f.layerX}px, 0, 0)`;
        el.style.setProperty('--swipe-anchor-x', `${f.anchorX}px`);
        el.style.setProperty('--swipe-icon', String(f.iconOpacity));
        el.style.setProperty('--swipe-icon-scale', String(f.iconScale));
        el.style.setProperty('--swipe-label', String(f.labelOpacity));
      });
    };
    const xs = makeSpring(paint);
    const cs = makeSpring(paint);

    const setCover = (on) => {
      if (reducedMotion()) cs.jump(on ? 1 : 0);
      else cs.to(on ? 1 : 0, { duration: SWIPE_SPRING.morph });
    };

    /* An open row is a light popover (dismissRules.js): a press elsewhere
       shuts it and still does its own job, and Escape shuts only the row,
       not the sheet or panel it sits in. A scroll shuts it too. */
    let unwatch = null;
    const onScroll = (e) => { if (!root.contains(e.target)) settle(0); };
    const listenOutside = (on) => {
      if (on && !unwatch) {
        const stop = watchLightPopover({
          contains: (el) => root.contains(el),
          close: () => settle(0),
        });
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        unwatch = () => { stop(); document.removeEventListener('scroll', onScroll, { capture: true }); };
      } else if (!on && unwatch) {
        unwatch();
        unwatch = null;
      }
    };
    const claim = () => {
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
    };

    /* Open (target = ±width of the side's actions) or shut (0). */
    function settle(target, velocity = 0) {
      if (armed || (target !== 0 && cs.get() !== 0)) setCover(false);
      armed = false;
      const x = xs.get();
      // Coming back from the far side, a hard flick is capped (HTML q()).
      const v = target === 0 && Math.sign(velocity) === -Math.sign(x)
        ? Math.sign(velocity) * Math.min(Math.abs(velocity), Math.abs(x) * 12)
        : velocity;
      xs.to(target, {
        duration: target === 0 ? SWIPE_SPRING.smooth : SWIPE_SPRING.snappy,
        velocity: v,
        onComplete: () => { if (target === 0) { cs.jump(0); coverSide = null; coverRank = null; } },
      });
      const nowOpen = target !== 0;
      if (nowOpen) claim();
      else if (closeOpenRow === close) closeOpenRow = null;
      listenOutside(nowOpen);
      if (nowOpen !== isOpen) { isOpen = nowOpen; if (mounted) setOpen(nowOpen); }
    }
    function close() { if (!removing) settle(0); }

    /* Run one side's action: Delete slides the row away and folds it; any
       other action runs and the row slides home. */
    const run = (side, index, velocity = 0) => {
      const action = list(side)[index];
      if (!action || removing) return;
      if (action.reason) { settle(0); activateOrExplain(action.reason, null); return; }
      const dir = side === 'leading' ? 1 : -1;
      armed = false;
      coverSide = side;
      coverRank = side === 'leading' ? list(side).length - 1 - index : index;
      setCover(true);
      if (!action.danger) {
        // The row itself anchors anything the action opens (a menu, a picker).
        action.onSelect?.(content);
        settle(0, velocity);
        return;
      }
      removing = true;
      root.setAttribute('data-removing', '');
      listenOutside(false);
      if (closeOpenRow === close) closeOpenRow = null;
      const restore = () => {
        removing = false;
        if (!mounted) return;
        root.removeAttribute('data-removing');
        root.classList.remove('is-folding');
        root.style.height = '';
        settle(0);
      };
      const finish = async () => {
        try { await action.onSelect?.(); } finally { setTimeout(restore, 60); }
      };
      if (reducedMotion()) { finish(); return; }
      xs.to(dir * (rowWidth() + 2), { duration: SWIPE_SPRING.smooth, velocity: Math.sign(velocity) === dir ? velocity : 0 });
      foldTimer = setTimeout(() => {
        if (!mounted) return;
        root.style.height = `${root.offsetHeight}px`;
        void root.offsetHeight;
        root.classList.add('is-folding');
        root.style.height = '0px';
        foldTimer = setTimeout(finish, FOLD_MS);
      }, FOLD_DELAY_MS);
    };

    /* Arm (or disarm) the full swipe as the row passes the line. */
    const track = (x, type) => {
      const side = swipeSide(x);
      const acts = side ? list(side) : [];
      const line = side ? fullSwipeThreshold(acts.length, rowWidth()) : Infinity;
      const next = Boolean(side) && canFullSwipe(acts) && Math.abs(x) > (armed ? line - SWIPE_FULL_HYSTERESIS : line);
      if (next === armed || !side) {
        if (!side && armed) { armed = false; setCover(false); }
        return;
      }
      armed = next;
      if (next) {
        coverSide = side;
        coverRank = side === 'leading' ? 0 : acts.length - 1;
        if (type === 'touch') { try { navigator.vibrate?.(8); } catch { /* no haptics */ } }
      }
      setCover(next);
    };

    const onDown = (e) => {
      g = null;
      if (removing || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const t = e.target;
      if (t.closest?.('.swipe-row__layer')) return;
      if (t.closest?.('[data-drag-rearrange-handle], [data-drag-handle]')) { if (isOpen) settle(0); return; }
      const active = document.activeElement;
      if (isEditable(active) && (active === t || active.contains(t))) return;
      xs.stop();
      g = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, origin: xs.get(), mode: 'pending', wasOpen: isOpen, samples: [[e.timeStamp, e.clientX]] };
    };
    const onMove = (e) => {
      if (!g || g.id !== e.pointerId || g.mode === 'scroll') return;
      g.mx = e.clientX;
      g.my = e.clientY;
      if (g.mode === 'pending') {
        const dx = e.clientX - g.x0;
        const dy = e.clientY - g.y0;
        if (Math.hypot(dx, dy) < SWIPE_INTENT_SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          g.mode = 'scroll';
          if (isOpen) settle(0);
          return;
        }
        if (g.origin === 0) {
          // Nothing on that side: not ours. Rightward from the screen's edge
          // is the phone's back gesture.
          if (list(dx > 0 ? 'leading' : 'trailing').length === 0) { g.mode = 'scroll'; return; }
          if (dx > 0 && g.type !== 'mouse' && g.x0 < EDGE_BACK_PX) { g.mode = 'scroll'; return; }
        }
        g.mode = 'swipe';
        g.x0 = e.clientX;
        claim();
        try { root.setPointerCapture(e.pointerId); } catch { /* already gone */ }
        root.setAttribute('data-swipe-dragging', '');
        try { window.getSelection()?.removeAllRanges(); } catch { /* none */ }
      }
      if (e.cancelable) e.preventDefault();
      const { leading, trailing } = sidesRef.current;
      const x = swipeOffset(g.origin + e.clientX - g.x0, { leading, trailing, rowWidth: rowWidth() });
      xs.jump(x);
      g.samples.push([e.timeStamp, e.clientX]);
      if (g.samples.length > 12) g.samples.shift();
      track(x, g.type);
    };
    const onUp = (e) => {
      if (!g || g.id !== e.pointerId) return;
      const { mode, wasOpen, samples } = g;
      g = null;
      root.removeAttribute('data-swipe-dragging');
      if (mode === 'swipe') {
        swallowUntil = Date.now() + 450;
        if (e.type === 'pointercancel') { settle(0); return; }
        samples.push([e.timeStamp, e.clientX]);
        const x = xs.get();
        const side = swipeSide(x);
        const acts = side ? list(side) : [];
        const velocity = releaseVelocity(samples);
        const verdict = settleSwipe({ offset: x, velocity, count: acts.length, rowWidth: rowWidth(), full: canFullSwipe(acts), armed });
        if (verdict === 'full') run(side, side === 'leading' ? 0 : acts.length - 1, velocity);
        else settle(verdict === 'open' ? Math.sign(x) * acts.length * SWIPE_ACTION_WIDTH : 0, velocity);
      } else if (mode === 'pending' && wasOpen) {
        // A tap on the open row only shuts it - no rename, no open.
        swallowUntil = Date.now() + 450;
        settle(0);
      }
    };
    /* A row the browser drags itself (drag a document onto a project): a
       mouse drag that starts out sideways is a swipe, any other a drag. */
    const onDragStart = (e) => {
      if (!g || g.type !== 'mouse') return;
      if (g.mode === 'swipe') { e.preventDefault(); return; }
      if (g.mode !== 'pending') return;
      // dragstart reports where the press began; the last move says where
      // the mouse is heading.
      const dx = Math.abs((g.mx ?? g.x0) - g.x0);
      const dy = Math.abs((g.my ?? g.y0) - g.y0);
      if (dx >= 2 && dx > dy * 2) e.preventDefault();
      else g = null;
    };
    const onClickCapture = (e) => {
      if (Date.now() < swallowUntil && !e.target.closest?.('.swipe-row__layer')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    root.addEventListener('pointerdown', onDown, { passive: true });
    root.addEventListener('pointermove', onMove, { passive: false });
    root.addEventListener('pointerup', onUp, { passive: true });
    root.addEventListener('pointercancel', onUp, { passive: true });
    root.addEventListener('click', onClickCapture, true);
    root.addEventListener('dragstart', onDragStart, true);
    api.current = { run };
    paint();

    return () => {
      // Leaving (or Select mode turning the swipe off): the row sits shut.
      if (isOpen) setOpen(false);
      mounted = false;
      api.current = null;
      xs.stop();
      cs.stop();
      clearTimeout(foldTimer);
      content.style.transform = '';
      root.removeAttribute('data-swipe-revealed');
      root.removeAttribute('data-swipe-dragging');
      root.removeAttribute('data-removing');
      root.classList.remove('is-folding');
      root.style.height = '';
      listenOutside(false);
      if (closeOpenRow === close) closeOpenRow = null;
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.removeEventListener('click', onClickCapture, true);
      root.removeEventListener('dragstart', onDragStart, true);
    };
  }, [off, sides.leading.length, sides.trailing.length]);

  const press = useCallback((side, index) => (e) => {
    e.stopPropagation();
    api.current?.run(side, index);
  }, []);

  if (off) {
    return <Tag className={className || undefined} {...rest}>{children}</Tag>;
  }

  const layer = (side) => (action, index) => {
    const n = sides[side].length;
    const rank = side === 'leading' ? n - 1 - index : index;
    return (
      <button
        key={`${side}-${action.key}`}
        type="button"
        className="swipe-row__layer"
        data-side={side}
        data-rank={rank}
        data-swipe-action={action.key}
        data-tone={action.danger ? 'danger' : 'neutral'}
        aria-label={label ? `${action.label} ${label}` : action.label}
        aria-disabled={action.reason ? true : undefined}
        aria-hidden={open ? undefined : 'true'}
        tabIndex={open ? 0 : -1}
        style={{ zIndex: rank + 1 }}
        {...tip(action.reason || action.label, 'below')}
        onClick={press(side, index)}
      >
        <span className="swipe-row__anchor">
          <span className="swipe-row__glyph" aria-hidden="true">
            <span className="swipe-row__icon"><Icon name={action.icon} size={compact ? 16 : 20} color="currentColor" /></span>
            <span className="swipe-row__label">{action.label}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <Tag
      ref={rootRef}
      className={`swipe-row${className ? ` ${className}` : ''}`}
      data-swipe-open={open ? 'true' : undefined}
      data-swipe-compact={compact ? '' : undefined}
      {...rest}
      style={{ ...rest.style, '--swipe-action-w': `${SWIPE_ACTION_WIDTH}px` }}
    >
      {sides.leading.map(layer('leading'))}
      {sides.trailing.map(layer('trailing'))}
      <div ref={contentRef} className="swipe-row__content">{children}</div>
    </Tag>
  );
}
