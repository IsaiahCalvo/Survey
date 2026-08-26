// Imported Underline / StrikeOut must keep /QuadPoints, not leftover /Rect.
// se011 4638R / 4640R already have native /QuadPoints (word AABB); leftover
// /Rect is padded ~10pt each side so the painted bar was leftover-wide
// until the markup was deleted. Distinct from leftover-18, imported
// Highlight /CA, FreeText /RC, Square / Circle / Polygon stroke /CA,
// imported filled Ink /CA, package2 Ink /AP stroke union, and
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

test('imported StrikeOut keeps /QuadPoints width, not leftover /Rect', () => {
  const obj = convertPdfAnnotationToFabric({
    id: '4638R',
    subtype: 'StrikeOut',
    rect: [417.44, 353.47, 617.651, 391.458],
    color: [0.972549, 0.392151, 0.392151],
    quadPoints: [
      427.51, 389.348,
      607.581, 389.348,
      427.51, 355.58,
      607.581, 355.58,
    ],
  }, makeViewport());

  assert.equal(obj.type, 'rect');
  assert.equal(obj.pdfAnnotationType, 'StrikeOut');
  assert.ok(obj.width > 179 && obj.width < 181, `width must keep /QuadPoints ~180, not leftover /Rect 200: ${obj.width}`);
  assert.ok(obj.left > 427 && obj.left < 428, `left must keep /QuadPoints ~427.51, not leftover /Rect 417.44: ${obj.left}`);
});

test('se011 StrikeOut 4638R / Underline 4640R keep /QuadPoints, not leftover /Rect', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'se011.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const objects = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || []);

  const strike = objects.find((object) => object?.pdfAnnotationId === '4638R');
  assert.ok(strike, 'fixture StrikeOut 4638R');
  assert.equal(strike.pdfAnnotationType, 'StrikeOut');
  assert.ok(strike.width > 179 && strike.width < 181, `4638R width must keep /QuadPoints ~180, not leftover /Rect 200: ${strike.width}`);

  const underline = objects.find((object) => object?.pdfAnnotationId === '4640R');
  assert.ok(underline, 'fixture Underline 4640R');
  assert.equal(underline.pdfAnnotationType, 'Underline');
  assert.ok(underline.width > 251 && underline.width < 253, `4640R width must keep /QuadPoints ~252, not leftover /Rect 272: ${underline.width}`);
});

test('Underline converter prefers /QuadPoints; leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /function convertQuadPointsToViewportRect/);
  assert.match(
    importer,
    /const viewportRect = convertQuadPointsToViewportRect\(annotation\.quadPoints, viewport, scale\)\n    \|\| convertPdfRectToViewportRect\(annotation\.rect, viewport, scale\);/,
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
