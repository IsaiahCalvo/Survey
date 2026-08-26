// Genuine hunt of Highlight after live resize + Ellipse/Textbox/Ink
// first-create after sibling leftovers after tip c02066a0 / product
// 162aa1f5. No unique LIVE leftover. Do not invent Font family chrome,
// richTextEditor, Line /AP, callout Rotation, user-settable callout
// verticalAlign, leftover-18 hosts, or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('imported Highlight export after resize already multiplies scale + keeps /CA', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /const width = \(Number\(fabricObj\.width\) \|\| 0\) \* Math\.abs\(Number\(fabricObj\.scaleX\) \|\| 1\);/);
  assert.match(writer, /CA: paintAlpha\(fabricObj\.fill, fabricObj\.opacity\),/);
  assert.match(writer, /Highlight: createImportedHighlightAnnotation,/);
});

test('live spec covers Highlight resize + sibling first-create + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-after-highlight-resize-sibling-first-create-hunt.spec.mjs');
  assert.match(spec, /testPdf=se011\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Highlight fill \/CA after resize/);
  assert.match(spec, /export \/QuadPoints uses scaled width/);
  assert.match(spec, /desktop Ellipse first-create Width 8 after sibling Line/);
  assert.match(spec, /desktop Textbox first-create Fill 40 after sibling/);
  assert.match(spec, /desktop Pen first-create Width 16 after sibling/);
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
