/**
 * viewerTopOverlay.js — tool strips that lie OVER the top of the PDF scroll area,
 * and the extra scroll room the viewer adds so a page can be scrolled out from
 * underneath them.
 *
 * UX (owner 2026-09-23: "I should be able to scroll up and move the top of the
 * page out from underneath"): the desktop sub-toolbar host (tool sub-row, text
 * formatting bar, text-markup bar) and the phone tool-settings strip overlay the
 * top of the canvas instead of pushing it down. Reference behaviour is Drawboard
 * PDF: a toolbar drops down over the page, nothing moves, and you can still
 * scroll up until the top of the page sits clear below it. So:
 *   • the viewer adds scroll room above page 1 equal to the strips' live height;
 *   • when strips appear, grow or shrink, the page does NOT move on screen (the
 *     scroll offset is moved by the same amount as the room);
 *   • when strips go away while you are scrolled up into that room, the room
 *     stays until it has scrolled off screen, so the page still does not move.
 *
 * Strips opt in with the callback ref from useViewerTopOverlayRef(); the viewer
 * subscribes with subscribeViewerTopOverlays(). A module-level registry (not a
 * DOM-wide MutationObserver) keeps this free while you draw.
 */
import { useCallback, useRef } from 'react';

const overlays = new Set();
const listeners = new Set();

const notify = () => {
  listeners.forEach((listener) => {
    try { listener(); } catch { /* a listener must never break a strip mount */ }
  });
};

export function registerViewerTopOverlay(element) {
  if (!element) return () => {};
  overlays.add(element);
  // A strip over the top of the viewer is also something the search jump must
  // centre below (resolveViewerOcclusionInsets reads [data-viewer-occluder]).
  if (typeof element.setAttribute === 'function' && !element.hasAttribute?.('data-viewer-occluder')) {
    element.setAttribute('data-viewer-occluder', 'bar');
  }
  notify();
  return () => {
    if (overlays.delete(element)) notify();
  };
}

export function getViewerTopOverlays() {
  return Array.from(overlays);
}

export function subscribeViewerTopOverlays(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Callback ref for a strip that overlays the top of the viewer. */
export function useViewerTopOverlayRef() {
  const releaseRef = useRef(null);
  return useCallback((element) => {
    releaseRef.current?.();
    releaseRef.current = element ? registerViewerTopOverlay(element) : null;
  }, []);
}

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * How many px of the top of the scroll area the strips cover right now.
 * Only strips that start at (or above) the scroller's top edge and span most of
 * its width count — a popover or a side panel is not a top strip. Always leaves
 * at least `minVisible` px of the viewer uncovered.
 */
export function computeTopOverlayInset(scrollerRect, overlayRects = [], { minVisible = 80 } = {}) {
  if (!scrollerRect) return 0;
  const top = finite(scrollerRect.top);
  const bottom = finite(scrollerRect.bottom);
  const left = finite(scrollerRect.left);
  const right = finite(scrollerRect.right);
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) return 0;
  let inset = 0;
  for (const rect of overlayRects) {
    if (!rect) continue;
    const rTop = finite(rect.top);
    const rBottom = finite(rect.bottom);
    if (!(rBottom - rTop > 0.5)) continue; // hidden (display:none) or empty
    if (rTop > top + 2) continue; // not attached to the top edge
    const overlapW = Math.min(right, finite(rect.right)) - Math.max(left, finite(rect.left));
    if (!(overlapW >= width * 0.5)) continue;
    inset = Math.max(inset, Math.min(bottom, rBottom) - top);
  }
  return Math.round(Math.max(0, Math.min(inset, height - minVisible)));
}

/**
 * The scroll room to keep above the document.
 *   • Growing (a strip appeared or got taller): take the new height at once.
 *   • Shrinking: only give back room that is scrolled off screen (above
 *     scrollTop). Room still on screen stays, so the page never moves; it is
 *     given back as you scroll down past it.
 */
export function resolveTopRoom({ room = 0, inset = 0, scrollTop = 0 } = {}) {
  const current = Math.max(0, finite(room));
  const target = Math.max(0, finite(inset));
  if (target >= current) return target;
  const giveBack = Math.min(current - target, Math.max(0, finite(scrollTop)));
  return current - giveBack;
}

/** The scroll offset that keeps the page still when the room changes. */
export function compensateScrollTopForRoom(scrollTop, previousRoom, nextRoom) {
  return Math.max(0, finite(scrollTop) + finite(nextRoom) - finite(previousRoom));
}

/**
 * The scroll offset to compensate from, read right after the room changed.
 *
 * Giving room back makes the content shorter. Scrolled to the very end of the
 * document, the browser then clamps scrollTop to the new maximum on its own,
 * BEFORE the viewer moves it by the same amount — so compensating the live
 * (already clamped) value moved the page twice. Found 2026-09-23 (w22 verify):
 * closing the Text tool's two strips on the last page moved the page 72px.
 * When the live value sits on the new maximum and the offset taken just
 * before the change is larger, the browser clamped it: use that one. Anywhere
 * else the live value wins, so scrolling in between is never undone.
 */
export function resolveRoomCompensationBase({ liveScrollTop = 0, maxScrollTop = 0, snapshotScrollTop = null } = {}) {
  const live = finite(liveScrollTop);
  if (snapshotScrollTop === null || snapshotScrollTop === undefined) return live;
  const snapshot = finite(snapshotScrollTop);
  const clamped = live >= finite(maxScrollTop) - 1 && snapshot > live;
  return clamped ? snapshot : live;
}

/**
 * Vertical placement of the document inside the scroll content.
 *   centerPad — centres a document shorter than the viewer (unchanged rule:
 *               centred in the FULL viewer height, so strips never move it);
 *   padTop    — offset of the document from the scroll origin (room + centring);
 *   contentHeight — height of the content box below its top margin. The bottom
 *               centring pad is included while there is room, so a short
 *               document can still be held still by the scroll offset when room
 *               is added above it (scrollHeight = room + max(viewerHeight,
 *               documentHeight)). With no room it is left out, exactly as before,
 *               so sub-pixel rounding can never make a fitting page scrollable.
 */
export function resolveVerticalPlacement({ containerHeight = 0, rawTotalHeight = 0, topRoom = 0 } = {}) {
  const raw = Math.max(0, finite(rawTotalHeight));
  const centerPad = Math.max(0, (finite(containerHeight) - raw) / 2);
  const room = Math.max(0, finite(topRoom));
  return { centerPad, padTop: centerPad + room, contentHeight: room > 0 ? raw + centerPad : raw };
}

/** Where a page lands for "go to page": its top edge just below the strips. */
export function resolvePageLandingScrollTop({ padTop = 0, pageTop = 0, fixedTopInset = 0, overlayInset = 0 } = {}) {
  return Math.max(0, finite(padTop) + finite(pageTop) - finite(fixedTopInset) - finite(overlayInset));
}
