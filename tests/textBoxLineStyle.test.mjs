// textBoxLineStyle.test.mjs — a text box's dashed / dotted line style shows on
// screen (renderText), on the canvas painter and in the exported / printed PDF.
// The Style picker wrote strokeDashArray onto text boxes, but every text
// renderer drew the border solid, so the pick did nothing you could see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
const { savePDFWithFlattenedRegularAnnotationsForPrint } = await import('../src/utils/pdfAnnotationsPdfLib.js');

const rendererSource = readFileSync(new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url), 'utf8');

const PAGE = { width: 200, height: 200 };
const textBox = (extra = {}) => ({
  type: 'textbox', left: 20, top: 20, width: 120, height: 40, text: 'Hello box',
  fontSize: 12, fontFamily: 'Helvetica', fill: '#000000', stroke: '#ff0000', strokeWidth: 2, ...extra,
});

test('renderText draws the border with the box\'s dash pattern', () => {
  const start = rendererSource.indexOf('export const renderText = ');
  const body = rendererSource.slice(start, rendererSource.indexOf('\nexport const ', start + 10));
  assert.match(body, /strokeDasharray=\{Array\.isArray\(obj\.strokeDashArray\)/);
});

test('canvas painter strokes a dashed text box border dashed, then clears the dash', () => {
  const dashes = [];
  const context = new Proxy({ globalAlpha: 1 }, {
    get(target, key) {
      if (key === 'setLineDash') return (d) => dashes.push([...d]);
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  drawAnnotationObject(context, textBox({ strokeDashArray: [6, 4] }), 1);
  assert.ok(dashes.some((d) => d.join(',') === '6,4'), `dash set: ${JSON.stringify(dashes)}`);
  assert.deepEqual(dashes.at(-1), []);
});

const blankPdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return { name: 'blank.pdf', async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
};
const printedContent = async (object) => {
  const original = globalThis.window;
  globalThis.window = {};
  try {
    const result = await savePDFWithFlattenedRegularAnnotationsForPrint(
      await blankPdfFile(), { 1: { objects: [object] } }, { 1: PAGE }, { returnBytes: true },
    );
    const bytes = result instanceof Uint8Array ? result : result?.bytes || result?.pdfBytes || result;
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(0).node.Contents();
    const streams = contents?.asArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const { decodePDFRawStream } = await import('pdf-lib');
    return streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')).join('\n');
  } finally { globalThis.window = original; }
};

test('the printed PDF draws a dashed text box border dashed and a solid one solid', async () => {
  assert.match(await printedContent(textBox({ strokeDashArray: [6, 4] })), /\[6 4\] 0 d/);
  assert.doesNotMatch(await printedContent(textBox()), /\[6 4\] 0 d/);
});
