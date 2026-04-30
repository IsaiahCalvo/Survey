const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');

(async () => {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const titles = [
    'Sync Test — Page 1',
    'Sync Test — Page 2',
    'Sync Test — Page 3'
  ];
  const subtitles = [
    'Try a pen stroke here, then check if it shows on the other device.',
    'Drop a counter pin or a rectangle and watch it sync.',
    'Add a callout or some free text and confirm it lands.'
  ];

  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 700, width: 612, height: 92, color: rgb(0.13, 0.32, 0.62) });
    page.drawText(titles[i], { x: 36, y: 736, size: 28, font: helvBold, color: rgb(1, 1, 1) });
    page.drawText(subtitles[i], { x: 36, y: 660, size: 14, font: helv, color: rgb(0.2, 0.2, 0.2) });
    page.drawRectangle({ x: 36, y: 100, width: 540, height: 540, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
    page.drawText('Draw inside the box', { x: 36, y: 644, size: 11, font: helv, color: rgb(0.45, 0.45, 0.45) });
    for (let row = 0; row < 12; row++) {
      page.drawLine({
        start: { x: 36, y: 130 + row * 42 },
        end: { x: 576, y: 130 + row * 42 },
        thickness: 0.4,
        color: rgb(0.85, 0.85, 0.85)
      });
    }
    page.drawText(`Page ${i + 1} of 3`, { x: 36, y: 60, size: 9, font: helv, color: rgb(0.55, 0.55, 0.55) });
  }

  const bytes = await doc.save();
  const out = '/Users/isaiahcalvo/Desktop/sync-test.pdf';
  fs.writeFileSync(out, bytes);
  console.log('wrote', out, bytes.length, 'bytes');
})();
