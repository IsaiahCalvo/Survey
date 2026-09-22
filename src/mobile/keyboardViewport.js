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
 * the bottom of the last page needs. Nothing else consumes it, and it is
 * exactly 0 whenever the keyboard is down, so nothing moves at rest.
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
  let frame = 0;
  let disposed = false;

  const writeInset = (next) => {
    if (next === inset) return inset;
    inset = next;
    root.style.setProperty(KEYBOARD_INSET_VAR, `${next}px`);
    if (next > 0) root.setAttribute(KEYBOARD_OPEN_ATTR, 'true');
    else root.removeAttribute(KEYBOARD_OPEN_ATTR);
    onInsetChange?.(next);
    return inset;
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
    return writeInset(Math.max(measureKeyboardInset(win), nativeInset));
  };

  const schedule = () => {
    if (frame || disposed) return;
    const raf = win.requestAnimationFrame;
    if (typeof raf === 'function') {
      frame = raf(update) || 1;
      return;
    }
    update();
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
  win.addEventListener?.('focusin', schedule);
  win.addEventListener?.('focusout', schedule);
  win.addEventListener?.('keyboardWillShow', onNativeShow);
  win.addEventListener?.('keyboardDidShow', onNativeShow);
  win.addEventListener?.('keyboardWillHide', onNativeHide);
  win.addEventListener?.('keyboardDidHide', onNativeHide);

  update();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (frame && typeof win.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(frame);
    }
    frame = 0;
    vv?.removeEventListener?.('resize', schedule);
    vv?.removeEventListener?.('scroll', schedule);
    win.removeEventListener?.('resize', schedule);
    win.removeEventListener?.('orientationchange', schedule);
    win.removeEventListener?.('scroll', schedule, true);
    win.removeEventListener?.('focusin', schedule);
    win.removeEventListener?.('focusout', schedule);
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
