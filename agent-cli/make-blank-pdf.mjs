// Writes a tiny one-page PDF (no embedded annotations) for throwaway probes.
//   node agent-cli/make-blank-pdf.mjs <out.pdf> [label]
import fs from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const out = process.argv[2];
if (!out) throw new Error('usage: make-blank-pdf.mjs <out.pdf> [label]');
const doc = await PDFDocument.create();
const page = doc.addPage([792, 612]);
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText(process.argv[3] || 'throwaway probe page', { x: 40, y: 570, size: 14, font });
fs.writeFileSync(out, await doc.save());
console.log(out, fs.statSync(out).size, 'bytes');
