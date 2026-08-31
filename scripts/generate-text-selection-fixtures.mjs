import { access, readFile, writeFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';

const fixtureRoot = new URL('../debug/fixtures/', import.meta.url);

async function resolveHebrewFont() {
  const candidates = [
    '/System/Library/Fonts/SFHebrew.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common OS font path.
    }
  }
  throw new Error('A Hebrew-capable system font is required (SF Hebrew, DejaVu Sans, or Arial).');
}

async function buildRotationFixture() {
  const pdf = await PDFDocument.create();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cases = [
    { size: [612, 792], rotation: 0, label: 'ROTATION 0 - LETTER PAGE' },
    { size: [792, 612], rotation: 90, label: 'ROTATION 90 - WIDE PAGE' },
    { size: [420, 700], rotation: 180, label: 'ROTATION 180 - NARROW PAGE' },
    { size: [700, 420], rotation: 270, label: 'ROTATION 270 - SHORT PAGE' },
  ];
  cases.forEach(({ size, rotation, label }, index) => {
    const page = pdf.addPage(size);
    page.setRotation(degrees(rotation));
    page.drawText(label, { x: 48, y: size[1] - 80, size: 22, font: bold, color: rgb(0.05, 0.1, 0.2) });
    page.drawText(`Selectable line one on page ${index + 1}.`, { x: 48, y: size[1] - 125, size: 16, font: helvetica });
    page.drawText('Selectable line two crosses the same page.', { x: 48, y: size[1] - 155, size: 16, font: helvetica });
  });

  const hebrewFontPath = await resolveHebrewFont();
  pdf.registerFontkit(fontkit);
  const hebrewFont = await pdf.embedFont(await readFile(hebrewFontPath), { subset: true });
  const rtlPage = pdf.addPage([500, 500]);
  rtlPage.drawText('RTL HEBREW TEXT SELECTION', { x: 48, y: 420, size: 20, font: bold });
  const rtlText = 'שלום עולם בדיקת בחירת טקסט';
  const width = hebrewFont.widthOfTextAtSize(rtlText, 22);
  rtlPage.drawText(rtlText, { x: 452 - width, y: 350, size: 22, font: hebrewFont });

  const cropPage = pdf.addPage([640, 500]);
  cropPage.setCropBox(24, 36, 592, 428);
  cropPage.drawText('CROPBOX OFFSET - TWO COLUMNS', { x: 48, y: 425, size: 18, font: bold });
  cropPage.drawText('Left column line one.', { x: 48, y: 375, size: 15, font: helvetica });
  cropPage.drawText('Left column wrapped', { x: 48, y: 348, size: 15, font: helvetica });
  cropPage.drawText('onto its next line.', { x: 48, y: 327, size: 15, font: helvetica });
  cropPage.drawText('Right column line one.', { x: 330, y: 375, size: 15, font: helvetica });
  cropPage.drawText('Right column line two.', { x: 330, y: 348, size: 15, font: helvetica });
  cropPage.drawText('Near left crop edge.', { x: 26, y: 80, size: 13, font: helvetica });
  cropPage.drawText('Near right crop edge.', { x: 480, y: 80, size: 13, font: helvetica });

  const rotatedCropPage = pdf.addPage([700, 460]);
  rotatedCropPage.setCropBox(32, 28, 620, 392);
  rotatedCropPage.setRotation(degrees(90));
  rotatedCropPage.drawText('ROTATED CROPBOX OFFSET', { x: 60, y: 385, size: 18, font: bold });
  rotatedCropPage.drawText('Rotated cropped selectable text.', { x: 60, y: 335, size: 15, font: helvetica });
  rotatedCropPage.drawText('Rotated cropped edge text.', { x: 60, y: 55, size: 13, font: helvetica });

  await writeFile(new URL('text-selection-rotation-matrix.pdf', fixtureRoot), await pdf.save());
}

async function buildScannedFixture() {
  const width = 1224;
  const height = 1584;
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f8f5ee"/>
      <rect x="80" y="90" width="1064" height="1320" fill="none" stroke="#9ca3af" stroke-width="4"/>
      <text x="120" y="300" font-family="Arial" font-size="92" font-weight="700" fill="#111827">LOCAL OCR TEST</text>
      <text x="120" y="470" font-family="Arial" font-size="62" fill="#111827">Select these scanned words</text>
      <text x="120" y="620" font-family="Arial" font-size="62" fill="#111827">Survey text markup 2026</text>
      <text x="120" y="820" font-family="Arial" font-size="44" fill="#374151">Highlight Underline Squiggle Strikeout</text>
    </svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const png = await pdf.embedPng(image);
  page.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  await writeFile(new URL('ocr-scan-clear.pdf', fixtureRoot), await pdf.save());
}

const fixture = process.argv[2] || 'all';
if (fixture === 'all' || fixture === 'rotation') await buildRotationFixture();
if (fixture === 'all' || fixture === 'scan') await buildScannedFixture();
