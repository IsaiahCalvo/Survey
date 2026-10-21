// Shared by the PDF to Word and PDF to Markdown tests: a small spec-like PDF
// made with pdf-lib, read back with pdf.js the way the tools do.
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfText } from '../pdfParagraphs.js';

// Page 1: a 20pt title, a 14pt heading, a two-line paragraph with a bold
// word, a gap, a second paragraph and a bullet list. Page 2: a heading, a
// numbered list and a rotated note. Page 3 is blank.
export async function specPdf({ rotatePage2 = 0 } = {}) {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([612, 792]);
  const at = (page, text, x, y, size = 11, font = reg) => page.drawText(text, { x, y, size, font });
  at(p1, 'Section 09 91 23 Painting', 72, 720, 20, bold);
  at(p1, 'Part 1 General', 72, 680, 14, bold);
  at(p1, 'The contractor shall supply all', 72, 650);
  at(p1, 'labor', 72 + reg.widthOfTextAtSize('The contractor shall supply all ', 11), 650, 11, bold);
  at(p1, 'and materials for the work.', 72, 636);
  at(p1, 'Submit product data before any work starts.', 72, 606);
  at(p1, '•', 72, 576);
  at(p1, 'Primer for steel', 86, 576);
  at(p1, '•', 72, 562);
  at(p1, 'Finish coats', 86, 562);
  const p2 = doc.addPage([612, 792]);
  if (rotatePage2) p2.setRotation(degrees(rotatePage2));
  at(p2, 'Part 2 Products', 72, 720, 14, bold);
  at(p2, '1. Paint shall be low VOC.', 72, 690);
  at(p2, '2. Use one maker for each system.', 72, 676);
  p2.drawText('NOT FOR CONSTRUCTION', { x: 550, y: 200, size: 11, font: reg, rotate: degrees(90) });
  doc.addPage([612, 792]);
  return doc.save();
}

export async function readPages(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    return await readPdfText(pdf);
  } finally {
    await task.destroy();
  }
}
