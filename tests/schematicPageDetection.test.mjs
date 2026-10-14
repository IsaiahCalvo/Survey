// KAL-402 (F12 Schematic Mode): which pages are drawings.
// Pure rules first, then the real pdf.js reading of debug/fixtures PDFs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  classifySchematicPage, detectSchematicPage, measureOperatorList, measureTextContent,
} from '../src/utils/schematicPageDetection.js';

const OPS = pdfjsLib.OPS;

test('body text is never a schematic, even with many drawn lines', () => {
  const text = { chars: 3000, coverage: 0.3, charsPer10kPt: 70 };
  assert.equal(classifySchematicPage({ text, drawing: { paths: 5000, images: 0, imageCoverage: 0 } }).schematic, false);
});

test('a full-page picture with no text is a raster schematic', () => {
  const r = classifySchematicPage({ text: { chars: 0, coverage: 0, charsPer10kPt: 0 }, drawing: { paths: 0, images: 1, imageCoverage: 1 } });
  assert.deepEqual([r.schematic, r.kind], [true, 'raster']);
});

test('many paths with only scattered labels is a vector schematic', () => {
  const r = classifySchematicPage({ text: { chars: 2500, coverage: 0.05, charsPer10kPt: 25 }, drawing: { paths: 4000, images: 0, imageCoverage: 0 } });
  assert.deepEqual([r.schematic, r.kind], [true, 'vector']);
});

test('a picture with lines over it is mixed', () => {
  const r = classifySchematicPage({ text: { chars: 0, coverage: 0, charsPer10kPt: 0 }, drawing: { paths: 400, images: 1, imageCoverage: 0.9 } });
  assert.deepEqual([r.schematic, r.kind], [true, 'mixed']);
});

test('a blank or sparse page is not a schematic', () => {
  const blank = classifySchematicPage({ text: { chars: 0, coverage: 0, charsPer10kPt: 0 }, drawing: { paths: 1, images: 0, imageCoverage: 0 } });
  assert.equal(blank.schematic, false);
  const logo = classifySchematicPage({ text: { chars: 20, coverage: 0.01, charsPer10kPt: 1 }, drawing: { paths: 10, images: 1, imageCoverage: 0.05 } });
  assert.equal(logo.schematic, false);
});

test('text measurement ignores whitespace and measures box coverage', () => {
  const m = measureTextContent({ items: [{ str: 'A B', width: 50, height: 10, transform: [10, 0, 0, 10, 0, 0] }, { str: '   ' }] }, 1000);
  assert.equal(m.chars, 2);
  assert.equal(m.coverage, 0.5);
});

test('picture coverage follows save / transform / restore and form matrices', () => {
  const fnArray = [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
    OPS.paintFormXObjectBegin, OPS.transform, OPS.paintImageXObject, OPS.paintFormXObjectEnd,
    OPS.constructPath, OPS.constructPath];
  const argsArray = [null, [100, 0, 0, 50, 10, 10], ['img1', 1, 1], null,
    [[2, 0, 0, 2, 0, 0], [0, 0, 10, 10]], [10, 0, 0, 10, 0, 0], ['img2', 1, 1], null,
    [], []];
  const m = measureOperatorList({ fnArray, argsArray }, OPS, 10000);
  assert.equal(m.images, 2);
  assert.equal(m.paths, 2);
  // 100*50 + (2*10)*(2*10) = 5000 + 400 = 5400 of 10000.
  assert.equal(m.imageCoverage, 0.54);
});

const loadFixture = async (name) => pdfjsLib.getDocument({
  data: new Uint8Array(readFileSync(new URL(`../debug/fixtures/${name}`, import.meta.url))),
  verbosity: 0,
}).promise;

const detectAll = async (name) => {
  const doc = await loadFixture(name);
  const out = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    out.push(await detectSchematicPage(await doc.getPage(i), { ops: OPS }));
  }
  await doc.loadingTask?.destroy?.();
  return out;
};

test('kal402 fixture: text, raster, vector, mixed, blank pages read as expected', async () => {
  const results = await detectAll('kal402-schematic-pages.pdf');
  assert.deepEqual(results.map((r) => r.schematic), [false, true, true, true, false]);
  assert.deepEqual(results.map((r) => r.kind), [null, 'raster', 'vector', 'mixed', null]);
  // The body-text page never pays for an operator list.
  assert.equal(results[0].drawing, null);
});

test('existing fixtures: a scan is a schematic; text and form pages are not', async () => {
  assert.deepEqual((await detectAll('ocr-scan-clear.pdf')).map((r) => r.kind), ['raster']);
  assert.ok((await detectAll('text-search-glyph-lab.pdf')).every((r) => !r.schematic));
  assert.ok((await detectAll('kal441-form-fields.pdf')).every((r) => !r.schematic));
  assert.ok((await detectAll('landscape-sheets.pdf')).every((r) => !r.schematic));
});
