import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DARK_PAGES_ATTR, DARK_PAGES_KEY, applyDarkPages, loadDarkPages, setDarkPages } from '../src/utils/darkPages.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}
function fakeRoot() {
  const attrs = {};
  return { attrs, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
}

test('dark pages is saved per device and lives on <html>', () => {
  const storage = memoryStorage();
  const root = fakeRoot();
  assert.equal(loadDarkPages(storage), false);
  assert.equal(setDarkPages(true, { storage, root }), true);
  assert.equal(storage.getItem(DARK_PAGES_KEY), '1');
  assert.equal(root.attrs[DARK_PAGES_ATTR], 'on');
  assert.equal(loadDarkPages(storage), true);
  setDarkPages(false, { storage, root });
  assert.equal(root.attrs[DARK_PAGES_ATTR], undefined);
  assert.equal(loadDarkPages(storage), false);
});

test('broken storage never throws', () => {
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  assert.equal(loadDarkPages(broken), false);
  assert.doesNotThrow(() => setDarkPages(true, { storage: broken, root: fakeRoot() }));
  assert.doesNotThrow(() => applyDarkPages(true, null));
});

test('only the page image is inverted, and never in print', () => {
  const css = readFileSync(new URL('../src/styles/darkPages.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-dark-pages="on"\] :is\(\.survey-pdfjs-page-canvas, \.survey-pdfjs-detail-tile\) \{\s*filter: invert/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /svg|annotation|text-layer/i);
});

test('the switch sits on the desktop rail and in the phone zoom menu, behind the flag', () => {
  const toggle = readFileSync(new URL('../src/components/DarkPagesToggle.jsx', import.meta.url), 'utf8');
  assert.match(toggle, /isFeatureOn\('dark-pages'\)/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /<DarkPagesToggle render=/);
  const phone = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  assert.match(phone, /<span>Dark pages<\/span>/);
  assert.match(phone, /<DarkPagesToggle render=\{\(\) => null\} \/>/);
});
