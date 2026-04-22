import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import fs from 'node:fs';

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const font = await doc.embedFont(StandardFonts.Helvetica);

page.drawText('Clickable link test', {
  x: 72,
  y: 720,
  size: 22,
  font,
  color: rgb(0, 0, 0)
});

page.drawText('Tap the blue text below — should open Claude in your default browser:', {
  x: 72,
  y: 680,
  size: 13,
  font,
  color: rgb(0.3, 0.3, 0.3)
});

const linkX = 72;
const linkY = 635;
const linkWidth = 220;
const linkHeight = 24;

page.drawText('https://claude.com', {
  x: linkX + 6,
  y: linkY + 6,
  size: 16,
  font,
  color: rgb(0.1, 0.45, 0.9)
});

const link = doc.context.obj({
  Type: 'Annot',
  Subtype: 'Link',
  Rect: [linkX, linkY, linkX + linkWidth, linkY + linkHeight],
  Border: [0, 0, 0],
  A: {
    Type: 'Action',
    S: 'URI',
    URI: PDFString.of('https://claude.com')
  }
});
const linkRef = doc.context.register(link);
page.node.set(PDFName.of('Annots'), doc.context.obj([linkRef]));

const bytes = await doc.save();
const outPath = '/Users/isaiahcalvo/Desktop/clickable-link-test.pdf';
fs.writeFileSync(outPath, bytes);
console.log('wrote', outPath);
