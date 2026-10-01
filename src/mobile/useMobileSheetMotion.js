import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  KEYBOARD_MOTION_EASING,
  KEYBOARD_MOTION_MS,
  SHEET_AT_REST_ATTR,
  isKeyboardEditable,
} from './keyboardViewport';

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
 *    height before a further pull can dismiss it. The detent itself is still
 *    the sheet's CSS height; since 2026-10-01 the step between two heights is
 *    eased by the RESIZE GLIDE below (a custom-property animation on the
 *    fixed-position sheet only - its inline style stays transform-only).
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
// Exit: slightly quicker than the entrance so dismissing feels responsive.
// OWNER 2026-10-01 ("open and close equally polished, same curve family"): the
// exit was an in-cubic, which spends its first half barely moving and then
// snaps off the edge - next to the decelerating entrance it read as a lag and
// a pop. It now uses the entrance's own iOS sheet curve, so a close leaves at
// once and eases out of sight behind the dock, the way a UIKit sheet dismisses.
export const SHEET_CLOSE_MS = 220;
export const SHEET_CLOSE_EASING = SHEET_OPEN_EASING;
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

/*
 * OWNER 2026-10-01 (iPhone): "tapping into the search input makes the sheet SNAP
 * to a larger size" - and the same for every height change that is not a drag:
 * a detent step, typing (the sheet rises onto the keyboard and to Full), the
 * keyboard going away, the Survey accordion's full screen.
 *
 * The RESIZE GLIDE. Whatever changes the sheet's box - its detent class, its
 * --mobile-sheet-height, the keyboard lift (html[data-keyboard-open] and
 * --keyboard-inset), or its own content - the new box is laid out at once and
 * the sheet's HEIGHT then glides from where its top edge was to where it now
 * is (SHEET_RESIZE_MS on the entrance's iOS curve). Height, not a transform:
 * unless the keyboard moved, the bottom edge is already where it belongs (on
 * the dock), so only the top edge travels.
 *
 * The keyboard (owner 2026-10-01: "whenever the keyboard comes up it needs to
 * come up smooth"): the lift still lands in layout in the focus task
 * (keyboardViewport.js step 4), but on screen BOTH edges now glide there - the
 * bottom edge with a `translate` that starts at the dock and ends on the
 * keyboard - on the keyboard's own clock (KEYBOARD_MOTION_MS / _EASING), so the
 * sheet rises with the keyboard and settles back down with it. The instant
 * lift used to be what kept WebKit from panning the page; that pan is now
 * prevented at its source (keyboardViewport.js step 6). The page itself is
 * never moved.
 *
 * Mechanics: the Web Animations API animates a registered custom property
 * (--sheet-glide-height, @property in mobilePdfViewer.css) while
 * [data-sheet-glide] makes the sheet's height read it. It never writes the
 * inline `transition` that the callers and this hook's transform phases own,
 * so the two compose: a detent step that lands with a spring-back glides on the
 * spring's own curve and the top edge still moves as one.
 */
export const SHEET_RESIZE_MS = 240;
export const SHEET_RESIZE_EASING = SHEET_OPEN_EASING;

/*
 * PANEL TO PANEL (owner 2026-10-01: "switching from one panel to another via the
 * dock should also look intentional"). The dock is the phone's tab bar, so a
 * switch behaves like a tab switch under an iOS sheet (Find My, Maps): the
 * sheet STAYS where it is and its content fades through to the new panel
 * (SHEET_SWAP_MS); if the new panel stands at another height, the top edge
 * glides there (the resize glide). The dim behind it never changes. A drop and
 * a rise would read as two separate events, take twice as long, and flash the
 * page between them; a fade-through keeps the place and the context.
 * - One sheet element (Pages / Search / Bookmarks <-> Spaces <-> History in
 *   PDFSidebar): the caller passes `contentKey`; a new key while open fades the
 *   content in.
 * - Two sheet elements (Survey <-> the hub, Active users <-> anything): a sheet
 *   that starts closing in the same frame another starts opening hands over -
 *   the old one leaves at once and the new one appears in its place, at the old
 *   one's height, and fades its content in. Either order of the two calls works
 *   (the registry below).
 * Under reduced motion both are instant, like every other sheet motion.
 */
export const SHEET_SWAP_MS = 200;
// How long the two halves of a switch wait for each other. The new sheet waits
// offscreen (so nothing shows), the old one holds still in place; if the other
// half never comes, each falls back to its own plain slide.
const SHEET_HANDOVER_OPEN_WAIT_MS = 160;
const SHEET_HANDOVER_CLOSE_WAIT_MS = 300;

// Every mounted sheet, for the hand-over above.
const sheetRegistry = new Set();
// One "tick" per animation frame: a close and an open in the same tick are one
// switch, not two separate events.
let sheetTick = 0;
let sheetTickArmed = false;
function currentSheetTick() {
  if (!sheetTickArmed && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    sheetTickArmed = true;
    window.requestAnimationFrame(() => {
      sheetTick += 1;
      sheetTickArmed = false;
    });
  }
  return sheetTick;
}

// The sheet's laid-out box, without the hook's own translateY.
function sheetLayoutBox(el) {
  if (!el?.getBoundingClientRect) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.height) return null;
  let ty = 0;
  try {
    const transform = el.ownerDocument?.defaultView?.getComputedStyle?.(el).transform;
    if (transform && transform !== 'none') ty = new DOMMatrixReadOnly(transform).m42 || 0;
  } catch {
    ty = 0;
  }
  return { top: rect.top - ty, bottom: rect.bottom - ty, height: rect.height };
}

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
 * @param {string} [options.contentKey]  which panel the sheet shows, for a
 *   sheet that holds several (PDFSidebar). A new key while the sheet is open
 *   fades the new content in (PANEL TO PANEL above); a new key while it is
 *   sliding shut brings it back up.
 *
 * Spread the returned `sheetProps` on the sheet's root element: it attaches
 * the swipe-anywhere gesture and marks the sheet (data-mobile-sheet) for the
 * keyboard lift in mobilePdfViewer.css.
 */
export function useMobileSheetMotion(onClose, options = {}) {
  const { canStartDrag, contentKey, expandable = false, fullscreenable = false, open = true, onPullDown } = options;
  // Read at release time, so the caller's latest state decides.
  const onPullDownRef = useRef(onPullDown);
  onPullDownRef.current = onPullDown;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeTimerRef = useRef(0);
  const requestCloseRef = useRef(null);
  // Bumped per panel-to-panel swap so the content fade restarts (see sheetProps).
  const [swapSeq, setSwapSeq] = useState(0);
  // True while a sheet that took over from another stays open (backdropStyle).
  const [backdropInstant, setBackdropInstant] = useState(false);
  // The resize glide's handle (installed with the sheet element, below).
  const glideRef = useRef(null);
  // This sheet's entry in the hand-over registry. Stable object; its methods
  // are refreshed every render so they always see the latest state setters.
  const registryRef = useRef(null);
  if (!registryRef.current) registryRef.current = { openTick: -1, closeTick: -1, closeFromTop: null };
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

  // PANEL TO PANEL hand-over (see the header). `registry` is this sheet's entry.
  const registry = registryRef.current;
  // Only sheets that report their open state take part (the browse panels and
  // Active users); a sheet that simply mounts over another (the colour sheet
  // over a tool sheet) keeps its own slide.
  const tracksOpen = Object.prototype.hasOwnProperty.call(options, 'open');
  // The old sheet of a swap: gone at once, with no slide, and its real close
  // fires now (its backdrop goes with it, so the dim never doubles or blinks).
  const finishCloseNow = () => {
    window.clearTimeout(closeTimerRef.current);
    registry.closeTick = -1;
    registry.closeFromTop = null;
    registry.handingOver = false;
    setClosing(false);
    setCloseMotion(null);
    setDragY(0);
    setSpringing(false);
    setDetent(SHEET_DETENT_STANDARD);
    setEnterPhase(null);
    onCloseRef.current?.();
  };
  // The new sheet of a swap: stands in place (no slide), its top edge glides
  // from the old sheet's, and its content fades in.
  const beginSwapIn = (fromTop) => {
    // awaitingHandover stays set until the swap has rendered (the effect on
    // enterPhase below clears it): the swap's own render can land a frame or
    // two after this call, and the backdrop must stay clear until it does.
    registry.openTick = -1;
    setDragY(0);
    setSpringing(false);
    setEnterPhase('swap');
    setSwapSeq((n) => n + 1);
    setBackdropInstant(true);
    glideRef.current?.glideFrom(fromTop);
  };
  registry.vanish = finishCloseNow;
  registry.swapIn = beginSwapIn;
  registry.tracksOpen = tracksOpen;
  registry.isOpen = () => liveRef.current?.open !== false;
  registry.isLeaving = () => Boolean(liveRef.current?.closing || registry.handingOver);
  useEffect(() => {
    sheetRegistry.add(registry);
    return () => { sheetRegistry.delete(registry); };
  }, [registry]);
  // A sheet that has just started to open takes over from one that is leaving
  // in this same tick, or is holding still for a hand-over (requestClose with
  // { handover: true }). Otherwise it marks itself: a close in the same tick
  // hands over to it, and while another browse sheet is still up it waits a
  // moment offscreen for that sheet's close (the dock closes the old panel a
  // render or two after it opens the new one).
  const claimSwap = () => {
    if (!tracksOpen || prefersReducedMotion()) return false;
    const tick = currentSheetTick();
    for (const other of sheetRegistry) {
      if (other !== registry && (other.closeTick === tick || other.handingOver)) {
        const fromTop = other.closeFromTop;
        other.vanish?.();
        beginSwapIn(fromTop);
        return true;
      }
    }
    registry.openTick = tick;
    registry.awaitingHandover = [...sheetRegistry].some((other) => (
      other !== registry && other.tracksOpen && other.isOpen?.() && !other.isLeaving?.()
    ));
    return false;
  };

  // A sheet that mounts already open (Active users) can be the new half of a
  // swap too.
  useSheetLayoutEffect(() => {
    if (open) claimSwap();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new panel in the same sheet (PANEL TO PANEL): fade the content in. Runs
  // before the open effect below, so wasOpenRef still says whether the sheet
  // was already up before this render.
  const contentKeyRef = useRef(contentKey);
  useSheetLayoutEffect(() => {
    if (contentKeyRef.current === contentKey) return;
    contentKeyRef.current = contentKey;
    if (!open || !wasOpenRef.current || prefersReducedMotion()) return;
    if (closing) {
      // Asked for another panel while this one was sliding shut: stop the
      // close and bring the sheet back up from where it is.
      window.clearTimeout(closeTimerRef.current);
      registry.closeTick = -1;
      registry.closeFromTop = null;
      setClosing(false);
      setCloseMotion(null);
      setEnterPhase('settling');
      return;
    }
    if (enterPhase === null || enterPhase === 'swap') {
      setEnterPhase('swap');
      setSwapSeq((n) => n + 1);
    }
    // Only a key change starts this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  // Park before paint on the frame the sheet becomes visible, so the entrance
  // always starts from fully offscreen (a passive effect here would let the
  // browser paint one frame at rest first — that was visible as a flash).
  useSheetLayoutEffect(() => {
    if (open === wasOpenRef.current) return;
    wasOpenRef.current = open;
    if (!open) {
      registry.openTick = -1;
      registry.awaitingHandover = false;
      setEnterPhase(null);
      setBackdropInstant(false);
      return;
    }
    setDragY(0);
    setSpringing(false);
    // Replacing a sheet that is leaving in this same tick: take its place.
    if (claimSwap()) return;
    setEnterPhase(prefersReducedMotion() ? null : 'parked');
    // claimSwap reads the registry, not React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A sheet that is no longer parked is not waiting for a hand-over any more.
  useSheetLayoutEffect(() => {
    if (enterPhase !== 'parked') registry.awaitingHandover = false;
  }, [enterPhase, registry]);

  // parked -> settling on the next frame (the transition needs a painted start
  // value to animate away from).
  useEffect(() => {
    if (enterPhase !== 'parked') return undefined;
    // Functional: a swap that took over in the meantime must not be undone by
    // a frame callback queued for the slide.
    const settle = () => setEnterPhase((phase) => (phase === 'parked' ? 'settling' : phase));
    if (registry.awaitingHandover) {
      // Another browse sheet is still up: give the dock's close of it a moment
      // to arrive and hand over (claimSwap), then slide up on our own.
      const timer = window.setTimeout(() => {
        registry.awaitingHandover = false;
        settle();
      }, SHEET_HANDOVER_OPEN_WAIT_MS);
      return () => window.clearTimeout(timer);
    }
    const raf = window.requestAnimationFrame(settle);
    return () => window.cancelAnimationFrame(raf);
  }, [enterPhase, registry]);

  // settling -> idle once the slide is done, so a drag right after the entrance
  // tracks the finger 1:1 with no leftover transition. A swap's content fade
  // ends the same way.
  useEffect(() => {
    if (enterPhase !== 'settling' && enterPhase !== 'swap') return undefined;
    const phase = enterPhase;
    const timer = window.setTimeout(
      () => setEnterPhase((current) => (current === phase ? null : current)),
      phase === 'swap' ? SHEET_SWAP_MS : SHEET_OPEN_MS,
    );
    return () => window.clearTimeout(timer);
  }, [enterPhase, swapSeq]);

  /**
   * Slide the sheet off and then fire the real close. Buttons and backdrops
   * call it bare (their click event is ignored); a released drag passes
   * { velocity, travel } so the slide continues at the speed of the flick.
   */
  const requestClose = useCallback((fling) => {
    if (closing || registry.handingOver) return;
    // Already down (a dock button closing "whatever is open"): just collapse.
    // Sliding an invisible sheet would only delay the close and would read as
    // a leaving sheet to a swap in the same tick.
    if (!open) {
      onClose?.();
      return;
    }
    if (prefersReducedMotion()) {
      setDragY(0);
      setSpringing(false);
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
      return;
    }
    const sheet = sheetElRef.current;
    const tick = currentSheetTick();
    // A released drag passes { velocity, travel }; a dock switch may pass
    // { handover: true }; buttons pass their click event (ignored).
    const dragged = typeof fling?.velocity === 'number';
    if (!dragged && tracksOpen) {
      // Another sheet is opening right now: hand over to it (PANEL TO PANEL)
      // instead of sliding down under it.
      for (const other of sheetRegistry) {
        if (other !== registry && other.isOpen?.()
          && (other.openTick === tick || other.awaitingHandover)) {
          const fromTop = sheet?.getBoundingClientRect?.().top ?? null;
          finishCloseNow();
          other.swapIn?.(fromTop);
          return;
        }
      }
      registry.closeTick = tick;
      registry.closeFromTop = sheet?.getBoundingClientRect?.().top ?? null;
      if (fling?.handover === true) {
        // The caller is opening another panel that has not rendered yet: hold
        // still in place until it takes over (claimSwap), or slide down after
        // a moment if it never does.
        registry.handingOver = true;
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = window.setTimeout(() => {
          registry.handingOver = false;
          requestCloseRef.current?.();
        }, SHEET_HANDOVER_CLOSE_WAIT_MS);
        return;
      }
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
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      registry.closeTick = -1;
      registry.closeFromTop = null;
      setClosing(false);
      setCloseMotion(null);
      setDragY(0);
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
    }, motion ? motion.ms + (SHEET_CLOSE_UNMOUNT_MS - SHEET_CLOSE_MS) : SHEET_CLOSE_UNMOUNT_MS);
    // finishCloseNow / registry only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, onClose, open, tracksOpen]);
  requestCloseRef.current = requestClose;

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
  liveRef.current = { canStartDrag, closing, detent, enterPhase, expandable, maxDetent, open, release, springing };

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

  // The RESIZE GLIDE (see the header). Watches everything that can move the
  // sheet's box and glides its height from the old top edge to the new one.
  useEffect(() => {
    const el = sheetEl;
    const doc = el?.ownerDocument;
    const view = doc?.defaultView;
    if (!el || !view || typeof el.animate !== 'function') {
      glideRef.current = null;
      return undefined;
    }
    const root = doc.documentElement;
    // The laid-out box the sheet rests at, or is gliding to.
    let box = null;
    let anim = null;
    let signature = '';
    let keyboardSignature = '';
    let mutations = null;
    const readKeyboardSignature = () => `${root.getAttribute('data-keyboard-open') || ''}|${root.style.getPropertyValue('--keyboard-inset')}`;
    const readSignature = () => [
      el.className,
      el.style.getPropertyValue('--mobile-sheet-height'),
      readKeyboardSignature(),
    ].join('|');
    const stop = () => {
      if (anim) {
        const done = anim;
        anim = null;
        done.cancel();
      }
      el.removeAttribute('data-sheet-glide');
    };
    // The box the sheet's own CSS gives it right now (a running glide's
    // height and lift lifted for the measurement - SHEET_AT_REST_ATTR).
    const measureNatural = () => {
      const gliding = el.hasAttribute('data-sheet-glide');
      if (gliding) el.removeAttribute('data-sheet-glide');
      el.setAttribute(SHEET_AT_REST_ATTR, '');
      const natural = sheetLayoutBox(el);
      el.removeAttribute(SHEET_AT_REST_ATTR);
      if (gliding) el.setAttribute('data-sheet-glide', '');
      return natural;
    };
    // Where the sheet's edges are on screen this frame.
    const currentBox = () => {
      if (!box) return null;
      if (!anim) return { top: box.top, bottom: box.bottom };
      const computed = view.getComputedStyle(el);
      const height = parseFloat(computed.getPropertyValue('--sheet-glide-height'));
      const shift = parseFloat(String(computed.translate || '').split(' ')[1]) || 0;
      const bottom = box.bottom + shift;
      return { top: Number.isFinite(height) ? bottom - height : box.top + shift, bottom };
    };
    // Both edges travel from where they are to where the sheet's CSS now puts
    // them: the height (top edge) and a translate (bottom edge - only ever
    // non-zero when the keyboard lifts or lowers the sheet, step 7 in
    // keyboardViewport.js) run on one clock, so the sheet moves as one piece.
    const glide = (from, natural, timing) => {
      const startHeight = Math.max(0, Math.min(from.bottom - from.top, view.innerHeight || Infinity));
      const shift = from.bottom - natural.bottom;
      box = natural;
      if (Math.abs(startHeight - natural.height) < 1 && Math.abs(shift) < 1) {
        stop();
        return;
      }
      el.setAttribute('data-sheet-glide', '');
      const previous = anim;
      const next = el.animate(
        [
          { '--sheet-glide-height': `${startHeight}px`, translate: `0 ${shift}px` },
          { '--sheet-glide-height': `${natural.height}px`, translate: '0 0' },
        ],
        { duration: timing.ms, easing: timing.easing, fill: 'forwards' },
      );
      anim = next;
      previous?.cancel();
      next.onfinish = () => {
        if (anim !== next) return;
        stop();
        box = sheetLayoutBox(el) || box;
      };
    };
    const handle = (source) => {
      if (source === 'resize' && anim) return; // the glide itself resizing
      const nextSignature = readSignature();
      if (source === 'mutation' && nextSignature === signature) return;
      signature = nextSignature;
      const nextKeyboard = readKeyboardSignature();
      const keyboardMoved = nextKeyboard !== keyboardSignature;
      keyboardSignature = nextKeyboard;
      const live = liveRef.current || {};
      if (!live.open || live.closing || live.enterPhase === 'parked' || prefersReducedMotion()) {
        stop();
        box = sheetLayoutBox(el);
        return;
      }
      const from = currentBox();
      const natural = measureNatural();
      if (!natural || !from) {
        stop();
        box = natural;
        return;
      }
      let timing = { ms: SHEET_RESIZE_MS, easing: SHEET_RESIZE_EASING };
      if (keyboardMoved) timing = { ms: KEYBOARD_MOTION_MS, easing: KEYBOARD_MOTION_EASING };
      else if (live.springing) timing = { ms: SHEET_SPRING_MS, easing: SHEET_SPRING_EASING };
      glide(from, natural, timing);
    };
    glideRef.current = {
      // PANEL TO PANEL: stand where the old sheet's top edge was, then glide.
      glideFrom: (fromTop) => {
        signature = readSignature();
        const natural = measureNatural();
        if (!natural || typeof fromTop !== 'number' || prefersReducedMotion()) {
          stop();
          box = natural;
          return;
        }
        glide({ top: fromTop, bottom: natural.bottom }, natural, { ms: SHEET_RESIZE_MS, easing: SHEET_RESIZE_EASING });
      },
    };
    signature = readSignature();
    keyboardSignature = readKeyboardSignature();
    box = sheetLayoutBox(el);
    mutations = new MutationObserver(() => handle('mutation'));
    mutations.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    mutations.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-keyboard-open'] });
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => handle('resize')) : null;
    resizes?.observe(el);
    return () => {
      mutations.disconnect();
      resizes?.disconnect();
      stop();
      glideRef.current = null;
    };
  }, [sheetEl]);

  // Merge into the sheet element's inline style. Only ever transform +
  // transition, so this never invalidates layout for the pdf.js render. (A
  // height change - detent, keyboard - is the resize glide's, above.)
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
      transition: `transform ${SHEET_SPRING_MS}ms ${SHEET_SPRING_EASING}`,
    };
  } else if (enterPhase === 'parked') {
    motionStyle = { transform: 'translateY(100%)', transition: 'none' };
  } else if (enterPhase === 'settling') {
    motionStyle = {
      transform: 'translateY(0)',
      transition: `transform ${SHEET_OPEN_MS}ms ${SHEET_OPEN_EASING}`,
    };
  } else if (enterPhase === 'swap') {
    // Standing in for the sheet it replaced: no slide at all.
    motionStyle = { transform: 'translateY(0)', transition: 'none' };
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
  } else if (enterPhase === 'parked' && registry.awaitingHandover) {
    // Waiting offscreen to take over from the sheet still up: its dim is the
    // one showing, so this one stays clear (no double dim for those frames).
    backdropStyle = { opacity: 0, animation: 'none', visibility: 'hidden' };
  } else if (enterPhase === 'settling') {
    // A close called back mid-way (contentKey) brings the dim back with it.
    backdropStyle = { opacity: 1, transition: `opacity ${SHEET_OPEN_MS}ms ${SHEET_OPEN_EASING}` };
  }

  // PANEL TO PANEL: a sheet that took over from another opened under a dim
  // that was already there, so its backdrop skips the fade-in for as long as
  // it stays open (dropping the override later would restart the keyframe).
  if (backdropInstant) backdropStyle = { animation: 'none', ...(backdropStyle || {}) };

  return {
    motionStyle: motionStyle || {},
    backdropStyle: backdropStyle || undefined,
    // Spread on the sheet's root element. data-sheet-swap runs the PANEL TO
    // PANEL content fade (mobilePdfViewer.css); it alternates a/b so a second
    // swap inside the fade restarts it.
    sheetProps: {
      ref: sheetRef,
      'data-mobile-sheet': 'true',
      'data-sheet-swap': enterPhase === 'swap' ? (swapSeq % 2 ? 'a' : 'b') : undefined,
    },
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
