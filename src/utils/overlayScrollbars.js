/* Overlay scrollbars for ordinary scrolling lists — the PDF canvas look,
   shrunk (owner, 2026-09-22).

   WHY THIS EXISTS. The canvas viewport draws its own rails
   (`ViewportScrollbars` in components/PdfjsViewerContainer.jsx): a thin bar
   that appears while you scroll and fades out once you stop. The owner likes
   that behaviour and wants every scrolling list on the home screens to feel
   the same. A native `::-webkit-scrollbar` cannot: it is painted inside the
   layout box, so it steals width from the content and it is either always
   there or never there. So the thumb is a separate element positioned over
   the container.

   WHAT IS SHARED WITH THE CANVAS. The geometry — thumb size, travel and
   offset all come from `getViewportScrollbarAxis`, the same pure helper the
   canvas rails use (utils/pdfViewportScrollbar.js). Only the numbers differ:
   the canvas rails are 12px grabbable shuttles, these are 5px non-interactive
   hints.

   CONTRACT
     * opt in with `class="slim-scroll"` or `data-overlay-scroll` on the
       scroll container;
     * the thumb is `position: fixed` in `document.body`, so it adds NO layout
       width and needs no wrapper element and no `position: relative` on the
       container (which would silently re-parent absolutely positioned
       children);
     * `pointer-events: none` — it is a read-out, never a target, so it can
       never swallow a click meant for a row;
     * a container whose content fits shows NOTHING. Ever. (The owner hit the
       opposite: a one-row file list painting a full-height bar.)
     * it appears on scroll, holds 600ms after the last scroll, then fades. */

import { getViewportScrollbarAxis } from './pdfViewportScrollbar';

/* The bar is a hint, so it holds just long enough to read and leaves. */
const HOLD_MS = 600;
const FADE_MS = 200;
/* 5px inside the owner's 4–6px window; 3px radius keeps it a rounded lozenge. */
const THUMB_THICKNESS = 5;
const THUMB_RADIUS = 3;
const EDGE_GAP = 2;
const EDGE_INSET = 2;
const MIN_THUMB = 28;
/* Above the hub's own popups (z 50) and modals; the thumb only paints while
   its own container is being scrolled, so it cannot hang over a dialog. */
const THUMB_Z = 2147480000;

const OPT_IN_SELECTOR = '.slim-scroll, [data-overlay-scroll]';
export const OVERLAY_THUMB_CLASS = 'hub-overlay-scroll-thumb';

const SCROLLABLE_SLACK = 2; // sub-pixel layout noise is not "scrollable"

const makeThumb = (axis) => {
  const el = document.createElement('div');
  el.className = `${OVERLAY_THUMB_CLASS} ${OVERLAY_THUMB_CLASS}--${axis}`;
  el.setAttribute('aria-hidden', 'true');
  const style = el.style;
  style.position = 'fixed';
  style.left = '0';
  style.top = '0';
  style.borderRadius = `${THUMB_RADIUS}px`;
  /* --border-strong at ~0.6 alpha: visible on every one of the four surfaces
     without becoming a second border. */
  style.background = 'color-mix(in srgb, var(--border-strong) 60%, transparent)';
  style.pointerEvents = 'none';
  style.opacity = '0';
  style.zIndex = String(THUMB_Z);
  if (axis === 'y') style.width = `${THUMB_THICKNESS}px`;
  else style.height = `${THUMB_THICKNESS}px`;
  return el;
};

export function installOverlayScrollbars({ root = document } = {}) {
  if (typeof document === 'undefined') return () => {};

  /** element -> { y, x, hideTimer, active } */
  const tracked = new Map();
  let frame = 0;

  const dropThumb = (thumb) => { if (thumb && thumb.parentNode) thumb.parentNode.removeChild(thumb); };

  const forget = (el) => {
    const state = tracked.get(el);
    if (!state) return;
    clearTimeout(state.hideTimer);
    dropThumb(state.y);
    dropThumb(state.x);
    tracked.delete(el);
  };

  const hide = (state) => {
    state.active = false;
    for (const thumb of [state.y, state.x]) {
      if (!thumb) continue;
      thumb.style.transition = `opacity ${FADE_MS}ms ease-out`;
      thumb.style.opacity = '0';
    }
  };

  const paint = (el, state) => {
    if (!el.isConnected) { forget(el); return; }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { hide(state); return; }
    const insetLeft = rect.left + el.clientLeft;
    const insetTop = rect.top + el.clientTop;

    const axes = [
      {
        key: 'y',
        overflow: el.scrollHeight - el.clientHeight,
        axis: () => getViewportScrollbarAxis({
          viewportSize: el.clientHeight,
          contentSize: el.scrollHeight,
          scrollOffset: el.scrollTop,
          trackSize: el.clientHeight,
          edgeInset: EDGE_INSET,
          minimumThumbSize: MIN_THUMB,
        }),
        place: (thumb, a) => {
          thumb.style.height = `${Math.round(a.size)}px`;
          thumb.style.transform = `translate3d(${Math.round(insetLeft + el.clientWidth - THUMB_THICKNESS - EDGE_GAP)}px, ${Math.round(insetTop + a.start)}px, 0)`;
        },
      },
      {
        key: 'x',
        overflow: el.scrollWidth - el.clientWidth,
        axis: () => getViewportScrollbarAxis({
          viewportSize: el.clientWidth,
          contentSize: el.scrollWidth,
          scrollOffset: el.scrollLeft,
          trackSize: el.clientWidth,
          edgeInset: EDGE_INSET,
          minimumThumbSize: MIN_THUMB,
        }),
        place: (thumb, a) => {
          thumb.style.width = `${Math.round(a.size)}px`;
          thumb.style.transform = `translate3d(${Math.round(insetLeft + a.start)}px, ${Math.round(insetTop + el.clientHeight - THUMB_THICKNESS - EDGE_GAP)}px, 0)`;
        },
      },
    ];

    for (const spec of axes) {
      const scrollable = spec.overflow > SCROLLABLE_SLACK;
      if (!scrollable) {
        // Content fits: no thumb at all, and drop any thumb we already made.
        dropThumb(state[spec.key]);
        state[spec.key] = null;
        continue;
      }
      let thumb = state[spec.key];
      if (!thumb) {
        thumb = makeThumb(spec.key);
        document.body.appendChild(thumb);
        state[spec.key] = thumb;
      }
      spec.place(thumb, spec.axis());
      if (state.active) {
        thumb.style.transition = 'none';
        thumb.style.opacity = '1';
      }
    }
  };

  const tick = () => {
    frame = 0;
    let anyActive = false;
    for (const [el, state] of Array.from(tracked)) {
      if (!state.active) continue;
      anyActive = true;
      paint(el, state);
    }
    // Keep following while a container is live: an ancestor may scroll or the
    // window may resize under us, and a fixed thumb has to be re-measured.
    if (anyActive) frame = requestAnimationFrame(tick);
  };

  const wake = (el) => {
    let state = tracked.get(el);
    if (!state) {
      state = { y: null, x: null, hideTimer: 0, active: false };
      tracked.set(el, state);
    }
    state.active = true;
    clearTimeout(state.hideTimer);
    paint(el, state);
    state.hideTimer = setTimeout(() => hide(state), HOLD_MS);
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const onScroll = (event) => {
    const el = event.target;
    if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return;
    if (!el.matches(OPT_IN_SELECTOR)) return;
    wake(el);
  };

  // Scroll events do not bubble, but they do reach a capturing listener on the
  // document — one listener covers every list, including ones inside portals.
  root.addEventListener('scroll', onScroll, true);

  return () => {
    root.removeEventListener('scroll', onScroll, true);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    for (const el of Array.from(tracked.keys())) forget(el);
  };
}

export default installOverlayScrollbars;
