import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isKeyboardEditable } from './keyboardViewport';

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

/*
 * SWIPE DOWN ANYWHERE (owner 2026-09-30, "like Drawboard"): a downward swipe
 * that starts ANYWHERE on a sheet - a row, a button, the header - drags the
 * sheet, not only one that starts on the grab handle. The gesture is read off
 * native listeners on the sheet element (sheetProps.ref) so the move can be
 * preventDefault-ed once the sheet owns it (React's touch props are passive).
 * What it must never break, and how:
 *   - a tap stays a tap: nothing engages until the finger travels SHEET_SLOP_PX,
 *     and a click that follows a real drag is swallowed;
 *   - list scrolling: a pull inside a list that is scrolled down scrolls the
 *     list; the moment the list reaches its top while the finger keeps pulling,
 *     the sheet takes over from there (the hand-over), and the lists do not
 *     rubber-band (overscroll-behavior in mobilePdfViewer.css);
 *   - sideways moves (a horizontal strip, a slider) are never a dismiss;
 *   - a touch that starts on a drag grip, a slider, the focused text field, or
 *     anything that set `touch-action: none` for its own gesture belongs to
 *     that control - a reorder from a grip is never a dismiss.
 * Upward: a pull up that starts outside a scrolling list steps an expandable
 * sheet up a detent, as the handle always did.
 * Release settles with the finger's velocity: a flick carries the sheet off at
 * the speed it was thrown (SHEET_FLING_EASING starts at 3x the average speed).
 */
export const SHEET_SLOP_PX = 8;
// Starts at slope 3, so a close of `ms = 3 * distance / velocity` leaves the
// finger at exactly the velocity it was released with.
export const SHEET_FLING_EASING = 'cubic-bezier(0.2, 0.6, 0.35, 1)';
const SHEET_FLING_MIN_MS = 150;
const SHEET_FLING_MAX_MS = 320;
// A finger that stopped before lifting has no velocity to carry.
const SHEET_VELOCITY_STALE_MS = 90;
const SHEET_HEIGHT_TRANSITION = `height ${SHEET_SPRING_MS}ms ${SHEET_SPRING_EASING}`;

// Controls with a drag gesture of their own. A touch that starts on one of
// these (inside the sheet) is theirs, never the sheet's.
const FOREIGN_GESTURE_SELECTOR = [
  '[data-drag-rearrange-handle]',
  '[data-drag-handle]',
  '[aria-roledescription="sortable"]',
  '.mobile-bookmark-grip',
  '[data-sheet-no-drag]',
  'input[type="range"]',
  '[role="slider"]',
].join(',');

function nowMs(event) {
  return event?.timeStamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

function isForeignGesture(target, sheet) {
  if (!target || !sheet) return true;
  const doc = sheet.ownerDocument;
  if (doc?.body?.classList?.contains('drag-rearrange-dragging')) return true;
  const foreign = target.closest?.(FOREIGN_GESTURE_SELECTOR);
  if (foreign && sheet.contains(foreign)) return true;
  // Moving a finger on the field you are typing in moves the caret.
  if (target === doc?.activeElement && isKeyboardEditable(target)) return true;
  const view = doc?.defaultView;
  for (let el = target; el && el !== sheet; el = el.parentElement) {
    if (el.classList?.contains('mobile-pdf-sheet__handle')) break;
    if (view?.getComputedStyle?.(el).touchAction === 'none') return true;
  }
  return false;
}

function scrollersBetween(target, sheet) {
  const view = sheet?.ownerDocument?.defaultView;
  const list = [];
  for (let el = target; el && el !== sheet; el = el.parentElement) {
    const overflowY = view?.getComputedStyle?.(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
      && el.scrollHeight > el.clientHeight + 1) list.push(el);
  }
  return list;
}

function suppressNextClick(doc) {
  if (!doc) return;
  const until = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 450;
  const swallow = (event) => {
    doc.removeEventListener('click', swallow, true);
    if ((typeof performance !== 'undefined' ? performance.now() : Date.now()) > until) return;
    event.stopPropagation();
    event.preventDefault();
  };
  doc.addEventListener('click', swallow, true);
  setTimeout(() => doc.removeEventListener('click', swallow, true), 500);
}

/**
 * @param {() => void} onClose  the real collapse/unmount setter; called AFTER
 *                              the slide-down completes (or immediately under
 *                              reduced motion).
 * @param {object} [options]
 * @param {(event: TouchEvent) => boolean} [options.canStartDrag]  extra guard:
 *   return false to keep a touch from ever dragging the sheet.
 * @param {boolean} [options.expandable]  opt this sheet into the taller second
 *   detent (the Pages / Search / Bookmarks tray). Off for everything else.
 * @param {boolean} [options.fullscreenable]  also allow the THIRD step, full
 *   screen, from Expanded. Browse panels only; requires expandable.
 * @param {() => boolean} [options.onPullDown]  called when a downward release
 *   passes the dismiss threshold, before the sheet steps down a detent or
 *   closes. Return true when the caller used the pull itself (the Survey panel
 *   collapses one accordion level); the sheet then springs back where it is.
 * @param {boolean} [options.open]  whether the sheet is currently shown. Drives
 *   the slide-up entrance. Sheets that mount only while open can leave this at
 *   its default; sheets that stay mounted and toggle a collapsed class (the hub
 *   tray, the survey rail) must pass their real open state.
 *
 * Spread the returned `sheetProps` on the sheet's root element: it attaches
 * the swipe-anywhere gesture and marks the sheet (data-mobile-sheet) for the
 * keyboard lift in mobilePdfViewer.css.
 */
export function useMobileSheetMotion(onClose, options = {}) {
  const { canStartDrag, expandable = false, fullscreenable = false, open = true, onPullDown } = options;
  // Read at release time, so the caller's latest state decides.
  const onPullDownRef = useRef(onPullDown);
  onPullDownRef.current = onPullDown;
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  // { ms, easing } of a velocity-matched close, or null for the plain slide.
  const [closeMotion, setCloseMotion] = useState(null);
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
  const [sheetEl, setSheetEl] = useState(null);
  const sheetElRef = useRef(null);
  const sheetRef = useCallback((el) => {
    sheetElRef.current = el;
    setSheetEl(el);
  }, []);
  const gestureRef = useRef({ mode: null });
  // The sheet's height when a drag took hold, so the backdrop's dim can follow
  // the finger as a fraction of the way off (see backdropStyle below).
  const dragHeightRef = useRef(0);
  // { from, to } while a sheet is raised for typing (see onFocusIn below).
  const typingRestoreRef = useRef(null);
  const springTimerRef = useRef(0);

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

  /**
   * Slide the sheet off and then fire the real close. Buttons and backdrops
   * call it bare (their click event is ignored); a released drag passes
   * { velocity, travel } so the slide continues at the speed of the flick.
   */
  const requestClose = useCallback((fling) => {
    if (closing) return;
    if (prefersReducedMotion()) {
      setDragY(0);
      setSpringing(false);
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
      return;
    }
    let motion = null;
    const velocity = typeof fling?.velocity === 'number' ? fling.velocity : 0;
    const travel = typeof fling?.travel === 'number' ? fling.travel : 0;
    const height = sheetElRef.current?.offsetHeight || 0;
    if (velocity > 0 && height > 0) {
      const remaining = Math.max(0, height - travel);
      const ms = Math.round(Math.min(SHEET_FLING_MAX_MS, Math.max(
        SHEET_FLING_MIN_MS,
        (3 * remaining) / Math.max(velocity, 0.5),
      )));
      motion = { ms, easing: SHEET_FLING_EASING };
    }
    // keep the sheet mounted + slide it down, then fire the real close
    setSpringing(false);
    setEnterPhase(null);
    setCloseMotion(motion);
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setCloseMotion(null);
      setDragY(0);
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
    }, motion ? motion.ms + (SHEET_CLOSE_UNMOUNT_MS - SHEET_CLOSE_MS) : SHEET_CLOSE_UNMOUNT_MS);
  }, [closing, onClose]);

  const springBack = useCallback(() => {
    if (prefersReducedMotion()) {
      setDragY(0);
      return;
    }
    setSpringing(true);
    setDragY(0);
    window.clearTimeout(springTimerRef.current);
    springTimerRef.current = window.setTimeout(() => setSpringing(false), SHEET_SPRING_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(springTimerRef.current), []);

  const release = useCallback((travel, vy) => {
    // You moved the sheet yourself: it stays where you put it after typing.
    if (travel !== 0) typingRestoreRef.current = null;
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
    if (dy <= 0) {
      setDragY(0);
      return;
    }
    // Pulled down and then pushed back up before letting go: stay.
    if (vy < -0.25) {
      springBack();
      return;
    }
    if (dy > SHEET_DISMISS_DY || vy > SHEET_DISMISS_VY) {
      // The sheet's own content may take the pull first (one level of the
      // Survey accordion closes per pull, owner 2026-10-01).
      if (typeof onPullDownRef.current === 'function' && onPullDownRef.current()) {
        springBack();
        return;
      }
      // From a tall detent a downward pull steps back ONE height instead of
      // dismissing, so Full screen takes three pulls to close and a panel is
      // never lost in one gesture. The transform springs home on the same
      // 260ms curve the height steps down on, so the top edge moves as one.
      if (detent > SHEET_DETENT_STANDARD) {
        setDetent((current) => current - 1);
        springBack();
        return;
      }
      requestClose({ velocity: vy, travel: dy });
      return;
    }
    springBack();
  }, [detent, expandable, maxDetent, requestClose, springBack]);

  // Everything the native listeners read, fresh every render.
  const liveRef = useRef(null);
  liveRef.current = { canStartDrag, closing, detent, expandable, maxDetent, open, release };

  useEffect(() => {
    const sheet = sheetEl;
    if (!sheet) return undefined;
    const g = gestureRef.current;

    const onTouchStart = (event) => {
      const live = liveRef.current;
      g.mode = null;
      if (live.closing || event.touches?.length !== 1) return;
      if (typeof live.canStartDrag === 'function' && !live.canStartDrag(event)) return;
      if (isForeignGesture(event.target, sheet)) return;
      const touch = event.touches[0];
      g.mode = 'pending';
      g.x0 = touch.clientX;
      g.y0 = touch.clientY;
      g.anchorY = touch.clientY;
      g.lastY = touch.clientY;
      g.lastT = nowMs(event);
      g.vy = 0;
      g.scrollers = scrollersBetween(event.target, sheet);
    };

    const onTouchMove = (event) => {
      if (!g.mode || g.mode === 'ignore') return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const live = liveRef.current;
      const y = touch.clientY;
      const prevY = g.lastY;
      const now = nowMs(event);
      const dt = now - g.lastT;
      if (dt > 0) g.vy = (0.7 * ((y - prevY) / dt)) + (0.3 * g.vy);
      g.lastY = y;
      g.lastT = now;

      if (g.mode === 'pending') {
        const dx = touch.clientX - g.x0;
        const dy = y - g.y0;
        if (Math.abs(dx) < SHEET_SLOP_PX && Math.abs(dy) < SHEET_SLOP_PX) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          g.mode = 'ignore';
          return;
        }
        if (dy > 0) {
          if (g.scrollers.some((el) => el.scrollTop > 0)) {
            g.mode = 'watch';
            return;
          }
          g.mode = 'drag';
          g.anchorY = y;
        } else if (live.expandable && live.detent < live.maxDetent && g.scrollers.length === 0) {
          g.mode = 'expand';
          g.anchorY = g.y0;
        } else {
          g.mode = 'ignore';
          return;
        }
        dragHeightRef.current = sheet.offsetHeight || 0;
        // A grab during the entrance takes over immediately.
        setEnterPhase(null);
        setSpringing(false);
      }

      if (g.mode === 'watch') {
        // The hand-over: the list has reached its top and the finger is still
        // pulling down - from here on the sheet follows it.
        if (y > prevY && g.scrollers.every((el) => el.scrollTop <= 0)) {
          g.mode = 'drag';
          g.anchorY = y;
          dragHeightRef.current = sheet.offsetHeight || 0;
          setEnterPhase(null);
          setSpringing(false);
        } else {
          return;
        }
      }

      if (event.cancelable) event.preventDefault();
      if (g.mode === 'drag') {
        // Note the sheet is never translated upward: it is anchored to the
        // bottom, so moving it up would open a gap beneath it.
        setDragY(Math.max(0, y - g.anchorY));
      }
    };

    const onTouchEnd = (event) => {
      const mode = g.mode;
      g.mode = null;
      if (mode !== 'drag' && mode !== 'expand') return;
      // A down-drag pushed back above where it started is a spring-back, not
      // a pull up; a pull up is never a dismiss.
      const travel = mode === 'drag'
        ? Math.max(0, g.lastY - g.anchorY)
        : Math.min(0, g.lastY - g.anchorY);
      const vy = nowMs(event) - g.lastT > SHEET_VELOCITY_STALE_MS ? 0 : g.vy;
      if (Math.abs(travel) >= SHEET_SLOP_PX || mode === 'drag') suppressNextClick(sheet.ownerDocument);
      if (event.type === 'touchcancel') {
        liveRef.current.release(0, 0);
        return;
      }
      liveRef.current.release(travel, vy);
    };

    // Owner 2026-09-30: start typing in a browse sheet and it rises to its
    // tallest height, so the field and its list sit in all the room left above
    // the keyboard (keyboardViewport.js lifts the sheet onto the keyboard and
    // scrolls the field into view).
    const onFocusIn = (event) => {
      const live = liveRef.current;
      if (!live.open || !live.expandable || !isKeyboardEditable(event.target)) return;
      if (live.detent < live.maxDetent) {
        typingRestoreRef.current = { from: live.detent, to: live.maxDetent };
        setDetent(live.maxDetent);
      }
    };
    // ...and once you are done typing (focus left every field in the sheet),
    // it settles back to the height it had, unless you moved it meanwhile.
    let focusOutFrame = 0;
    const onFocusOut = () => {
      if (!typingRestoreRef.current) return;
      window.cancelAnimationFrame(focusOutFrame);
      focusOutFrame = window.requestAnimationFrame(() => {
        const restore = typingRestoreRef.current;
        const active = sheet.ownerDocument?.activeElement;
        if (!restore || (sheet.contains(active) && isKeyboardEditable(active))) return;
        typingRestoreRef.current = null;
        setDetent((current) => (current === restore.to ? restore.from : current));
      });
    };

    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('touchend', onTouchEnd);
    sheet.addEventListener('touchcancel', onTouchEnd);
    sheet.addEventListener('focusin', onFocusIn);
    sheet.addEventListener('focusout', onFocusOut);
    return () => {
      window.cancelAnimationFrame(focusOutFrame);
      sheet.removeEventListener('focusout', onFocusOut);
      sheet.removeEventListener('touchstart', onTouchStart, { passive: true });
      sheet.removeEventListener('touchmove', onTouchMove, { passive: false });
      sheet.removeEventListener('touchend', onTouchEnd);
      sheet.removeEventListener('touchcancel', onTouchEnd);
      sheet.removeEventListener('focusin', onFocusIn);
      g.mode = null;
    };
  }, [sheetEl]);

  // Merge into the sheet element's inline style. Only ever transform +
  // transition, so this never invalidates layout for the pdf.js render. (The
  // spring's transition also carries the height leg, so a detent step that
  // lands with it moves the top edge as one motion.)
  let motionStyle = null;
  if (closing) {
    motionStyle = prefersReducedMotion()
      ? null
      : {
        transform: 'translateY(100%)',
        transition: closeMotion
          ? `transform ${closeMotion.ms}ms ${closeMotion.easing}`
          : `transform ${SHEET_CLOSE_MS}ms ${SHEET_CLOSE_EASING}`,
      };
  } else if (dragY > 0 && !springing) {
    // finger-follow: no transition so it tracks 1:1
    motionStyle = { transform: `translateY(${dragY}px)`, transition: 'none' };
  } else if (springing) {
    motionStyle = {
      transform: 'translateY(0)',
      transition: `transform ${SHEET_SPRING_MS}ms ${SHEET_SPRING_EASING}, ${SHEET_HEIGHT_TRANSITION}`,
    };
  } else if (enterPhase === 'parked') {
    motionStyle = { transform: 'translateY(100%)', transition: 'none' };
  } else if (enterPhase === 'settling') {
    motionStyle = {
      transform: 'translateY(0)',
      transition: `transform ${SHEET_OPEN_MS}ms ${SHEET_OPEN_EASING}`,
    };
  }

  /*
   * OWNER 2026-10-01 ("once it's collapsed, its collapsed version refreshes"):
   * the dim behind a sheet stayed at full strength for the whole slide down and
   * was then removed in one frame together with the sheet, so the entire screen
   * brightened in a single step right as the sheet landed - read as the page
   * and the dock "refreshing". The backdrop now goes with the sheet: it lightens
   * as a drag pulls the sheet down, fades out on the sheet's own close curve
   * (same duration and easing, so the dim always matches how far the sheet has
   * left), and is already clear on the frame the real close unmounts it.
   * Spread on the sheet's backdrop element's style. Opacity only - no layout.
   */
  let backdropStyle = null;
  if (closing) {
    backdropStyle = prefersReducedMotion()
      ? null
      : {
        opacity: 0,
        transition: closeMotion
          ? `opacity ${closeMotion.ms}ms ${closeMotion.easing}`
          : `opacity ${SHEET_CLOSE_MS}ms ${SHEET_CLOSE_EASING}`,
      };
  } else if (dragY > 0 && !springing && dragHeightRef.current > 0) {
    backdropStyle = {
      opacity: Math.max(0, 1 - (dragY / dragHeightRef.current)),
      transition: 'none',
    };
  } else if (springing) {
    backdropStyle = { opacity: 1, transition: `opacity ${SHEET_SPRING_MS}ms ease-out` };
  }

  return {
    motionStyle: motionStyle || {},
    backdropStyle: backdropStyle || undefined,
    // Spread on the sheet's root element.
    sheetProps: { ref: sheetRef, 'data-mobile-sheet': 'true' },
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
