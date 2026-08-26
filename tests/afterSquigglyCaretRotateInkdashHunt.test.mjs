// Genuine hunt after tip 410a31df: leftover-omitted EDITED_IMPORT
// writers (Caret / Stamp / Redact / Text note), Polygon first-create,
// Square rotate then Select persist, Ink dash+opacity first-create.
// No unique LIVE leftover. Do not invent stamp renderer, Note/Link
// create, create-poly tool, Font family chrome, leftover-18 hosts,
// or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('EDITED_IMPORT writers keep Caret + Text; Stamp/Redact stay omitted', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(writer, /Caret: createImportedCaretAnnotation,/);
  assert.match(writer, /Text: createImportedTextNoteAnnotation,/);
  assert.match(writer, /CA: paintAlpha\(fabricObj\.fill, fabricObj\.opacity\),/);
  assert.doesNotMatch(writer, /Stamp: createImported/);
  assert.doesNotMatch(writer, /Redact: createImported/);
  assert.match(importer, /Stamp, Link, Widget, Popup, FileAttachment/);
  assert.match(importer, /const SILENT_IGNORE_SUBTYPES = \['Link', 'Popup', 'Widget'\]/);
  assert.doesNotMatch(importer, /'Redact'/);
  assert.doesNotMatch(importer, /'Stamp'/);
});

test('live spec covers Text-note Select Fill + rotate-Select + no invent', () => {
  const spec = read('debug/scenarios/e2e-after-squiggly-caret-rotate-inkdash-hunt.spec.mjs');
  assert.match(spec, /testPdf=e2e-sticky-note\.pdf/);
  assert.match(spec, /testPdf=kal412-mixed-import-e2e\.pdf/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /Select Fill on Text note must ride/);
  assert.match(spec, /export must keep Text subtype \+ \/CA after Select Fill/);
  assert.match(spec, /Stamp stays unsupported/);
  assert.match(spec, /must not invent create-poly tool/);
  assert.match(spec, /export must keep Square \/AP \/Matrix \+ angle 45/);
  assert.match(spec, /Pen has no Style/);
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
