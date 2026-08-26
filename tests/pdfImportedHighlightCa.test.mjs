// Imported Highlight must bake /CA into fill rgba, not leftover hex + opacity.
// se011 4636R has /CA 0.399994 and no /ca; leftover hex fill + object.opacity
// split that fade so Select read leftover 100 until Opacity was re-touched.
// Distinct from leftover-18, imported FreeText /RC, Square / Circle / Polygon
// stroke /CA, imported filled Ink /CA, package2 Ink /AP stroke union, and
// imported-outline Width restroke. Do not invent a richTextEditor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfAnnotationToFabric, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

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

test('imported Highlight keeps /CA in fill rgba, not leftover hex + object.opacity', () => {
  const obj = convertPdfAnnotationToFabric({
    id: '4636R',
    subtype: 'Highlight',
    rect: [100, 100, 200, 120],
    color: [1, 0.384314, 0],
    CA: 0.399994,
  }, makeViewport());

  assert.equal(obj.type, 'rect');
  assert.equal(obj.pdfAnnotationType, 'Highlight');
  const fillA = parseAlpha(obj.fill);
  assert.ok(fillA > 0.39 && fillA < 0.41, `fill must keep /CA ~0.40, not leftover hex: ${obj.fill}`);
  assert.match(String(obj.fill), /^rgba\(/);
  assert.notEqual(obj.opacity, 0.399994, 'must not leftover-split /CA onto object.opacity');
});

test('se011 Highlight 4636R keeps /CA ~0.40 in fill rgba', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'se011.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const highlight = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || [])
    .find((object) => object?.pdfAnnotationId === '4636R');

  assert.ok(highlight, 'fixture Highlight 4636R');
  assert.equal(highlight.pdfAnnotationType, 'Highlight');
  const fillA = parseAlpha(highlight.fill);
  assert.ok(fillA > 0.39 && fillA < 0.41, `fill must keep /CA ~0.40, not leftover hex: ${highlight.fill}`);
  assert.match(String(highlight.fill), /^rgba\(/);
  assert.notEqual(highlight.opacity, 0.399994, 'must not leftover-split /CA onto object.opacity');
});

test('Highlight converter bakes /CA into fill rgba; leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /Bake \/CA into fill rgba like Square \/\n  \/\/ Circle \/ Polygon \/ Ink/);
  assert.match(importer, /fill: hexToRgba\(color, opacity\),/);
  assert.doesNotMatch(
    importer,
    /const color = pdfColorToHex\(annotation\.color \|\| \[1, 1, 0\], annotation\); \/\/ Default yellow\n  const opacity = extractAnnotationOpacity\(annotation, 0\.3\);\n\n  return \{\n    type: 'rect',\n    left: viewportRect\.left,\n    top: viewportRect\.top,\n    width: viewportRect\.width,\n    height: viewportRect\.height,\n    fill: color,\n    opacity,/,
  );
  assert.doesNotMatch(importer, /create-ink tool/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
