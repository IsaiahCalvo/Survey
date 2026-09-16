import { useCallback, useRef, useState } from 'react';

/*
 * Mobile bottom-sheet motion system — Phase F (motion & feel polish),
 * demo parity with mobile-expo-go.
 *
 * Intended feel (demo inv-demo.md §17 / SurveySetupSheet.tsx:51-96,
 * AnnotationEditPanel.tsx:141-199):
 *  - Finger-follow drag: the sheet tracks the finger's downward Y via
 *    transform: translateY while the gesture is held.
 *  - Velocity-aware dismiss: release closes the sheet if the total downward
 *    drag exceeds 82px OR the flick velocity exceeds 0.65 px/ms (computed from
 *    the last touchmove delta / elapsed time).
 *  - Spring-back: releasing below threshold snaps the sheet home with a short
 *    lightly-underdamped settle (the demo used RN spring damping 24 /
 *    stiffness 260 / mass .75; we approximate that with a CSS cubic-bezier —
 *    no physics lib, per Phase F constraint).
 *  - Second detent (opt-in via options.expandable): dragging UP past 48px, or
 *    flicking up faster than the dismiss velocity, snaps the sheet to a taller
 *    70%-of-screen detent; dragging down from there returns it to its compact
 *    height before a further pull can dismiss it. The height step is
 *    deliberately NOT driven from here — the hook still only writes
 *    transform/opacity, and the sheet's own CSS eases its height — so a detent
 *    change never competes with the pdf.js render.
 *  - Exit slide-down: dismissing (or any routed close) slides the sheet down
 *    ~170ms with the demo's in-cubic easing before the real unmount fires
 *    (mirrors the 180ms slide-in), instead of a hard display swap.
 *  - prefers-reduced-motion short-circuits every transition (drag finger-follow
 *    is direct manipulation, so it stays; only the decorative easings drop).
 *
 * The hook is GPU-cheap: it only ever writes transform/opacity (never
 * top/height), so it never competes with the pdf.js render.
 */

// demo SurveySetupSheet.tsx:51-96 — drag-dismiss thresholds
export const SHEET_DISMISS_DY = 82; // px of downward travel
export const SHEET_DISMISS_VY = 0.65; // px/ms flick velocity
// demo close 170ms Easing.in(cubic); slide-in mirror is 180ms
export const SHEET_CLOSE_MS = 170;
export const SHEET_CLOSE_EASING = 'cubic-bezier(0.32, 0, 0.67, 0)'; // in-cubic
// UX 2026-09-16 (phone reach pass): upward travel that commits to the taller
// detent. Half the dismiss distance, because expanding is the cheap, reversible
// direction. Reference: Drawboard PDF's phone page list opens to roughly two
// thirds of the screen rather than one fixed short tray.
export const SHEET_EXPAND_DY = 48; // px of upward travel
export const SHEET_EXPANDED_HEIGHT = '70dvh';
// spring-back settle approximating damping24/stiffness260/mass.75 — a brief
// overshoot then settle; kept subtle so it reads as a snap, not a bounce.
export const SHEET_SPRING_MS = 260;
export const SHEET_SPRING_EASING = 'cubic-bezier(0.22, 1.15, 0.36, 1)';

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * @param {() => void} onClose  the real collapse/unmount setter; called AFTER
 *                              the slide-down completes (or immediately under
 *                              reduced motion).
 * @param {object} [options]
 * @param {(event: TouchEvent) => boolean} [options.canStartDrag]  guard so the
 *   drag only engages from the handle / when inner scroll is at top.
 * @param {boolean} [options.expandable]  opt this sheet into the taller second
 *   detent (the Pages / Search / Bookmarks tray). Off for everything else.
 */
export function useMobileSheetMotion(onClose, options = {}) {
  const { canStartDrag, expandable = false } = options;
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const [springing, setSpringing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const startYRef = useRef(null);
  const lastYRef = useRef(null);
  const lastTRef = useRef(0);
  const vyRef = useRef(0);
  const engagedRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (prefersReducedMotion()) {
      setDragY(0);
      setSpringing(false);
      setExpanded(false);
      onClose?.();
      return;
    }
    // keep the sheet mounted + slide it down, then fire the real close
    setSpringing(false);
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setDragY(0);
      setExpanded(false);
      onClose?.();
    }, SHEET_CLOSE_MS);
  }, [closing, onClose]);

  const onTouchStart = useCallback((event) => {
    if (typeof canStartDrag === 'function' && !canStartDrag(event)) {
      startYRef.current = null;
      return;
    }
    const y = event.touches?.[0]?.clientY ?? null;
    startYRef.current = y;
    lastYRef.current = y;
    lastTRef.current = event.timeStamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());
    vyRef.current = 0;
    engagedRef.current = false;
    setSpringing(false);
  }, [canStartDrag]);

  const onTouchMove = useCallback((event) => {
    const startY = startYRef.current;
    if (startY == null || closing) return;
    const y = event.touches?.[0]?.clientY;
    if (y == null) return;
    const dy = y - startY;
    // Downward pull always engages. An upward move engages only on a sheet
    // that HAS a taller detent to reach — everywhere else an upward/neutral
    // move must never hijack the sheet's inner scroll (the demo starts the
    // responder from the handle only). Note the sheet is never translated
    // upward: it is anchored to the bottom, so moving it up would open a gap
    // beneath it. The snap on release is the feedback.
    if (dy <= 0 && !engagedRef.current && !expandable) return;
    engagedRef.current = true;
    const now = event.timeStamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = now - (lastTRef.current || now);
    if (dt > 0) vyRef.current = (y - (lastYRef.current ?? y)) / dt;
    lastYRef.current = y;
    lastTRef.current = now;
    setDragY(Math.max(0, dy));
  }, [closing, expandable]);

  const onTouchEnd = useCallback(() => {
    const startY = startYRef.current;
    startYRef.current = null;
    if (startY == null) return;
    const engaged = engagedRef.current;
    engagedRef.current = false;
    if (!engaged) return;
    const travel = (lastYRef.current ?? startY) - startY;
    const vy = vyRef.current;
    // Upward release on an expandable sheet: step up to the tall detent.
    if (expandable && travel < 0) {
      if (!expanded && (-travel > SHEET_EXPAND_DY || -vy > SHEET_DISMISS_VY)) setExpanded(true);
      setDragY(0);
      return;
    }
    const dy = Math.max(0, travel);
    if (dy > SHEET_DISMISS_DY || vy > SHEET_DISMISS_VY) {
      // From the tall detent a downward pull steps back to the compact height
      // instead of dismissing, so the sheet is never lost in one gesture.
      if (expanded) {
        setExpanded(false);
        setDragY(0);
        return;
      }
      requestClose();
    } else if (dy > 0) {
      // spring back home
      if (prefersReducedMotion()) {
        setDragY(0);
        return;
      }
      setSpringing(true);
      setDragY(0);
      window.setTimeout(() => setSpringing(false), SHEET_SPRING_MS);
    }
  }, [requestClose, expandable, expanded]);

  // Merge into the sheet element's inline style. Empty when idle+open so the
  // CSS slide-in keyframe (mobilePdfSheetIn) governs the entrance untouched.
  let motionStyle = null;
  if (closing) {
    motionStyle = prefersReducedMotion()
      ? null
      : {
        transform: 'translateY(100%)',
        opacity: 0,
        transition: `transform ${SHEET_CLOSE_MS}ms ${SHEET_CLOSE_EASING}, opacity ${SHEET_CLOSE_MS}ms linear`,
      };
  } else if (dragY > 0 && !springing) {
    // finger-follow: no transition so it tracks 1:1
    motionStyle = { transform: `translateY(${dragY}px)`, transition: 'none' };
  } else if (springing) {
    motionStyle = {
      transform: 'translateY(0)',
      transition: `transform ${SHEET_SPRING_MS}ms ${SHEET_SPRING_EASING}`,
    };
  }

  return {
    motionStyle: motionStyle || {},
    dragHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    requestClose,
    closing,
    expanded,
    setExpanded,
  };
}
