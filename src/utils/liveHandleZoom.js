/**
 * liveHandleZoom.js — keeps selection grabbers one screen size while the page
 * zooms (Drawboard PDF: handles never grow or shrink with a pinch).
 *
 * Grabbers are drawn in page units sized by the layer's `inverseScale` state.
 * That state is retuned only once the page is still (useSVGInteraction: a
 * retune re-renders the whole layer, too slow to run on every pinch frame).
 * Between, a pinch or Ctrl+wheel scales the page with a CSS transform and then
 * resizes it, so the grabbers grew to ~3x during a zoom-in, shrank on a
 * zoom-out, and snapped back up to a second later.
 *
 * This bridges that gap without React: it measures the svg's real on-screen
 * width each frame while something moves and writes the correction as the
 * `--handle-zoom-k` custom property on the svg. styles.css scales each grabber
 * by it around its own centre, so it stays on its point and keeps its size.
 * Only layers that show grabbers register, so a still page costs nothing.
 */
import { clampInverseScale } from './svgTransformMath.js';

export const HANDLE_ZOOM_VAR = '--handle-zoom-k';
const SETTLE_FRAMES = 30;

/** Page units per screen px for the svg as painted now (CSS transforms included). */
export function getLiveInverseScale(svgEl, viewBoxWidth) {
  const width = svgEl?.getBoundingClientRect?.().width;
  if (!(width > 0) || !(viewBoxWidth > 0)) return null;
  return viewBoxWidth / width;
}

/**
 * Factor that turns a grabber sized for `renderedInverseScale` into one sized
 * for `liveInverseScale`. Both go through the same zoom-out cap the renderer
 * uses, so past the cap grabbers shrink with the page exactly as at rest.
 */
export function getHandleZoomCompensation(liveInverseScale, renderedInverseScale) {
  if (!(liveInverseScale > 0) || !(renderedInverseScale > 0)) return 1;
  const k = clampInverseScale(liveInverseScale) / clampInverseScale(renderedInverseScale);
  return Number.isFinite(k) && k > 0 ? k : 1;
}

const layers = new Map(); // svg -> { pageWidth, renderedInverseScale }
let frame = 0;
let quietFrames = 0;
let detach = null;

// While the factor is in play the svg also carries data-handle-zooming, which
// turns off the grabbers' hover easing (styles.css). It stays until the page
// has been quiet for SETTLE_FRAMES, past the frame the re-render lands in.
const writeFactor = (svgEl, k) => {
  const value = Math.abs(k - 1) < 0.002 ? '' : String(Math.round(k * 10000) / 10000);
  if (svgEl.style.getPropertyValue(HANDLE_ZOOM_VAR) === value) return false;
  if (value) {
    svgEl.style.setProperty(HANDLE_ZOOM_VAR, value);
    svgEl.setAttribute('data-handle-zooming', '');
  } else {
    svgEl.style.removeProperty(HANDLE_ZOOM_VAR);
  }
  return true;
};

const clearZooming = (svgEl) => {
  if (!svgEl.style.getPropertyValue(HANDLE_ZOOM_VAR)) svgEl.removeAttribute('data-handle-zooming');
};

const syncLayer = (svgEl) => {
  const entry = layers.get(svgEl);
  if (!entry || !svgEl.isConnected) return false;
  const live = getLiveInverseScale(svgEl, entry.pageWidth);
  return writeFactor(svgEl, getHandleZoomCompensation(live, entry.renderedInverseScale));
};

const tick = () => {
  frame = 0;
  let changed = false;
  let moving = false;
  layers.forEach((_, svgEl) => {
    if (syncLayer(svgEl)) changed = true;
    if (svgEl.closest?.('[data-pdfjs-moving="true"]')) moving = true;
  });
  quietFrames = changed || moving ? 0 : quietFrames + 1;
  if (layers.size && quietFrames < SETTLE_FRAMES) frame = requestAnimationFrame(tick);
  else layers.forEach((_, svgEl) => clearZooming(svgEl));
};

const wake = () => {
  quietFrames = 0;
  if (!frame && layers.size && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick);
};

const attach = () => {
  if (typeof window === 'undefined') return () => {};
  const options = { capture: true, passive: true };
  const events = ['wheel', 'touchmove', 'gesturechange', 'scroll', 'resize', 'survey-pdfjs-pinch-start'];
  events.forEach((name) => window.addEventListener(name, wake, options));
  // Resize and ancestor-style callbacks run before the next paint, so the
  // correction lands in the very frame the page changes size (a rAF of our
  // own can run before the viewer's and trail it by a frame).
  const syncNow = () => { layers.forEach((_, svgEl) => syncLayer(svgEl)); wake(); };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(syncNow) : null;
  const ancestors = typeof MutationObserver === 'function' ? new MutationObserver(syncNow) : null;
  const moving = typeof MutationObserver === 'function' ? new MutationObserver(wake) : null;
  moving?.observe?.(document.documentElement, { attributes: true, attributeFilter: ['data-pdfjs-moving'], subtree: true });
  return {
    resize,
    // The pinch preview scales a page wrapper with an inline transform.
    // MutationObserver has no unobserve, so it is rebuilt when a layer leaves.
    watchAncestors() {
      if (!ancestors) return;
      ancestors.disconnect?.();
      layers.forEach((_, svgEl) => {
        for (let el = svgEl.parentElement; el && el !== document.body; el = el.parentElement) {
          ancestors.observe?.(el, { attributes: true, attributeFilter: ['style'] });
        }
      });
    },
    off() {
      events.forEach((name) => window.removeEventListener(name, wake, options));
      resize?.disconnect?.();
      moving?.disconnect?.();
      ancestors?.disconnect?.();
    },
  };
};

/**
 * Register (or update) a layer that shows grabbers. `renderedInverseScale` is
 * the value its grabbers were last drawn with. Call from a layout effect so
 * the correction lands in the same frame as the re-render.
 */
export function trackHandleZoom(svgEl, { pageWidth, renderedInverseScale }) {
  if (!svgEl) return;
  const isNew = !layers.has(svgEl);
  layers.set(svgEl, { pageWidth, renderedInverseScale });
  if (!detach) detach = attach();
  if (isNew) {
    detach.resize?.observe?.(svgEl);
    detach.watchAncestors();
  }
  syncLayer(svgEl);
  wake();
}

export function untrackHandleZoom(svgEl) {
  if (!svgEl || !layers.has(svgEl)) return;
  layers.delete(svgEl);
  detach?.resize?.unobserve?.(svgEl);
  writeFactor(svgEl, 1);
  svgEl.removeAttribute('data-handle-zooming');
  detach?.watchAncestors();
  if (!layers.size && detach) {
    detach.off();
    detach = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
}
