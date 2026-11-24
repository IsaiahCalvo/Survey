// The suite look (KAL-663): shared greys and Survey's gold, dark only (owner
// 2026-11-24), behind the Nightly flag 'one-look'. Checks src/suiteLook.js,
// that index.html reads the same saved key before the first paint, and that
// the colour values in src/styles/tokens.css match docs/suite/SUITE-RULES.md
// and stay readable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FEATURE_FLAGS, isBetaFlag } from '../src/featureFlags.js';
import {
  LOOK_CACHE_KEY, OLD_APPEARANCE_KEY, SUITE_LOOK_FLAG, THEME_COLOR,
  applySuiteLook, currentTheme,
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

test('suite look: the flag is a beta flag, so it reaches Nightly first', () => {
  assert.ok(FEATURE_FLAGS[SUITE_LOOK_FLAG], 'flag is listed');
  assert.equal(isBetaFlag(SUITE_LOOK_FLAG), true);
});

test('suite look: off leaves the page alone and clears the first-paint key', () => {
  const doc = fakeDoc();
  const storage = memoryStorage({ [LOOK_CACHE_KEY]: '1', [OLD_APPEARANCE_KEY]: 'light' });
  doc.documentElement.setAttribute('data-look', 'suite');
  doc.documentElement.setAttribute('data-theme', 'dark');
  assert.equal(applySuiteLook({ doc, storage, on: false }), null);
  assert.equal(doc.documentElement.getAttribute('data-look'), null);
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
  assert.equal(storage.getItem(LOOK_CACHE_KEY), null);
  assert.equal(storage.getItem(OLD_APPEARANCE_KEY), null, 'the old light/dark choice is cleared');
});

test('suite look: on is always dark, whatever was saved before', () => {
  const doc = fakeDoc();
  const storage = memoryStorage({ [OLD_APPEARANCE_KEY]: 'light' });
  assert.equal(applySuiteLook({ doc, storage, on: true }), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-look'), 'suite');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(storage.getItem(LOOK_CACHE_KEY), '1');
  assert.equal(storage.getItem(OLD_APPEARANCE_KEY), null);
  assert.equal(doc.meta('meta[name="theme-color"]'), THEME_COLOR);
  assert.equal(doc.meta('meta[name="color-scheme"]'), 'dark');
  assert.equal(currentTheme(), 'dark');
});

test('suite look: there is no Appearance setting and no light set', () => {
  const settings = read('../src/components/AccountSettings.jsx');
  assert.ok(!settings.includes('Match system'), 'no Light / Dark / Match system picker');
  assert.ok(!/data-theme="light"/.test(read('../src/styles/tokens.css')), 'tokens.css has no light block');
  assert.ok(!/data-theme="light"/.test(read('../index.html')), 'index.html paints no light ground');
});

test('suite look: index.html reads the same key before the first paint', () => {
  const html = read('../index.html');
  assert.ok(html.includes(`getItem('${LOOK_CACHE_KEY}') !== '1'`), 'look key');
  assert.ok(!html.includes(`'${OLD_APPEARANCE_KEY}'`), 'no light/dark choice is read');
  // The script must run before the stylesheet paints anything.
  assert.ok(html.indexOf(`getItem('${LOOK_CACHE_KEY}')`) < html.indexOf('<body'), 'runs in <head>');
  assert.ok(html.includes(`html[data-look="suite"] body { background: ${THEME_COLOR}`), 'dark ground');
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
  };
  for (const [mode, set] of [['dark', dark]]) {
    for (const [name, value] of Object.entries(want[mode])) assert.equal(set[name], value, `${mode} ${name}`);
  }
  assert.equal(dark['color-scheme'] ?? 'dark', 'dark');
});

test('suite look: words stay readable on every surface, in both modes', () => {
  for (const [mode, set] of [['dark', dark]]) {
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
  for (const [mode, set] of [['dark', dark]]) {
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
  for (const [mode, set] of [['dark', dark]]) {
    for (const [name, value] of Object.entries(set)) {
      for (const hex of blue) assert.ok(!value.includes(hex), `${mode} ${name} still holds ${hex}`);
      if (name.startsWith('--accent')) continue;
      for (const hex of gold) assert.ok(!value.includes(hex), `${mode} ${name} holds the accent gold ${hex}`);
    }
  }
});
