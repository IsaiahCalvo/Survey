import { writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

const pdf = await PDFDocument.create();
const page = pdf.addPage([300, 200]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const secret = 'Selectable line one on page 1.';
page.drawText(secret, { x: 30, y: 120, size: 14, font, color: rgb(0, 0, 0) });

const appearance = pdf.context.register(pdf.context.flateStream(
  'q\n0 0 0 rg\n0 0 222 18 re f\nQ\n',
  {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, 222, 18],
    Resources: {},
  },
));
const redaction = pdf.context.register(pdf.context.obj({
  Type: 'Annot',
  Subtype: 'Redact',
  Rect: [28, 116, 250, 134],
  C: [0, 0, 0],
  Contents: PDFString.of(secret),
  AP: { N: appearance },
  NM: PDFString.of('unsafe-imported-redaction'),
  P: page.ref,
}));
page.node.set(PDFName.of('Annots'), pdf.context.obj([redaction]));

await writeFile(
  new URL('../debug/fixtures/unapplied-redaction-leak.pdf', import.meta.url),
  await pdf.save(),
);
