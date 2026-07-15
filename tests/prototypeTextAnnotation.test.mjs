import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  createTextboxAnnotation,
  drawTextboxAnnotation,
  isTextboxAnnotation,
  wrapTextboxText,
} from '../src/prototype/textAnnotation.js';
import {
  extractFreeTextAnnotation,
  parseFreeTextAppearance,
} from '../src/prototype/freeTextAnnotation.js';
import { eraseAnnotations } from '../src/prototype/annotationGeometry.js';

test('textbox creation clamps the editable box to page space', () => {
  const annotation = createTextboxAnnotation({ x: 190, y: 290 }, {
    id: 'text-1',
    pageWidth: 200,
    pageHeight: 300,
    width: 80,
    height: 40,
    color: '#123456',
    fontSize: 18,
  });

  assert.equal(isTextboxAnnotation(annotation), true);
  assert.deepEqual(annotation.bounds, { x: 120, y: 260, w: 80, h: 40 });
  assert.equal(annotation.textColor, '#123456');
  assert.equal(annotation.fontFamily, 'Helvetica');
  assert.equal(annotation.atomicErase, true);
});

test('textbox wrapping preserves explicit lines and wraps to measured width', () => {
  const context = { measureText: (value) => ({ width: value.length * 5 }) };
  assert.deepEqual(wrapTextboxText(context, 'abcd ef\nxy', 20), ['abcd', 'ef', 'xy']);
});

test('textbox edit mode paints text with the same Canvas layout as idle mode', () => {
  const createContext = () => {
    const operations = [];
    return {
      operations,
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      translate() {},
      rotate() {},
      setLineDash() {},
      measureText: (value) => ({ width: value.length * 6 }),
      fillRect: (...args) => operations.push(['fillRect', ...args]),
      strokeRect: (...args) => operations.push(['strokeRect', ...args]),
      fillText: (...args) => operations.push(['fillText', ...args]),
    };
  };
  const annotation = createTextboxAnnotation({ x: 20, y: 30 }, {
    id: 'text-layout', pageWidth: 300, pageHeight: 300, width: 120, height: 60,
  });
  annotation.text = 'Canvas text stays fixed';

  const idleContext = createContext();
  const editingContext = createContext();
  drawTextboxAnnotation(idleContext, annotation);
  drawTextboxAnnotation(editingContext, annotation, 0, 0, {
    selectionStart: 11,
    selectionEnd: 11,
    displayScale: 2,
  });

  assert.deepEqual(
    editingContext.operations.filter(([kind]) => kind === 'fillText'),
    idleContext.operations.filter(([kind]) => kind === 'fillText'),
  );
  assert.equal(editingContext.operations.some(([kind]) => kind === 'fillRect'), true);
  assert.equal(editingContext.operations.some(([kind]) => kind === 'strokeRect'), true);
});

test('FreeText appearance parser reads font, size, and color in either operator order', () => {
  assert.deepEqual(parseFreeTextAppearance('1 0 0 rg /Helv 14 Tf'), {
    fontFamily: 'Helvetica',
    fontSize: 14,
    color: 'rgb(255, 0, 0)',
  });
});

test('PDF FreeText imports as an editable textbox with text, bounds, and styling', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 300]);
  const annotation = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: [20, 240, 120, 280],
    Contents: PDFString.of('Imported note'),
    DA: PDFString.of('1 0 0 rg /Helv 14 Tf'),
    DS: PDFString.of('font-size: 16pt; font-family: Arial; color: #00aa00; text-align: center'),
    C: [0, 0, 1],
    IC: [1, 1, 0],
    CA: 0.5,
    BS: { W: 2 },
    Q: 1,
    NM: PDFString.of('note-1'),
  });
  const ref = pdf.context.register(annotation);
  page.node.set(PDFName.of('Annots'), pdf.context.obj([ref]));
  const viewport = { convertToViewportPoint: (x, y) => [x, 300 - y] };

  const imported = extractFreeTextAnnotation(annotation, viewport, pdf.context, 0);

  assert.equal(imported.id, 'FreeText-note-1');
  assert.equal(imported.text, 'Imported note');
  assert.deepEqual(imported.bounds, { x: 20, y: 20, w: 100, h: 40 });
  assert.equal(imported.fontFamily, 'Arial');
  assert.equal(imported.fontSize, 16);
  assert.equal(imported.textColor, '#00aa00');
  assert.equal(imported.textAlign, 'center');
  assert.equal(imported.backgroundColor, 'rgb(255, 255, 0)');
  assert.equal(imported.borderColor, 'rgb(0, 0, 255)');
  assert.equal(imported.borderWidth, 2);
  assert.equal(imported.opacity, 0.5);
});

test('partial eraser treats textboxes atomically', () => {
  const textbox = createTextboxAnnotation({ x: 20, y: 20 }, {
    id: 'text-atomic', pageWidth: 200, pageHeight: 200, width: 100, height: 40,
  });
  const result = eraseAnnotations([textbox], [{ x: 30, y: 30 }], 5, 'partial');

  assert.deepEqual(result.changedIds, ['text-atomic']);
  assert.deepEqual(result.deletedIds, ['text-atomic']);
  assert.equal(result.annotations.length, 0);
});
