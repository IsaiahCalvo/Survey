// KAL-20 — generate a synthetic supported-only PDF as the negative-case
// counterpart to kal-20-generate-mixed-fixture.mjs.
//
// Writes a single-page PDF with one supported Square annotation and nothing
// else, so the importer's `unsupportedTypes` array stays empty and the
// bottom-right notice should NOT appear.

import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

const DEFAULT_OUT = path.resolve(
  'debug/fixtures/pdf-native-edge-cases/kal-20-supported-only.pdf'
);

async function main() {
  const outPath = path.resolve(process.argv[2] || DEFAULT_OUT);

  const pdf = await PDFDocument.create();
  pdf.setTitle('KAL-20 supported-only annotation fixture (negative case)');
  pdf.setCreator('kal-20-generate-supported-only-fixture.mjs');
  pdf.setProducer('survey-betasafe-s2 fixture builder');

  const page = pdf.addPage([612, 792]);
  const { context } = pdf;

  const squareDict = context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [50, 50, 250, 180],
    C: [0, 0.6, 0],
    CA: 1,
    F: 4,
    Border: [0, 0, 2],
    T: PDFString.of('kal-20 synthetic'),
    Contents: PDFString.of('Supported Square annotation (negative case)'),
    NM: PDFString.of('kal-20-square-neg-1'),
  });

  const annotsRef = context.register(context.obj([squareDict]));
  page.node.set(PDFName.of('Annots'), annotsRef);

  const bytes = await pdf.save();
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, bytes);
  console.log(`[KAL-20] wrote supported-only fixture (${bytes.byteLength} bytes): ${outPath}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
