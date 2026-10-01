/**
 * On-screen keyboard viewport contract (owner bug 2026-09-22).
 *
 * "On the phone, when you type into a text box or callout on the page, the
 * on-screen keyboard pushes/scrolls the WHOLE app shell up (header, rail and
 * dock move) instead of only the PDF page scrolling so the text stays visible."
 *
 * A headless runner cannot raise a real soft keyboard, so these tests simulate
 * one: a 390x844 phone whose visual viewport shrinks by 336px (an iPhone
 * keyboard with its accessory bar). The controller is driven through the same
 * `update()` the real visualViewport listeners call.
 *
 * What is pinned here:
 *   - the measured inset, and the 80px floor that keeps a URL-bar collapse from
 *     counting as a keyboard;
 *   - the document is re-pinned to 0,0 — the browser's own reveal scroll is
 *     what moved the chrome, so it must be undone;
 *   - the chrome's own geometry is never written by the controller: it touches
 *     one CSS variable and one attribute on <html>, and nothing else;
 *   - the CSS that pins the shell and spends the inset on the PDF scroller;
 *   - the Capacitor config that tells the OS not to resize or scroll the
 *     web view underneath us.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEYBOARD_INSET_VAR,
  KEYBOARD_MIN_INSET_PX,
  KEYBOARD_OPEN_ATTR,
  KEYBOARD_PREDICT_FRACTION,
  createKeyboardViewportController,
  isKeyboardEditable,
  measureKeyboardInset,
  revealAboveKeyboard,
} from '../src/mobile/keyboardViewport.js';

const MOBILE_VIEWER_CSS_SOURCE = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');
const APP_SHELL_SOURCE = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const CAPACITOR_CONFIG_SOURCE = readFileSync(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
const TEXT_EDIT_OVERLAY_SOURCE = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');

// A 390x844 phone (iPhone 14/15/16/17 logical size).
const PHONE_W = 390;
const PHONE_H = 844;
const KEYBOARD_H = 336;

// Chrome rectangles as the phone viewer lays them out: header pinned to the
// top, tool rail down the left, dock pinned to the bottom. The fake DOM hands
// these back unchanged unless something writes to them — which is the point.
const chromeRects = () => ({
  header: { top: 0, left: 0, width: PHONE_W, height: 34 },
  rail: { top: 34, left: 0, width: 36, height: PHONE_H - 34 - 62 },
  dock: { top: PHONE_H - 62, left: 0, width: PHONE_W, height: 62 },
});

function createFakePhone({ keyboard = 0, revealScroll = 0 } = {}) {
  const listeners = new Map();
  const vvListeners = new Map();
  const styles = new Map();
  const attributes = new Map();

  const scrollingElement = { scrollTop: revealScroll, scrollLeft: 0 };
  const body = { scrollTop: 0, scrollLeft: 0 };

  const root = {
    style: {
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: (name) => styles.delete(name),
      getPropertyValue: (name) => styles.get(name) ?? '',
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name) ?? null,
  };

  const visualViewport = {
    width: PHONE_W,
    height: PHONE_H - keyboard,
    offsetTop: 0,
    offsetLeft: 0,
    addEventListener: (type, fn) => vvListeners.set(type, fn),
    removeEventListener: (type) => vvListeners.delete(type),
  };

  const win = {
    innerWidth: PHONE_W,
    innerHeight: PHONE_H,
    scrollX: 0,
    scrollY: revealScroll,
    visualViewport,
    document: { scrollingElement, documentElement: root, body },
    // Synchronous so a test can assert straight after dispatching.
    requestAnimationFrame: null,
    cancelAnimationFrame: () => {},
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    scrollTo: (x, y) => { win.scrollX = x; win.scrollY = y; },
  };

  return {
    win,
    root,
    styles,
    attributes,
    visualViewport,
    scrollingElement,
    // Raise the keyboard exactly as iOS Safari reports it: the visual viewport
    // shrinks, window.innerHeight does not, and the browser has meanwhile
    // scrolled the document to reveal the caret.
    raiseKeyboard(height = KEYBOARD_H, documentReveal = 0) {
      visualViewport.height = PHONE_H - height;
      win.scrollY = documentReveal;
      vvListeners.get('resize')?.();
    },
    lowerKeyboard() {
      visualViewport.height = PHONE_H;
      win.scrollY = 0;
      vvListeners.get('resize')?.();
    },
  };
}

test('no keyboard measures as no inset', () => {
  assert.equal(measureKeyboardInset(null), 0);
  assert.equal(measureKeyboardInset({ innerHeight: PHONE_H }), 0);
  assert.equal(measureKeyboardInset({
    innerHeight: PHONE_H,
    visualViewport: { height: PHONE_H, offsetTop: 0 },
  }), 0);
});

test('a URL-bar collapse is not a keyboard', () => {
  const almost = KEYBOARD_MIN_INSET_PX - 1;
  assert.equal(measureKeyboardInset({
    innerHeight: PHONE_H,
    visualViewport: { height: PHONE_H - almost, offsetTop: 0 },
  }), 0);
  assert.equal(measureKeyboardInset({
    innerHeight: PHONE_H,
    visualViewport: { height: PHONE_H - KEYBOARD_MIN_INSET_PX, offsetTop: 0 },
  }), KEYBOARD_MIN_INSET_PX);
});

test('an offset visual viewport counts towards the covered height', () => {
  // iOS Safari slides the visual viewport up inside the layout viewport as
  // well as shrinking it; both halves are keyboard.
  assert.equal(measureKeyboardInset({
    innerHeight: PHONE_H,
    visualViewport: { height: PHONE_H - 300, offsetTop: 36 },
  }), 264);
});

test('a 336px keyboard publishes the inset and the open marker; the chrome never moves', () => {
  const phone = createFakePhone();
  const before = chromeRects();
  const controller = createKeyboardViewportController({ window: phone.win, root: phone.root });

  assert.equal(controller.getInset(), 0);
  assert.equal(phone.attributes.get(KEYBOARD_OPEN_ATTR), undefined);

  phone.raiseKeyboard(KEYBOARD_H);

  assert.equal(controller.getInset(), KEYBOARD_H);
  assert.equal(phone.styles.get(KEYBOARD_INSET_VAR), `${KEYBOARD_H}px`);
  assert.equal(phone.attributes.get(KEYBOARD_OPEN_ATTR), 'true');

  // The bug: header, rail and dock used to ride up with the document. The
  // controller writes one variable and one attribute on <html> and nothing
  // else, so no chrome rectangle can change.
  assert.deepEqual(chromeRects(), before);
  assert.deepEqual([...phone.styles.keys()], [KEYBOARD_INSET_VAR]);
  assert.deepEqual([...phone.attributes.keys()], [KEYBOARD_OPEN_ATTR]);

  controller.dispose();
});

test("the browser's own reveal scroll is undone, so the shell stays pinned", () => {
  const phone = createFakePhone();
  const controller = createKeyboardViewportController({ window: phone.win, root: phone.root });

  // The browser scrolled the document 180px to reveal the focused text box.
  phone.raiseKeyboard(KEYBOARD_H, 180);

  assert.equal(phone.win.scrollY, 0, 'document must be pinned back to the top');
  assert.equal(phone.scrollingElement.scrollTop, 0);
  assert.equal(controller.getInset(), KEYBOARD_H);

  controller.dispose();
});

test('closing the keyboard puts everything back', () => {
  const phone = createFakePhone();
  const controller = createKeyboardViewportController({ window: phone.win, root: phone.root });

  phone.raiseKeyboard(KEYBOARD_H);
  assert.equal(controller.getInset(), KEYBOARD_H);

  phone.lowerKeyboard();
  assert.equal(controller.getInset(), 0);
  assert.equal(phone.styles.get(KEYBOARD_INSET_VAR), '0px');
  assert.equal(phone.attributes.get(KEYBOARD_OPEN_ATTR), undefined);

  controller.dispose();
});

test('a native Capacitor keyboard event raises the inset without visualViewport', () => {
  const phone = createFakePhone();
  const nativeListeners = new Map();
  phone.win.addEventListener = (type, fn) => nativeListeners.set(type, fn);
  phone.win.removeEventListener = (type) => nativeListeners.delete(type);

  const controller = createKeyboardViewportController({ window: phone.win, root: phone.root });

  // Keyboard.resize:'none' means the web view is NOT resized, so on a build
  // where visualViewport stays quiet the plugin's height is the only signal.
  nativeListeners.get('keyboardWillShow')?.({ detail: { keyboardHeight: 291 } });
  assert.equal(controller.getInset(), 291);
  assert.equal(phone.attributes.get(KEYBOARD_OPEN_ATTR), 'true');

  nativeListeners.get('keyboardWillHide')?.({});
  assert.equal(controller.getInset(), 0);

  controller.dispose();
});

test('disposing clears the inset so a closed viewer leaves no residue', () => {
  const phone = createFakePhone();
  const controller = createKeyboardViewportController({ window: phone.win, root: phone.root });
  phone.raiseKeyboard(KEYBOARD_H);
  controller.dispose();

  assert.equal(phone.styles.has(KEYBOARD_INSET_VAR), false);
  assert.equal(phone.attributes.has(KEYBOARD_OPEN_ATTR), false);
});

test('the mobile shell is pinned so the document has no reveal scroll to give', () => {
  assert.match(
    MOBILE_VIEWER_CSS_SOURCE,
    /html\.survey-viewer-open body \{\s*position: fixed !important;/,
    'body must be pinned to the viewport while the phone viewer is open',
  );
  assert.match(MOBILE_VIEWER_CSS_SOURCE, /--keyboard-inset:\s*0px;/, '--keyboard-inset needs a 0px default');
});

// 2026-09-30 (owner: "the keyboard must NEVER cover what you type into"): the
// inset now has exactly TWO consumers - the PDF scroller's range (below) and
// the bottom sheets, which stand on the keyboard instead of behind it. The
// header, rail and dock still never read it.
test('only the PDF scroller and the bottom sheets spend the keyboard inset', () => {
  assert.match(
    MOBILE_VIEWER_CSS_SOURCE,
    /html\.survey-viewer-open\[data-keyboard-open='true'\] \[data-mobile-pdf-surface='true'\] \[data-pdfjs-content='true'\] \{\s*box-sizing: content-box;\s*padding-bottom: var\(--keyboard-inset, 0px\);/,
    // content-box is load-bearing: the app's global border-box made the padding
    // eat the node's inline height instead of extending its box, and the PDF
    // gained ZERO extra scroll range (measured live 2026-09-22).
  );
  const sheetRule = /html\[data-keyboard-open='true'\] \[data-mobile-sheet\] \{([^}]*)\}/.exec(MOBILE_VIEWER_CSS_SOURCE);
  assert.ok(sheetRule, 'the sheets must lift onto the keyboard');
  // 2026-10-01: a sheet stands on the dock at rest, so with the keyboard up it
  // stands on whichever is higher - the keyboard or the dock's top edge.
  assert.match(sheetRule[1], /bottom: max\(var\(--keyboard-inset, 0px\), var\(--mobile-dock-bar-height\)\) !important;/);
  assert.match(sheetRule[1], /max-height: calc\(100dvh - max\(var\(--keyboard-inset, 0px\), var\(--mobile-dock-bar-height\)\)/);
  // The lift must not glide: WebKit measures the focused field in the same
  // task, and a sheet still on its way up reads as covered (the flicker).
  assert.doesNotMatch(sheetRule[1], /transition/);
  // Nothing else may react to it: the header, rail and dock stay put.
  const consumers = MOBILE_VIEWER_CSS_SOURCE.match(/var\(--keyboard-inset/g) || [];
  const inSheetRule = sheetRule[1].match(/var\(--keyboard-inset/g) || [];
  assert.equal(consumers.length, 1 + inSheetRule.length, 'only these two rules may read --keyboard-inset');
});

test('the phone viewer mounts the keyboard controller and tears it down', () => {
  assert.match(APP_SHELL_SOURCE, /import \{ createKeyboardViewportController \} from '\.\/mobile\/keyboardViewport'/);
  assert.match(
    APP_SHELL_SOURCE,
    /if \(!isMobileViewer\) return undefined;\s*\n\s*const controller = createKeyboardViewportController\(\);\s*\n\s*return \(\) => controller\.dispose\(\);/,
  );
});

test('Capacitor is told not to resize or scroll the web view for the keyboard', () => {
  assert.match(CAPACITOR_CONFIG_SOURCE, /Keyboard: \{/);
  assert.match(CAPACITOR_CONFIG_SOURCE, /resize: 'none'/);
  assert.match(CAPACITOR_CONFIG_SOURCE, /resizeOnFullScreen: false/);
  assert.match(CAPACITOR_CONFIG_SOURCE, /scroll: false/);
  // contentInset 'never' is the existing edge-to-edge ruling; the keyboard fix
  // must not have quietly changed it.
  assert.match(CAPACITOR_CONFIG_SOURCE, /contentInset: 'never'/);
});

// 2026-09-30: the text editor no longer runs its own reveal; the shared
// controller does it for every field. The editor's box names itself as the
// reveal target (with room for the tick/cross) and opts out of the focus-time
// pass, because it focuses before its final on-page box is applied.
test('the text editor uses the shared reveal, a frame after the inset lands', () => {
  assert.match(TEXT_EDIT_OVERLAY_SOURCE, /data-keyboard-reveal-target=""/);
  assert.match(TEXT_EDIT_OVERLAY_SOURCE, /data-keyboard-reveal-defer=""/);
  assert.match(TEXT_EDIT_OVERLAY_SOURCE, /data-keyboard-reveal-margin=\{ACTION_BOX_GAP \+ ACTION_TOUCH_TARGET \+ ACTION_EDGE_MARGIN\}/);
  assert.doesNotMatch(TEXT_EDIT_OVERLAY_SOURCE, /findScrollableAncestor/);
  const source = readFileSync(new URL('../src/mobile/keyboardViewport.js', import.meta.url), 'utf8');
  // The inset-change reveal is scheduled, not run inside the resize tick.
  assert.match(source, /if \(next > 0\) scheduleReveal\(\);/);
  assert.match(source, /if \(raf\) revealFrame = raf\(reveal\);/);
});

const fakeInput = () => ({ nodeType: 1, tagName: 'INPUT', getAttribute: () => 'text', closest: () => null });

test('a field taking focus lifts for a PREDICTED keyboard in the same task', () => {
  const phone = createFakePhone();
  const listeners = new Map();
  phone.win.addEventListener = (type, fn) => listeners.set(type, fn);
  phone.win.removeEventListener = (type) => listeners.delete(type);
  const controller = createKeyboardViewportController({ window: phone.win, root: phone.root, predict: true });

  // No keyboard yet: the focus alone publishes the guess, synchronously, so
  // the sheets are already clear of the keyboard when WebKit measures the
  // field (no pan, no snap back, no flicker).
  listeners.get('focusin')({ target: fakeInput() });
  const guess = Math.round(PHONE_H * KEYBOARD_PREDICT_FRACTION);
  assert.ok(controller.getInset() === guess || controller.getInset() >= KEYBOARD_MIN_INSET_PX);
  assert.equal(phone.attributes.get(KEYBOARD_OPEN_ATTR), 'true');

  // The real keyboard replaces the guess...
  phone.raiseKeyboard(KEYBOARD_H);
  assert.equal(controller.getInset(), KEYBOARD_H);
  phone.lowerKeyboard();
  assert.equal(controller.getInset(), 0);
  // ...and is the next guess.
  listeners.get('focusin')({ target: fakeInput() });
  assert.equal(controller.getInset(), KEYBOARD_H);
  controller.dispose();
});

test('no prediction without an on-screen keyboard, and never for a button', () => {
  const phone = createFakePhone();
  const listeners = new Map();
  phone.win.addEventListener = (type, fn) => listeners.set(type, fn);
  phone.win.removeEventListener = (type) => listeners.delete(type);
  const controller = createKeyboardViewportController({ window: phone.win, root: phone.root, predict: false });
  listeners.get('focusin')({ target: fakeInput() });
  assert.equal(controller.getInset(), 0);
  controller.dispose();

  const touch = createKeyboardViewportController({ window: phone.win, root: phone.root, predict: true });
  listeners.get('focusin')({ target: { nodeType: 1, tagName: 'BUTTON', getAttribute: () => null } });
  assert.equal(touch.getInset(), 0);
  touch.dispose();
});

test('isKeyboardEditable: text fields and contenteditable, not checkboxes', () => {
  const input = (type, extra = {}) => ({ nodeType: 1, tagName: 'INPUT', getAttribute: () => type, ...extra });
  assert.equal(isKeyboardEditable(input(null)), true);
  assert.equal(isKeyboardEditable(input('search')), true);
  assert.equal(isKeyboardEditable(input('number')), true);
  assert.equal(isKeyboardEditable(input('checkbox')), false);
  assert.equal(isKeyboardEditable(input('range')), false);
  assert.equal(isKeyboardEditable(input('text', { readOnly: true })), false);
  assert.equal(isKeyboardEditable({ nodeType: 1, tagName: 'TEXTAREA' }), true);
  assert.equal(isKeyboardEditable({ nodeType: 1, tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isKeyboardEditable(null), false);
});

test('revealAboveKeyboard scrolls the field\'s own list by the smallest amount', () => {
  // A list (top 100, bottom 800) whose row sits at 560-600: under a
  // 336px keyboard (visible to 508). It must end with its bottom at 508 - 12.
  const list = {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 400,
    parentElement: null,
    getBoundingClientRect: () => ({ top: 100, bottom: 800 }),
  };
  const field = {
    parentElement: list,
    closest: () => null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ top: 560 - list.scrollTop, bottom: 600 - list.scrollTop, height: 40 }),
  };
  const win = {
    innerHeight: PHONE_H,
    getComputedStyle: (el) => ({ overflowY: el === list ? 'auto' : 'visible' }),
    document: { body: {}, documentElement: {}, querySelectorAll: () => [] },
  };
  field.ownerDocument = win.document;
  const moved = revealAboveKeyboard(field, { win, inset: KEYBOARD_H });
  assert.equal(moved, true);
  assert.equal(list.scrollTop, 600 - (PHONE_H - KEYBOARD_H - 12));
  // Already visible: nothing moves.
  assert.equal(revealAboveKeyboard(field, { win, inset: KEYBOARD_H }), false);
});
