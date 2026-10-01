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
 *
 * OWNER 2026-10-01 (iPhone): "whenever the keyboard comes up it needs to come
 * up smooth ... in the Survey panel, tapping the name of a marker, the whole
 * app moves up quickly, even the header ... a whole flicker."
 * Why step 4 did not stop it (read in WebKit's source, WKWebViewIOS.mm
 * -_zoomToFocusRect and WKContentViewInteraction.mm
 * -_zoomToRevealFocusedElement): on an iPhone a text field always has the form
 * accessory bar, which makes WebKit pass forceScroll, so it does NOT stop at
 * "the field is already visible" - it CENTRES the field in the strip above the
 * keyboard. Any field below the middle of that strip (a marker name at y=325
 * on an 844pt screen is enough) pans the whole web view up, header included,
 * over 0.25s; step 3 then snapped it back - the flicker. The one thing that
 * method honours is a focus made with preventScroll, so:
 *   6. On iOS this controller makes every field focus that way: a tap on a
 *      field that is not focused yet is taken over (its touchend default is
 *      prevented, the field is focused with preventScroll at the tapped
 *      character, and the tap's click is replayed), and any focus() call on a
 *      field from our own code (rename, autoFocus, search) gets preventScroll.
 *      WebKit then never pans; the keyboard is ours to follow.
 *   7. Everything that follows the keyboard moves ON the keyboard's own clock
 *      (KEYBOARD_MOTION_MS / _EASING): the reveal scroll in step 5 glides
 *      instead of jumping, and so does what the sheets do with the inset
 *      (useMobileSheetMotion). Closing drops the inset the frame focus leaves
 *      the last field, so that starts down with the keyboard instead of
 *      waiting for it.
 *
 * OWNER 2026-10-01 (iPhone, after step 7): "When I bring up the keyboard and
 * dismiss it, there's this jump of the survey panel ... very flickery". A
 * browse panel no longer rides the keyboard at all (mobilePdfViewer.css, the
 * 'pad' keyboard rule): it is at Full while you type, the keyboard slides over
 * its lower part, and only its content area ends at the keyboard. Nothing of
 * the sheet moves on open or dismiss, so there is nothing to drift from the
 * real keyboard. The one-height sheets (colour, tool, text, Active users)
 * still stand on the keyboard.
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

/*
 * The iOS keyboard slides in and out in 0.25s on UIKit's keyboard curve
 * (animation curve 7), which this cubic approximates: off the mark fast, a long
 * soft landing. Everything that follows the keyboard - a sheet standing on it,
 * a list or page scrolling a field clear of it - uses exactly this, so it all
 * moves as one with the keyboard.
 */
export const KEYBOARD_MOTION_MS = 250;
export const KEYBOARD_MOTION_EASING = 'cubic-bezier(0.38, 0.7, 0.125, 1)';
// While a sheet moves (useMobileSheetMotion), this attribute pins it to its
// resting box for a measurement: mobilePdfViewer.css drops the hook's
// translate and its height hold for that instant.
export const SHEET_AT_REST_ATTR = 'data-sheet-at-rest';

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const xAt = (t) => ((ax * t + bx) * t + cx) * t;
  const yAt = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0; let hi = 1; let t = x;
    for (let i = 0; i < 20; i += 1) {
      const v = xAt(t);
      if (Math.abs(v - x) < 1e-4) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return yAt(t);
  };
}
const keyboardEase = cubicBezier(0.38, 0.7, 0.125, 1);

function prefersReducedMotion(win) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/**
 * Run `measure` with every gliding sheet laid out at its resting box, so a
 * reveal measures where the field WILL be, not a frame of the glide. The
 * attributes go back before anything paints.
 */
export function withSheetsAtRest(doc, measure) {
  const moving = doc?.querySelectorAll
    ? [...doc.querySelectorAll('[data-mobile-sheet]')].filter((sheet) => (
      sheet.hasAttribute('data-sheet-hold')
      || Boolean(sheet.style?.translate)
      || Boolean(sheet.getAnimations?.().length)
    ))
    : [];
  moving.forEach((sheet) => sheet.setAttribute(SHEET_AT_REST_ATTR, ''));
  try {
    return measure();
  } finally {
    moving.forEach((sheet) => sheet.removeAttribute(SHEET_AT_REST_ATTR));
  }
}

// Scroll containers gliding to a reveal target: el -> { to, frame, last }.
const scrollGlides = new WeakMap();
const scrollTargetOf = (el) => scrollGlides.get(el)?.to ?? el.scrollTop;

function glideScrollTop(win, el, to) {
  const previous = scrollGlides.get(el);
  if (previous) win.cancelAnimationFrame?.(previous.frame);
  scrollGlides.delete(el);
  const from = el.scrollTop;
  if (typeof win.requestAnimationFrame !== 'function' || prefersReducedMotion(win) || Math.abs(to - from) < 1) {
    el.scrollTop = to;
    return;
  }
  const clock = () => (win.performance?.now ? win.performance.now() : Date.now());
  const start = clock();
  const glide = { to, frame: 0, last: from };
  const step = () => {
    // A finger (or anything else) moved the list meanwhile: it is theirs now.
    if (Math.abs(el.scrollTop - glide.last) > 1) { scrollGlides.delete(el); return; }
    const p = Math.min(1, Math.max(0, (clock() - start) / KEYBOARD_MOTION_MS));
    el.scrollTop = from + (to - from) * keyboardEase(p);
    glide.last = el.scrollTop;
    if (p < 1) glide.frame = win.requestAnimationFrame(step);
    else scrollGlides.delete(el);
  };
  scrollGlides.set(el, glide);
  glide.frame = win.requestAnimationFrame(step);
}

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

/** iPhone / iPad WebKit (Safari, WKWebView, the Expo and Capacitor shells). */
export function isAppleTouchWebKit(win) {
  try {
    const nav = win?.navigator;
    const ua = String(nav?.userAgent || '');
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS asks for the desktop site: a "Macintosh" with a touch screen.
    return /Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1;
  } catch {
    return false;
  }
}

// The field a touch landed in: the input / textarea itself, the root of a
// contentEditable, or the control of a <label>.
function editableFromTarget(target) {
  let el = target?.nodeType === 1 ? target : target?.parentElement;
  if (!el) return null;
  if (el.tagName === 'LABEL' && el.control) el = el.control;
  if (el.isContentEditable) {
    while (el.parentElement?.isContentEditable) el = el.parentElement;
    return el;
  }
  const field = el.closest?.('input, textarea');
  return isKeyboardEditable(field) ? field : null;
}

const MIRROR_STYLE_PROPS = [
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch',
  'letterSpacing', 'wordSpacing', 'lineHeight', 'textIndent', 'textTransform',
  'textAlign', 'tabSize', 'direction',
];

/**
 * The character offset under (x, y) in an input / textarea, or null. A tap we
 * take over (step 6) must still put the caret where the finger landed, and a
 * form control's text cannot be hit-tested, so a same-styled copy of it is
 * laid over it for one synchronous measurement and removed again.
 */
export function textOffsetAtPoint(win, field, x, y) {
  const doc = field?.ownerDocument;
  const value = String(field?.value ?? '');
  if (!doc?.body || !value) return value ? null : 0;
  if (String(field.type).toLowerCase() === 'password') return value.length;
  const caretAt = doc.caretPositionFromPoint
    ? (px, py) => { const pos = doc.caretPositionFromPoint(px, py); return pos ? { node: pos.offsetNode, offset: pos.offset } : null; }
    : doc.caretRangeFromPoint
      ? (px, py) => { const range = doc.caretRangeFromPoint(px, py); return range ? { node: range.startContainer, offset: range.startOffset } : null; }
      : null;
  if (!caretAt) return null;
  const rect = field.getBoundingClientRect();
  if (!(x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return null;
  const computed = win.getComputedStyle(field);
  const single = field.tagName === 'INPUT';
  const mirror = doc.createElement('div');
  const style = mirror.style;
  MIRROR_STYLE_PROPS.forEach((prop) => { style[prop] = computed[prop]; });
  Object.assign(style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    boxSizing: 'border-box',
    margin: '0',
    borderStyle: 'solid',
    borderColor: 'transparent',
    overflow: 'hidden',
    whiteSpace: single ? 'pre' : 'pre-wrap',
    overflowWrap: single ? 'normal' : 'break-word',
    opacity: '0',
    pointerEvents: 'auto',
    zIndex: '2147483647',
  });
  if (single) {
    // ...and an input's one line sits in the middle of its box.
    const px = (prop) => parseFloat(computed[prop]) || 0;
    const inner = rect.height - px('paddingTop') - px('paddingBottom') - px('borderTopWidth') - px('borderBottomWidth');
    if (inner > 0) style.lineHeight = `${inner}px`;
  }
  const text = doc.createTextNode(value);
  mirror.appendChild(text);
  doc.body.appendChild(mirror);
  let offset = null;
  try {
    mirror.scrollTop = field.scrollTop;
    mirror.scrollLeft = field.scrollLeft;
    // An input centres its one line; read the caret on that line.
    const point = caretAt(x, single ? rect.top + rect.height / 2 : y);
    if (point?.node === text) offset = point.offset;
    else if (point?.node === mirror) offset = point.offset > 0 ? value.length : 0;
  } catch {
    offset = null;
  } finally {
    mirror.remove();
  }
  return offset == null ? null : Math.max(0, Math.min(value.length, offset));
}

/**
 * Focus `field` the way a tap would, minus WebKit's page pan: preventScroll,
 * with the caret at the tapped point.
 */
function focusFieldAt(win, field, x, y) {
  const doc = field.ownerDocument;
  if (field.isContentEditable) {
    field.focus({ preventScroll: true });
    try {
      const range = doc.caretRangeFromPoint?.(x, y);
      if (range && field.contains(range.startContainer)) {
        const selection = win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch { /* the browser's own caret stands */ }
    return;
  }
  const offset = textOffsetAtPoint(win, field, x, y);
  const place = () => {
    if (offset == null) return;
    try {
      if (field.selectionStart !== offset || field.selectionEnd !== offset) field.setSelectionRange(offset, offset);
    } catch { /* email / number fields have no selection API */ }
  };
  // Set before focusing too: WebKit restores a field's cached selection on a
  // script focus, and would otherwise select all of its text.
  place();
  field.focus({ preventScroll: true });
  place();
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
 *
 * With `animate`, the scroll glides on the keyboard's clock (step 7) instead
 * of jumping, and it is measured against where everything is going: gliding
 * sheets at their resting box, gliding scrollers at their target.
 */
export function revealAboveKeyboard(field, { win = typeof window !== 'undefined' ? window : null, inset = 0, animate = false } = {}) {
  if (!win?.getComputedStyle || !field?.getBoundingClientRect) return false;
  const doc = field.ownerDocument || win.document;
  if (animate) return withSheetsAtRest(doc, () => revealNow(field, win, doc, inset, true));
  return revealNow(field, win, doc, inset, false);
}

function revealNow(field, win, doc, inset, animate) {
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
      // Where the field will be once this scroller's own glide lands.
      const pending = animate ? scrollTargetOf(el) - el.scrollTop : 0;
      if (pending) rect = { top: rect.top - pending, bottom: rect.bottom - pending, height: rect.height };
      // Only ever scroll a covered field UP into view, and never so far that
      // its top leaves the visible strip. A field whose top is already hidden
      // is left alone ("opening an editor never moves the page" - the reveal
      // is for the keyboard, not a general scroll-into-view).
      let delta = 0;
      if (rect.bottom > bottom) {
        delta = Math.max(0, Math.min(rect.bottom - bottom, rect.top - top));
      }
      if (delta >= 1 && animate) {
        const from = scrollTargetOf(el);
        const to = Math.min(from + delta, Math.max(0, el.scrollHeight - el.clientHeight));
        if (to - from >= 1) {
          glideScrollTop(win, el, to);
          moved = true;
        }
      } else if (delta >= 1) {
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
  // Focus has left every field: the keyboard is on its way down, whatever the
  // viewport still reports, until it reports it gone (or this times out).
  let hiding = false;
  let hideTimer = 0;
  let frame = 0;
  let revealFrame = 0;
  let focusOutFrame = 0;
  const revealTimers = new Set();
  let disposed = false;
  const predicts = options.predict ?? hasOnScreenKeyboard(win);
  // Step 6 (iOS only): focus every field with preventScroll.
  const takesOverFocus = options.preventFocusPan ?? (predicts && isAppleTouchWebKit(win));
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
    if (field) revealAboveKeyboard(field, { win, inset, animate: true });
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
  const endHide = () => {
    hiding = false;
    if (hideTimer) clearTimer(hideTimer);
    hideTimer = 0;
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
    let measured = Math.max(measureKeyboardInset(win), nativeInset);
    if (hiding) {
      if (measured > 0) measured = 0;
      else endHide();
    }
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
      if (hiding) { endHide(); update(); }
      if (predicts && inset === 0) {
        predictedInset = predictKeyboardInset(win);
        if (predictTimer) clearTimer(predictTimer);
        predictTimer = setTimer
          ? setTimer(() => { predictTimer = 0; predictedInset = 0; update(); }, KEYBOARD_PREDICT_TIMEOUT_MS)
          : 0;
        writeInset(predictedInset);
      }
      if (!field.closest?.(`[${KEYBOARD_REVEAL_DEFER_ATTR}]`)) {
        revealAboveKeyboard(field, { win, inset, animate: true });
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
    // Left for good: the keyboard starts down now, so the sheet starts down
    // with it (step 7) instead of a frame-or-more later when the viewport
    // catches up.
    if (inset > 0 && raf && !focusOutFrame) {
      focusOutFrame = raf(() => {
        focusOutFrame = 0;
        if (activeEditable()) return;
        clearPrediction();
        if (predicts && !hiding) {
          hiding = true;
          hideTimer = setTimer ? setTimer(() => { hideTimer = 0; hiding = false; update(); }, KEYBOARD_PREDICT_TIMEOUT_MS) : 0;
        }
        update();
      });
    }
    schedule();
  };

  // Step 6. A tap on a field that is not focused yet: iOS would focus it from
  // the tap and then pan the whole page to centre it. Take the tap over -
  // touchend's default (the synthetic mouse events, the native focus) is
  // prevented, the field is focused with preventScroll at the tapped point,
  // and the click the tap would have produced is replayed on the field.
  // A drag, a second finger or a long press (iOS's loupe) is left alone, and
  // a tap in a field that already has focus is native (caret moves, a
  // double tap selects a word).
  const TAP_SLOP_PX = 10;
  const TAP_MAX_MS = 450;
  let tap = null;
  const onTouchStart = (event) => {
    tap = null;
    if (disposed || event.touches?.length !== 1) return;
    const field = editableFromTarget(event.target);
    const active = win.document?.activeElement;
    if (!field || field === active || field.contains?.(active)) return;
    const touch = event.touches[0];
    tap = { field, x: touch.clientX, y: touch.clientY, at: event.timeStamp };
  };
  const onTouchMove = (event) => {
    if (!tap) return;
    const touch = event.touches?.[0];
    if (!touch || event.touches.length > 1 || Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > TAP_SLOP_PX) tap = null;
  };
  const onTouchEnd = (event) => {
    const pending = tap;
    tap = null;
    if (!pending || disposed || event.type !== 'touchend' || event.touches?.length) return;
    if (event.timeStamp - pending.at > TAP_MAX_MS) return;
    const { field } = pending;
    if (!field.isConnected || !isKeyboardEditable(field) || win.document?.activeElement === field) return;
    const touch = event.changedTouches?.[0];
    const x = touch ? touch.clientX : pending.x;
    const y = touch ? touch.clientY : pending.y;
    if (event.cancelable === false) return;
    event.preventDefault();
    focusFieldAt(win, field, x, y);
    if (typeof win.MouseEvent === 'function') {
      field.dispatchEvent(new win.MouseEvent('click', {
        bubbles: true, cancelable: true, view: win, detail: 1, clientX: x, clientY: y,
      }));
    }
  };

  // ...and a focus() from our own code on a field (a rename that opens with
  // its field focused, React autoFocus, Search focusing its box) gets
  // preventScroll, for the same reason. Fields only; a button or a dialog
  // focusing keeps whatever it asked for.
  let restoreFocusMethod = null;
  if (takesOverFocus) {
    const proto = win.HTMLElement?.prototype;
    const original = proto?.focus;
    if (typeof original === 'function') {
      const focusWithoutPan = function focus(focusOptions) {
        if (!isKeyboardEditable(this)) return original.call(this, focusOptions);
        const base = focusOptions && typeof focusOptions === 'object' ? focusOptions : {};
        return original.call(this, { ...base, preventScroll: true });
      };
      proto.focus = focusWithoutPan;
      restoreFocusMethod = () => { if (proto.focus === focusWithoutPan) proto.focus = original; };
    }
  }

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
  if (takesOverFocus) {
    win.addEventListener?.('touchstart', onTouchStart, { capture: true, passive: true });
    win.addEventListener?.('touchmove', onTouchMove, { capture: true, passive: true });
    win.addEventListener?.('touchend', onTouchEnd, { capture: true, passive: false });
    win.addEventListener?.('touchcancel', onTouchEnd, { capture: true, passive: true });
  }

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
    endHide();
    restoreFocusMethod?.();
    restoreFocusMethod = null;
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
    win.removeEventListener?.('touchstart', onTouchStart, { capture: true });
    win.removeEventListener?.('touchmove', onTouchMove, { capture: true });
    win.removeEventListener?.('touchend', onTouchEnd, { capture: true });
    win.removeEventListener?.('touchcancel', onTouchEnd, { capture: true });
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
