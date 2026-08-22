import { writeFile } from 'node:fs/promises';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';

// Letter page so ?testPdf= viewBox stays `0 0 612 792` (same as glyph-lab).
// Construction matches scripts/fix19-live-auth-contract-e2e.mjs (PDFName +
// PDFArray Vertices) so pdf.js + the importer see Polygon / PolyLine.
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
  Subtype: PDFName.of('Polygon'),
  NM: PDFString.of('e2e-poly-a'),
  Contents: PDFString.of('e2e polygon A'),
  Rect: mkArray([90, 350, 290, 530]),
  Vertices: mkArray([100, 480, 260, 520, 280, 380, 110, 360]),
  C: mkArray([0, 0.25, 1]),
  IC: mkArray([0.75, 0.88, 1]),
  Border: mkArray([0, 0, 3]),
  F: PDFNumber.of(4),
});

addAnnot({
  Type: PDFName.of('Annot'),
  Subtype: PDFName.of('PolyLine'),
  NM: PDFString.of('e2e-polyline'),
  Contents: PDFString.of('e2e polyline'),
  Rect: mkArray([330, 390, 530, 570]),
  Vertices: mkArray([340, 500, 430, 560, 520, 480, 440, 400]),
  C: mkArray([0.8, 0.15, 0.15]),
  Border: mkArray([0, 0, 4]),
  F: PDFNumber.of(4),
});

addAnnot({
  Type: PDFName.of('Annot'),
  Subtype: PDFName.of('Polygon'),
  NM: PDFString.of('e2e-poly-b'),
  Contents: PDFString.of('e2e polygon B'),
  Rect: mkArray([110, 130, 250, 270]),
  Vertices: mkArray([120, 220, 240, 260, 220, 140]),
  C: mkArray([0, 0.55, 0.2]),
  IC: mkArray([0.8, 1, 0.85]),
  Border: mkArray([0, 0, 3]),
  F: PDFNumber.of(4),
});

page.node.set(PDFName.of('Annots'), mkArray(annotationRefs));

const bytes = await pdf.save();
await writeFile(
  new URL('../debug/fixtures/e2e-poly-vertices.pdf', import.meta.url),
  bytes,
);
