/**
 * On-screen keyboard viewport controller (phone web + Capacitor WKWebView).
 *
 * OWNER BUG 2026-09-22: "on the phone, when you type into a text box or callout
 * on the page, the on-screen keyboard pushes/scrolls the WHOLE app shell up
 * (header, rail and dock move) instead of only the PDF page scrolling so the
 * text stays visible."
 *
 * Root cause: when a field takes focus, the browser reveals it by scrolling the
 * DOCUMENT (iOS Safari also offsets the visual viewport inside the layout
 * viewport; Chrome Android resizes the layout viewport). Our chrome — header,
 * tool rail, dock — lives in that document, so the whole shell rides up and the
 * user loses the toolbar along with the caret.
 *
 * Intended UX (Drawboard PDF parity): the chrome never moves. The keyboard
 * covers the bottom of the PDF area, the page scrolls the caret back above it,
 * and everything returns when the keyboard closes.
 *
 * How this file delivers that:
 *   1. The shell is pinned (`position: fixed` lock in mobilePdfViewer.css) so
 *      the document has NO scroll range for the browser's reveal to use.
 *   2. This controller measures the keyboard from `window.visualViewport` (and
 *      from the Capacitor Keyboard plugin's DOM events when a native shell
 *      publishes them) and writes the height to `--keyboard-inset` on <html>,
 *      plus a `data-keyboard-open` marker for CSS to key off.
 *   3. It re-pins the document to 0,0 on every viewport event, so any reveal
 *      WebKit still manages to start is undone in the same frame.
 *
 * The inset is what gives the PDF scroller the extra scroll range a caret near
 * the bottom of the last page needs, and (since 2026-09-30) what lifts the
 * bottom sheets above the keyboard. It is exactly 0 whenever the keyboard is
 * down, so nothing moves at rest.
 *
 * OWNER RULING 2026-09-30: "the keyboard must NEVER cover what you type into"
 * (renaming a space: the keyboard came up with a flicker, then covered the row).
 * What was wrong:
 *   - the sheets are `position: fixed; bottom: 0`, i.e. BEHIND the keyboard, and
 *     nothing lifted them - only the PDF scroller spent the inset;
 *   - the flicker: WebKit reveals a covered field by panning the visual viewport
 *     up (the whole app rides up), and step 3 above snapped it back a frame
 *     later - up, down, then the row sat under the keyboard.
 * So this controller is now also the ONE reveal mechanism for every field:
 *   4. The moment an editable field takes focus on a touch device it publishes
 *      a PREDICTED inset (the last real keyboard height, or 41% of the screen)
 *      in the same task - before WebKit measures the field for its own reveal.
 *      The sheets lift in that same layout (mobilePdfViewer.css), so the field
 *      is already clear of where the keyboard will land and WebKit has nothing
 *      to pan: no pan, no snap-back, no flicker. The real measurement replaces
 *      the guess as soon as visualViewport reports it; if no keyboard ever
 *      comes (a hardware keyboard) the guess is dropped after a second.
 *   5. revealAboveKeyboard() then scrolls the field's own scroll containers
 *      (a sheet's list, the PDF scroller) by the smallest amount that puts it
 *      above the keyboard and above any bottom sheet that does not hold it. It
 *      runs on focus, on every inset change, while typing (a growing callout),
 *      and when a transition around the field ends (a sheet growing to full
 *      height). A field can name a bigger target / margin with
 *      data-keyboard-reveal-target / data-keyboard-reveal-margin (the PDF text
 *      editor does, so its tick/cross stay visible too).
 */

export const KEYBOARD_INSET_VAR = '--keyboard-inset';
export const KEYBOARD_OPEN_ATTR = 'data-keyboard-open';

/**
 * A browser URL bar collapsing, or a rounding wobble in the reported viewport,
 * is not a keyboard. 80px is well under the shortest iPhone keyboard (~216pt)
 * and well over any chrome-collapse delta. Shared with the tick/cross clamp in
 * src/components/TextEditOverlay.jsx, which uses the same test.
 */
export const KEYBOARD_MIN_INSET_PX = 80;

/**
 * Height the on-screen keyboard is covering, in CSS pixels, or 0 when it is
 * down. Pure: it reads a window-like object and nothing else, so the tests can
 * hand it a plain object (tests/mobileKeyboardViewport.test.mjs).
 */
export function measureKeyboardInset(win) {
  const vv = win?.visualViewport;
  if (!vv) return 0;
  const layoutHeight = Number(win.innerHeight) || 0;
  const visibleHeight = Number(vv.height) || 0;
  const offsetTop = Number(vv.offsetTop) || 0;
  const covered = layoutHeight - (visibleHeight + offsetTop);
  if (!Number.isFinite(covered) || covered < KEYBOARD_MIN_INSET_PX) return 0;
  return Math.round(covered);
}

/**
 * Before the keyboard has ever opened, guess 41% of the screen: an iPhone
 * keyboard with its suggestion bar is 336 of 844 (40%), 260 of 667 on an SE.
 * Guessing a little high only lifts the field a little higher than needed for
 * the few frames until the real height lands.
 */
export const KEYBOARD_PREDICT_FRACTION = 0.41;
// No keyboard within this long after a focus = no on-screen keyboard (a
// hardware keyboard, or a desktop-width phone emulator): drop the guess.
export const KEYBOARD_PREDICT_TIMEOUT_MS = 1200;
const KEYBOARD_MEMORY_KEY = 'survey.keyboardInset.v1';
const REVEAL_MARGIN_PX = 12;
export const KEYBOARD_REVEAL_TARGET_ATTR = 'data-keyboard-reveal-target';
export const KEYBOARD_REVEAL_MARGIN_ATTR = 'data-keyboard-reveal-margin';
// A field whose on-screen box is placed a frame AFTER it takes focus (the PDF
// text editor) opts out of the synchronous focus-time reveal; it still gets
// every later one.
export const KEYBOARD_REVEAL_DEFER_ATTR = 'data-keyboard-reveal-defer';

let rememberedInset = 0;

function readRememberedInset(win) {
  if (rememberedInset) return rememberedInset;
  try {
    const stored = Number(win?.localStorage?.getItem?.(KEYBOARD_MEMORY_KEY));
    if (Number.isFinite(stored) && stored >= KEYBOARD_MIN_INSET_PX) rememberedInset = stored;
  } catch { /* storage blocked: fall back to the fraction */ }
  return rememberedInset;
}

function rememberInset(win, px) {
  if (!(px >= KEYBOARD_MIN_INSET_PX) || px === rememberedInset) return;
  rememberedInset = px;
  try { win?.localStorage?.setItem?.(KEYBOARD_MEMORY_KEY, String(px)); } catch { /* ignore */ }
}

/** The keyboard height to lift for before the real one is known. Pure-ish. */
export function predictKeyboardInset(win) {
  const remembered = readRememberedInset(win);
  if (remembered >= KEYBOARD_MIN_INSET_PX) return remembered;
  const height = Number(win?.innerHeight) || 0;
  return height ? Math.round(height * KEYBOARD_PREDICT_FRACTION) : 0;
}

const TEXT_INPUT_TYPES = /^(|text|search|email|number|tel|url|password)$/i;

/** True for a field that raises the on-screen keyboard when focused. */
export function isKeyboardEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  if (el.disabled || el.readOnly) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.test(el.getAttribute?.('type') || '');
  return false;
}

function hasOnScreenKeyboard(win) {
  try {
    if (Number(win?.navigator?.maxTouchPoints) > 0) return true;
    return Boolean(win?.matchMedia?.('(pointer: coarse)')?.matches);
  } catch {
    return false;
  }
}

function isVerticalScroller(win, el) {
  const overflowY = win.getComputedStyle(el).overflowY;
  return (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
    && el.scrollHeight > el.clientHeight + 1;
}

function caretRectIn(win, host) {
  try {
    const selection = win.getSelection?.();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.endContainer)) return null;
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    return rect && (rect.height || rect.width) ? rect : null;
  } catch {
    return null;
  }
}

/**
 * Scroll `field` (or its data-keyboard-reveal-target ancestor) into the part of
 * the screen the user can see: above the keyboard (`inset`) and above any open
 * bottom sheet that does not contain it. Only the field's own scroll containers
 * move - never the document, which is pinned. Moves by the smallest amount; a
 * target taller than the room left keeps its top (or, for a text editor, the
 * caret is revealed instead) in view. Returns true when anything scrolled.
 */
export function revealAboveKeyboard(field, { win = typeof window !== 'undefined' ? window : null, inset = 0 } = {}) {
  if (!win?.getComputedStyle || !field?.getBoundingClientRect) return false;
  const doc = field.ownerDocument || win.document;
  const target = field.closest?.(`[${KEYBOARD_REVEAL_TARGET_ATTR}]`) || field;
  const margin = Number(target.getAttribute?.(KEYBOARD_REVEAL_MARGIN_ATTR)) || REVEAL_MARGIN_PX;
  const viewportHeight = Number(win.innerHeight) || 0;
  let visibleBottom = viewportHeight - Math.max(0, inset);
  doc?.querySelectorAll?.('[data-mobile-sheet]').forEach((sheet) => {
    if (sheet.contains(target)) return;
    const rect = sheet.getBoundingClientRect();
    // A sheet taller than three quarters of the screen leaves no page to
    // reveal into; do not let it swallow the whole visible strip.
    if (!rect.height || rect.top <= viewportHeight * 0.25) return;
    visibleBottom = Math.min(visibleBottom, rect.top);
  });
  let moved = false;
  let el = target.parentElement;
  while (el && el !== doc?.body && el !== doc?.documentElement) {
    if (isVerticalScroller(win, el)) {
      const box = el.getBoundingClientRect();
      const top = Math.max(box.top, 0) + 4;
      const bottom = Math.min(box.bottom, visibleBottom) - margin;
      let rect = target.getBoundingClientRect();
      if (rect.height > bottom - top && field.isContentEditable) {
        rect = caretRectIn(win, field) || rect;
      }
      // Only ever scroll a covered field UP into view, and never so far that
      // its top leaves the visible strip. A field whose top is already hidden
      // is left alone ("opening an editor never moves the page" - the reveal
      // is for the keyboard, not a general scroll-into-view).
      let delta = 0;
      if (rect.bottom > bottom) {
        delta = Math.max(0, Math.min(rect.bottom - bottom, rect.top - top));
      }
      if (delta >= 1) {
        const before = el.scrollTop;
        el.scrollTop = before + delta;
        if (el.scrollTop !== before) moved = true;
      }
    }
    el = el.parentElement;
  }
  return moved;
}

const NOOP_CONTROLLER = {
  update: () => 0,
  dispose: () => {},
  getInset: () => 0,
};

/**
 * Install the controller. Returns { update, dispose, getInset }.
 *
 * `update()` is the whole behaviour in one call — the tests drive it directly
 * to simulate a keyboard opening, because a headless browser cannot raise a
 * real one.
 */
export function createKeyboardViewportController(options = {}) {
  const win = options.window
    || (typeof window !== 'undefined' ? window : null);
  const root = options.root
    || win?.document?.documentElement
    || null;
  if (!win || !root?.style) return NOOP_CONTROLLER;

  const onInsetChange = typeof options.onInsetChange === 'function'
    ? options.onInsetChange
    : null;

  let inset = 0;
  let nativeInset = 0;
  let predictedInset = 0;
  let predictTimer = 0;
  let frame = 0;
  let revealFrame = 0;
  let focusOutFrame = 0;
  const revealTimers = new Set();
  let disposed = false;
  const predicts = options.predict ?? hasOnScreenKeyboard(win);
  const raf = typeof win.requestAnimationFrame === 'function'
    ? (fn) => win.requestAnimationFrame(fn) || 1
    : null;
  const caf = (id) => { if (id && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(id); };
  const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : null;
  const clearTimer = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : () => {};

  const activeEditable = () => {
    const active = win.document?.activeElement;
    return isKeyboardEditable(active) ? active : null;
  };

  const reveal = () => {
    revealFrame = 0;
    if (disposed) return;
    const field = activeEditable();
    if (field) revealAboveKeyboard(field, { win, inset });
  };
  const scheduleReveal = () => {
    if (revealFrame || disposed) return;
    if (raf) revealFrame = raf(reveal);
    else reveal();
  };
  // A sheet growing to its full height (useMobileSheetMotion), or the lift
  // settling, moves the field after the first reveal: look again once those
  // transitions are done.
  const revealLater = (ms) => {
    if (!setTimer) return;
    const id = setTimer(() => { revealTimers.delete(id); reveal(); }, ms);
    revealTimers.add(id);
  };

  const writeInset = (next) => {
    if (next === inset) return inset;
    inset = next;
    root.style.setProperty(KEYBOARD_INSET_VAR, `${next}px`);
    if (next > 0) root.setAttribute(KEYBOARD_OPEN_ATTR, 'true');
    else root.removeAttribute(KEYBOARD_OPEN_ATTR);
    onInsetChange?.(next);
    // Deferred one frame: the inset has to land in layout (sheet lift, PDF
    // scroll range) before the field can be measured against it.
    if (next > 0) scheduleReveal();
    return inset;
  };

  const clearPrediction = () => {
    predictedInset = 0;
    if (predictTimer) clearTimer(predictTimer);
    predictTimer = 0;
  };

  // Undo the browser's own "scroll the document so the focused field shows".
  // With the shell pinned there is normally nothing to undo; WebKit can still
  // offset the visual viewport inside the layout viewport, and that is what
  // drags the fixed chrome off the top of the screen.
  const pinDocument = () => {
    const vv = win.visualViewport;
    const pageY = Number(win.scrollY ?? win.pageYOffset ?? 0) || 0;
    const pageX = Number(win.scrollX ?? win.pageXOffset ?? 0) || 0;
    const offsetTop = Number(vv?.offsetTop) || 0;
    const offsetLeft = Number(vv?.offsetLeft) || 0;
    if (!pageY && !pageX && !offsetTop && !offsetLeft) return;
    win.scrollTo?.(0, 0);
    const doc = win.document;
    const scroller = doc?.scrollingElement || doc?.documentElement;
    if (scroller) { scroller.scrollTop = 0; scroller.scrollLeft = 0; }
    if (doc?.body) { doc.body.scrollTop = 0; doc.body.scrollLeft = 0; }
  };

  const update = () => {
    frame = 0;
    if (disposed) return inset;
    pinDocument();
    // A native plugin height wins only when it is the larger of the two: with
    // `Keyboard.resize: "none"` the webview is not resized, and visualViewport
    // is still the honest measure in every WKWebView build we ship to.
    const measured = Math.max(measureKeyboardInset(win), nativeInset);
    if (measured > 0) {
      // The real keyboard replaces the guess, and becomes the next guess.
      clearPrediction();
      rememberInset(win, measured);
    }
    return writeInset(measured || predictedInset);
  };

  const schedule = () => {
    if (frame || disposed) return;
    if (raf) {
      frame = raf(update);
      return;
    }
    update();
  };

  // Step 4 in the header: runs synchronously inside the focus dispatch, i.e.
  // before WebKit measures the field to decide whether to pan the page.
  const onFocusIn = (event) => {
    const field = isKeyboardEditable(event?.target) ? event.target : null;
    if (field && !disposed) {
      if (focusOutFrame) { caf(focusOutFrame); focusOutFrame = 0; }
      if (predicts && inset === 0) {
        predictedInset = predictKeyboardInset(win);
        if (predictTimer) clearTimer(predictTimer);
        predictTimer = setTimer
          ? setTimer(() => { predictTimer = 0; predictedInset = 0; update(); }, KEYBOARD_PREDICT_TIMEOUT_MS)
          : 0;
        writeInset(predictedInset);
      }
      if (!field.closest?.(`[${KEYBOARD_REVEAL_DEFER_ATTR}]`)) {
        revealAboveKeyboard(field, { win, inset });
      }
      scheduleReveal();
      revealLater(180);
      revealLater(420);
    }
    schedule();
  };

  const onFocusOut = () => {
    if (disposed) return;
    // Focus moving field to field keeps the keyboard up: decide a frame later.
    if (predictedInset && raf && !focusOutFrame) {
      focusOutFrame = raf(() => {
        focusOutFrame = 0;
        if (!activeEditable()) { clearPrediction(); update(); }
      });
    }
    schedule();
  };

  // Typing can grow the field (a callout wrapping onto a new line) down under
  // the keyboard: follow it.
  const onInput = () => { if (inset > 0) scheduleReveal(); };
  const onTransitionEnd = (event) => {
    if (inset <= 0) return;
    const field = activeEditable();
    if (field && event?.target?.contains?.(field)) scheduleReveal();
  };

  // Capacitor's @capacitor/keyboard plugin publishes these on window. They are
  // plain DOM events, so listening costs nothing when the plugin is absent —
  // which it is today; visualViewport carries the whole job in that case.
  const onNativeShow = (event) => {
    const height = Number(event?.detail?.keyboardHeight);
    nativeInset = Number.isFinite(height) && height >= KEYBOARD_MIN_INSET_PX
      ? Math.round(height)
      : 0;
    schedule();
  };
  const onNativeHide = () => {
    nativeInset = 0;
    schedule();
  };

  const vv = win.visualViewport || null;
  vv?.addEventListener?.('resize', schedule);
  vv?.addEventListener?.('scroll', schedule);
  win.addEventListener?.('resize', schedule);
  win.addEventListener?.('orientationchange', schedule);
  win.addEventListener?.('scroll', schedule, true);
  win.addEventListener?.('focusin', onFocusIn);
  win.addEventListener?.('focusout', onFocusOut);
  win.addEventListener?.('input', onInput, true);
  win.addEventListener?.('transitionend', onTransitionEnd, true);
  win.addEventListener?.('keyboardWillShow', onNativeShow);
  win.addEventListener?.('keyboardDidShow', onNativeShow);
  win.addEventListener?.('keyboardWillHide', onNativeHide);
  win.addEventListener?.('keyboardDidHide', onNativeHide);

  update();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    caf(frame);
    caf(revealFrame);
    caf(focusOutFrame);
    frame = 0;
    revealFrame = 0;
    focusOutFrame = 0;
    clearPrediction();
    revealTimers.forEach((id) => clearTimer(id));
    revealTimers.clear();
    vv?.removeEventListener?.('resize', schedule);
    vv?.removeEventListener?.('scroll', schedule);
    win.removeEventListener?.('resize', schedule);
    win.removeEventListener?.('orientationchange', schedule);
    win.removeEventListener?.('scroll', schedule, true);
    win.removeEventListener?.('focusin', onFocusIn);
    win.removeEventListener?.('focusout', onFocusOut);
    win.removeEventListener?.('input', onInput, true);
    win.removeEventListener?.('transitionend', onTransitionEnd, true);
    win.removeEventListener?.('keyboardWillShow', onNativeShow);
    win.removeEventListener?.('keyboardDidShow', onNativeShow);
    win.removeEventListener?.('keyboardWillHide', onNativeHide);
    win.removeEventListener?.('keyboardDidHide', onNativeHide);
    root.style.removeProperty(KEYBOARD_INSET_VAR);
    root.removeAttribute(KEYBOARD_OPEN_ATTR);
    inset = 0;
  };

  return {
    update,
    dispose,
    getInset: () => inset,
  };
}
