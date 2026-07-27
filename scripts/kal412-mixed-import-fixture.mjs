import { writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

const pdf = await PDFDocument.create();
const page = pdf.addPage([300, 300]);

function appearanceRef(content, bbox) {
  return pdf.context.register(pdf.context.flateStream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: bbox,
    Resources: {},
  }));
}

function annotation(value) {
  return pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    P: page.ref,
    ...value,
  }));
}

const curvedInkAppearance = appearanceRef(
  'q\n1 0 0 RG\n4 w\n10 10 m\n25 35 45 35 60 10 c\nS\nQ\n',
  [0, 0, 70, 45],
);
const stampAppearance = appearanceRef(
  'q\n0.8 0.2 0.2 rg\n0 0 60 30 re\nf\nQ\n',
  [0, 0, 60, 30],
);
const redactAppearance = appearanceRef(
  'q\n0 0 0 rg\n0 0 70 20 re\nf\nQ\n',
  [0, 0, 70, 20],
);

const annotations = [
  annotation({
    Subtype: 'Square',
    Rect: [20, 230, 80, 280],
    C: [0, 0, 1],
    BS: { W: 2 },
    NM: PDFString.of('supported-square'),
  }),
  annotation({
    Subtype: 'Ink',
    Rect: [20, 150, 90, 200],
    InkList: [[30, 160, 45, 190, 65, 190, 80, 160]],
    C: [1, 0, 0],
    BS: { W: 4 },
    AP: { N: curvedInkAppearance },
    NM: PDFString.of('sampled-curved-ink'),
  }),
  annotation({
    Subtype: 'Ink',
    Rect: [110, 150, 180, 200],
    InkList: [[120, 160, 140, 190, 170, 160]],
    C: [0, 0.5, 0],
    BS: { W: 4 },
    NM: PDFString.of('fallback-ink-list'),
  }),
  annotation({
    Subtype: 'Stamp',
    Rect: [20, 90, 80, 120],
    AP: { N: stampAppearance },
    NM: PDFString.of('native-stamp'),
  }),
  annotation({
    Subtype: 'Redact',
    Rect: [100, 90, 170, 110],
    AP: { N: redactAppearance },
    NM: PDFString.of('native-redact'),
  }),
  annotation({
    Subtype: 'Square',
    Rect: [200, 230, 250, 280],
    Border: [0, 0, 0],
    NM: PDFString.of('skipped-invisible-square'),
  }),
];

page.node.set(PDFName.of('Annots'), pdf.context.obj(annotations));

const bytes = await pdf.save();
await writeFile(
  new URL('../debug/fixtures/kal412-mixed-import-e2e.pdf', import.meta.url),
  bytes,
);
