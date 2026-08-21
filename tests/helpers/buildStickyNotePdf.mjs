import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

/** Native PDF Text (sticky note) fixture. Not a product Note writer. */
export const STICKY_NOTE = Object.freeze({
  contents: 'e2e-sticky-body',
  icon: 'Note',
  title: 'Isaiah',
});

export async function buildStickyNotePdf() {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([612, 792]);
  doc.addPage([612, 792]);

  const annot = page1.doc.context.register(page1.doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [72, 680, 96, 704],
    Contents: PDFString.of(STICKY_NOTE.contents),
    T: PDFString.of(STICKY_NOTE.title),
    Name: PDFName.of(STICKY_NOTE.icon),
    C: [1, 0.92, 0.23],
    Open: false,
  }));
  page1.node.addAnnot(annot);

  return doc.save();
}
