// The suite look (KAL-663): shared greys and Survey's gold, dark and light, behind the Nightly
// flag 'one-look'. Checks the mode logic in src/suiteLook.js, that index.html
// reads the same saved keys before the first paint, and that the colour values
// in src/styles/tokens.css match docs/suite/SUITE-RULES.md and stay readable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FEATURE_FLAGS, isBetaFlag } from '../src/featureFlags.js';
import {
  APPEARANCE_DEFAULT, APPEARANCE_KEY, LOOK_CACHE_KEY, SUITE_LOOK_FLAG, THEME_COLOR,
  applySuiteLook, currentTheme, readAppearance, resolveTheme, writeAppearance,
} from '../src/suiteLook.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function fakeDoc() {
  const attrs = new Map();
  const metas = { 'meta[name="theme-color"]': new Map(), 'meta[name="color-scheme"]': new Map() };
  return {
    documentElement: {
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: (k) => attrs.delete(k),
    },
    querySelector: (sel) => (metas[sel] ? { setAttribute: (k, v) => metas[sel].set(k, v) } : null),
    meta: (sel) => metas[sel].get('content'),
  };
}

const fakeWin = (dark) => ({ matchMedia: () => ({ matches: dark }), dispatchEvent: () => true });

test('suite look: the flag is a beta flag, so it reaches Nightly first', () => {
  assert.ok(FEATURE_FLAGS[SUITE_LOOK_FLAG], 'flag is listed');
  assert.equal(isBetaFlag(SUITE_LOOK_FLAG), true);
});

test('suite look: Survey opens dark until the person picks', () => {
  assert.equal(APPEARANCE_DEFAULT, 'dark');
  assert.equal(readAppearance(memoryStorage()), 'dark');
  assert.equal(readAppearance(memoryStorage({ [APPEARANCE_KEY]: 'purple' })), 'dark');
  assert.equal(readAppearance(memoryStorage({ [APPEARANCE_KEY]: 'light' })), 'light');
});

test('suite look: Match system follows the device, the other two do not', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('nonsense', false), 'dark');
});

test('suite look: off leaves the page alone and clears the first-paint key', () => {
  const doc = fakeDoc();
  const storage = memoryStorage({ [LOOK_CACHE_KEY]: '1', [APPEARANCE_KEY]: 'light' });
  doc.documentElement.setAttribute('data-look', 'suite');
  doc.documentElement.setAttribute('data-theme', 'light');
  assert.equal(applySuiteLook({ doc, win: fakeWin(true), storage, on: false }), null);
  assert.equal(doc.documentElement.getAttribute('data-look'), null);
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
  assert.equal(storage.getItem(LOOK_CACHE_KEY), null);
  assert.equal(currentTheme(doc), 'dark');
});

test('suite look: on sets the look, the mode and the browser bar colour', () => {
  const doc = fakeDoc();
  const storage = memoryStorage({ [APPEARANCE_KEY]: 'light' });
  assert.equal(applySuiteLook({ doc, win: fakeWin(true), storage, on: true }), 'light');
  assert.equal(doc.documentElement.getAttribute('data-look'), 'suite');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(storage.getItem(LOOK_CACHE_KEY), '1');
  assert.equal(doc.meta('meta[name="theme-color"]'), THEME_COLOR.light);
  assert.equal(doc.meta('meta[name="color-scheme"]'), 'light');
  assert.equal(currentTheme(doc), 'light');

  const system = memoryStorage({ [APPEARANCE_KEY]: 'system' });
  assert.equal(applySuiteLook({ doc, win: fakeWin(true), storage: system, on: true }), 'dark');
  assert.equal(applySuiteLook({ doc, win: fakeWin(false), storage: system, on: true }), 'light');
});

test('suite look: a bad choice is saved as the default', () => {
  const storage = memoryStorage();
  assert.equal(writeAppearance('system', { storage, win: fakeWin(true) }), 'system');
  assert.equal(storage.getItem(APPEARANCE_KEY), 'system');
  assert.equal(writeAppearance('sepia', { storage, win: fakeWin(true) }), 'dark');
  assert.equal(storage.getItem(APPEARANCE_KEY), 'dark');
});

test('suite look: index.html reads the same keys before the first paint', () => {
  const html = read('../index.html');
  assert.ok(html.includes(`getItem('${LOOK_CACHE_KEY}') !== '1'`), 'look key');
  assert.ok(html.includes(`getItem('${APPEARANCE_KEY}')`), 'appearance key');
  // The script must run before the stylesheet paints anything.
  assert.ok(html.indexOf(`getItem('${LOOK_CACHE_KEY}')`) < html.indexOf('<body'), 'runs in <head>');
  // The page behind the app is the ground colour of each mode.
  assert.ok(html.includes(`html[data-look="suite"] body { background: ${THEME_COLOR.dark}`), 'dark ground');
  assert.ok(html.includes(`html[data-look="suite"][data-theme="light"] body { background: ${THEME_COLOR.light}`), 'light ground');
});

// ---- the colour values ----

const css = read('../src/styles/tokens.css');

function block(selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `tokens.css has ${selector}`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase();
  return out;
}

const dark = block('html[data-look="suite"]');
const light = { ...dark, ...block('html[data-look="suite"][data-theme="light"]') };

const lum = (hex) => {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('suite look: the values are the ones in docs/suite/SUITE-RULES.md', () => {
  const want = {
    dark: { '--surface-0': '#131315', '--surface-2': '#1c1c1e', '--hover': '#242426', '--surface-3': '#2c2c2f', '--border': '#2c2c2f', '--border-strong': '#737378', '--text-1': '#e8e7e2', '--text-2': '#d2d1cc', '--text-3': '#9a9a97', '--text-disabled': '#5c5c5a', '--accent': '#d8a84e', '--accent-light': '#edc26d', '--accent-press': '#b6904a', '--accent-text': '#131315', '--danger': '#ef4444', '--danger-text': '#f87171', '--success': '#8baa6e', '--warning': '#d4a54a' },
    light: { '--surface-0': '#f4f4f6', '--surface-2': '#ffffff', '--hover': '#f5f5f5', '--surface-3': '#ebebeb', '--border': '#ececec', '--border-strong': '#8a8a8f', '--text-1': '#131313', '--text-2': '#4b4b4b', '--text-3': '#666666', '--text-disabled': '#a3a3a3', '--accent': '#8b6500', '--accent-light': '#775600', '--accent-press': '#634800', '--accent-text': '#ffffff', '--danger': '#d92d20', '--danger-text': '#b42318', '--success': '#1f7a4d', '--warning': '#9a5b00' },
  };
  for (const [mode, set] of [['dark', dark], ['light', light]]) {
    for (const [name, value] of Object.entries(want[mode])) assert.equal(set[name], value, `${mode} ${name}`);
  }
  assert.equal(dark['color-scheme'] ?? 'dark', 'dark');
});

test('suite look: words stay readable on every surface, in both modes', () => {
  for (const [mode, set] of [['dark', dark], ['light', light]]) {
    const surfaces = ['--surface-0', '--surface-1', '--surface-2', '--surface-3', '--hover', '--pressed'];
    for (const surface of surfaces) {
      for (const text of ['--text-1', '--text-2', '--text-3', '--danger-text']) {
        const c = contrast(set[text], set[surface]);
        assert.ok(c >= 4.5, `${mode}: ${text} on ${surface} is ${c.toFixed(2)}:1`);
      }
    }
    // The gold as words (a link, a chosen icon) on the three main surfaces.
    for (const surface of ['--surface-0', '--surface-2', '--hover']) {
      const c = contrast(set['--accent'], set[surface]);
      assert.ok(c >= 4.5, `${mode}: gold on ${surface} is ${c.toFixed(2)}:1`);
    }
    // Words on a gold button, in each of its three steps.
    for (const fill of ['--accent', '--accent-light', '--accent-press']) {
      const c = contrast(set['--accent-text'], set[fill]);
      assert.ok(c >= 4.5, `${mode}: words on ${fill} are ${c.toFixed(2)}:1`);
    }
    // The edge is all that shows an empty field is there: 3:1.
    for (const surface of ['--surface-0', '--surface-2', '--hover']) {
      const c = contrast(set['--border-strong'], set[surface]);
      assert.ok(c >= 3, `${mode}: edge on ${surface} is ${c.toFixed(2)}:1`);
    }
  }
});

test('suite look: hover and pressed never look the same', () => {
  for (const [mode, set] of [['dark', dark], ['light', light]]) {
    assert.notEqual(set['--hover'], set['--pressed'], mode);
    assert.notEqual(set['--hover'], set['--surface-2'], mode);
    assert.notEqual(set['--accent-light'], set['--accent-press'], mode);
  }
});

test('suite look: no blue from the old palette is left, and the gold is only the accent', () => {
  // Owner 2026-11-24: Survey's accent is its own gold again. It belongs to the
  // accent names only, never to a focus ring, a border or a selected row.
  const blue = ['#6aa6f6', '#8dbcf9', '#4b8ae8'];
  const gold = ['#d8a84e', '#edc26d', '#b6904a', '#8b6500', '#775600', '#634800'];
  for (const [mode, set] of [['dark', dark], ['light', light]]) {
    for (const [name, value] of Object.entries(set)) {
      for (const hex of blue) assert.ok(!value.includes(hex), `${mode} ${name} still holds ${hex}`);
      if (name.startsWith('--accent')) continue;
      for (const hex of gold) assert.ok(!value.includes(hex), `${mode} ${name} holds the accent gold ${hex}`);
    }
  }
});
