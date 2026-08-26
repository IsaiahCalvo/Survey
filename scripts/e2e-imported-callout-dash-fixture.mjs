import { writeFile } from 'node:fs/promises';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';

// Letter page so ?testPdf= viewBox stays `0 0 612 792`.
// Native /FreeText /IT /FreeTextCallout + /BS /S /D so imported Callout
// Select Width can prove Line /BS dash is not leftover-replaced with
// leftover-solid (class 21 used Square / Circle dash; class 18/19 used
// Line / Poly dash). Do not invent Line /AP.
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
  Subtype: PDFName.of('FreeText'),
  NM: PDFString.of('e2e-imported-callout-dash'),
  Contents: PDFString.of('e2e imported callout dash'),
  Rect: mkArray([220, 430, 380, 530]),
  C: mkArray([0.8, 0.15, 0.15]),
  IC: mkArray([1, 1, 1]),
  IT: PDFName.of('FreeTextCallout'),
  CL: mkArray([80, 420, 160, 480, 220, 480]),
  LE: [PDFName.of('OpenArrow'), PDFName.of('None')],
  DA: PDFString.of('0.8 0.15 0.15 rg /Helv 12 Tf'),
  Q: PDFNumber.of(0),
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
  new URL('../debug/fixtures/e2e-imported-callout-dash.pdf', import.meta.url),
  bytes,
);
