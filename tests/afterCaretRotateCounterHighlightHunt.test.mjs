// Genuine hunt after tip c69d3f5e: Counter first-create after sibling,
// imported Highlight Select Color, Textbox Select Color after sibling,
// Arrow first-create after Ellipse. bc-90120044 landed none.
// No unique LIVE leftover. Do not invent stamp renderer, Note/Link
// create, create-poly tool, Font family chrome, leftover-18 hosts,
// Counter rotation, or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Highlight writer keeps /CA; Counter prefs keep badge fill', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  const prefs = read('src/hooks/useDatabase.js');
  assert.match(writer, /Highlight: createImportedHighlightAnnotation,/);
  assert.match(writer, /CA: paintAlpha\(fabricObj\.fill, fabricObj\.opacity\),/);
  assert.match(prefs, /counter: \{ strokeColor: '#ffffff', strokeWidth: 14, strokeOpacity: 100, fillColor: '#ef4444', fillOpacity: 100 \}/);
});

test('live spec covers Highlight Select Color + Counter after sibling + no invent', () => {
  const spec = read('debug/scenarios/e2e-after-caret-rotate-counter-highlight-hunt.spec.mjs');
  assert.match(spec, /testPdf=se011\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Select Color on imported Highlight must ride/);
  assert.match(spec, /export must keep Highlight subtype \+ \/CA after Select Color/);
  assert.match(spec, /Counter Size after sibling Line must not leftover-inherit Width 5/);
  assert.match(spec, /must not invent Counter rotation leftover/);
  assert.match(spec, /Arrow first-create Width 6 after Ellipse/);
  assert.match(spec, /Textbox Select Color Fill after sibling must ride/);
  assert.match(spec, /must not invent 390 hex chrome/);
  assert.match(spec, /must not invent Font family chrome/);
  assert.match(spec, /0 0 612 792/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('isolated 8448 / 75\/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
