// Generate three disposable PDFs inside the worktree:
//  - normal-test.pdf   : 3 pages with annotation guides
//  - corrupted.pdf     : truncated/invalid bytes
//  - form-test.pdf     : pdf-lib with form fields
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ART = join(__dirname, '..', 'artifacts');

async function makeNormal() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const titles = ['Audit Test — Page 1', 'Audit Test — Page 2', 'Audit Test — Page 3'];
  const subtitles = [
    'Pen + highlighter test surface.',
    'Rectangle / ellipse / line / arrow test surface.',
    'Text box / callout / counter test surface.'
  ];
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 700, width: 612, height: 92, color: rgb(0.13, 0.32, 0.62) });
    page.drawText(titles[i], { x: 36, y: 736, size: 28, font: helvBold, color: rgb(1, 1, 1) });
    page.drawText(subtitles[i], { x: 36, y: 660, size: 14, font: helv, color: rgb(0.2, 0.2, 0.2) });
    page.drawRectangle({ x: 36, y: 100, width: 540, height: 540, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
  }
  writeFileSync(join(ART, 'normal-test.pdf'), await doc.save());
}

async function makeCorrupted() {
  // 12 bytes of "PDF-looking" garbage that won't parse
  writeFileSync(
    join(ART, 'corrupted.pdf'),
    Buffer.from('%PDF-1.7\nthis is not actually a pdf\n%%EOF', 'utf8')
  );
}

async function makeForm() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Form Field Test', { x: 36, y: 736, size: 24, font: helv });
  const form = doc.getForm();
  const tf = form.createTextField('survey.name');
  tf.setText('initial');
  tf.addToPage(page, { x: 36, y: 660, width: 200, height: 24 });
  const cb = form.createCheckBox('survey.agree');
  cb.addToPage(page, { x: 36, y: 600, width: 18, height: 18 });
  writeFileSync(join(ART, 'form-test.pdf'), await doc.save());
}

await makeNormal();
await makeCorrupted();
await makeForm();
console.log('PDFs written to', ART);
