import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * Mobile bottom-sheet motion system — one motion source per sheet.
 *
 * OWNER RULING 2026-09-17: "the animation of it panning up and coming down
 * sucks." What was actually wrong, and what changed:
 *
 *  1. TWO engines fought over the same element. The entrance was a CSS keyframe
 *     (`mobilePdfSheetIn`, 180ms ease-out) while drag/close were inline
 *     transforms from this hook. A running keyframe outranks an inline
 *     transform, so grabbing or closing a sheet inside the first 180ms was
 *     simply ignored, and the two clocks read as a stutter.
 *  2. The entrance did not slide up. The keyframe travelled 24px and faded in,
 *     i.e. a pop, not a sheet rising off the bottom edge.
 *  3. The exit faded while it slid (opacity -> 0 over 170ms), so the sheet
 *     vanished in mid-travel instead of finishing its slide.
 *  4. 170-180ms ease-out at phone scale reads as abrupt.
 *
 * Now the hook owns the whole arc and writes ONLY transform (+ its transition),
 * never top/height, so it still never competes with the pdf.js render:
 *  - open: parked at translateY(100%) for one frame, then a single slide to 0
 *    over SHEET_OPEN_MS with an iOS-style decelerating curve.
 *  - close: one slide to translateY(100%) over SHEET_CLOSE_MS, at full opacity,
 *    and the real unmount/collapse fires only after that finishes.
 *  - drag: finger-follow via translateY (demo SurveySetupSheet.tsx:51-96 /
 *    inv-demo §17); release past dy>82px or vy>0.65px/ms dismisses, otherwise a
 *    short lightly-underdamped spring-back.
 *  - second detent (opt-in via options.expandable): dragging UP past 48px, or
 *    flicking up faster than the dismiss velocity, snaps the sheet to a taller
 *    70%-of-screen detent; dragging down from there returns it to its compact
 *    height before a further pull can dismiss it. The height step is
 *    deliberately NOT driven from here — the hook still only writes transform,
 *    and the sheet's own CSS eases its height — so a detent change never
 *    competes with the pdf.js render.
 *  - prefers-reduced-motion short-circuits every easing. Finger-follow drag is
 *    direct manipulation, so it stays.
 */

// demo SurveySetupSheet.tsx:51-96 — drag-dismiss thresholds
export const SHEET_DISMISS_DY = 82; // px of downward travel
export const SHEET_DISMISS_VY = 0.65; // px/ms flick velocity
// Entrance: one slide from fully offscreen. 260ms sits in the owner's
// 240-280ms window; the curve is the iOS sheet ease (fast out of the gate, long
// gentle settle) so it lands instead of stopping dead like the old ease-out.
export const SHEET_OPEN_MS = 260;
export const SHEET_OPEN_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
// Exit: slightly quicker than the entrance so dismissing feels responsive, with
// an in-cubic that accelerates the sheet off the bottom edge.
export const SHEET_CLOSE_MS = 220;
export const SHEET_CLOSE_EASING = 'cubic-bezier(0.32, 0, 0.67, 0)'; // in-cubic
// Small buffer so the final frame of the close paints before the real unmount.
export const SHEET_CLOSE_UNMOUNT_MS = SHEET_CLOSE_MS + 30;
// UX 2026-09-16 (phone reach pass): upward travel that commits to the taller
// detent. Half the dismiss distance, because expanding is the cheap, reversible
// direction. Reference: Drawboard PDF's phone page list opens to roughly two
// thirds of the screen rather than one fixed short tray.
export const SHEET_EXPAND_DY = 48; // px of upward travel
export const SHEET_EXPANDED_HEIGHT = '70dvh';
/*
 * PASS 7 (2026-09-21, DESIGN-SYSTEM.md "Phone bottom panels"): THREE named
 * heights, and a browse panel can climb two of them.
 *
 *   0 Standard   448px + the bottom safe area. Every browse panel opens here.
 *   1 Expanded   70% of the visible screen. Reached only by pulling up.
 *   2 Full       the app area below the status bar. A second pull up.
 *
 * Pulling down steps Full -> Expanded -> Standard -> closed, so a panel is never
 * lost in one gesture from the top. Only the browse panels (Pages, Search,
 * Bookmarks, Spaces, Survey, Version history, Active users) opt into this.
 *
 * RULED CHANGE 2026-09-22 (owner): these three heights are for BROWSE panels
 * only. A SETTINGS sheet - the color picker, the tool "..." sheet, the text
 * formatting sheet - is exactly as tall as its content (handle + header + body
 * + the bottom safe area) and never taller, so it names no height here: its CSS
 * is `height: auto` under the same max-height cap. Nothing in this hook has to
 * change for that, because the hook writes ONLY transform - translateY(100%)
 * parks a content-height sheet fully offscreen just as it does a 448px one, and
 * the dismiss test is finger travel and velocity, never a fraction of the
 * height. A settings sheet still passes expandable:false, which is now the
 * stronger statement that it has no taller detent to reach at all.
 */
export const SHEET_DETENT_STANDARD = 0;
export const SHEET_DETENT_EXPANDED = 1;
export const SHEET_DETENT_FULL = 2;
// spring-back settle approximating damping24/stiffness260/mass.75 — a brief
// overshoot then settle; kept subtle so it reads as a snap, not a bounce.
export const SHEET_SPRING_MS = 260;
export const SHEET_SPRING_EASING = 'cubic-bezier(0.22, 1.15, 0.36, 1)';

// Sheets live in the browser only; useLayoutEffect keeps the parked frame from
// ever painting at translateY(0), but must not warn if this is ever imported
// somewhere without a DOM.
const useSheetLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
 * @param {boolean} [options.fullscreenable]  also allow the THIRD step, full
 *   screen, from Expanded. Browse panels only; requires expandable.
 * @param {boolean} [options.open]  whether the sheet is currently shown. Drives
 *   the slide-up entrance. Sheets that mount only while open can leave this at
 *   its default; sheets that stay mounted and toggle a collapsed class (the hub
 *   tray, the survey rail) must pass their real open state.
 */
export function useMobileSheetMotion(onClose, options = {}) {
  const { canStartDrag, expandable = false, fullscreenable = false, open = true } = options;
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const [springing, setSpringing] = useState(false);
  // 0 Standard | 1 Expanded | 2 Full screen. `expanded` below is kept as the
  // boolean every existing caller reads: it means "taller than Standard".
  const [detent, setDetent] = useState(SHEET_DETENT_STANDARD);
  const maxDetent = fullscreenable ? SHEET_DETENT_FULL : SHEET_DETENT_EXPANDED;
  // null = idle | 'parked' = held offscreen for one frame | 'settling' = sliding up
  const [enterPhase, setEnterPhase] = useState(() => (
    open && !prefersReducedMotion() ? 'parked' : null
  ));
  const wasOpenRef = useRef(open);

  const startYRef = useRef(null);
  const lastYRef = useRef(null);
  const lastTRef = useRef(0);
  const vyRef = useRef(0);
  const engagedRef = useRef(false);

  // Park before paint on the frame the sheet becomes visible, so the entrance
  // always starts from fully offscreen (a passive effect here would let the
  // browser paint one frame at rest first — that was visible as a flash).
  useSheetLayoutEffect(() => {
    if (open === wasOpenRef.current) return;
    wasOpenRef.current = open;
    if (!open) {
      setEnterPhase(null);
      return;
    }
    setDragY(0);
    setSpringing(false);
    setEnterPhase(prefersReducedMotion() ? null : 'parked');
  }, [open]);

  // parked -> settling on the next frame (the transition needs a painted start
  // value to animate away from).
  useEffect(() => {
    if (enterPhase !== 'parked') return undefined;
    const raf = window.requestAnimationFrame(() => setEnterPhase('settling'));
    return () => window.cancelAnimationFrame(raf);
  }, [enterPhase]);

  // settling -> idle once the slide is done, so a drag right after the entrance
  // tracks the finger 1:1 with no leftover transition.
  useEffect(() => {
    if (enterPhase !== 'settling') return undefined;
    const timer = window.setTimeout(() => setEnterPhase(null), SHEET_OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [enterPhase]);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (prefersReducedMotion()) {
      setDragY(0);
      setSpringing(false);
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
      return;
    }
    // keep the sheet mounted + slide it down, then fire the real close
    setSpringing(false);
    setEnterPhase(null);
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setDragY(0);
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
    }, SHEET_CLOSE_UNMOUNT_MS);
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
    // A grab during the entrance takes over immediately — the old CSS keyframe
    // outranked this transform and swallowed the gesture.
    setEnterPhase(null);
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
    // Upward release on an expandable sheet: step UP one detent, at most to the
    // sheet's own ceiling (Expanded, or Full screen for a browse panel).
    if (expandable && travel < 0) {
      if (-travel > SHEET_EXPAND_DY || -vy > SHEET_DISMISS_VY) {
        setDetent((current) => Math.min(maxDetent, current + 1));
      }
      setDragY(0);
      return;
    }
    const dy = Math.max(0, travel);
    if (dy > SHEET_DISMISS_DY || vy > SHEET_DISMISS_VY) {
      // From a tall detent a downward pull steps back ONE height instead of
      // dismissing, so Full screen takes three pulls to close and a panel is
      // never lost in one gesture.
      if (detent > SHEET_DETENT_STANDARD) {
        setDetent((current) => current - 1);
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
  }, [requestClose, expandable, detent, maxDetent]);

  // Merge into the sheet element's inline style. Only ever transform +
  // transition, so this never invalidates layout for the pdf.js render.
  let motionStyle = null;
  if (closing) {
    motionStyle = prefersReducedMotion()
      ? null
      : {
        transform: 'translateY(100%)',
        transition: `transform ${SHEET_CLOSE_MS}ms ${SHEET_CLOSE_EASING}`,
      };
  } else if (dragY > 0 && !springing) {
    // finger-follow: no transition so it tracks 1:1
    motionStyle = { transform: `translateY(${dragY}px)`, transition: 'none' };
  } else if (springing) {
    motionStyle = {
      transform: 'translateY(0)',
      transition: `transform ${SHEET_SPRING_MS}ms ${SHEET_SPRING_EASING}`,
    };
  } else if (enterPhase === 'parked') {
    motionStyle = { transform: 'translateY(100%)', transition: 'none' };
  } else if (enterPhase === 'settling') {
    motionStyle = {
      transform: 'translateY(0)',
      transition: `transform ${SHEET_OPEN_MS}ms ${SHEET_OPEN_EASING}`,
    };
  }

  return {
    motionStyle: motionStyle || {},
    dragHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    requestClose,
    closing,
    // `expanded` stays the boolean it always was - "taller than Standard" - so
    // callers that only need two states are untouched.
    expanded: detent > SHEET_DETENT_STANDARD,
    fullscreen: detent >= SHEET_DETENT_FULL,
    detent,
    setDetent,
    setExpanded: (next) => setDetent(next ? SHEET_DETENT_EXPANDED : SHEET_DETENT_STANDARD),
  };
}
