// Genuine hunt of Underline/StrikeOut after live resize + Cloud after
// Ellipse + Highlighter after sibling + Square rotate persist after tip
// cb83ce61 / product 162aa1f5. Unique leftover: Select Fill on imported
// StrikeOut/Underline leftover-dropped export /CA (no subtype writer).
// Do not invent Font family chrome, richTextEditor, Line /AP, callout
// Rotation, user-settable callout verticalAlign, leftover-18 hosts, or
// stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('edited imported Underline / StrikeOut export writers keep subtype + /CA', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /Underline: createImportedQuadMarkupAnnotation\('Underline'/);
  assert.match(writer, /StrikeOut: createImportedQuadMarkupAnnotation\('StrikeOut'/);
  assert.match(writer, /CA: paintAlpha\(paint, fabricObj\.opacity\),/);
  assert.match(writer, /Subtype: subtype,/);
  assert.doesNotMatch(writer, /Underline: createImportedHighlightAnnotation/);
});

test('live spec covers StrikeOut Select Fill export + Cloud after Ellipse + Highlighter + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-after-underline-resize-cloud-highlighter-hunt.spec.mjs');
  assert.match(spec, /testPdf=se011\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Select Fill on StrikeOut must ride/);
  assert.match(spec, /export must keep StrikeOut subtype \+ \/CA after Select Fill/);
  assert.match(spec, /Select Fill must not leftover-export StrikeOut as Square/);
  assert.match(spec, /Cloud first-create Bump 8 after Ellipse sibling/);
  assert.match(spec, /Highlighter first-create Width 4 after sibling/);
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
