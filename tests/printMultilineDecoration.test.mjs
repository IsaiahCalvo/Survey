// Wave 2: print flatten must underline / strike every wrapped and newline line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function collectContent(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

const PAGE_SIZES = { 1: { width: 200, height: 200 } };

test('print flatten underlines and strikes every explicit newline', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {
    1: {
      objects: [{
        id: 'multi-underline',
        type: 'textbox',
        left: 10,
        top: 10,
        width: 160,
        height: 60,
        text: 'Line1\nLine2\nLine3',
        fill: '#000000',
        fontSize: 12,
        underline: true,
        linethrough: true,
      }],
    },
  }, PAGE_SIZES, { returnBytes: true });

  const contentText = await collectContent(bytes);
  const strokedLines = (contentText.match(/ l\s*\n?S\b/g) || []).length;
  assert.equal(
    strokedLines,
    6,
    `3 lines × underline+strike must be 6 strokes, got ${strokedLines}\n${contentText}`,
  );
});

test('print flatten underlines every wrapped line, not just the first', async () => {
  const pdfFile = await makePdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(pdfFile, {
    1: {
      objects: [{
        id: 'wrapped-underline',
        type: 'textbox',
        left: 10,
        top: 10,
        width: 40,
        height: 80,
        text: 'AAAA BBBB CCCC',
        fill: '#000000',
        fontSize: 12,
        underline: true,
      }],
    },
  }, PAGE_SIZES, { returnBytes: true });

  const contentText = await collectContent(bytes);
  const strokedLines = (contentText.match(/ l\s*\n?S\b/g) || []).length;
  assert.ok(
    strokedLines >= 2,
    `wrapped underline must decorate more than the first line, got ${strokedLines}`,
  );
});
