import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');

test('P1-02 intended: arrowheadStyle / tool:arrow map to /LE via resolveExportedLineEnding2', () => {
  assert.match(src, /const resolveExportedLineEnding2 = \(fabricObj\) =>/);
  assert.match(src, /fabricObj\?\.tool === 'arrow' \? ARROWHEAD_STYLES\.SOLID_TRIANGLE/);
  assert.match(src, /ARROWHEAD_STYLE_TO_PDF_LINE_ENDING\[style\]/);
});

test('P1-02 break: createLineAnnotation uses the helper, not raw lineEnding2 only', () => {
  const create = src.slice(src.indexOf('const createLineAnnotation'));
  assert.match(create.slice(0, 2500), /resolveExportedLineEnding2\(fabricObj\)/);
  assert.doesNotMatch(
    create.slice(0, 2500),
    /if \(fabricObj\.lineEnding1 \|\| fabricObj\.lineEnding2\)/,
  );
});

test('P1-02 edge: style none / unknown still have a ClosedArrow default for tool arrow', () => {
  assert.match(src, /tool === 'arrow' \? ARROWHEAD_STYLES\.SOLID_TRIANGLE : null/);
  assert.match(src, /\[ARROWHEAD_STYLES\.NONE\]: 'None'/);
});
