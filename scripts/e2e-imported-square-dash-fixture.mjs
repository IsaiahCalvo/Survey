import { writeFile } from 'node:fs/promises';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';

// Letter page so ?testPdf= viewBox stays `0 0 612 792`.
// Native /Square + /BS /S /D so imported Square Select Width can
// prove /AP dash is not leftover-replaced with solid (class 16 used
// Square rotate; class 18 used Polygon dash).
const pdf = await PDFDocument.create();
const page = pdf.addPage([612, 792]);
const annotationRefs = [];

const mkArray = (items) => {
  const arr = PDFArray.withContext(pdf.context);
  items.forEach((item) => arr.push(Number.isFinite(item) ? PDFNumber.of(item) : item));
  return arr;
};

const addAnnot = (dict) => {
  annotationRefs.push(pdf.context.register(pdf.context.obj(dict)));
};

addAnnot({
  Type: PDFName.of('Annot'),
  Subtype: PDFName.of('Square'),
  NM: PDFString.of('e2e-imported-square-dash'),
  Contents: PDFString.of('e2e imported square dash'),
  Rect: mkArray([90, 390, 310, 510]),
  C: mkArray([0.8, 0.15, 0.15]),
  IC: mkArray([0.8, 0.15, 0.15]),
  Border: mkArray([0, 0, 3]),
  BS: pdf.context.obj({
    Type: PDFName.of('Border'),
    W: PDFNumber.of(3),
    S: PDFName.of('D'),
    D: mkArray([6, 4]),
  }),
  F: PDFNumber.of(4),
});

addAnnot({
  Type: PDFName.of('Annot'),
  Subtype: PDFName.of('Circle'),
  NM: PDFString.of('e2e-imported-circle-dash'),
  Contents: PDFString.of('e2e imported circle dash'),
  Rect: mkArray([90, 220, 190, 320]),
  C: mkArray([0.15, 0.2, 0.8]),
  IC: mkArray([0.15, 0.2, 0.8]),
  Border: mkArray([0, 0, 3]),
  BS: pdf.context.obj({
    Type: PDFName.of('Border'),
    W: PDFNumber.of(3),
    S: PDFName.of('D'),
    D: mkArray([6, 4]),
  }),
  F: PDFNumber.of(4),
});

page.node.set(PDFName.of('Annots'), mkArray(annotationRefs));

const bytes = await pdf.save();
await writeFile(
  new URL('../debug/fixtures/e2e-imported-square-dash.pdf', import.meta.url),
  bytes,
);
