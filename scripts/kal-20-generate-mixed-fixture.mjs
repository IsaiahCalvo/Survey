// KAL-20 — generate a synthetic mixed-annotation PDF.
//
// Writes a single-page PDF with:
//   • one supported Square annotation
//   • one unsupported FileAttachment annotation
//
// The unsupported subtype is detected by the production importer via
// `categorizeAnnotations` (src/utils/pdfAnnotationImporter.js), which keys off
// `annotation.subtype === 'FileAttachment'`. The PDF.js viewer exposes the
// subtype regardless of whether the FileAttachment has an /FS file-spec dict,
// so we can keep the fixture minimal.
//
// Usage:
//   node scripts/kal-20-generate-mixed-fixture.mjs [outPath]

import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

const DEFAULT_OUT = path.resolve(
  'debug/fixtures/pdf-native-edge-cases/kal-20-mixed-fileattachment.pdf'
);

async function main() {
  const outPath = path.resolve(process.argv[2] || DEFAULT_OUT);

  const pdf = await PDFDocument.create();
  pdf.setTitle('KAL-20 mixed supported + unsupported annotation fixture');
  pdf.setCreator('kal-20-generate-mixed-fixture.mjs');
  pdf.setProducer('survey-betasafe-s2 fixture builder');

  const page = pdf.addPage([612, 792]);
  const { context } = pdf;

  // Supported Square (red outline, lower-left). Visible on import.
  const squareDict = context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [50, 50, 250, 180],
    C: [1, 0, 0],
    CA: 1,
    F: 4,
    Border: [0, 0, 2],
    T: PDFString.of('kal-20 synthetic'),
    Contents: PDFString.of('Supported Square annotation'),
    NM: PDFString.of('kal-20-square-1'),
  });

  // Unsupported FileAttachment. Importer keys off /Subtype.
  const faDict = context.obj({
    Type: 'Annot',
    Subtype: 'FileAttachment',
    Rect: [300, 300, 320, 320],
    C: [0, 0, 1],
    F: 4,
    Name: 'Paperclip',
    T: PDFString.of('kal-20 synthetic'),
    Contents: PDFString.of('Unsupported FileAttachment annotation'),
    NM: PDFString.of('kal-20-fileattachment-1'),
  });

  const annotsRef = context.register(context.obj([squareDict, faDict]));
  page.node.set(PDFName.of('Annots'), annotsRef);

  const bytes = await pdf.save();
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, bytes);
  console.log(`[KAL-20] wrote synthetic fixture (${bytes.byteLength} bytes): ${outPath}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
