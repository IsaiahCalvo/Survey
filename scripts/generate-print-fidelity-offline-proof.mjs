import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(root, 'debug', 'fixtures');
const outputDir = join(root, 'debug', 'artifacts', 'print-fidelity', 'offline-pairs');
const manifest = JSON.parse(await readFile(join(fixtureDir, 'print-fidelity.manifest.json'), 'utf8'));
const source = new Uint8Array(await readFile(join(fixtureDir, manifest.pdfFile)));
const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const fixed = await savePDFWithFlattenedRegularAnnotationsForPrint(
  { name: manifest.pdfFile, async arrayBuffer() { return toArrayBuffer(source); } },
  manifest.annotationsByPage,
  Object.fromEntries(manifest.pages.map((page) => [page.page, page.rotation === 90 || page.rotation === 270 ? { width: 792, height: 612 } : page.cropBox ? { width: 540, height: 648 } : { width: 612, height: 792 }])),
  {
    actionType: 'offline-print-fidelity-proof',
    callouts: manifest.callouts,
    surveyMarkers: manifest.surveyMarkers,
  },
);
const fixedPdf = join(outputDir, 'after-fixed.pdf');
await writeFile(fixedPdf, fixed);
await execFileAsync('pdftoppm', ['-f', '1', '-l', '8', '-png', '-r', '144', join(fixtureDir, manifest.pdfFile), join(outputDir, 'before')]);
await execFileAsync('pdftoppm', ['-f', '1', '-l', '8', '-png', '-r', '144', fixedPdf, join(outputDir, 'after')]);

const ids = [
  'imported-native-square', 'imported-native-polygon', 'imported-green-strike',
  'form-checkbox', 'form-text', 'imported-native-ink', 'imported-native-circle',
  'imported-native-free-text', 'imported-native-highlight', 'imported-native-cloud',
  'imported-native-arrow',
  'native-stamp',
];
const pairs = [];
for (const id of ids) {
  const entry = manifest.regions.find((region) => region.id === id);
  const beforePage = join(outputDir, `before-${entry.page}.png`);
  const afterPage = join(outputDir, `after-${entry.page}.png`);
  const [x1, y1, x2, y2] = entry.bounds;
  const box = { left: Math.floor(x1 * 2), top: Math.floor(y1 * 2), width: Math.ceil((x2 - x1) * 2), height: Math.ceil((y2 - y1) * 2) };
  const before = join(outputDir, `${id}-before.png`);
  const after = join(outputDir, `${id}-after.png`);
  await sharp(beforePage).extract(box).png().toFile(before);
  await sharp(afterPage).extract(box).png().toFile(after);
  pairs.push({ id, before, after });
}
await writeFile(join(outputDir, 'report.json'), `${JSON.stringify({ fixedPdf, pairs }, null, 2)}\n`);
console.log(`Wrote ${join(outputDir, 'report.json')}`);
