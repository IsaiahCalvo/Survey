import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import fs from 'node:fs';

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const font = await doc.embedFont(StandardFonts.Helvetica);

page.drawText('Interactive PDF test', {
  x: 72,
  y: 720,
  size: 22,
  font,
  color: rgb(0, 0, 0)
});

page.drawText('Tap the blue text — should open Claude in your default browser:', {
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

page.drawText('Type your name in the box:', {
  x: 72,
  y: 560,
  size: 13,
  font,
  color: rgb(0.3, 0.3, 0.3)
});

page.drawText('Tick the checkbox:', {
  x: 72,
  y: 470,
  size: 13,
  font,
  color: rgb(0.3, 0.3, 0.3)
});

const form = doc.getForm();
const nameField = form.createTextField('name');
nameField.setText('');
nameField.addToPage(page, {
  x: 72,
  y: 510,
  width: 300,
  height: 28,
  borderColor: rgb(0.5, 0.5, 0.5),
  backgroundColor: rgb(1, 1, 1)
});

const agreeBox = form.createCheckBox('agree');
agreeBox.addToPage(page, {
  x: 72,
  y: 430,
  width: 20,
  height: 20
});

page.drawText('I agree', {
  x: 100,
  y: 434,
  size: 13,
  font,
  color: rgb(0.3, 0.3, 0.3)
});

const existingAnnots = page.node.get(PDFName.of('Annots'));
if (existingAnnots && typeof existingAnnots.push === 'function') {
  existingAnnots.push(linkRef);
} else {
  page.node.set(PDFName.of('Annots'), doc.context.obj([linkRef, ...(existingAnnots?.array || [])]));
}

const bytes = await doc.save();
const outPath = '/Users/isaiahcalvo/Desktop/clickable-link-test.pdf';
fs.writeFileSync(outPath, bytes);
console.log('wrote', outPath);
