// Nightly 'thin-lines' (Drawboard Projects: Enhance thin PDF lines).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THIN_LINES_ATTR,
  THIN_LINES_KEY,
  THIN_LINE_LEVELS,
  loadThinLines,
  normalizeThinLines,
  setThinLines,
  thinLinesFilterMarkup,
} from '../src/utils/thinLines.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('four levels, Off first; anything else reads as Off', () => {
  assert.deepEqual(THIN_LINE_LEVELS.map((l) => l.id), ['off', 'thin', 'medium', 'thick']);
  assert.equal(normalizeThinLines('huge'), 'off');
  assert.equal(normalizeThinLines(null), 'off');
});

test('filters are in device pixels: the radius halves on a 2x screen', () => {
  const one = thinLinesFilterMarkup(1);
  const two = thinLinesFilterMarkup(2);
  for (const id of ['thin', 'medium', 'thick']) assert.match(one, new RegExp(`id="survey-thin-lines-${id}"`));
  assert.match(one, /id="survey-thin-lines-medium"[^>]*><feMorphology in="SourceGraphic" operator="erode" radius="1"/);
  assert.match(two, /id="survey-thin-lines-medium"[^>]*><feMorphology in="SourceGraphic" operator="erode" radius="0.5"/);
  assert.match(two, /id="survey-thin-lines-thick".*radius="0.5".*radius="1".*k2="0.5" k3="0.5"/);
  assert.match(one, /id="survey-thin-lines-thin"[^>]*><feOffset/);
});

test('a pick is saved on this device and set on <html>', () => {
  const storage = memoryStorage();
  const attrs = new Map();
  const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), ownerDocument: null };
  assert.equal(setThinLines('thick', { storage, root }), 'thick');
  assert.equal(storage.getItem(THIN_LINES_KEY), 'thick');
  assert.equal(loadThinLines(storage), 'thick');
  assert.equal(attrs.get(THIN_LINES_ATTR), 'thick');
  setThinLines('off', { storage, root });
  assert.equal(attrs.size, 0);
  assert.equal(loadThinLines({ getItem() { throw new Error('blocked'); } }), 'off');
});

test('CSS filters only the PDF canvases, not in print; flag is beta with a migration', () => {
  const css = readFileSync(new URL('../src/styles/thinLines.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-thin-lines="medium"\] \.survey-pdfjs-page-canvas/);
  assert.match(css, /\.survey-pdfjs-detail-tile \{ filter: url\(#survey-thin-lines-thick\)/);
  assert.match(css, /@media print[\s\S]*filter: none/);
  assert.ok(!/annotation|svg-annotation/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'never the marks');
  assert.equal(FEATURE_FLAGS['thin-lines'].stage, 'beta');
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /isFeatureOn\('thin-lines'\)/);
  const migration = readFileSync(new URL('../supabase/migrations/20261116021000_thin_lines_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'thin-lines', 'off'/);
});
