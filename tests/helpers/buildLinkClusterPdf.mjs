import { PDFDocument, PDFString } from 'pdf-lib';

/** Native PDF Link cluster used by unit + Playwright hunts. Not a product writer. */
export const LINK_CLUSTER = Object.freeze({
  https: 'https://example.com/safe',
  mailto: 'mailto:isaiah@example.test',
  javascript: 'javascript:alert(1)',
  data: 'data:text/html,pwned',
  file: 'file:///etc/passwd',
  ftp: 'ftp://files.example.com/x',
});

export async function buildLinkClusterPdf() {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([612, 792]);
  const page2 = doc.addPage([612, 792]);

  const addUri = (page, rect, uri) => {
    const annot = page.doc.context.register(page.doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect,
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
    }));
    page.node.addAnnot(annot);
  };

  addUri(page1, [50, 700, 280, 740], LINK_CLUSTER.https);
  addUri(page1, [50, 640, 280, 680], LINK_CLUSTER.mailto);
  addUri(page1, [50, 580, 280, 620], LINK_CLUSTER.javascript);
  addUri(page1, [50, 520, 280, 560], LINK_CLUSTER.data);
  addUri(page1, [50, 460, 280, 500], LINK_CLUSTER.file);
  addUri(page1, [50, 400, 280, 440], LINK_CLUSTER.ftp);

  const dest = page1.doc.context.obj([page2.ref, 'XYZ', null, null, null]);
  const gotoAnnot = page1.doc.context.register(page1.doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [50, 340, 280, 380],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'GoTo', D: dest },
  }));
  page1.node.addAnnot(gotoAnnot);

  return doc.save();
}
