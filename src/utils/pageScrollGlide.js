/**
 * pageScrollGlide.js — the smooth page move (Drawboard canvas audit, chunk 6,
 * 2026-10-13).
 *
 * Drawboard scrolls to a new page over about 250 ms, easing out (measured frame
 * by frame: Next page, the typed page jump and PageDown all glide). Survey used
 * to jump in one frame, so you lost your sense of where you were. The viewer
 * (PdfjsViewerContainer) runs one of these glides when you press Previous /
 * Next page, type a page number, click a page thumbnail or press PageUp /
 * PageDown. Nothing else (opening a file, undo on another page, a search hit,
 * a link) changes: those still land at once.
 *
 * Rules:
 * - 250 ms, ease-out (the same cubic the zoom glide uses), whatever the distance.
 * - A long jump (more than LONG_JUMP_SCREENS screens away, e.g. page 1 to 300)
 *   first jumps to one screen short of the target and glides only that last
 *   screen. Gliding the whole way would draw every page in between for a
 *   single frame each (a blur of half-drawn pages and a lot of wasted
 *   rendering); jumping all the way would lose the sense of direction. One
 *   screen is the same distance a Next page press glides at Fit page.
 * - It stops the moment the person takes over: a wheel or trackpad scroll, a
 *   press or touch on the page, a zoom, or anyone else writing the scroll
 *   position (a scrollbar drag, keyboard arrows). The page simply stays where
 *   the glide had got to.
 * - Reduced motion (the system setting): no glide, it lands at once.
 * - It only ever writes scrollTop. Zoom (and the zoomGeneration signal) is
 *   never touched.
 */

import { easeOutCubic } from './zoomGlide.js';

export const PAGE_GLIDE_MS = 250;
// A target further than this many screens away is reached by a jump to one
// screen short of it, then a glide of the last screen.
export const LONG_JUMP_SCREENS = 2;
export const LONG_JUMP_GLIDE_SCREENS = 1;
// Between two frames the scroll position may only differ from what the glide
// itself wrote by this much; more means someone else moved it.
export const EXTERNAL_SCROLL_EPSILON_PX = 1.5;

/** True when the person asked the system for less motion. */
export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : undefined) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Where the glide starts and ends. `from` is the scroll position now, `to`
 * the target, `screen` the height of the view. Returns
 *   { start, to, jumped }  — start = where the glide begins (a jump there
 *   first when `jumped`), or null when there is nothing to move.
 */
export function planPageGlide({ from, to, screen }) {
  const a = finite(from);
  const b = finite(to, a);
  const distance = b - a;
  if (Math.abs(distance) < 0.5) return null;
  const h = Math.max(1, finite(screen, 800));
  if (Math.abs(distance) > LONG_JUMP_SCREENS * h) {
    const run = LONG_JUMP_GLIDE_SCREENS * h;
    return { start: b - Math.sign(distance) * run, to: b, jumped: true };
  }
  return { start: a, to: b, jumped: false };
}

/** A new glide object. `now` in ms. */
export function createPageGlide({ start, to, now = 0, durationMs = PAGE_GLIDE_MS }) {
  return {
    from: finite(start),
    to: finite(to),
    t0: finite(now),
    duration: Math.max(1, finite(durationMs, PAGE_GLIDE_MS)),
  };
}

/** The scroll position at time `now`, and whether the glide is over. */
export function stepPageGlide(glide, now) {
  if (!glide) return { top: 0, done: true };
  const u = Math.min(1, Math.max(0, (finite(now) - glide.t0) / glide.duration));
  const done = u >= 1;
  return { top: done ? glide.to : glide.from + (glide.to - glide.from) * easeOutCubic(u), done };
}

/**
 * Run a glide on a scrolling element. Returns a controller
 *   { cancel(reason), retarget(to), isRunning(), target }
 * or null when it landed at once (reduced motion, nothing to move).
 *
 * Options:
 *   el            the scroller
 *   to            target scrollTop
 *   screen        view height (defaults to el.clientHeight)
 *   reducedMotion force the instant path (defaults to the system setting)
 *   shouldStop()  checked every frame: true stops the glide (a zoom started)
 *   onEnd(reason) 'done' | 'instant' | 'wheel' | 'pointer' | 'touch' |
 *                 'external' | 'zoom' | 'cancel' | 'retarget-instant'
 *   raf / caf / now  injectable clock (tests)
 */
export function startPageGlide({
  el,
  to,
  screen,
  reducedMotion,
  shouldStop = null,
  onEnd = null,
  durationMs = PAGE_GLIDE_MS,
  raf = (fn) => window.requestAnimationFrame(fn),
  caf = (id) => window.cancelAnimationFrame(id),
  now = () => performance.now(),
} = {}) {
  if (!el) return null;
  const maxTop = Math.max(0, finite(el.scrollHeight) - finite(el.clientHeight));
  const clampTop = (v) => Math.min(maxTop, Math.max(0, finite(v)));
  const target = clampTop(to);
  const reduce = reducedMotion ?? prefersReducedMotion();
  const plan = reduce ? null : planPageGlide({ from: el.scrollTop, to: target, screen: screen ?? el.clientHeight });
  if (!plan) {
    el.scrollTop = target;
    onEnd?.('instant');
    return null;
  }
  if (plan.jumped) el.scrollTop = clampTop(plan.start);
  let glide = createPageGlide({ start: el.scrollTop, to: target, now: now(), durationMs });
  let lastWritten = el.scrollTop;
  let frame = 0;
  let running = true;

  const listeners = [];
  const listen = (type, reason, options) => {
    const handler = () => stop(reason);
    el.addEventListener(type, handler, options);
    listeners.push([type, handler, options]);
  };
  const detach = () => {
    listeners.forEach(([type, handler, options]) => el.removeEventListener(type, handler, options));
    listeners.length = 0;
  };
  function stop(reason) {
    if (!running) return;
    running = false;
    if (frame) caf(frame);
    frame = 0;
    detach();
    onEnd?.(reason);
  }
  const tick = () => {
    frame = 0;
    if (!running) return;
    if (Math.abs(el.scrollTop - lastWritten) > EXTERNAL_SCROLL_EPSILON_PX) { stop('external'); return; }
    if (shouldStop?.()) { stop('zoom'); return; }
    const { top, done } = stepPageGlide(glide, now());
    el.scrollTop = top;
    lastWritten = el.scrollTop;
    if (done) { stop('done'); return; }
    frame = raf(tick);
  };
  // The person takes over: wheel / trackpad, a press, a touch.
  listen('wheel', 'wheel', { capture: true, passive: true });
  listen('pointerdown', 'pointer', { capture: true, passive: true });
  listen('touchstart', 'touch', { capture: true, passive: true });
  frame = raf(tick);

  return {
    get target() { return glide.to; },
    isRunning: () => running,
    cancel: (reason = 'cancel') => stop(reason),
    // A second press while gliding: carry on from where the page is shown now
    // toward the new target, on a fresh 250 ms ease-out (a long way off is
    // still jump-then-glide).
    retarget: (nextTo) => {
      if (!running) return false;
      const nextTarget = clampTop(nextTo);
      if (Math.abs(nextTarget - glide.to) < 0.5) return true;
      const next = planPageGlide({ from: el.scrollTop, to: nextTarget, screen: screen ?? el.clientHeight });
      if (!next) { el.scrollTop = nextTarget; stop('retarget-instant'); return true; }
      if (next.jumped) el.scrollTop = clampTop(next.start);
      lastWritten = el.scrollTop;
      glide = createPageGlide({ start: el.scrollTop, to: nextTarget, now: now(), durationMs });
      return true;
    },
  };
}
