// Small text PDFs for the PDF to RTF / HTML tests, and their pdf.js text.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// A two-page letter: a big title, a paragraph over three lines, a second
// paragraph after a gap, and a page with words drawn in two pieces.
export async function letterPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Site Safety Notice', { x: 72, y: 700, size: 24, font: bold });
  ['All visitors must sign in at the', 'gate and wear a hard hat and a high-', 'visibility vest at all times.'].forEach((t, i) => p1.drawText(t, { x: 72, y: 650 - i * 14, size: 11, font }));
  p1.drawText('Deliveries arrive before 7 am.', { x: 72, y: 580, size: 11, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('Level 2', { x: 72, y: 700, size: 11, font });
  p2.drawText('slab pour', { x: 72 + font.widthOfTextAtSize('Level 2', 11) + 4, y: 700, size: 11, font });
  p2.drawText('Second line here.', { x: 72, y: 686, size: 11, font });
  return doc.save();
}

export async function pagesOf(bytes) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true, verbosity: 0 });
  const pdf = await task.promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out.push({ ...content, viewport: page.getViewport({ scale: 1 }) });
  }
  await task.destroy();
  return out;
}
