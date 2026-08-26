// Imported Square / Circle stroke must use /CA, not leftover fill /ca.
// clickable-link-test 55R has /CA 1 and /ca ~0.30; extractAnnotationOpacity
// preferred /ca so the border painted leftover 0.30 until Border was
// re-touched. Distinct from leftover-18, imported Ink/Polygon/PolyLine
// dash+opacity export, Square / Circle dict /BS, and imported-outline
// Width restroke. Do not invent a create-poly or create-ink tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const makeViewport = ({ pageHeight = 792 } = {}) => ({
  height: pageHeight,
  convertToViewportPoint: (x, y) => [x, pageHeight - y],
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
});

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i);
  return rgba ? Number(rgba[1]) : (text === 'transparent' || text === 'none' || !text ? 0 : 1);
}

test('imported Square keeps stroke /CA independent of fill /ca', () => {
  const obj = convertPdfAnnotationToFabric({
    id: '55R',
    subtype: 'Square',
    rect: [100, 100, 166.723, 127],
    color: [0.980392, 0.196078, 0.215686],
    interiorColor: [0.980392, 0.196078, 0.215686],
    ca: 0.301961,
    CA: 1,
    borderStyle: { width: 3, style: 'S' },
  }, makeViewport());

  assert.equal(obj.type, 'rect');
  assert.equal(obj.pdfAnnotationType, 'Square');
  assert.ok(parseAlpha(obj.fill) > 0.29 && parseAlpha(obj.fill) < 0.32, `fill leftover /ca: ${obj.fill}`);
  assert.ok(parseAlpha(obj.stroke) > 0.99, `stroke must keep /CA 1, not leftover /ca: ${obj.stroke}`);
  assert.notEqual(parseAlpha(obj.stroke), parseAlpha(obj.fill));
});

test('imported Circle keeps stroke /CA independent of fill /ca', () => {
  const obj = convertPdfAnnotationToFabric({
    id: 'circle-ca',
    subtype: 'Circle',
    rect: [40, 40, 80, 80],
    color: [0, 0, 1],
    interiorColor: [0, 0, 1],
    ca: 0.3,
    CA: 1,
    borderStyle: { width: 2 },
  }, makeViewport({ pageHeight: 100 }));

  assert.equal(obj.type, 'circle');
  assert.ok(parseAlpha(obj.fill) > 0.29 && parseAlpha(obj.fill) < 0.31, `fill leftover /ca: ${obj.fill}`);
  assert.ok(parseAlpha(obj.stroke) > 0.99, `stroke must keep /CA 1: ${obj.stroke}`);
});

test('Square / Circle converters read stroke /CA; do not invent /BS leftover', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /function extractAnnotationStrokeOpacity/);
  assert.match(
    importer,
    /const strokeOpacity = extractAnnotationStrokeOpacity\(annotation, 1\);\n  const fillColor = getShapeFillColor\(annotation, strokeColor\);\n  const strokeWidth = getBorderWidth\(annotation, 1, \{ allowExplicitZero: true \}\);/,
  );
  assert.match(
    importer,
    /const strokeOpacity = extractAnnotationStrokeOpacity\(annotation, 1\);\n  const fillColor = getShapeFillColor\(annotation, strokeColor\);\n  const strokeWidth = getBorderWidth\(annotation, 1\);/,
  );
  assert.doesNotMatch(importer, /Square \/ Circle dict \/BS leftover/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
