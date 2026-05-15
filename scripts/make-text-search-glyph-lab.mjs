import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const outputPath = path.resolve('debug/fixtures/text-search-glyph-lab.pdf');
const pdf = await PDFDocument.create();

const fonts = {
  helvetica: await pdf.embedFont(StandardFonts.Helvetica),
  helveticaBold: await pdf.embedFont(StandardFonts.HelveticaBold),
  helveticaItalic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  times: await pdf.embedFont(StandardFonts.TimesRoman),
  timesBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  timesItalic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  courier: await pdf.embedFont(StandardFonts.Courier),
  courierBold: await pdf.embedFont(StandardFonts.CourierBold),
  courierItalic: await pdf.embedFont(StandardFonts.CourierOblique)
};

const pageWidth = 612;
const pageHeight = 792;
const margin = 48;
const textColor = rgb(0.08, 0.08, 0.08);

const pages = [
  {
    title: 'Text Search Glyph Lab - Core Alphabet',
    rows: [
      ['Helvetica 28', fonts.helvetica, 28, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
      ['Helvetica 28', fonts.helvetica, 28, 'abcdefghijklmnopqrstuvwxyz'],
      ['Helvetica 28', fonts.helvetica, 28, '0123456789'],
      ['Helvetica 22', fonts.helvetica, 22, 'Sync Test Fresh - Page 1'],
      ['Helvetica 22', fonts.helvetica, 22, 'The quick brown fox jumps over lazy glyphs.'],
      ['Helvetica 22', fonts.helvetica, 22, 'Single letters: S T A V W Y g j p q s t f i l']
    ]
  },
  {
    title: 'Text Search Glyph Lab - Styles and Fonts',
    rows: [
      ['Helvetica Bold 28', fonts.helveticaBold, 28, 'BOLD SYNC TEST S T W M 12345'],
      ['Helvetica Italic 28', fonts.helveticaItalic, 28, 'Italic sync test S T W M 12345'],
      ['Times 28', fonts.times, 28, 'Times Sync Test Fresh S T W M 12345'],
      ['Times Bold 28', fonts.timesBold, 28, 'Times Bold Sync Test S T W M'],
      ['Times Italic 28', fonts.timesItalic, 28, 'Times Italic sync test S T W M'],
      ['Courier 24', fonts.courier, 24, 'Courier Sync Test Fresh S T W M 12345'],
      ['Courier Bold 24', fonts.courierBold, 24, 'Courier Bold Sync Test S T W M'],
      ['Courier Italic 24', fonts.courierItalic, 24, 'Courier Italic sync test S T W M']
    ]
  },
  {
    title: 'Text Search Glyph Lab - Marks, Sizes, Phrases',
    rows: [
      ['Helvetica 36', fonts.helvetica, 36, 'Large Sync Test S T g j p q y'],
      ['Helvetica 16', fonts.helvetica, 16, 'Small Sync Test Fresh - phrase search target'],
      ['Times 32', fonts.times, 32, 'Café naïve façade résumé coöperate'],
      ['Helvetica 24', fonts.helvetica, 24, 'Accents: À Á Â Ã Ä Å Ç É È Ê Ë Í Ñ Ó Ö Ú Ü Ý'],
      ['Helvetica 24', fonts.helvetica, 24, 'Symbols: ! ? @ # $ % & * ( ) [ ] { } / + = - _'],
      ['Times Italic 24', fonts.timesItalic, 24, 'Mixed Phrase: Sync Test Fresh with italic accents café'],
      ['Courier 18', fonts.courier, 18, 'Monospace phrase: search every letter and number 9876543210']
    ]
  }
];

for (const section of pages) {
  const page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  page.drawText(section.title, {
    x: margin,
    y,
    size: 18,
    font: fonts.helveticaBold,
    color: rgb(0.05, 0.18, 0.42)
  });
  y -= 40;

  for (const [label, font, size, text] of section.rows) {
    page.drawText(label, {
      x: margin,
      y,
      size: 8,
      font: fonts.helvetica,
      color: rgb(0.35, 0.35, 0.35)
    });
    y -= 8;
    page.drawText(text, {
      x: margin,
      y,
      size,
      font,
      color: textColor
    });
    y -= Math.max(size + 20, 38);
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, await pdf.save());
console.log(outputPath);
