// KAL-788: on the Library's Stamps tab, stamps were a thin strip in a tall
// 4:3 tile, too small to read. Stamp tiles use a wide frame, and library
// pictures fill their frame (the drawing keeps its own small edge).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/markLibrary/MarkLibraryPanel.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/markLibrary/MarkLibraryPanel.jsx', import.meta.url), 'utf8');

test('the Stamps tab gets wide tiles', () => {
  assert.match(jsx, /mark-library__body\$\{stampsTab \? ' mark-library__body--stamps' : ''\}/);
  assert.match(css, /\.mark-library__body--stamps \.mark-library__tile--large \.mark-library__thumb \{ aspect-ratio: 5 \/ 2; \}/);
});

test('library pictures fill their frame', () => {
  const rule = css.match(/\.mark-library__thumb img \{[^}]*\}/)[0];
  assert.match(rule, /max-width: 100%/);
  assert.match(rule, /max-height: 100%/);
});
