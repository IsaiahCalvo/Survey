/**
 * viewerSideOverlay.js — side panels that lie OVER the left or right edge of
 * the PDF scroll area, the scroll room the viewer adds so a page can be moved
 * out from under them, and where a fit puts the page between them.
 *
 * UX (coordinator 2026-09-23, right-rail audit follow-up — RULED 2026-09-23
 * (coordinator: auto refits keep the view; fits use the band between panels)):
 * the desktop Pages panel (~224px, left) and the Survey panel (~272px of the
 * viewer, right) float over the page instead of pushing it aside. So:
 *   • Fit page / Fit width / Fit height that YOU pick size the page to the band
 *     between the open panels (and below any tool strips) and centre it there;
 *   • opening or closing a panel never moves the page — the viewer adds (or
 *     keeps) horizontal scroll room the width of the panel, exactly like the
 *     top strips' room (src/utils/viewerTopOverlay.js), so you can scroll the
 *     page out from under a panel yourself;
 *   • room a closed panel no longer needs is given back only once it has
 *     scrolled off screen, so closing a panel never moves the page either.
 * Reference behaviour: Drawboard PDF — a side panel slides over the canvas and
 * nothing under it moves; a fit then fills the space you can still see.
 *
 * Panels opt in with the callback ref from useViewerSideOccluderRef(); only an
 * element whose data-viewer-occluder is 'side' at measure time counts (a
 * collapsed panel drops the attribute or sits outside the viewer). The same
 * attribute already steers the search-result centring
 * (resolveViewerOcclusionInsets in searchMatchNavigation.js).
 */
import { useCallback, useRef } from 'react';

const occluders = new Set();
const listeners = new Set();

const notify = () => {
  listeners.forEach((listener) => {
    try { listener(); } catch { /* a listener must never break a panel mount */ }
  });
};

export function registerViewerSideOccluder(element) {
  if (!element) return () => {};
  occluders.add(element);
  notify();
  return () => {
    if (occluders.delete(element)) notify();
  };
}

export function getViewerSideOccluders() {
  return Array.from(occluders);
}

export function subscribeViewerSideOccluders(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Callback ref for a panel that can cover the side of the viewer. */
export function useViewerSideOccluderRef() {
  const releaseRef = useRef(null);
  return useCallback((element) => {
    releaseRef.current?.();
    releaseRef.current = element ? registerViewerSideOccluder(element) : null;
  }, []);
}

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const NO_SIDE_INSETS = Object.freeze({ left: 0, right: 0 });

/**
 * How many px of the left and right of the scroll area the side panels cover.
 * A panel counts when it covers most of the viewer's height and touches its
 * left or right edge. Always leaves at least `minVisible` px of width.
 */
export function computeSideOverlayInsets(scrollerRect, overlayRects = [], { minVisible = 80 } = {}) {
  if (!scrollerRect) return { left: 0, right: 0 };
  const cLeft = finite(scrollerRect.left);
  const cRight = finite(scrollerRect.right);
  const cTop = finite(scrollerRect.top);
  const cBottom = finite(scrollerRect.bottom);
  const width = cRight - cLeft;
  const height = cBottom - cTop;
  if (!(width > 0) || !(height > 0)) return { left: 0, right: 0 };
  let left = 0;
  let right = 0;
  for (const rect of overlayRects) {
    if (!rect) continue;
    const l = Math.max(cLeft, finite(rect.left));
    const r = Math.min(cRight, finite(rect.right));
    const t = Math.max(cTop, finite(rect.top));
    const b = Math.min(cBottom, finite(rect.bottom));
    if (!(r - l > 1) || !(b - t > 1)) continue; // hidden, collapsed or outside the viewer
    if ((b - t) < height * 0.6) continue; // a popover, not a side panel
    if (l <= cLeft + 1) left = Math.max(left, r - cLeft);
    else if (r >= cRight - 1) right = Math.max(right, cRight - l);
  }
  if (width - left - right < minVisible) return { left: 0, right: 0 };
  return { left: Math.round(left), right: Math.round(right) };
}

/**
 * The horizontal scroll room to keep beside the document.
 *   • Growing (a panel opened or widened): take the new width at once. Left
 *     room is added in front of the content, so the caller moves scrollLeft by
 *     the same amount (compensateScrollLeftForSideRoom) and nothing moves.
 *     Right room is added after the content and needs no compensation.
 *   • Shrinking: only give back room that is off screen. Left room is off
 *     screen while scrollLeft is past it; right room is off screen while the
 *     view does not reach into it (`pageScrollMax` = the current page's scroll
 *     range WITHOUT the right room). Room still on screen stays, so the page
 *     never moves; it is given back as you scroll away from it.
 */
export function resolveSideRoom({
  room = NO_SIDE_INSETS,
  inset = NO_SIDE_INSETS,
  scrollLeft = 0,
  pageScrollMax = 0,
} = {}) {
  const curL = Math.max(0, finite(room?.left));
  const curR = Math.max(0, finite(room?.right));
  const wantL = Math.max(0, finite(inset?.left));
  const wantR = Math.max(0, finite(inset?.right));
  const sl = Math.max(0, finite(scrollLeft));
  const left = wantL >= curL ? wantL : curL - Math.min(curL - wantL, sl);
  // The right room starts where the page's own scroll range (which includes
  // the left room) ends. Left-room compensation moves scrollLeft and that end
  // by the same amount, so it can be judged before it.
  const rightVisible = Math.max(0, sl - Math.max(0, finite(pageScrollMax)));
  const right = wantR >= curR ? wantR : Math.max(wantR, Math.min(curR, rightVisible));
  return { left, right };
}

/** The scroll offset that keeps the page still when the LEFT room changes. */
export function compensateScrollLeftForSideRoom(scrollLeft, previousLeft, nextLeft) {
  return Math.max(0, finite(scrollLeft) + finite(nextLeft) - finite(previousLeft));
}

/**
 * The scrollLeft that centres a page in the band between the side panels.
 * `pageLeft` is the page's left edge in scroll-content coordinates (room
 * included), `insets` the live panel widths. Clamped to [0, maxScrollLeft].
 */
export function resolveBandCentreScrollLeft({
  pageLeft = 0,
  pageWidth = 0,
  viewportWidth = 0,
  insets = NO_SIDE_INSETS,
  maxScrollLeft = Infinity,
} = {}) {
  const bandLeft = finite(insets?.left);
  const bandRight = finite(viewportWidth) - finite(insets?.right);
  const target = finite(pageLeft) + finite(pageWidth) / 2 - (bandLeft + bandRight) / 2;
  const max = Number.isFinite(Number(maxScrollLeft)) ? Math.max(0, Number(maxScrollLeft)) : Infinity;
  return Math.min(max, Math.max(0, target));
}

/**
 * Whether an automatic (layout-driven) re-fit has anything to do.
 *
 * RULED 2026-09-23 (coordinator: auto refits keep the view; fits use the band
 * between panels). Opening or closing a panel, a template, a tab switch or a
 * strip calls the layout re-fit, but a panel FLOATS over the viewer: the
 * viewer itself did not change size, so the fitted zoom did not either and the
 * page must stay exactly where it is. Only a real change of the viewer's own
 * size (a window resize) or of the fitted page's size (rotation, the page
 * sizes arriving after load) re-fits — and then around the visible middle.
 * `last` is the record of the previous fit ({ mode, viewW, viewH, pageW, pageH }).
 */
export function shouldAutoRefit(last, next, tolerance = 0.5) {
  if (!last || !next) return true;
  if (last.mode !== next.mode) return true;
  return ['viewW', 'viewH', 'pageW', 'pageH'].some(
    (key) => Math.abs(finite(last[key]) - finite(next[key])) > tolerance,
  );
}
