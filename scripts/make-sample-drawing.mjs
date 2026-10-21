#!/usr/bin/env node
// Builds src/assets/sample-floor-plan.pdf, the "Try a sample drawing" file on
// an empty Home. A made-up single-storey plan, so it is safe to ship: rerun
// this script if you change it, and commit the PDF.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/assets/sample-floor-plan.pdf');
const FT = 18; // points per foot (1/4" = 1'-0" on a 17x11 sheet)
const INK = rgb(0.12, 0.12, 0.14);
const GREY = rgb(0.45, 0.45, 0.5);

const pdf = await PDFDocument.create();
pdf.setTitle('Sample floor plan');
pdf.setAuthor('Survey');
pdf.setCreator('Survey');
pdf.setProducer('Survey');
// Fixed dates keep the file byte-identical between runs.
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
const page = pdf.addPage([1224, 792]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

const X0 = 170;
const Y0 = 170;
const at = (fx, fy) => ({ x: X0 + fx * FT, y: Y0 + fy * FT });
const line = (a, b, thickness = 1, color = INK) => page.drawLine({ start: at(...a), end: at(...b), thickness, color });
const wall = (a, b) => line(a, b, 5);
const text = (s, fx, fy, size = 11, f = font, color = INK) => {
  const w = f.widthOfTextAtSize(s, size);
  page.drawText(s, { x: at(fx, fy).x - w / 2, y: at(fx, fy).y - size / 2, size, font: f, color });
};

// Outer walls: 36' x 24' with an entry gap on the south wall.
wall([0, 0], [16, 0]); wall([19, 0], [36, 0]);
wall([36, 0], [36, 24]); wall([36, 24], [0, 24]); wall([0, 24], [0, 0]);
// Inner walls.
wall([14, 0], [14, 10]); wall([14, 13], [14, 24]);
wall([24, 24], [24, 14]); wall([24, 11], [24, 10]); wall([24, 10], [36, 10]);
wall([0, 12], [5, 12]); wall([8, 12], [14, 12]);
wall([24, 17], [28, 17]); wall([31, 17], [36, 17]);
// Door swings (quarter arcs drawn as short segments).
const door = (cx, cy, r, from, to) => {
  const steps = 12;
  for (let i = 0; i < steps; i += 1) {
    const a1 = (from + ((to - from) * i) / steps) * (Math.PI / 180);
    const a2 = (from + ((to - from) * (i + 1)) / steps) * (Math.PI / 180);
    line([cx + r * Math.cos(a1), cy + r * Math.sin(a1)], [cx + r * Math.cos(a2), cy + r * Math.sin(a2)], 0.6, GREY);
  }
  line([cx, cy], [cx + r * Math.cos(to * Math.PI / 180), cy + r * Math.sin(to * Math.PI / 180)], 0.8, GREY);
};
door(16, 0, 3, 0, 90);
door(14, 10, 3, 90, 0);
door(5, 12, 3, 0, 90);
door(24, 11, 3, 90, 180);
door(28, 17, 3, 0, 90);
// Windows on the outer walls.
for (const [a, b] of [[[4, 24], [10, 24]], [[27, 24], [33, 24]], [[36, 3], [36, 7]], [[0, 16], [0, 20]], [[4, 0], [10, 0]]]) {
  line([a[0], a[1] - 0.15], [b[0], b[1] - 0.15], 0.6, GREY);
  line([a[0], a[1] + 0.15], [b[0], b[1] + 0.15], 0.6, GREY);
}
// Kitchen counter and island.
page.drawRectangle({ ...at(0.2, 0.2), width: 2 * FT, height: 11.6 * FT, borderColor: GREY, borderWidth: 0.8 });
page.drawRectangle({ ...at(5, 4), width: 5 * FT, height: 2.5 * FT, borderColor: GREY, borderWidth: 0.8 });

text('KITCHEN', 7, 8.5, 12, bold); text('14\'-0" x 12\'-0"', 7, 7.6, 9, font, GREY);
text('BEDROOM 1', 7, 18, 12, bold); text('14\'-0" x 12\'-0"', 7, 17.1, 9, font, GREY);
text('LIVING', 19, 6, 12, bold); text('10\'-0" x 24\'-0"', 19, 5.1, 9, font, GREY);
text('BEDROOM 2', 30, 5, 12, bold); text('12\'-0" x 10\'-0"', 30, 4.1, 9, font, GREY);
text('BATH', 30, 22.4, 12, bold); text('12\'-0" x 7\'-0"', 30, 21.5, 9, font, GREY);
text('HALL', 30, 13.5, 12, bold); text('12\'-0" x 7\'-0"', 30, 12.6, 9, font, GREY);
text('ENTRY', 17.5, -1.2, 9, font, GREY);

// Overall dimensions.
const dim = (a, b, label, offset) => {
  line(a, b, 0.6, GREY);
  for (const p of [a, b]) line([p[0] - (offset[1] ? 0.3 : 0), p[1] - (offset[0] ? 0.3 : 0)], [p[0] + (offset[1] ? 0.3 : 0), p[1] + (offset[0] ? 0.3 : 0)], 0.6, GREY);
  text(label, (a[0] + b[0]) / 2 + offset[0], (a[1] + b[1]) / 2 + offset[1], 9, font, GREY);
};
dim([0, 26], [36, 26], '36\'-0"', [0, 0.7]);
dim([38, 0], [38, 24], '24\'-0"', [1.4, 0]);

// Title block.
page.drawRectangle({ x: 1000, y: 40, width: 184, height: 712, borderColor: INK, borderWidth: 1 });
page.drawText('SAMPLE FLOOR PLAN', { x: 1012, y: 120, size: 13, font: bold, color: INK });
page.drawText('Try marking it up: count rooms,', { x: 1012, y: 100, size: 8.5, font, color: GREY });
page.drawText('circle problems, add notes.', { x: 1012, y: 89, size: 8.5, font, color: GREY });
page.drawText('Scale: 1/4" = 1\'-0"', { x: 1012, y: 66, size: 9, font, color: INK });
page.drawText('Sheet A-101  ·  Survey sample', { x: 1012, y: 52, size: 8, font, color: GREY });
page.drawText('N', { x: 1086, y: 690, size: 16, font: bold, color: INK });
page.drawLine({ start: { x: 1092, y: 640 }, end: { x: 1092, y: 684 }, thickness: 1.5, color: INK });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, await pdf.save({ useObjectStreams: true }));
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);
