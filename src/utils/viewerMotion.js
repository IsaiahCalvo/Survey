// Is the PDF viewer moving (scrolling, zooming, panning)? Work that can wait
// (laying out a page's text, reading text ahead for search) waits while it
// is: on a big drawing set it took the CPU and the pdf.js worker from the
// pages scrolling into view, which stayed white for seconds (2026-11-09).

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

// Longest a slice waits for the viewer to be still: past a long scroll, but a
// flag that never clears must not stop the text for good.
export const TEXT_LAYER_STILL_WAIT_MS = 10_000;
// The viewer counts as moving until this long after its last scroll or wheel.
export const TEXT_LAYER_QUIET_MS = 250;

const motionByScroller = new WeakMap();
function motionOf(scroller) {
  let motion = motionByScroller.get(scroller);
  if (!motion) {
    motion = { at: -Infinity };
    const mark = () => { motion.at = now(); };
    scroller.addEventListener('scroll', mark, { passive: true });
    scroller.addEventListener('wheel', mark, { passive: true });
    motionByScroller.set(scroller, motion);
  }
  return motion;
}

/**
 * Resolves once `scroller` has been still for TEXT_LAYER_QUIET_MS (no scroll
 * or wheel, and no data-pdfjs-moving: the viewer sets it while it scrolls,
 * zooms or pans), or after `maxMs`. Null when it is still already.
 */
export function whenViewerStill(scroller, { quietMs = TEXT_LAYER_QUIET_MS, maxMs = TEXT_LAYER_STILL_WAIT_MS } = {}) {
  if (!scroller || typeof scroller.addEventListener !== 'function') return null;
  const motion = motionOf(scroller);
  const moving = () => scroller.dataset?.pdfjsMoving === 'true' || now() - motion.at < quietMs;
  if (!moving()) return null;
  const started = now();
  return new Promise((resolve) => {
    const check = () => {
      if (!moving() || now() - started >= maxMs) resolve();
      else setTimeout(check, Math.max(16, Math.min(quietMs, quietMs - (now() - motion.at))));
    };
    setTimeout(check, Math.max(16, quietMs - (now() - motion.at)));
  });
}

/** Waits until every viewer on the page is still (null when they are). */
export function whenViewersStill(options) {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
  const scrollers = [...document.querySelectorAll('[data-touch-pdf-surface]')];
  const waits = scrollers.map((scroller) => whenViewerStill(scroller, options)).filter(Boolean);
  if (!waits.length) return null;
  // Check again once these settle: one may have started moving meanwhile.
  return Promise.all(waits).then(() => whenViewersStill(options));
}
