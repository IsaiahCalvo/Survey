// Launch polish 2026-11-02: the dialog backdrop blur slowed weak PCs. The look
// stays on capable devices; weak ones (and reduced transparency) drop it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldDropBackdropBlur, installBackdropBlurTier } from '../src/utils/backdropBlur.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('weak memory or few cores drop the blur; capable devices keep it', () => {
  assert.equal(shouldDropBackdropBlur({ deviceMemory: 4, hardwareConcurrency: 8 }), true);
  assert.equal(shouldDropBackdropBlur({ deviceMemory: 2 }), true);
  assert.equal(shouldDropBackdropBlur({ hardwareConcurrency: 4 }), true);
  assert.equal(shouldDropBackdropBlur({ hardwareConcurrency: 2 }), true);
  assert.equal(shouldDropBackdropBlur({ deviceMemory: 8, hardwareConcurrency: 8 }), false);
  assert.equal(shouldDropBackdropBlur({ hardwareConcurrency: 12 }), false);
  // Safari / Firefox report no deviceMemory: decide on cores alone.
  assert.equal(shouldDropBackdropBlur({ hardwareConcurrency: 6 }), false);
  // Nothing known: keep the look.
  assert.equal(shouldDropBackdropBlur({}), false);
  assert.equal(shouldDropBackdropBlur(undefined), false);
});

test('the localStorage override wins either way', () => {
  assert.equal(shouldDropBackdropBlur({ hardwareConcurrency: 16, deviceMemory: 8 }, 'off'), true);
  assert.equal(shouldDropBackdropBlur({ hardwareConcurrency: 2, deviceMemory: 2 }, 'on'), false);
});

function fakeWindow(nav, stored = null) {
  const attrs = new Map();
  return {
    navigator: nav,
    localStorage: { getItem: () => stored },
    document: {
      documentElement: {
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
        getAttribute: (k) => attrs.get(k) ?? null,
      },
    },
  };
}

test('install publishes <html data-backdrop-blur="off"> only on a weak device', () => {
  const weak = fakeWindow({ hardwareConcurrency: 4 });
  assert.equal(installBackdropBlurTier(weak), true);
  assert.equal(weak.document.documentElement.getAttribute('data-backdrop-blur'), 'off');

  const strong = fakeWindow({ hardwareConcurrency: 8, deviceMemory: 8 });
  assert.equal(installBackdropBlurTier(strong), false);
  assert.equal(strong.document.documentElement.getAttribute('data-backdrop-blur'), null);

  const forced = fakeWindow({ hardwareConcurrency: 16 }, 'off');
  assert.equal(installBackdropBlurTier(forced), true);

  const throwing = fakeWindow({ hardwareConcurrency: 16 });
  throwing.localStorage = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(installBackdropBlurTier(throwing), false, 'blocked storage never breaks start-up');
});

test('the stylesheet turns every backdrop blur off under the attribute, beating inline styles', () => {
  const css = read('src/styles.css');
  assert.match(css, /html\[data-backdrop-blur="off"\] \*[\s\S]*?backdrop-filter: none !important/);
  assert.match(css, /prefers-reduced-transparency: reduce[\s\S]*?backdrop-filter: none !important/);
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /html\[data-backdrop-blur="off"\] \{\s*--overlay-scrim:/);
  assert.match(read('src/main.jsx'), /installBackdropBlurTier\(window\)/);
});
