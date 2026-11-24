// KAL-652 batch 31: PDF tools cards in one row are the same height, and Back
// is the app's arrow icon, not a typed "←".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every tools grid cell lets its card fill the row height', () => {
  const css = read('src/components/PdfToolsDialog.css');
  assert.match(css, /\.pdft-tools>li\{display:flex\}/);
  assert.match(css, /\.pdft-tool\{width:100%;/);
});

test('Back to all tools uses the arrow icon', () => {
  const jsx = read('src/components/PdfToolsDialog.jsx');
  assert.doesNotMatch(jsx, /aria-label="Back to all tools"[^\n]*>←<\/button>/);
  assert.match(jsx, /aria-label="Back to all tools"[^\n]*<Icon name="arrowLeft" size=\{14\} \/><\/button>/);
});

test('the main button names what each tool does', () => {
  const jsx = read('src/components/PdfToolsDialog.jsx');
  const ids = [...read('src/tools/inApp.js').matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8);
  const map = jsx.match(/const RUN_LABELS = \{([^}]*)\}/)[1];
  for (const id of ids) assert.match(map, new RegExp(`\\b${id}: '[A-Z][a-z ]+'`), id);
  assert.match(jsx, /\{RUN_LABELS\[def\?\.id\] \|\| 'Run'\}/);
});
