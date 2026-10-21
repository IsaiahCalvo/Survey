// Builds debug/fixtures/door-tags.pdf: a 792 x 612 pt floor plan stand-in.
// Page 1 has door tags D-101 to D-106 (D-103 printed twice, one split as
// "D-" "104"), plus look-alikes that are not doors (SD-110, sizes, a sheet
// number); page 2 has D-201 and D-202. For the Survey agent's
// "add all doors on this sheet" checks.
//   node debug/fixtures/make-door-tags.mjs
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./door-tags.pdf', import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const label = (page, text, x, y, size = 10) => page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });

const one = doc.addPage([792, 612]);
one.drawRectangle({ x: 40, y: 60, width: 712, height: 500, borderColor: rgb(0, 0, 0), borderWidth: 2 });
label(one, 'LEVEL 1 PLAN', 50, 575, 14);
label(one, 'D-101', 100, 480);
label(one, 'D-102', 260, 480);
label(one, 'D-103', 420, 480);
label(one, 'D-', 580, 480);
label(one, '104', 593, 480);
label(one, 'D-105', 100, 300);
label(one, 'D-106', 260, 300);
label(one, 'D-103', 650, 120, 7);
label(one, 'SD-110', 420, 300);
label(one, '3\'-0" x 7\'-0"', 580, 300);
label(one, 'A-101', 700, 70, 12);

const two = doc.addPage([792, 612]);
label(two, 'LEVEL 2 PLAN', 50, 575, 14);
label(two, 'D-201', 100, 480);
label(two, 'D-202', 260, 480);

writeFileSync(out, await doc.save());
console.log('wrote', out);
