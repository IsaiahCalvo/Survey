// Nightly 'drag-auto-scroll' (Drawboard parity, t2-tools-deep.md gap 8): while
// a shape is being drawn, a mark moved or a box select dragged, holding the
// pointer near the edge of the document view scrolls the view that way. The
// drag follows: after each scroll step the same pointer position is sent to
// the page again as a pointermove, so the shape grows into what scrolled in.
//
// Mouse and pen only: on a touch screen a finger drag pans (touch is pan-only).

export const AUTO_SCROLL_EDGE_PX = 30;
export const AUTO_SCROLL_MAX_STEP_PX = 14;
const START_TRAVEL_PX = 4;

/** Scroll step (px per frame) for a pointer at `pos` in a box from `min` to `max`. */
export function edgeScrollStep(pos, min, max, edge = AUTO_SCROLL_EDGE_PX, maxStep = AUTO_SCROLL_MAX_STEP_PX) {
  if (!(max - min > edge * 2)) return 0;
  const near = pos - min;
  const far = max - pos;
  // Ramps from 0 at the band's inner line to maxStep at (and past) the edge.
  if (near < edge) return -Math.round(maxStep * Math.min(1, (edge - near) / edge));
  if (far < edge) return Math.round(maxStep * Math.min(1, (edge - far) / edge));
  return 0;
}

const canScroll = (el, axis) => {
  const style = getComputedStyle(el);
  const overflow = axis === 'y' ? style.overflowY : style.overflowX;
  if (!/(auto|scroll|overlay)/.test(overflow)) return false;
  return axis === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
};

/** The nearest ancestor that scrolls (either way), or null. */
export function scrollParentOf(el) {
  for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
    if (canScroll(node, 'y') || canScroll(node, 'x')) return node;
  }
  return null;
}

/**
 * Watch one press from `downEvent` on `target` (the page's SVG layer). Returns
 * a stop function; it also stops itself when the pointer is released.
 */
export function startMarkDragAutoScroll(target, downEvent, { edge = AUTO_SCROLL_EDGE_PX, maxStep = AUTO_SCROLL_MAX_STEP_PX } = {}) {
  if (!target || !downEvent || downEvent.pointerType === 'touch' || typeof window === 'undefined') return () => {};
  const scroller = scrollParentOf(target);
  if (!scroller) return () => {};
  const { pointerId, pointerType } = downEvent;
  const start = { x: downEvent.clientX, y: downEvent.clientY };
  const last = { ...start, shiftKey: !!downEvent.shiftKey, altKey: !!downEvent.altKey, ctrlKey: !!downEvent.ctrlKey, metaKey: !!downEvent.metaKey };
  let travelled = false;
  let frame = 0;
  let stopped = false;

  const tick = () => {
    frame = 0;
    if (stopped) return;
    const box = scroller.getBoundingClientRect();
    const dx = canScroll(scroller, 'x') ? edgeScrollStep(last.x, box.left, box.right, edge, maxStep) : 0;
    const dy = canScroll(scroller, 'y') ? edgeScrollStep(last.y, box.top, box.bottom, edge, maxStep) : 0;
    if (!dx && !dy) return;
    const beforeTop = scroller.scrollTop;
    const beforeLeft = scroller.scrollLeft;
    scroller.scrollBy(dx, dy);
    if (scroller.scrollTop !== beforeTop || scroller.scrollLeft !== beforeLeft) {
      target.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType,
        isPrimary: true,
        clientX: last.x,
        clientY: last.y,
        buttons: 1,
        shiftKey: last.shiftKey,
        altKey: last.altKey,
        ctrlKey: last.ctrlKey,
        metaKey: last.metaKey,
      }));
    }
    frame = requestAnimationFrame(tick);
  };

  const onMove = (e) => {
    if (!e.isTrusted || e.pointerId !== pointerId) return;
    Object.assign(last, { x: e.clientX, y: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
    if (!travelled && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= START_TRAVEL_PX) travelled = true;
    if (travelled && !frame) frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
  };
  const onEnd = (e) => { if (e.pointerId === pointerId) stop(); };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  return stop;
}
