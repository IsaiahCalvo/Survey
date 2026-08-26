// Imported FreeText must keep /DS text-align, not leftover left.
// package2 13246R has /DS text-align:center and no /Q; convertFreeText
// leftover-dropped that align so the textbox painted leftover-left until
// Text alignment was re-touched. Distinct from leftover-18, imported
// FreeText /RC color, Underline /QuadPoints, Highlight /CA, Square /
// Circle / Polygon stroke /CA, imported filled Ink /CA, package2 Ink
// /AP stroke union, imported-outline Width restroke, and inventing a
// richTextEditor. Do not invent a user-settable callout verticalAlign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfAnnotationToFabric, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const makeViewport = ({ pageHeight = 1224 } = {}) => ({
  width: 792,
  height: pageHeight,
  convertToViewportPoint: (x, y) => [x, pageHeight - y],
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
});

test('imported FreeText keeps /DS text-align:center, not leftover left', () => {
  const obj = convertPdfAnnotationToFabric({
    id: '13246R',
    subtype: 'FreeText',
    rect: [514.8, 173.64, 532.8, 214.033],
    contents: 'Hello',
    defaultAppearanceString: ' /Helv 16.0 Tf',
    defaultStyleString: 'font-weight: normal;text-align: center;text-valign: top;font-family: Arial;color: #FA3237;font-size: 16.0pt',
  }, makeViewport());

  assert.equal(obj.type, 'textbox');
  assert.equal(obj.pdfAnnotationType, 'FreeText');
  assert.equal(obj.text, 'Hello');
  assert.equal(obj.textAlign, 'center', `textAlign must keep /DS center, not leftover left: ${obj.textAlign}`);
  assert.notEqual(obj.textAlign, 'left', 'must not leftover-drop /DS text-align to left');
});

test('package2 FreeText 13246R keeps /DS text-align:center, not leftover left', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'package2-rev4.pdf'));
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

  const freetext = objects.find((object) => object?.pdfAnnotationId === '13246R');
  assert.ok(freetext, 'fixture FreeText 13246R');
  assert.equal(freetext.pdfAnnotationType, 'FreeText');
  assert.equal(freetext.text, 'Hello');
  assert.equal(freetext.textAlign, 'center', `13246R textAlign must keep /DS center, not leftover left: ${freetext.textAlign}`);
});

test('FreeText converter stamps textAlign from /DS; leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /package2 13246R already has native \/DS text-align:center/);
  assert.match(importer, /\.\.\.\(textAlign \? \{ textAlign \} : \{\}\)/);
  assert.doesNotMatch(importer, /create-ink tool/);
  assert.doesNotMatch(importer, /user-settable callout verticalAlign control/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
