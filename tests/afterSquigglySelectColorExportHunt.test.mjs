// Genuine hunt of Squiggly Select Color export after tip 7962b2b2 /
// product a57f34fc. Unique leftover: Select Color Opacity on imported
// Squiggly leftover-omitted the subtype writer so export leftover-emitted
// /Ink. Do not invent Font family chrome, richTextEditor, Line /AP,
// callout Rotation, user-settable callout verticalAlign, leftover-18
// hosts, or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('edited imported Squiggly export writer keeps subtype + stroke /CA', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /Squiggly: createImportedQuadMarkupAnnotation\('Squiggly'/);
  assert.match(writer, /paintFrom: 'stroke'/);
  assert.match(writer, /importedMarkupPathBounds/);
  assert.match(writer, /CA: paintAlpha\(paint, fabricObj\.opacity\),/);
  assert.doesNotMatch(writer, /Squiggly: createImportedHighlightAnnotation/);
});

test('live spec covers Squiggly Select Color export + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-after-squiggly-select-color-export-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Select Color on Squiggly must ride/);
  assert.match(spec, /export must keep Squiggly subtype \+ \/CA after Select Color/);
  assert.match(spec, /Select Color must not leftover-export Squiggly as Ink/);
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
