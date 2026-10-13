/**
 * The on-screen keyboard on the DESKTOP layout of a touch device (owner
 * 2026-10-13, Drawboard touch audit K1 / chunk E).
 *
 * iPads and touch laptops show the desktop layout (src/utils/layoutMode.js),
 * so their on-screen keyboard could cover a text box low on the page, a
 * Survey Marker's name low in the right rail, or a dialog's field. AppShell
 * now mounts the phone's keyboard controller there too, in its `desktop`
 * mode. Pinned here:
 *   - the mount: phone viewer OR (touch device AND desktop viewer AND not
 *     Electron) - never a mouse-only desktop;
 *   - a hardware keyboard changes nothing (no predicted keyboard; a shortcut
 *     bar under 80px is not a keyboard);
 *   - a real keyboard publishes the inset, and leaving the field starts it
 *     down at once;
 *   - a pinch-zoomed page is not a keyboard and is not re-pinned;
 *   - iOS: taps are taken over, focus() gets preventScroll only for a field
 *     already on screen; a touch laptop's browser is left alone;
 *   - a dialog still covered stands on the keyboard and goes back down;
 *   - the desktop CSS: the page area's scroll room and the lists' room,
 *     inside the desktop-layout media query.
 * A headless runner cannot raise a real keyboard; the visual viewport is
 * shrunk by hand, as tests/mobileKeyboardViewport.test.mjs does for the phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEYBOARD_INSET_VAR,
  KEYBOARD_OPEN_ATTR,
  createKeyboardViewportController,
  fullyInView,
} from '../src/mobile/keyboardViewport.js';
import { DESKTOP_LAYOUT_MEDIA } from '../src/utils/layoutMode.js';

const APP_SHELL_SOURCE = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const MOBILE_VIEWER_CSS_SOURCE = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');

// An iPad Pro 12.9" upright, and its keyboard with the shortcut bar.
const W = 1024;
const H = 1366;
const KEYBOARD_H = 380;
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

function createFakeTablet({ ua = IPAD_UA, height = H } = {}) {
  const listeners = new Map();
  const vvListeners = new Map();
  const docListeners = new Map();
  const styles = new Map();
  const attributes = new Map();
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
    width: W, height, offsetTop: 0, offsetLeft: 0, scale: 1,
    addEventListener: (type, fn) => vvListeners.set(type, fn),
    removeEventListener: (type) => vvListeners.delete(type),
  };
  const calls = [];
  class FakeElement {}
  FakeElement.prototype.focus = function focus(options) { calls.push({ el: this, options }); win.document.activeElement = this; };
  const scrolls = [];
  const win = {
    innerWidth: W,
    innerHeight: height,
    scrollX: 0,
    scrollY: 0,
    visualViewport,
    navigator: { userAgent: ua, maxTouchPoints: 5 },
    HTMLElement: FakeElement,
    document: {
      documentElement: root,
      body: {},
      scrollingElement: { scrollTop: 0, scrollLeft: 0 },
      activeElement: null,
      visibilityState: 'visible',
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: (type, fn) => docListeners.set(type, fn),
      removeEventListener: (type) => docListeners.delete(type),
    },
    requestAnimationFrame: null,
    cancelAnimationFrame: () => {},
    getComputedStyle: (el) => el.computed || { overflowY: 'visible', overflowX: 'visible', position: 'static', translate: el.style?.translate || 'none' },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    scrollTo: (x, y) => { scrolls.push([x, y]); win.scrollX = x; win.scrollY = y; },
  };
  return {
    win, root, styles, attributes, listeners, docListeners, calls, scrolls, FakeElement, visualViewport,
    keyboard(px) { visualViewport.height = height - px; vvListeners.get('resize')?.(); },
  };
}

const fakeInput = (extra = {}) => ({ nodeType: 1, tagName: 'INPUT', getAttribute: () => 'text', closest: () => null, ...extra });

test('AppShell mounts it for the desktop viewer on a touch device only, never in Electron', () => {
  assert.match(APP_SHELL_SOURCE, /import \{ hasTouchInput, isElectronApp \} from '\.\/utils\/layoutMode\.js';/);
  assert.match(APP_SHELL_SOURCE, /const \[touchDesktop\] = useState\(\(\) => hasTouchInput\(\) && !isElectronApp\(\)\);/);
  assert.match(APP_SHELL_SOURCE, /const isTouchDesktopViewer = Boolean\(touchDesktop && isViewerVisible && !isNarrowShell\);/);
  assert.match(APP_SHELL_SOURCE, /createKeyboardViewportController\(isMobileViewer \? undefined : \{ desktop: true \}\)/);
  // The right rail's zoom / page stack sits where an iPad keyboard lands: it
  // stands on the keyboard while its field is typed in.
  assert.match(APP_SHELL_SOURCE, /<div data-chrome-rail="true" data-keyboard-lift="" style=/);
  // The tab strip's dialog layer is not a `#root > div` (the phone sizes
  // those to the full screen, which pushed the viewer off it).
  assert.match(APP_SHELL_SOURCE, /<section data-tab-strip-dialogs="" style=\{\{ position: 'relative', zIndex: 6500 \}\}>/);
});

test('a hardware keyboard changes nothing: no predicted keyboard, a shortcut bar is not one', () => {
  const t = createFakeTablet();
  const controller = createKeyboardViewportController({ window: t.win, root: t.root, desktop: true });
  t.listeners.get('focusin')({ target: fakeInput() });
  assert.equal(controller.getInset(), 0, 'no guess on focus');
  assert.equal(t.attributes.has(KEYBOARD_OPEN_ATTR), false);
  // iPadOS with a Magic Keyboard: a ~55px shortcut bar at the bottom.
  t.keyboard(55);
  assert.equal(controller.getInset(), 0);
  assert.equal(t.attributes.has(KEYBOARD_OPEN_ATTR), false);
  controller.dispose();
});

test('the real on-screen keyboard publishes the inset; leaving the field starts it down at once', () => {
  const t = createFakeTablet();
  const frames = [];
  t.win.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const flush = () => { while (frames.length) frames.shift()(); };
  const controller = createKeyboardViewportController({ window: t.win, root: t.root, desktop: true });
  t.keyboard(KEYBOARD_H);
  flush();
  assert.equal(controller.getInset(), KEYBOARD_H);
  assert.equal(t.styles.get(KEYBOARD_INSET_VAR), `${KEYBOARD_H}px`);
  assert.equal(t.attributes.get(KEYBOARD_OPEN_ATTR), 'true');
  t.listeners.get('focusout')({});
  flush();
  assert.equal(controller.getInset(), 0, 'down with the blur, before the viewport reports it');
  t.keyboard(0);
  flush();
  assert.equal(controller.getInset(), 0);
  controller.dispose();
  assert.equal(t.styles.has(KEYBOARD_INSET_VAR), false);
});

test('a pinch-zoomed page is not a keyboard, and is not re-pinned', () => {
  const t = createFakeTablet();
  const controller = createKeyboardViewportController({ window: t.win, root: t.root, desktop: true });
  t.visualViewport.scale = 2;
  t.visualViewport.offsetTop = 300;
  t.keyboard(H / 2);
  assert.equal(controller.getInset(), 0);
  assert.deepEqual(t.scrolls, [], 'the pinch is the user\'s; nothing scrolls it back');
  controller.dispose();
});

test('iOS: taps are taken over; focus() gets preventScroll only for a field already on screen', () => {
  const t = createFakeTablet();
  const original = t.FakeElement.prototype.focus;
  const controller = createKeyboardViewportController({ window: t.win, root: t.root, desktop: true });
  assert.equal(t.listeners.has('touchend'), true, 'taps are taken over (no WebKit pan of the whole app)');
  const onScreen = Object.assign(new t.FakeElement(), fakeInput({
    getBoundingClientRect: () => ({ top: 600, bottom: 640, left: 100, right: 300, width: 200, height: 40 }),
    parentElement: null,
  }));
  const offScreen = Object.assign(new t.FakeElement(), fakeInput({
    getBoundingClientRect: () => ({ top: 1500, bottom: 1540, left: 100, right: 300, width: 200, height: 40 }),
    parentElement: null,
  }));
  onScreen.focus();
  offScreen.focus();
  assert.equal(t.calls[0].options.preventScroll, true);
  assert.equal(t.calls[1].options, undefined, 'an off-screen field still scrolls into view');
  controller.dispose();
  assert.equal(t.FakeElement.prototype.focus, original, 'dispose restores focus()');
});

test('a touch laptop\'s browser keeps its own taps, focus and background behaviour', () => {
  const t = createFakeTablet({ ua: WINDOWS_UA });
  const original = t.FakeElement.prototype.focus;
  const controller = createKeyboardViewportController({ window: t.win, root: t.root, desktop: true });
  assert.equal(t.listeners.has('touchend'), false);
  assert.equal(t.FakeElement.prototype.focus, original);
  // Switching windows does not end the typing in a dialog there.
  let blurred = false;
  t.win.document.activeElement = fakeInput({ closest: () => ({}), blur: () => { blurred = true; } });
  t.win.document.visibilityState = 'hidden';
  t.docListeners.get('visibilitychange')({ type: 'visibilitychange' });
  assert.equal(blurred, false);
  controller.dispose();
});

test('fullyInView: inside the window and inside every clipping box', () => {
  const win = {
    innerWidth: W,
    innerHeight: H,
    getComputedStyle: (el) => el.computed || { overflowY: 'visible', overflowX: 'visible' },
  };
  const list = {
    computed: { overflowY: 'auto', overflowX: 'hidden' },
    getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 0, right: 400 }),
    parentElement: null,
  };
  const rowAt = (top) => ({ getBoundingClientRect: () => ({ top, bottom: top + 30, left: 10, right: 300, width: 290, height: 30 }), parentElement: list });
  assert.equal(fullyInView(win, rowAt(200)), true);
  assert.equal(fullyInView(win, rowAt(480)), false, 'clipped by its list');
  assert.equal(fullyInView(win, { getBoundingClientRect: () => ({ top: 1400, bottom: 1430, left: 0, right: 10, width: 10, height: 30 }), parentElement: null }), false);
  assert.equal(fullyInView(win, { getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }), parentElement: null }), false);
});

test('a dialog still covered stands on the keyboard, and goes back down with it', () => {
  // Landscape iPad: 1024 tall, a 420px keyboard leaves 604px. A dialog card
  // from 380 to 640 with its field at 450-494.
  const t = createFakeTablet({ height: 1024 });
  const dialog = {
    style: { translate: '' },
    getBoundingClientRect: () => ({ top: 380, bottom: 640, height: 260 }),
    closest: () => null,
  };
  const field = fakeInput({
    getBoundingClientRect: () => ({ top: 450, bottom: 494, height: 44 }),
    closest: (selector) => (selector.includes('role="dialog"') ? dialog : null),
    parentElement: null,
  });
  field.ownerDocument = t.win.document;
  t.win.document.activeElement = field;
  const controller = createKeyboardViewportController({ window: t.win, root: t.root, desktop: true, preventFocusPan: false });
  t.keyboard(420);
  assert.equal(controller.getInset(), 420);
  // The whole card clears the keyboard by 8px: 640 + 8 - 604 = 44.
  assert.equal(dialog.style.translate, '0 -44px');
  t.keyboard(0);
  assert.equal(controller.getInset(), 0);
  assert.equal(dialog.style.translate, '', 'back down with the keyboard');
  controller.dispose();
});

test('a panel-sized holder never moves', () => {
  const t = createFakeTablet({ height: 1024 });
  const panel = {
    style: { translate: '' },
    getBoundingClientRect: () => ({ top: 100, bottom: 1024, height: 924 }),
    closest: () => null,
  };
  const field = fakeInput({
    getBoundingClientRect: () => ({ top: 900, bottom: 930, height: 30 }),
    closest: (selector) => (selector.includes('role="dialog"') ? panel : null),
    parentElement: null,
  });
  field.ownerDocument = t.win.document;
  t.win.document.activeElement = field;
  const controller = createKeyboardViewportController({ window: t.win, root: t.root, desktop: true, preventFocusPan: false });
  t.keyboard(420);
  assert.equal(panel.style.translate, '');
  controller.dispose();
});

test('the desktop CSS: page scroll room and list room, only in the desktop layout', () => {
  const at = MOBILE_VIEWER_CSS_SOURCE.indexOf(`@media ${DESKTOP_LAYOUT_MEDIA} {`);
  assert.ok(at > 0, 'a desktop-layout block');
  const block = MOBILE_VIEWER_CSS_SOURCE.slice(at, MOBILE_VIEWER_CSS_SOURCE.indexOf('\n}\n', at));
  assert.match(block, /html\.survey-viewer-open\[data-keyboard-scroll-room\] \[data-mobile-pdf-surface='false'\] \[data-pdfjs-content='true'\] \{\s*box-sizing: content-box;\s*padding-bottom: var\(--keyboard-scroll-room, 0px\);/);
  assert.match(block, /html\.survey-viewer-open \[data-keyboard-room\] \{\s*max-height: var\(--keyboard-room-hold, none\) !important;/);
  assert.match(block, /html\.survey-viewer-open \[data-keyboard-room\]::after \{[^}]*height: var\(--keyboard-room, 0px\);/);
  // Nothing in it reads the inset itself: what moves is room, not chrome.
  assert.doesNotMatch(block, /--keyboard-inset/);
});
