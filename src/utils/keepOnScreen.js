/**
 * keepOnScreen.js — the safety net that keeps every floating menu inside the
 * window (KAL-793, owner 2026-11-17: "every pop-up and drop-down... fits
 * within what can be seen").
 *
 * Each menu still places itself (flipping off its opener, beside its row).
 * This catches the ones that get it wrong or were never told about a small
 * window: once a floating menu or list appears, it is measured, slid back
 * inside the window (8px off each edge) and, when it is taller or wider than
 * the window, capped so it scrolls. It runs again when the menu moves or
 * grows, and when the window is resized.
 *
 * The slide uses the CSS `translate` property, so it adds to whatever
 * left / top / transform the menu already has. A menu that sets its own
 * `translate` (centred cards) or opts out with data-keep-on-screen="off" is
 * left alone: those place themselves.
 *
 * Installed once at the app root (main.jsx). Pure DOM, no React.
 */

export const KEEP_ON_SCREEN_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '.hub-menu',
  '[data-keep-on-screen="on"]',
].join(', ');

const EDGE = 8;

/**
 * How far to slide a box, and whether to cap it, so it sits inside the window.
 * `rect` is where it is now with no slide of ours; `size` its full size.
 * Pure, for tests.
 */
export function keepOnScreenFit({ rect, scrollHeight = rect.height, viewportWidth, viewportHeight, edge = EDGE }) {
  const roomW = Math.max(0, viewportWidth - edge * 2);
  const roomH = Math.max(0, viewportHeight - edge * 2);
  const maxHeight = scrollHeight > roomH + 0.5 ? roomH : null;
  const maxWidth = rect.width > roomW + 0.5 ? roomW : null;
  const height = maxHeight ?? rect.height;
  const width = maxWidth ?? rect.width;
  const clamp = (start, size, room) => {
    const min = edge;
    const max = edge + Math.max(0, room - size);
    return Math.max(min, Math.min(start, max)) - start;
  };
  return {
    dx: Math.round(clamp(rect.left, width, roomW)),
    dy: Math.round(clamp(rect.top, height, roomH)),
    maxHeight,
    maxWidth,
  };
}

const state = new WeakMap();

function isFloating(el) {
  const cs = getComputedStyle(el);
  if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  return true;
}

function ownsTranslate(el, mine) {
  const inline = el.style.translate;
  if (inline && inline !== mine) return true;
  // A translate from a style sheet (a centred card), not from an animation.
  const cs = getComputedStyle(el);
  return !inline && cs.translate && cs.translate !== 'none' && el.getAnimations?.().length === 0;
}

export function fitElement(el, { edge = EDGE } = {}) {
  if (!el?.isConnected || el.closest('[data-keep-on-screen="off"]')) return;
  if (!isFloating(el)) return;
  const prev = state.get(el) || { dx: 0, dy: 0, translate: '', maxHeight: null, maxWidth: null };
  if (ownsTranslate(el, prev.translate)) return;
  const shown = el.getBoundingClientRect();
  if (shown.width === 0 || shown.height === 0) return;
  // Where it would be with no slide of ours.
  const rect = {
    left: shown.left - prev.dx,
    top: shown.top - prev.dy,
    width: shown.width,
    height: shown.height,
  };
  // Parked far off screen to be measured before it is placed: not yet.
  if (rect.left < -1000 || rect.top < -1000) return;
  // A cap of ours hides how tall it really is.
  const scrollHeight = prev.maxHeight != null ? Math.max(el.scrollHeight, shown.height) + 2 : shown.height;
  const vv = window.visualViewport;
  const next = keepOnScreenFit({
    rect,
    scrollHeight,
    viewportWidth: Math.min(window.innerWidth, vv ? vv.width : Infinity),
    viewportHeight: Math.min(window.innerHeight, vv ? vv.height : Infinity),
    edge,
  });
  const translate = next.dx || next.dy ? `${next.dx}px ${next.dy}px` : '';
  if (translate !== prev.translate) el.style.translate = translate;
  if (next.maxHeight !== prev.maxHeight) {
    el.style.maxHeight = next.maxHeight == null ? '' : `${next.maxHeight}px`;
    if (next.maxHeight != null) el.style.overflowY = 'auto';
    else if (prev.maxHeight != null) el.style.overflowY = '';
  }
  if (next.maxWidth !== prev.maxWidth) {
    el.style.maxWidth = next.maxWidth == null ? '' : `${next.maxWidth}px`;
  }
  state.set(el, { dx: next.dx, dy: next.dy, translate, maxHeight: next.maxHeight, maxWidth: next.maxWidth });
}

/** Watch the page; returns a function that stops watching. */
export function installKeepOnScreen({ root = typeof document !== 'undefined' ? document.body : null, edge = EDGE } = {}) {
  if (!root || typeof MutationObserver === 'undefined' || typeof window === 'undefined') return () => {};
  const tracked = new Set();
  const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    entries.forEach((entry) => schedule(entry.target));
  });
  const pending = new Set();
  let frame = 0;
  const flush = () => {
    frame = 0;
    const list = [...pending];
    pending.clear();
    list.forEach((el) => {
      if (!el.isConnected) { tracked.delete(el); sizes?.unobserve(el); return; }
      fitElement(el, { edge });
    });
  };
  function schedule(el) {
    pending.add(el);
    if (!frame) frame = window.requestAnimationFrame(flush);
  }
  const track = (el) => {
    if (!tracked.has(el)) {
      tracked.add(el);
      sizes?.observe(el);
      // Once more after an opening animation (a slide skews the first read).
      window.setTimeout(() => schedule(el), 220);
    }
    schedule(el);
  };
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches?.(KEEP_ON_SCREEN_SELECTOR)) track(node);
    node.querySelectorAll?.(KEEP_ON_SCREEN_SELECTOR).forEach(track);
  };
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'childList') record.addedNodes.forEach(scan);
      else if (record.type === 'attributes') {
        const el = record.target;
        if (tracked.has(el)) schedule(el);
        else if (el.matches?.(KEEP_ON_SCREEN_SELECTOR)) track(el);
      }
    });
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-side', 'hidden'] });
  scan(root);
  const onResize = () => tracked.forEach(schedule);
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  return () => {
    observer.disconnect();
    sizes?.disconnect();
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    if (frame) window.cancelAnimationFrame(frame);
  };
}
