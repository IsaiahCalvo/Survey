import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  KEYBOARD_MOTION_EASING,
  KEYBOARD_MOTION_MS,
  SHEET_AT_REST_ATTR,
  isKeyboardEditable,
} from './keyboardViewport.js';

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
 * Now the hook owns the whole arc, and it only ever moves the sheet with
 * `transform` (open / close, from React) and `translate` (drag, settle, height
 * glides - written straight to the element, see the MOTION ENGINE below):
 *  - open: parked at translateY(100%) for one frame, then a single slide to 0
 *    over SHEET_OPEN_MS with an iOS-style decelerating curve.
 *  - close: one slide to translateY(100%) over SHEET_CLOSE_MS, at full opacity,
 *    and the real unmount/collapse fires only after that finishes.
 *  - drag: the sheet's top edge stays under the finger, up and down; release
 *    settles to the nearest height with the finger's speed (below).
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

/*
 * TWO HEIGHTS (owner 2026-10-01, iPhone: "We have three different heights for
 * the bottom panel; I think we can get away with two: the small one and the big
 * one"). Supersedes PASS 7's Standard / Expanded (70%) / Full.
 *
 *   Standard   448px + the bottom safe area. Every browse panel opens here.
 *   Full       the app area below the status bar, down to the dock.
 *
 * A browse panel (Pages, Search, Bookmarks, Spaces, Version history, Survey)
 * passes `expandable` and can be pulled between the two; starting to type in
 * one takes it to Full. A SETTINGS sheet (colour, tool "...", text formatting)
 * and Active users have one height and never grow.
 *
 * A release lands on the NEAREST of the two heights to where the throw would
 * carry the sheet (its top edge plus SHEET_PROJECT_MS of the finger's speed),
 * and a firm flick (SHEET_DISMISS_VY) always goes the way it was thrown. A pull
 * down past SHEET_DISMISS_DY (or a downward flick) from Standard closes the
 * sheet; from Full it steps down to Standard, unless the sheet passed
 * `pullDownCloses` (the Survey panel closes from any height).
 */
export const SHEET_DETENT_STANDARD = 0;
export const SHEET_DETENT_FULL = 1;
// How far ahead (ms of the finger's speed) a release looks to pick the nearest
// height - a gentle throw carries past the half-way mark, a drag that stops
// does not.
export const SHEET_PROJECT_MS = 180;
// Upward travel that alone (a slow pull) is still "nearest Standard". Kept for
// the guard tests' vocabulary; the nearest-height rule above decides.
export const SHEET_EXPAND_DY = 48;

/*
 * SETTLE (owner 2026-10-01: "when I swipe up and down to make it grow, that
 * animation needs to be way smoother"). After a release the sheet runs a
 * critically damped spring from where the finger left it, starting at the
 * finger's own speed, so there is no speed step at the hand-off and no bounce
 * at the end. SHEET_SPRING_OMEGA (rad/s) puts a 270px Standard <-> Full move at
 * ~300ms; shorter moves finish sooner. The spring is precomputed into
 * keyframes for the Web Animations API, so it runs on the compositor - no
 * layout and no React render per frame.
 */
export const SHEET_SPRING_OMEGA = 27;
export const SHEET_SPRING_MIN_MS = 140;
export const SHEET_SPRING_MAX_MS = 420;
// The old CSS spring-back, still what a plain glide falls back to under the
// resize clock (SHEET_RESIZE_*).
export const SHEET_SPRING_MS = 260;
export const SHEET_SPRING_EASING = 'cubic-bezier(0.22, 1.15, 0.36, 1)';

/*
 * HEIGHT GLIDE (owner 2026-10-01: "tapping into the search input makes the
 * sheet SNAP to a larger size"). Whatever changes a sheet's resting box - its
 * height class, --mobile-sheet-height, the keyboard lift of a settings sheet,
 * or its own content - the new box is laid out at once and the sheet then
 * GLIDES there with `translate` only (a FLIP): it is moved back to where its
 * top edge was and slides to rest. Getting SHORTER, the old height is held
 * (data-sheet-hold) for the slide so the bottom edge never lifts off the dock,
 * and is let go on the last frame, when the two boxes coincide on screen. No
 * height animates, so nothing inside the sheet is laid out per frame.
 */
export const SHEET_RESIZE_MS = 260;
export const SHEET_RESIZE_EASING = SHEET_OPEN_EASING;

/*
 * PANEL TO PANEL (owner 2026-10-01: "switching from one panel to another via the
 * dock should also look intentional"). The dock is the phone's tab bar, so a
 * switch behaves like a tab switch under an iOS sheet (Find My, Maps): the
 * sheet STAYS where it is and its content fades through to the new panel
 * (SHEET_SWAP_MS); if the new panel stands at another height, the top edge
 * glides there (the height glide). The dim behind it never changes. A drop and
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

// The sheet's height hold (see HEIGHT GLIDE and the drag): 'full' | 'standard'
// lay it out at that named height, 'px' at --sheet-hold-height. CSS in
// mobilePdfViewer.css; data-sheet-at-rest lifts it for a measurement.
const SHEET_HOLD_ATTR = 'data-sheet-hold';
// While the sheet glides with its bottom edge above where it will rest (a
// settings sheet coming down off the keyboard), paint the sheet's colour under
// it so the page never shows through behind the falling keyboard.
const SHEET_FILL_ATTR = 'data-sheet-fill';

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

// The vertical part of the sheet's React-owned transform (open / close).
function transformY(el) {
  try {
    const transform = el.ownerDocument?.defaultView?.getComputedStyle?.(el).transform;
    if (transform && transform !== 'none') return new DOMMatrixReadOnly(transform).m42 || 0;
  } catch {
    return 0;
  }
  return 0;
}

// The vertical part of the engine's own `translate` (inline or animated).
function translateY(el) {
  const value = el.ownerDocument?.defaultView?.getComputedStyle?.(el).translate;
  if (!value || value === 'none') return 0;
  return parseFloat(String(value).split(' ')[1]) || 0;
}

/*
 * A critically damped spring from `from` to `to`, starting at `velocity`
 * (px/ms, same sign as the motion), sampled into Web Animations keyframes for
 * `translate` (and as plain { y, offset } points). No frame goes below `min`:
 * a held-tall sheet may never rise past Full, or its foot would lift off the
 * dock.
 */
export function springKeyframes(from, to, velocity = 0, { omega = SHEET_SPRING_OMEGA, min = -Infinity } = {}) {
  const w = omega / 1000; // per ms
  const x0 = from - to;
  const v0 = Number.isFinite(velocity) ? velocity : 0;
  const at = (t) => (x0 + (v0 + w * x0) * t) * Math.exp(-w * t);
  const speed = (t) => (v0 - w * (v0 + w * x0) * t) * Math.exp(-w * t);
  const step = 1000 / 60;
  let end = SHEET_SPRING_MIN_MS;
  for (let t = step; t <= SHEET_SPRING_MAX_MS; t += step) {
    end = t;
    if (Math.abs(at(t)) < 0.5 && Math.abs(speed(t)) < 0.05 && t >= SHEET_SPRING_MIN_MS) break;
  }
  const count = Math.max(2, Math.round(end / step));
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const t = (end * i) / count;
    const y = i === count ? to : Math.max(min, to + at(t));
    points.push({ y: Math.round(y * 100) / 100, offset: i / count });
  }
  const frames = points.map(({ y, offset }) => ({ translate: `0 ${y}px`, offset }));
  return { frames, points, ms: Math.round(end) };
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
 * Upward: a pull up that starts outside a scrolling list lifts an expandable
 * sheet toward Full, as the handle always did.
 *
 * OWNER 2026-10-01 ("way smoother"): what made the drag lag was a React render
 * of the whole panel (PDFSidebar, the Survey rail) on every touchmove, and a
 * pull UP that did not move the sheet at all until the finger lifted - then the
 * sheet's height animated, re-laying out every row on every frame. Now a drag
 * writes one `translate` to the sheet per move and nothing else: no React
 * state, no layout. An expandable sheet is laid out at Full for the drag
 * (data-sheet-hold, one layout when the drag takes hold) and pushed down to
 * where it stands, so pulling it up only reveals more of it from behind the
 * dock. The release springs (SETTLE above) and the hold is let go on the last
 * frame, where the held and the resting box coincide on screen.
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

const BACKDROP_SELECTOR = '.mobile-pdf-sheet-backdrop, .mobile-pdf-colorpicker-backdrop';

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
 * @param {boolean} [options.expandable]  a browse panel: it can be pulled from
 *   Standard up to Full, and rises to Full when you type in it.
 * @param {boolean} [options.fullscreenable]  accepted for older callers; with
 *   two heights an expandable sheet's taller height IS Full.
 * @param {boolean} [options.pullDownCloses]  a downward pull past the dismiss
 *   threshold closes the sheet from ANY height instead of stepping down to
 *   Standard first (the Survey panel, owner 2026-10-01: one swipe closes it and
 *   reopening restores where you were).
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
 * keyboard rules in mobilePdfViewer.css.
 */
export function useMobileSheetMotion(onClose, options = {}) {
  const { canStartDrag, contentKey, expandable = false, open = true, pullDownCloses = false } = options;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeTimerRef = useRef(0);
  const requestCloseRef = useRef(null);
  // Bumped per panel-to-panel swap so the content fade restarts (see sheetProps).
  const [swapSeq, setSwapSeq] = useState(0);
  // True while a sheet that took over from another stays open (backdropStyle).
  const [backdropInstant, setBackdropInstant] = useState(false);
  // The MOTION ENGINE (installed with the sheet element, below): drag, settle,
  // height glides - everything that moves the sheet with `translate`.
  const engineRef = useRef(null);
  // This sheet's entry in the hand-over registry. Stable object; its methods
  // are refreshed every render so they always see the latest state setters.
  const registryRef = useRef(null);
  if (!registryRef.current) registryRef.current = { openTick: -1, closeTick: -1, closeFromTop: null };
  const [closing, setClosing] = useState(false);
  // { ms, easing } of a velocity-matched close, or null for the plain slide.
  const [closeMotion, setCloseMotion] = useState(null);
  // 0 Standard | 1 Full. `expanded` / `fullscreen` below are kept as the
  // booleans existing callers read; with two heights both mean "at Full".
  const [detent, setDetent] = useState(SHEET_DETENT_STANDARD);
  const maxDetent = expandable ? SHEET_DETENT_FULL : SHEET_DETENT_STANDARD;
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
  // { from, to } while a sheet is raised for typing (see onFocusIn below).
  const typingRestoreRef = useRef(null);

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
    engineRef.current?.reset();
    setClosing(false);
    setCloseMotion(null);
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
    setEnterPhase('swap');
    setSwapSeq((n) => n + 1);
    setBackdropInstant(true);
    engineRef.current?.glideFrom(fromTop);
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
    engineRef.current?.reset();
    if (!open) {
      registry.openTick = -1;
      registry.awaitingHandover = false;
      setEnterPhase(null);
      setBackdropInstant(false);
      return;
    }
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
   * { velocity } so the slide continues at the speed of the flick.
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
      engineRef.current?.reset();
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
      return;
    }
    const sheet = sheetElRef.current;
    const tick = currentSheetTick();
    // A released drag passes { velocity }; a dock switch may pass
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
    // The close slides the sheet by its own laid-out height (translateY(100%)
    // on top of wherever the drag left it).
    const height = sheet?.offsetHeight || 0;
    if (velocity > 0 && height > 0) {
      const ms = Math.round(Math.min(SHEET_FLING_MAX_MS, Math.max(
        SHEET_FLING_MIN_MS,
        (3 * height) / Math.max(velocity, 0.5),
      )));
      motion = { ms, easing: SHEET_FLING_EASING };
    }
    // keep the sheet mounted + slide it down, then fire the real close
    engineRef.current?.stopForClose();
    setEnterPhase(null);
    setCloseMotion(motion);
    setClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      registry.closeTick = -1;
      registry.closeFromTop = null;
      engineRef.current?.reset();
      setClosing(false);
      setCloseMotion(null);
      setDetent(SHEET_DETENT_STANDARD);
      onClose?.();
    }, motion ? motion.ms + (SHEET_CLOSE_UNMOUNT_MS - SHEET_CLOSE_MS) : SHEET_CLOSE_UNMOUNT_MS);
    // finishCloseNow / registry only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, onClose, open, tracksOpen]);
  requestCloseRef.current = requestClose;

  /*
   * Where a released drag goes. `drag` is the engine's record of the drag:
   * the start height, the resting tops of Standard / Full, and where the top
   * edge is now. Returns 'close' or a detent.
   */
  const chooseRelease = useCallback((drag, vy) => {
    const restTop = drag.start === SHEET_DETENT_FULL ? drag.topFull : drag.topStandard;
    const travel = drag.top - restTop; // + is down
    const canClose = !expandable || drag.start === SHEET_DETENT_STANDARD || pullDownCloses;
    const pushedBack = vy < -0.25;
    if (canClose && travel > 0 && !pushedBack && (travel > SHEET_DISMISS_DY || vy > SHEET_DISMISS_VY)) return 'close';
    if (!expandable) return SHEET_DETENT_STANDARD;
    if (-vy > SHEET_DISMISS_VY) return SHEET_DETENT_FULL;
    if (vy > SHEET_DISMISS_VY) return SHEET_DETENT_STANDARD;
    // Nearest height to where the throw is heading.
    const projected = drag.top + Math.max(-3, Math.min(3, vy)) * SHEET_PROJECT_MS;
    return Math.abs(projected - drag.topFull) < Math.abs(projected - drag.topStandard)
      ? SHEET_DETENT_FULL
      : SHEET_DETENT_STANDARD;
  }, [expandable, pullDownCloses]);

  const release = useCallback((vy, cancelled) => {
    const engine = engineRef.current;
    const drag = engine?.dragState();
    if (!engine || !drag) return;
    // You moved the sheet yourself: it stays where you put it after typing.
    if (Math.abs(drag.top - drag.startTop) >= 1) typingRestoreRef.current = null;
    const choice = cancelled ? drag.start : chooseRelease(drag, vy);
    if (choice === 'close') {
      engine.endDragForClose();
      requestClose({ velocity: vy });
      return;
    }
    if (choice !== detent) setDetent(choice);
    engine.settle(choice, cancelled ? 0 : vy);
  }, [chooseRelease, detent, requestClose]);

  // Everything the native listeners read, fresh every render.
  const liveRef = useRef(null);
  liveRef.current = { canStartDrag, closing, detent, enterPhase, expandable, maxDetent, open, pullDownCloses, release };

  // ---------------------------------------------------------------- the gesture
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

    const engage = (y) => {
      g.mode = 'drag';
      g.anchorY = y;
      engineRef.current?.beginDrag();
      // A grab during the entrance takes over immediately (the engine has
      // already folded the entrance's transform into its own translate).
      if (liveRef.current.enterPhase) setEnterPhase(null);
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
        } else if (!(live.expandable && live.detent < live.maxDetent && g.scrollers.length === 0)) {
          g.mode = 'ignore';
          return;
        }
        // The sheet takes the finger where it is now, so the edge does not
        // jump by the slop distance.
        engage(y);
      }

      if (g.mode === 'watch') {
        // The hand-over: the list has reached its top and the finger is still
        // pulling down - from here on the sheet follows it.
        if (y > prevY && g.scrollers.every((el) => el.scrollTop <= 0)) engage(y);
        else return;
      }

      if (event.cancelable) event.preventDefault();
      engineRef.current?.dragBy(y - g.anchorY);
    };

    const onTouchEnd = (event) => {
      const mode = g.mode;
      g.mode = null;
      if (mode !== 'drag') return;
      const vy = nowMs(event) - g.lastT > SHEET_VELOCITY_STALE_MS ? 0 : g.vy;
      suppressNextClick(sheet.ownerDocument);
      liveRef.current.release(vy, event.type === 'touchcancel');
    };

    // Owner 2026-09-30: start typing in a browse sheet and it rises to Full, so
    // the field and its list sit in all the room left above the keyboard
    // (keyboardViewport.js scrolls the field into view).
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
        // Closing (the tap that closed it also took the focus): it slides off
        // at the height it has, and reopens at Standard anyway.
        if (liveRef.current?.closing) return;
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

  /*
   * ------------------------------------------------------------ MOTION ENGINE
   * Owns the sheet's `translate` (never `transform`, which is React's open /
   * close slide - the two add up), the height hold, the backdrop's dim during a
   * drag, and the keyboard padding of an expandable sheet. All of it is
   * written straight to the elements: a drag frame costs one style write and a
   * composite, never a React render or a layout.
   *
   * `box` is the laid-out box the current translate is measured from - the
   * resting box when idle - so a glide that starts while another runs picks
   * up from where the top edge is on screen.
   */
  useEffect(() => {
    const el = sheetEl;
    const doc = el?.ownerDocument;
    const view = doc?.defaultView;
    if (!el || !view) {
      engineRef.current = null;
      return undefined;
    }
    const root = doc.documentElement;
    const canAnimate = typeof el.animate === 'function';
    let mode = 'idle'; // 'idle' | 'glide' | 'drag' | 'settle'
    let anim = null;
    let box = null;
    let drag = null;
    let backdrop = null;
    let backdropAnim = null;
    let padAnim = null;
    let lastPad = null;
    let finishFrame = 0;
    let pinned = [];
    let pinnedAnims = [];
    let signature = '';
    let keyboardSignature = '';

    // The laid-out box, ignoring every transform and translate (offset* are
    // layout values; a fixed sheet's offsetTop is its distance from the top of
    // the viewport).
    const layoutBox = () => {
      const top = el.offsetTop;
      const height = el.offsetHeight;
      return { top, bottom: top + height, height };
    };
    const withHold = (hold, read) => {
      const previous = el.getAttribute(SHEET_HOLD_ATTR);
      if (hold) el.setAttribute(SHEET_HOLD_ATTR, hold);
      else el.removeAttribute(SHEET_HOLD_ATTR);
      try { return read(); } finally {
        if (previous) el.setAttribute(SHEET_HOLD_ATTR, previous);
        else el.removeAttribute(SHEET_HOLD_ATTR);
      }
    };
    const naturalBox = () => withHold(null, layoutBox);
    const setHold = (hold, px) => {
      if (hold === 'px') el.style.setProperty('--sheet-hold-height', `${px}px`);
      else el.style.removeProperty('--sheet-hold-height');
      if (hold) el.setAttribute(SHEET_HOLD_ATTR, hold);
      else el.removeAttribute(SHEET_HOLD_ATTR);
    };
    const setTranslate = (y) => {
      el.style.translate = Math.abs(y) < 0.01 ? '' : `0 ${Math.round(y * 100) / 100}px`;
    };
    // Where the top / bottom edges are on screen, leaving out React's
    // open / close transform.
    const visibleBox = () => {
      const base = box || layoutBox();
      const ty = translateY(el);
      return { top: base.top + ty, bottom: base.bottom + ty };
    };
    /*
     * BOTTOM BARS. While the sheet is laid out taller than it shows (a held
     * drag, a glide), its foot is down behind the dock - and so is anything
     * pinned to its bottom edge (the Pages "+ Add / Paste / Select" bar). Such
     * a bar is found once per motion (a full-width element, not in a list,
     * ending on the sheet's content bottom) and carried back up by the amount
     * the sheet hangs below its foot, so it stays exactly where it stood.
     */
    const findPinned = () => {
      const rect = el.getBoundingClientRect();
      const computed = view.getComputedStyle(el);
      const contentBottom = rect.bottom - (parseFloat(computed.paddingBottom) || 0) - (parseFloat(computed.borderBottomWidth) || 0);
      const found = [];
      const visit = (node, depth) => {
        for (const child of node.children) {
          const r = child.getBoundingClientRect();
          if (!r.height || r.bottom < contentBottom - 1.5 || r.top >= contentBottom) continue;
          const overflowY = view.getComputedStyle(child).overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') continue;
          if (Math.abs(r.bottom - contentBottom) < 1.5 && r.height < 120 && r.width > rect.width * 0.5) {
            found.push(child);
          } else if (depth < 5) {
            visit(child, depth + 1);
          }
        }
      };
      visit(el, 0);
      return found;
    };
    const setPinned = (y) => {
      pinned.forEach((bar) => { bar.style.translate = y > 0.01 ? `0 ${-Math.round(y * 100) / 100}px` : ''; });
    };
    const clearPinned = () => {
      pinnedAnims.forEach((a) => a.cancel());
      pinnedAnims = [];
      pinned.forEach((bar) => bar.style.removeProperty('translate'));
      pinned = [];
    };
    const stopAnim = () => {
      pinnedAnims.forEach((a) => a.cancel());
      pinnedAnims = [];
      if (!anim) return;
      const done = anim;
      anim = null;
      done.onfinish = null;
      done.cancel();
    };
    const findBackdrop = () => {
      const prev = el.previousElementSibling;
      return prev?.matches?.(BACKDROP_SELECTOR) ? prev : null;
    };
    const clearBackdrop = () => {
      backdropAnim?.cancel();
      backdropAnim = null;
      if (backdrop) {
        backdrop.style.removeProperty('opacity');
        backdrop.style.removeProperty('transition');
      }
      backdrop = null;
    };
    // Back to rest: no translate, no hold, no fill.
    const settleToRest = () => {
      window.cancelAnimationFrame(finishFrame);
      finishFrame = 0;
      stopAnim();
      clearPinned();
      setHold(null);
      setTranslate(0);
      el.removeAttribute(SHEET_FILL_ATTR);
      mode = 'idle';
      drag = null;
      box = naturalBox();
    };

    // A translate run through `points` ([{ y, offset }], y against the
    // laid-out box) - the sheet, and its bottom bars counter to it; `done`
    // runs on the last frame.
    const run = (points, ms, easing, done) => {
      stopAnim();
      if (!canAnimate || ms <= 0) {
        done();
        return;
      }
      const at = (y) => `0 ${Math.round(y * 100) / 100}px`;
      const next = el.animate(points.map(({ y, offset }) => ({ translate: at(y), offset })), { duration: ms, easing, fill: 'forwards' });
      setTranslate(0);
      if (pinned.length && points.some(({ y }) => y > 0.01)) {
        const counter = points.map(({ y, offset }) => ({ translate: at(-Math.max(0, y)), offset }));
        pinnedAnims = pinned.map((bar) => bar.animate(counter, { duration: ms, easing, fill: 'forwards' }));
        setPinned(0);
      }
      anim = next;
      next.onfinish = () => {
        if (anim !== next) return;
        done();
      };
    };

    // HEIGHT GLIDE (see the header): from the edges on screen now to the
    // resting box the sheet's CSS gives it now.
    const glide = (from, natural, timing) => {
      window.cancelAnimationFrame(finishFrame);
      stopAnim();
      if (!from || !natural
        || (Math.abs(from.top - natural.top) < 1 && Math.abs(from.bottom - natural.bottom) < 1)) {
        settleToRest();
        return;
      }
      const fromHeight = from.bottom - from.top;
      // Getting shorter: keep the old height for the slide, so the foot of the
      // sheet stays down on the dock (or behind the keyboard) the whole way.
      const hold = natural.height < fromHeight - 0.5;
      setHold(hold ? 'px' : null, fromHeight);
      const base = hold
        ? { top: natural.bottom - fromHeight, bottom: natural.bottom, height: fromHeight }
        : natural;
      box = base;
      const y0 = from.top - base.top;
      const y1 = natural.top - base.top;
      if (from.bottom < natural.bottom - 1) el.setAttribute(SHEET_FILL_ATTR, '');
      else el.removeAttribute(SHEET_FILL_ATTR);
      mode = 'glide';
      clearPinned();
      pinned = findPinned();
      run(
        [{ y: y0, offset: 0 }, { y: y1, offset: 1 }],
        timing.ms,
        timing.easing,
        settleToRest,
      );
    };

    const readKeyboardSignature = () => `${root.getAttribute('data-keyboard-open') || ''}|${root.style.getPropertyValue('--keyboard-inset')}`;
    const readSignature = () => [
      el.className,
      el.style.getPropertyValue('--mobile-sheet-height'),
      readKeyboardSignature(),
    ].join('|');

    // KEYBOARD PADDING (expandable sheets, mobilePdfViewer.css): the sheet
    // does not move for the keyboard; its content area ends at the keyboard
    // top. The padding that does this eases on the keyboard's clock, so rows
    // are covered / uncovered behind the keyboard as it moves, and a list
    // scrolled to its end comes back down WITH the keyboard instead of
    // jumping when the room returns.
    const animatePad = () => {
      if (el.getAttribute('data-sheet-keyboard') !== 'pad') return;
      const fromPad = padAnim ? parseFloat(view.getComputedStyle(el).paddingBottom) : lastPad;
      padAnim?.cancel();
      padAnim = null;
      const toPad = parseFloat(view.getComputedStyle(el).paddingBottom);
      lastPad = toPad;
      if (!canAnimate || fromPad == null || !Number.isFinite(fromPad) || Math.abs(toPad - fromPad) < 1
        || prefersReducedMotion()) return;
      const next = el.animate(
        [{ paddingBottom: `${fromPad}px` }, { paddingBottom: `${toPad}px` }],
        { duration: KEYBOARD_MOTION_MS, easing: KEYBOARD_MOTION_EASING },
      );
      padAnim = next;
      next.onfinish = () => { if (padAnim === next) padAnim = null; };
    };

    const handle = (source) => {
      if (source === 'resize' && (anim || mode === 'drag')) return; // our own hold
      const nextSignature = readSignature();
      if (source === 'mutation' && nextSignature === signature) return;
      signature = nextSignature;
      const nextKeyboard = readKeyboardSignature();
      const keyboardMoved = nextKeyboard !== keyboardSignature;
      keyboardSignature = nextKeyboard;
      if (keyboardMoved) animatePad();
      else if (!padAnim) lastPad = parseFloat(view.getComputedStyle(el).paddingBottom);
      // A drag or its settle owns the sheet; it lets go of the hold itself.
      if (mode === 'drag' || mode === 'settle') return;
      const live = liveRef.current || {};
      // Sliding shut: the close carries the sheet from where it is, at the
      // height it had (a field losing focus to the tap that closes it must
      // not drop a Full sheet to Standard under the slide).
      if (live.closing) {
        const was = box;
        const now = naturalBox();
        if (was && now.height < was.height - 0.5) {
          setHold('px', was.height);
          box = layoutBox();
        }
        return;
      }
      if (!live.open || live.enterPhase === 'parked' || prefersReducedMotion()) {
        settleToRest();
        return;
      }
      const from = visibleBox();
      const natural = naturalBox();
      if (from.bottom - from.top < 1 || natural.height < 1) {
        settleToRest();
        return;
      }
      const timing = keyboardMoved
        ? { ms: KEYBOARD_MOTION_MS, easing: KEYBOARD_MOTION_EASING }
        : { ms: SHEET_RESIZE_MS, easing: SHEET_RESIZE_EASING };
      glide(from, natural, timing);
    };

    const engine = {
      // PANEL TO PANEL: stand where the old sheet's top edge was, then glide.
      glideFrom: (fromTop) => {
        signature = readSignature();
        const natural = naturalBox();
        if (typeof fromTop !== 'number' || prefersReducedMotion()) {
          settleToRest();
          return;
        }
        glide({ top: fromTop, bottom: natural.bottom }, natural, { ms: SHEET_RESIZE_MS, easing: SHEET_RESIZE_EASING });
      },

      // The finger took the sheet. Everything on screen stays exactly where
      // it is: a running glide / settle / entrance is folded into one
      // translate, and an expandable sheet is laid out at Full and pushed down
      // to where it stands.
      beginDrag: () => {
        window.cancelAnimationFrame(finishFrame);
        finishFrame = 0;
        const live = liveRef.current || {};
        const visualTop = el.getBoundingClientRect().top;
        stopAnim();
        clearBackdrop();
        // React's entrance transform, if a grab lands mid-slide.
        el.style.transition = 'none';
        el.style.transform = 'none';
        el.removeAttribute(SHEET_FILL_ATTR);
        const start = live.detent === SHEET_DETENT_FULL ? SHEET_DETENT_FULL : SHEET_DETENT_STANDARD;
        let topStandard;
        let topFull;
        if (live.expandable) {
          topStandard = withHold('standard', layoutBox).top;
          topFull = withHold('full', layoutBox).top;
          setHold('full');
        } else {
          setHold(null);
          topStandard = layoutBox().top;
          topFull = topStandard;
        }
        box = layoutBox();
        const startY = visualTop - box.top;
        setTranslate(startY);
        clearPinned();
        pinned = findPinned();
        setPinned(startY);
        backdrop = findBackdrop();
        if (backdrop) backdrop.style.transition = 'none';
        drag = { start, startY, y: startY, top: visualTop, startTop: visualTop, topStandard, topFull };
        mode = 'drag';
      },

      // Follow the finger: `dy` px from where the drag took hold. Never above
      // the tallest resting top (the foot would lift off the dock).
      dragBy: (dy) => {
        if (mode !== 'drag' || !drag) return;
        const y = Math.max(0, drag.startY + dy);
        drag.y = y;
        drag.top = box.top + y;
        setTranslate(y);
        setPinned(y);
        if (backdrop) {
          // The dim lightens as the sheet heads off the bottom: from Full for
          // a sheet that one pull closes from there (Survey), else from
          // Standard, the last height before closed.
          const from = liveRef.current?.pullDownCloses && drag.start === SHEET_DETENT_FULL
            ? drag.topFull
            : drag.topStandard;
          const span = Math.max(1, box.bottom - from);
          const opacity = Math.max(0, Math.min(1, 1 - ((drag.top - from) / span)));
          backdrop.style.opacity = String(Math.round(opacity * 1000) / 1000);
        }
      },

      dragState: () => (mode === 'drag' && drag ? { ...drag } : null),

      // Released toward a height: spring there from the finger's speed, then
      // let go of the hold on the frame where both boxes coincide.
      settle: (target, velocity) => {
        if (!drag) return;
        const targetTop = target === SHEET_DETENT_FULL ? drag.topFull : drag.topStandard;
        const fromY = drag.y;
        const toY = targetTop - box.top;
        const fade = backdrop;
        backdrop = null;
        drag = null;
        mode = 'settle';
        // The detent's class / --mobile-sheet-height must have landed before
        // the hold goes, or the sheet would show its old height for a frame.
        const wantsFull = target === SHEET_DETENT_FULL;
        let waits = 0;
        const finish = () => {
          const isFull = el.classList.contains('is-fullscreen');
          if (liveRef.current?.expandable && isFull !== wantsFull && waits < 12) {
            waits += 1;
            finishFrame = window.requestAnimationFrame(finish);
            return;
          }
          settleToRest();
          signature = readSignature();
        };
        if (fade) {
          const opacity = parseFloat(fade.style.opacity);
          fade.style.removeProperty('opacity');
          fade.style.removeProperty('transition');
          if (canAnimate && Number.isFinite(opacity) && opacity < 0.999 && !prefersReducedMotion()) {
            backdropAnim = fade.animate([{ opacity }, { opacity: 1 }], { duration: 260, easing: SHEET_OPEN_EASING });
          }
        }
        if (prefersReducedMotion()) {
          finish();
          return;
        }
        // Never above the box's own top: that would lift its foot off the dock.
        const { points, ms } = springKeyframes(fromY, toY, velocity, { min: 0 });
        run(points, ms, 'linear', finish);
      },

      // A released drag that closes the sheet: React's close slide takes it
      // from here, on top of where the finger left it (translate stays).
      endDragForClose: () => {
        drag = null;
        mode = 'settle';
        if (backdrop) {
          backdrop.style.removeProperty('transition');
          backdrop = null;
        }
      },
      // Any close: stop gliding where the sheet is; the close slide carries it.
      stopForClose: () => {
        if (mode === 'glide' && anim) {
          const ty = translateY(el);
          stopAnim();
          setTranslate(ty);
          setPinned(ty);
        }
        el.removeAttribute(SHEET_FILL_ATTR);
      },
      // The sheet closed or (re)opened: nothing of the engine may linger.
      reset: () => {
        clearBackdrop();
        settleToRest();
        signature = readSignature();
        keyboardSignature = readKeyboardSignature();
      },
    };
    engineRef.current = engine;

    signature = readSignature();
    keyboardSignature = readKeyboardSignature();
    lastPad = parseFloat(view.getComputedStyle(el).paddingBottom);
    box = naturalBox();
    const mutations = new MutationObserver(() => handle('mutation'));
    mutations.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    mutations.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-keyboard-open'] });
    // border-box: the keyboard padding changes the content box every frame
    // while it eases, and that is not a resize of the sheet.
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => handle('resize')) : null;
    resizes?.observe(el, { box: 'border-box' });
    return () => {
      mutations.disconnect();
      resizes?.disconnect();
      window.cancelAnimationFrame(finishFrame);
      padAnim?.cancel();
      clearBackdrop();
      stopAnim();
      setHold(null);
      setTranslate(0);
      el.removeAttribute(SHEET_FILL_ATTR);
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [sheetEl]);

  // Merge into the sheet element's inline style: React's part of the motion is
  // the open / close slide, transform + transition only, so it never
  // invalidates layout for the pdf.js render. (Drag, settle and height glides
  // are the engine's `translate`, above.)
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
   * as a drag pulls the sheet down (the engine, written straight to the
   * backdrop), fades out on the sheet's own close curve (same duration and
   * easing, so the dim always matches how far the sheet has left), and is
   * already clear on the frame the real close unmounts it.
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
    // swap inside the fade restarts it. data-sheet-keyboard says how the
    // keyboard treats the sheet (mobilePdfViewer.css): a browse panel stays put
    // and pads its content ('pad'), a one-height sheet stands on it ('lift').
    sheetProps: {
      ref: sheetRef,
      'data-mobile-sheet': 'true',
      'data-sheet-keyboard': expandable ? 'pad' : 'lift',
      'data-sheet-swap': enterPhase === 'swap' ? (swapSeq % 2 ? 'a' : 'b') : undefined,
    },
    requestClose,
    closing,
    // `expanded` / `fullscreen` stay the booleans they always were for the
    // callers; with two heights both mean "at Full".
    expanded: detent > SHEET_DETENT_STANDARD,
    fullscreen: detent >= SHEET_DETENT_FULL,
    detent,
    setDetent,
    setExpanded: (next) => setDetent(next ? SHEET_DETENT_FULL : SHEET_DETENT_STANDARD),
  };
}
