// Builds debug/fixtures/landscape-sheets.pdf: drawing-sheet sized pages
// (17x11 in = 1224x792 pt) like the owner's "One Key" set, plus letter pages
// to compare against. Page 4 is stored with /Rotate 90 (a wide sheet that
// opens standing up). Used by the Pages-tab thumbnail size check.
//   node debug/fixtures/make-landscape-sheets.mjs
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./landscape-sheets.pdf', import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const sizes = [[612, 792], [1224, 792], [1224, 792], [1224, 792], [1224, 792], [1224, 792], [1224, 792], [612, 792]];
sizes.forEach(([w, h], i) => {
  const n = i + 1;
  const page = doc.addPage([w, h]);
  page.drawRectangle({ x: 12, y: 12, width: w - 24, height: h - 24, borderColor: rgb(0, 0, 0), borderWidth: 3 });
  page.drawText(`SHEET ${n}`, { x: 48, y: h - 110, size: 72, font, color: rgb(0.1, 0.1, 0.45) });
  page.drawText('top-left', { x: 24, y: h - 34, size: 16, font, color: rgb(0.7, 0, 0) });
  page.drawRectangle({ x: w - 260, y: 24, width: 236, height: 90, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.5 });
  page.drawText(`${w} x ${h} pt`, { x: w - 248, y: 60, size: 20, font, color: rgb(0.2, 0.2, 0.2) });
  for (let k = 0; k < 24; k += 1) {
    const x = 60 + ((k * 97) % (w - 160));
    const y = 140 + ((k * 61) % (h - 300));
    page.drawRectangle({ x, y, width: 70, height: 40, borderColor: rgb(0.3, 0.4, 0.6), borderWidth: 1 });
  }
  if (n === 4) page.setRotation(degrees(90));
});
writeFileSync(out, await doc.save());
console.log('wrote', out);
