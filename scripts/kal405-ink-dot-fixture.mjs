/**
 * KAL-405 fixture generator — a PDF containing imported "single-tap" ink dots
 * alongside control strokes, so the dot-detection fix can be checked by eye.
 *
 * Run:  node scripts/kal405-ink-dot-fixture.mjs
 * Writes: debug/fixtures/kal405-ink-dots.pdf
 *
 * What is in it (page is 400 x 320, one page):
 *   - a single-point /InkList tap, 4pt red pen        (the bug: used to vanish)
 *   - a single-point /InkList tap, 12pt blue pen      (size must follow the pen)
 *   - a multi-point tap whose samples collapse into
 *     a sub-pixel box, 8pt green pen                  (also a tap)
 *   - a genuinely SHORT but real stroke, 4pt red pen  (control: must stay a line)
 *   - a normal curved stroke, 4pt red pen             (control: unchanged)
 *   - three taps inside ONE annotation, 6pt magenta   (all-degenerate multi-dot)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFString } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'debug', 'fixtures', 'kal405-ink-dots.pdf');

const pdf = await PDFDocument.create();
const page = pdf.addPage([400, 320]);

const annotation = (value) => pdf.context.register(pdf.context.obj({
  Type: 'Annot',
  P: page.ref,
  F: 4,
  ...value,
}));

const annotations = [
  // The reported bug: one point, nothing else.
  annotation({
    Subtype: 'Ink',
    Rect: [60, 240, 68, 248],
    InkList: [[64, 244]],
    C: [1, 0, 0],
    BS: { W: 4 },
    NM: PDFString.of('kal405-tap-red-4pt'),
  }),
  // Same shape of bug with a fat pen — the dot must be visibly bigger.
  annotation({
    Subtype: 'Ink',
    Rect: [140, 236, 160, 256],
    InkList: [[150, 246]],
    C: [0, 0, 1],
    BS: { W: 12 },
    NM: PDFString.of('kal405-tap-blue-12pt'),
  }),
  // Several samples, but the pen never moved far enough to see.
  annotation({
    Subtype: 'Ink',
    Rect: [230, 238, 246, 254],
    InkList: [[238, 246, 238.2, 246.1, 238.1, 246.05, 238, 246]],
    C: [0, 0.6, 0],
    BS: { W: 8 },
    NM: PDFString.of('kal405-tap-green-8pt-collapsed'),
  }),
  // CONTROL: short, but a real stroke. Must still render as a line.
  annotation({
    Subtype: 'Ink',
    Rect: [55, 160, 90, 185],
    InkList: [[60, 165, 72, 178]],
    C: [1, 0, 0],
    BS: { W: 4 },
    NM: PDFString.of('kal405-control-short-stroke'),
  }),
  // CONTROL: ordinary stroke.
  annotation({
    Subtype: 'Ink',
    Rect: [130, 150, 300, 200],
    InkList: [[140, 160, 170, 190, 210, 160, 250, 190, 290, 160]],
    C: [1, 0, 0],
    BS: { W: 4 },
    NM: PDFString.of('kal405-control-normal-stroke'),
  }),
  // Three taps authored as one Ink annotation.
  annotation({
    Subtype: 'Ink',
    Rect: [55, 70, 165, 100],
    InkList: [[64, 84], [110, 84], [156, 84]],
    C: [1, 0, 1],
    BS: { W: 6 },
    NM: PDFString.of('kal405-tap-magenta-6pt-triple'),
  }),
];

page.node.set(pdf.context.obj('Annots'), pdf.context.obj(annotations));

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, await pdf.save());
console.log(`wrote ${outPath}`);
