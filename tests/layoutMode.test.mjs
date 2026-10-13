// Phone layout or desktop layout (owner 2026-10-13): "A touchscreen laptop
// needs to get a laptop layout, not a phone layout. Just like an iPad gets a
// laptop layout, not a phone layout." The screen's short side decides; touch
// never does. src/utils/layoutMode.js.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  DESKTOP_LAYOUT_MEDIA,
  PHONE_LAYOUT_MEDIA,
  PHONE_SCREEN_SHORT_SIDE_LIMIT,
  hasTouchInput,
  isElectronApp,
  isPhoneLayout,
  isPhoneScreen,
  subscribePhoneLayout,
} from '../src/utils/layoutMode.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// A tiny media-query evaluator for the two strings this module exports, so the
// pure rule and the CSS/matchMedia rule are checked against each other.
function evaluateMedia(query, screen) {
  return query.split(',').some((alternative) => {
    const parts = [...alternative.matchAll(/\((min|max)-device-(width|height):\s*(\d+)px\)/g)];
    assert.ok(parts.length > 0, `unparsed media query: ${alternative}`);
    return parts.every(([, bound, side, px]) => {
      const value = side === 'width' ? screen.width : screen.height;
      return bound === 'max' ? value <= Number(px) : value >= Number(px);
    });
  });
}

const fakeWindow = ({
  screen = { width: 1440, height: 900 },
  touchPoints = 0,
  anyCoarse = false,
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  electronAPI,
  withMatchMedia = true,
} = {}) => {
  const listeners = new Set();
  const win = {
    screen,
    navigator: { maxTouchPoints: touchPoints, userAgent },
    electronAPI,
    listeners,
  };
  if (withMatchMedia) {
    win.matchMedia = (query) => ({
      get matches() {
        if (query === '(any-pointer: coarse)') return anyCoarse;
        return evaluateMedia(query, win.screen);
      },
      addEventListener: (type, fn) => listeners.add(fn),
      removeEventListener: (type, fn) => listeners.delete(fn),
    });
  }
  return win;
};

const DEVICES = [
  // [name, screen (CSS px, as the device reports it), phone?]
  ['iPhone 13 upright', { width: 390, height: 844 }, true],
  ['iPhone 13 turned sideways (iOS keeps device-width upright)', { width: 390, height: 844 }, true],
  ['iPhone 13 turned sideways (a browser that swaps the screen)', { width: 844, height: 390 }, true],
  ['iPhone SE', { width: 375, height: 667 }, true],
  ['iPhone 15 Pro Max', { width: 430, height: 932 }, true],
  ['Pixel 7 upright', { width: 412, height: 915 }, true],
  ['Pixel 7 sideways (Android swaps)', { width: 915, height: 412 }, true],
  ['Galaxy Fold folded', { width: 344, height: 882 }, true],
  ['iPad mini', { width: 744, height: 1133 }, false],
  ['iPad Pro 11', { width: 834, height: 1194 }, false],
  ['iPad Pro 11 sideways', { width: 1194, height: 834 }, false],
  ['iPad Pro 11 posing as a Mac (desktop-site Safari)', { width: 834, height: 1194 }, false],
  ['7-inch Android tablet', { width: 600, height: 960 }, false],
  ['Galaxy Tab S8', { width: 800, height: 1280 }, false],
  ['touchscreen laptop', { width: 1440, height: 900 }, false],
  ['1366 x 768 laptop', { width: 1366, height: 768 }, false],
  ['desktop', { width: 1920, height: 1080 }, false],
];

test('the screen decides: phones are phones upright and sideways, tablets and laptops are desktop', () => {
  for (const [name, screen, phone] of DEVICES) {
    assert.equal(isPhoneScreen(screen.width, screen.height), phone, `${name} (pure rule)`);
    assert.equal(isPhoneLayout(fakeWindow({ screen })), phone, `${name} (matchMedia)`);
    assert.equal(isPhoneLayout(fakeWindow({ screen, withMatchMedia: false })), phone, `${name} (no matchMedia)`);
  }
});

test('the boundary: a short side under 600 is a phone, 600 is not', () => {
  assert.equal(PHONE_SCREEN_SHORT_SIDE_LIMIT, 600);
  assert.equal(isPhoneScreen(599, 1000), true);
  assert.equal(isPhoneScreen(600, 1000), false);
  assert.equal(isPhoneScreen(1000, 599), true);
  assert.equal(isPhoneScreen(0, 0), false, 'an unknown screen is not a phone');
  assert.equal(isPhoneScreen(undefined, undefined), false);
  for (let side = 300; side <= 900; side += 1) {
    for (const long of [side, 1400]) {
      const screen = { width: side, height: long };
      assert.equal(evaluateMedia(PHONE_LAYOUT_MEDIA, screen), isPhoneScreen(side, long), `${side}x${long}`);
      assert.equal(evaluateMedia(DESKTOP_LAYOUT_MEDIA, screen), !isPhoneScreen(side, long), `${side}x${long} desktop`);
      const turned = { width: long, height: side };
      assert.equal(evaluateMedia(PHONE_LAYOUT_MEDIA, turned), isPhoneScreen(long, side), `${long}x${side}`);
      assert.equal(evaluateMedia(DESKTOP_LAYOUT_MEDIA, turned), !isPhoneScreen(long, side), `${long}x${side} desktop`);
    }
  }
});

test('touch never picks the phone layout', () => {
  const touchLaptop = fakeWindow({ screen: { width: 1440, height: 900 }, touchPoints: 10, anyCoarse: true });
  assert.equal(isPhoneLayout(touchLaptop), false);
  assert.equal(hasTouchInput(touchLaptop), true);
  const iPadAsMac = fakeWindow({ screen: { width: 834, height: 1194 }, touchPoints: 5 });
  assert.equal(isPhoneLayout(iPadAsMac), false);
  assert.equal(hasTouchInput(iPadAsMac), true);
  const mouseDesktop = fakeWindow();
  assert.equal(hasTouchInput(mouseDesktop), false);
  assert.equal(hasTouchInput(fakeWindow({ anyCoarse: true })), true, 'a coarse pointer anywhere counts as touch');
  assert.equal(hasTouchInput(undefined), false);
});

test('a desktop window dragged narrow stays desktop (the screen did not change)', () => {
  // The window width is never asked: the fake window has no innerWidth at all.
  const win = fakeWindow({ screen: { width: 1440, height: 900 } });
  win.innerWidth = 400;
  assert.equal(isPhoneLayout(win), false);
});

test('the Electron app is always desktop', () => {
  const tiny = { width: 400, height: 500 };
  assert.equal(isPhoneLayout(fakeWindow({ screen: tiny, electronAPI: {} })), false);
  assert.equal(isPhoneLayout(fakeWindow({ screen: tiny, userAgent: 'Mozilla/5.0 Survey/1.0 Chrome/130.0 Electron/33.0.0 Safari/537.36' })), false);
  assert.equal(isElectronApp(fakeWindow({ electronAPI: {} })), true);
  assert.equal(isElectronApp(fakeWindow()), false);
  assert.equal(isPhoneLayout(undefined), false);
});

test('subscribePhoneLayout reports a screen change and unsubscribes', () => {
  const win = fakeWindow({ screen: { width: 1440, height: 900 } });
  const seen = [];
  const stop = subscribePhoneLayout((phone) => seen.push(phone), win);
  assert.equal(win.listeners.size, 1);
  win.screen = { width: 390, height: 844 };
  [...win.listeners].forEach((fn) => fn());
  assert.deepEqual(seen, [true]);
  stop();
  assert.equal(win.listeners.size, 0);
  // Electron never subscribes (it never changes layout).
  const electron = fakeWindow({ electronAPI: {} });
  subscribePhoneLayout(() => {}, electron)();
  assert.equal(electron.listeners.size, 0);
});

// Every stylesheet rule that switches phone/desktop uses the shared query, so
// the stylesheets can never disagree with the code (the old switch was a
// window width — 720px — in CSS and touch in the PDF viewer).
const LAYOUT_FILES = [
  'index.html',
  'src/home/hub.css',
  'src/styles.css',
  'src/mobile/mobilePdfViewer.css',
  'src/components/collab/UndoToast.css',
  'src/components/collab/ConfirmDeleteModal.css',
  'src/components/AnnotationSizeControl.css',
  'src/components/QuietLoading.jsx',
];

test('stylesheets switch layouts on the shared phone/desktop media queries only', () => {
  let phoneBlocks = 0;
  for (const file of LAYOUT_FILES) {
    const text = read(file);
    phoneBlocks += text.split(`@media ${PHONE_LAYOUT_MEDIA} {`).length - 1;
    assert.doesNotMatch(text, /@media[^{]*\((?:max-width:\s*720px|min-width:\s*721px)\)/, `${file} still switches at a 720px window`);
  }
  assert.ok(phoneBlocks >= 14, `expected the phone blocks to use PHONE_LAYOUT_MEDIA (found ${phoneBlocks})`);
  assert.equal(read('src/home/hub.css').split(`@media ${DESKTOP_LAYOUT_MEDIA} {`).length - 1, 2);
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'prototype') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(jsx?|css)$/.test(name)) out.push(path);
  }
  return out;
}

test('no code picks the layout from the window width or from touch', () => {
  for (const path of walk(join(ROOT, 'src'))) {
    const text = readFileSync(path, 'utf8');
    const rel = path.slice(ROOT.length);
    assert.doesNotMatch(text, /matchMedia\(\s*['"`]\(max-width:\s*720px\)/, `${rel} asks for a 720px window`);
    assert.doesNotMatch(text, /\(max-width: 720px\), \(pointer: coarse\)/, `${rel} treats touch as the phone layout`);
    assert.doesNotMatch(text, /PHONE_LAYOUT_MAX_WIDTH/, `${rel} still uses the old window-width switch`);
  }
  // The shell and the viewer both ask the shared helper.
  assert.match(read('src/AppShell.jsx'), /const isNarrowShell = usePhoneLayout\(\);/);
  const viewer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewer, /const phoneLayout = usePhoneLayout\(\);/);
  assert.match(viewer, /resolveLayoutMetrics\(phoneLayout\)/);
  assert.match(viewer, /data-mobile-pdf-surface=\{phoneLayout \? 'true' : 'false'\}/);
  // Touch gestures (pinch, two-finger pan, one-finger tool) run on any touch
  // screen, in either layout.
  assert.match(viewer, /const touchSurface = isMobileSurface \|\| touchInput;/);
  assert.match(viewer, /if \(!el \|\| !touchSurface\) return undefined;/);
  assert.match(viewer, /touchAction: touchSurface \? 'none'/);
});
