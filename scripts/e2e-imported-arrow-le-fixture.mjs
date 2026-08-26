import { writeFile } from 'node:fs/promises';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';

// Letter page so ?testPdf= viewBox stays `0 0 612 792`.
// Native /Line + /LE OpenArrow so imported Arrow Select Width can
// prove /LE is not leftover-remapped to ClosedArrow (class 19 used a
// headless Line).
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
  Subtype: PDFName.of('Line'),
  NM: PDFString.of('e2e-imported-arrow-le'),
  Contents: PDFString.of('e2e imported arrow le'),
  Rect: mkArray([90, 390, 310, 510]),
  L: mkArray([100, 400, 300, 500]),
  C: mkArray([0.8, 0.15, 0.15]),
  Border: mkArray([0, 0, 3]),
  LE: [PDFName.of('None'), PDFName.of('OpenArrow')],
  F: PDFNumber.of(4),
});

page.node.set(PDFName.of('Annots'), mkArray(annotationRefs));

const bytes = await pdf.save();
await writeFile(
  new URL('../debug/fixtures/e2e-imported-arrow-le.pdf', import.meta.url),
  bytes,
);
