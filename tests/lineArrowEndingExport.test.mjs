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

test('P1-01 intended: group flatten offsets only left/top, not center-relative x1..y2', () => {
  const flatten = src.slice(src.indexOf('const drawFlattenedObject'));
  const group = flatten.slice(0, flatten.indexOf("const type = String(obj.type"));
  assert.match(group, /left: \(Number\(child\?\.left\) \|\| 0\) \+ parentLeft/);
  assert.match(group, /top: \(Number\(child\?\.top\) \|\| 0\) \+ parentTop/);
  assert.doesNotMatch(group, /x1: child\?\.x1/);
});

test('P1-03 intended: Square export writes cloudy /BE when intensity or cloudBorder is set', () => {
  const square = src.slice(src.indexOf('const createSquareAnnotation'), src.indexOf('const createCircleAnnotation'));
  assert.match(square, /pdfCloudIntensity/);
  assert.match(square, /annotationDict\.BE/);
  assert.match(square, /PDFName\.of\('C'\)/);
});

test('P1-03 break: non-cloud rects do not get /BE', () => {
  const square = src.slice(src.indexOf('const createSquareAnnotation'), src.indexOf('const createCircleAnnotation'));
  assert.match(square, /if \(isCloud\)/);
});

test('P1-04 intended: print flatten multiplies width/height by |scaleX|/|scaleY|', () => {
  const flatten = src.slice(src.indexOf('const drawFlattenedObject'));
  assert.match(flatten, /getObjNumber\(shifted, 'width'\) \* scaleX/);
  assert.match(flatten, /getObjNumber\(shifted, 'height'\) \* scaleY/);
});

test('P1-04 edge: non-finite flattened box is skipped', () => {
  const flatten = src.slice(src.indexOf('const drawFlattenedObject'));
  assert.match(flatten, /if \(!\[left, top, width, height, pageHeight\]\.every\(Number\.isFinite\)\) return 0/);
});
