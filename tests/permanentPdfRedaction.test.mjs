import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { init } from '@embedpdf/pdfium';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  applyPermanentPdfRedactions,
  collectPendingRedactions,
} from '../src/utils/permanentPdfRedaction.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { createTextMarkupAnnotation } from '../src/utils/pdfTextMarkup.js';

const PAGE_SIZE = { width: 240, height: 200 };

const toArrayBuffer = (value) => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);

async function createNodePdfiumEngine() {
  const wasmBytes = readFileSync(fileURLToPath(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')));
  const module = await init({ wasmBinary: toArrayBuffer(wasmBytes) });
  const native = new PdfiumNative(module, { fontFallback: null });
  return new PdfEngine(native, {
    imageConverter: async () => {
      throw new Error('The redaction path must not rasterize pages.');
    },
  });
}

async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Keep this title');
  doc.setAuthor('Keep this author');
  doc.setSubject('Keep this subject');
  doc.addJavaScript('keep-script', 'app.alert("KEEP SCRIPT");');
  await doc.attach(new TextEncoder().encode('KEEP ATTACHMENT'), 'keep.txt', {
    mimeType: 'text/plain',
    description: 'Attachment that must survive redaction',
  });

  const page = doc.addPage([PAGE_SIZE.width, PAGE_SIZE.height]);
  page.drawText('TOP SECRET ALPHA', { x: 20, y: 150, size: 14, font, color: rgb(0, 0, 0) });
  page.drawText('KEEP ME SEARCHABLE', { x: 20, y: 105, size: 14, font, color: rgb(0, 0, 0) });

  const form = doc.getForm();
  const field = form.createTextField('kept.field');
  field.setText('KEEP FORM VALUE');
  field.addToPage(page, { x: 20, y: 55, width: 150, height: 24, font });

  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [20, 20, 160, 42],
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of('https://example.com/kept-link'),
    },
  });
  const linkRef = doc.context.register(link);
  const noteRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [190, 20, 212, 42],
    Contents: PDFString.of('KEEP COMMENT'),
    Name: 'Comment',
  }));
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots?.push) {
    annots.push(linkRef);
    annots.push(noteRef);
  } else page.node.set(PDFName.of('Annots'), doc.context.obj([linkRef, noteRef]));

  const layerRef = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('KEEP LAYER') }));
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({
    OCGs: [layerRef],
    D: { Order: [layerRef], ON: [layerRef] },
  }));

  const secondPage = doc.addPage([PAGE_SIZE.width, PAGE_SIZE.height]);
  secondPage.drawText('SECOND PAGE STAYS', { x: 20, y: 150, size: 14, font });
  return doc.save();
}

function makePdfFile(bytes) {
  return {
    name: 'selective-redaction.pdf',
    async arrayBuffer() { return toArrayBuffer(bytes); },
  };
}

function makeRedaction() {
  return createTextMarkupAnnotation({
    id: 'fresh-redaction',
    pageNumber: 1,
    selectionGroupId: 'fresh-redaction-group',
    markupType: 'redact',
    selectedText: 'TOP SECRET ALPHA',
    quads: [{ x1: 18, y1: 34, x2: 158, y2: 34, x3: 18, y3: 55, x4: 158, y4: 55 }],
  });
}

async function readPageText(bytes, pageNumber) {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(), useSystemFonts: false });
  const loaded = await loadingTask.promise;
  try {
    const content = await (await loaded.getPage(pageNumber)).getTextContent();
    return content.items.map((item) => item.str).join(' ');
  } finally {
    await loadingTask.destroy();
  }
}

test('pending redactions are collected by page without carrying non-redaction marks', () => {
  const redaction = makeRedaction();
  const result = collectPendingRedactions({
    1: { objects: [redaction, { data: { type: 'text-markup', markupType: 'highlight' } }] },
    2: { objects: [{ data: { type: 'rect' } }] },
  });
  assert.equal(result.count, 1);
  assert.deepEqual(Object.keys(result.byPage), ['1']);
  assert.equal(result.byPage[1][0], redaction);
});

test('permanent redaction removes only marked content and preserves the rest of the PDF', async () => {
  const sourceBytes = await makeSourcePdf();
  const redaction = makeRedaction();
  const annotationsByPage = { 1: { objects: [redaction] } };
  const annotatedBytes = await savePDFWithAnnotationsPdfLib(
    makePdfFile(sourceBytes),
    annotationsByPage,
    { 1: PAGE_SIZE, 2: PAGE_SIZE },
    null,
    { returnBytes: true, actionType: 'pdf-apply-redactions-source', documentId: 'selective-redaction-test' },
  );
  const progress = [];
  const outputBytes = await applyPermanentPdfRedactions({
    annotatedPdfBytes: annotatedBytes,
    annotationsByPage,
    createEngine: createNodePdfiumEngine,
    onProgress: (event) => progress.push(event),
  });

  assert.deepEqual(progress, [{ pageNumber: 1, pageCount: 1, sourcePageNumber: 1 }]);
  const firstPageText = await readPageText(outputBytes, 1);
  assert.doesNotMatch(firstPageText, /TOP SECRET ALPHA/);
  assert.match(firstPageText, /KEEP ME SEARCHABLE/);
  assert.match(await readPageText(outputBytes, 2), /SECOND PAGE STAYS/);

  const outputDoc = await PDFDocument.load(outputBytes);
  assert.equal(outputDoc.getTitle(), 'Keep this title');
  assert.equal(outputDoc.getAuthor(), 'Keep this author');
  assert.equal(outputDoc.getSubject(), 'Keep this subject');
  const pageContents = outputDoc.context.lookup(outputDoc.getPage(0).node.get(PDFName.of('Contents')));
  const pageContentStreams = pageContents instanceof PDFArray ? pageContents.asArray() : [pageContents];
  const decodedPageContent = pageContentStreams
    .map((item) => outputDoc.context.lookup(item))
    .filter((item) => item instanceof PDFRawStream)
    .map((item) => new TextDecoder().decode(decodePDFRawStream(item).decode()))
    .join('\n');
  assert.match(decodedPageContent, /0 0 0 rg[\s\S]*1 0 0 1 18 145 cm/, 'the removed content must keep an opaque black redaction fill');
  assert.equal(outputDoc.getForm().getTextField('kept.field').getText(), 'KEEP FORM VALUE');
  assert.ok(outputDoc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict), 'optional-content layers must survive');
  const names = outputDoc.catalog.lookup(PDFName.of('Names'), PDFDict);
  assert.ok(names.lookupMaybe(PDFName.of('JavaScript'), PDFDict), 'document JavaScript must survive');
  const embeddedFiles = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
  const attachmentNames = embeddedFiles.lookup(PDFName.of('Names'), PDFArray);
  const attachmentName = outputDoc.context.lookup(attachmentNames.get(0));
  assert.equal(attachmentName.decodeText(), 'keep.txt');
  const fileSpec = outputDoc.context.lookup(attachmentNames.get(1), PDFDict);
  const embeddedFileRefs = fileSpec.lookup(PDFName.of('EF'), PDFDict);
  const embeddedFile = embeddedFileRefs.lookup(PDFName.of('F'), PDFRawStream);
  assert.equal(new TextDecoder().decode(decodePDFRawStream(embeddedFile).decode()), 'KEEP ATTACHMENT');

  const loadingTask = pdfjsLib.getDocument({ data: outputBytes.slice(), useSystemFonts: false });
  const loaded = await loadingTask.promise;
  try {
    const page = await loaded.getPage(1);
    const pageAnnotations = await page.getAnnotations({ intent: 'display' });
    const links = pageAnnotations.filter((annotation) => annotation.subtype === 'Link');
    assert.equal(links.some((linkAnnotation) => linkAnnotation.url === 'https://example.com/kept-link'), true);
    assert.equal(pageAnnotations.some((annotation) => annotation.subtype === 'Text' && annotation.contentsObj?.str === 'KEEP COMMENT'), true);
    assert.equal(pageAnnotations.some((annotation) => annotation.subtype === 'Redact'), false);
  } finally {
    await loadingTask.destroy();
  }
});

test('permanent redaction refuses to make a copy when no redaction marks exist', async () => {
  await assert.rejects(
    applyPermanentPdfRedactions({
      annotatedPdfBytes: await makeSourcePdf(),
      annotationsByPage: {},
      createEngine: createNodePdfiumEngine,
    }),
    /No redaction marks/,
  );
});
