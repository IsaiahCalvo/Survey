// Builds debug/fixtures/order-pages.pdf: 8 pages, each a different width
// (600, 620, ... 740 pt by 792 pt), so a test can tell every page apart by
// its shape alone (Pages-tab drag-to-reorder and page Undo checks).
//   node debug/fixtures/make-order-pages.mjs
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./order-pages.pdf', import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 8; n += 1) {
  const width = 580 + n * 20;
  const page = doc.addPage([width, 792]);
  page.drawRectangle({ x: 12, y: 12, width: width - 24, height: 768, borderColor: rgb(0, 0, 0), borderWidth: 3 });
  page.drawText(String(n), { x: width / 2 - 60, y: 330, size: 220, font, color: rgb(0.1, 0.1, 0.45) });
  page.drawText(`${width} x 792 pt`, { x: 30, y: 40, size: 18, font, color: rgb(0.3, 0.3, 0.3) });
}
writeFileSync(out, await doc.save());
console.log('wrote', out);
