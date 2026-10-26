/**
 * touchLongPress.js — the long press that opens the page / mark menu by touch
 * (docs/GESTURE-CONTRACT.md rule L1; Drawboard touch audit 2026-10-13, T1/S2).
 *
 * A finger or pen held still for 380 ms on the page (Pan or Select tool)
 * opens the same menu a right-click opens. Until 2026-10-13 this only ran in
 * the phone layout; iPads and touch laptops now use the desktop layout, so it
 * runs on every touch screen (PdfjsViewerContainer's `touchSurface`).
 *
 * The rules, kept here so the viewer and the tests read the same numbers:
 *   - 380 ms still, 10 px slop. Drawboard's 666 ms with zero slop was
 *     measured as fragile (a fingertip always wobbles); ours stays.
 *   - Moving past the slop, a second finger, or lifting first cancels it, so
 *     a long press never fires while a pan, a pinch or a drag is under way.
 *   - Pencil only (utils/pencilMode.js, rule P2): a finger always navigates,
 *     so a finger's long press opens nothing; the pen's still does.
 *   - Pencil or Touch (the default): finger and pen alike.
 *   - A mouse never: it has the right button.
 *
 * The menu opened this way takes 44 px rows (`TOUCH_MENU_ROW_PX`): the
 * synthesized `contextmenu` event carries the input that made it
 * (`markLongPressEvent`), and the menu reads it back (`contextMenuInputOf`).
 * A touch screen's own long-press `contextmenu` (Chrome on Windows / Android
 * sends a PointerEvent with pointerType 'touch') gets the same rows.
 */
import { DRAW_MODES } from './pencilMode.js';

export const LONG_PRESS_MS = 380;
export const LONG_PRESS_MOVE_CANCEL_PX = 10;
/** Menu row height when the menu was opened by a finger or a pen. */
export const TOUCH_MENU_ROW_PX = 44;

const INPUT_KEY = '__surveyLongPressInput';

/**
 * May this contact arm the long-press menu?
 * `input`: 'touch' (a finger), 'pen' (a stylus Touch or a pen pointer), or
 * 'mouse'. `drawMode`: the Pencil-only setting (DRAW_MODES).
 */
export function longPressMayArm(input, drawMode = DRAW_MODES.TOUCH) {
  if (input === 'pen') return true;
  if (input === 'touch') return drawMode !== DRAW_MODES.PEN;
  return false;
}

/** Tag a synthesized contextmenu event with the input that made it. */
export function markLongPressEvent(event, input) {
  if (event && (input === 'touch' || input === 'pen')) {
    try { event[INPUT_KEY] = input; } catch (_) { /* frozen event: rows stay default */ }
  }
  return event;
}

/** 'touch' | 'pen' | 'mouse' — what opened this contextmenu event. */
export function contextMenuInputOf(event) {
  if (!event) return 'mouse';
  const tagged = event[INPUT_KEY];
  if (tagged === 'touch' || tagged === 'pen') return tagged;
  if (event.pointerType === 'touch' || event.pointerType === 'pen') return event.pointerType;
  return 'mouse';
}

/** Should a menu opened by `input` use the 44 px touch rows? */
export const isTouchMenuInput = (input) => input === 'touch' || input === 'pen';

/**
 * One press at a time: start / move / cancel, fire once after `delayMs` held
 * within `slopPx`. Timers are injected so the tests run without a clock.
 */
// Whether a pointer event moves or ends the armed press. A finger's touch
// events stop reaching the scroller when the element it landed on is
// re-rendered away mid-gesture (a selected mark redraws while it moves), so
// the finger's pointer stream must also move/lift the press, or the menu opens
// after the finger is already up.
export function pointerDrivesLongPress(event, penId) {
  if (event?.pointerType === 'touch') return true;
  return event?.pointerType === 'pen' && penId != null && event.pointerId === penId;
}

export function createLongPressTracker({
  onFire,
  delayMs = LONG_PRESS_MS,
  slopPx = LONG_PRESS_MOVE_CANCEL_PX,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let timer = null;
  let press = null;
  const cancel = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    press = null;
  };
  const start = (x, y, input) => {
    cancel();
    press = { x, y, input };
    timer = setTimer(() => {
      const fired = press;
      timer = null;
      press = null;
      if (fired) onFire?.(fired);
    }, delayMs);
  };
  const move = (x, y) => {
    if (!press) return;
    if (Math.abs(x - press.x) > slopPx || Math.abs(y - press.y) > slopPx) cancel();
  };
  return { start, move, cancel, isArmed: () => press != null };
}
