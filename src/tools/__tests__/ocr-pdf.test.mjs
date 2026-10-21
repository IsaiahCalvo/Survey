import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, StandardFonts, degrees, concatTransformationMatrix } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ToolError } from '../errors.js';
import {
  addTextLayer, hasRealText, ocrPdf, ocrScale, pageFrame, placeWord, safeText, squeezeFor, tesseractLines, textMatrix,
} from '../ocr.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} is not near ${b}`);

// One OCR line in image pixels: words laid left to right, baseline 8px above
// the box bottom.
function line(words, { y0 = 200, y1 = 240, baseline } = {}) {
  const ws = words.map(([text, x0, x1]) => ({ text, box: { x0, y0, x1, y1 } }));
  return {
    words: ws,
    box: { x0: ws[0].box.x0, y0, x1: ws.at(-1).box.x1, y1 },
    baseline: baseline || { x0: ws[0].box.x0, y0: y1 - 8, x1: ws.at(-1).box.x1, y1: y1 - 8 },
  };
}

async function textItems(bytes, scale) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true, verbosity: 0 });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale });
  const { items } = await page.getTextContent();
  await task.destroy();
  return { vp, items: items.filter((it) => it.str.trim()) };
}

test('ocrScale: about 300 DPI, capped for huge pages', () => {
  assert.equal(ocrScale(612, 792), 300 / 72);
  const s = ocrScale(2592, 3456); // 36 x 48 inch drawing
  near(2592 * 3456 * s * s, 10_000_000, 1, 'pixels');
  assert.ok(s < 300 / 72);
});

test('hasRealText: a few stray characters are not text', () => {
  assert.equal(hasRealText({ items: [{ str: ' 1 ' }, { str: 'a' }] }), false);
  assert.equal(hasRealText({ items: [{ str: 'Hello ' }, { str: 'world, again' }] }), true);
  assert.equal(hasRealText(null), false);
});

test('safeText: keeps Latin-1, simplifies what it can, replaces the rest', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const set = new Set(font.getCharacterSet());
  const has = (cp) => set.has(cp);
  assert.equal(safeText('café “quoted” – 5€', has), 'café “quoted” – 5€');
  assert.equal(safeText('ﬁle', has), 'file');
  assert.equal(safeText('ŝ', has), 's');
  assert.equal(safeText('Ωmega 你', has), '?mega ?');
  // Whatever comes out must encode without throwing.
  font.encodeText(safeText('ﬁ Ω ŝ 你 ✓', has));
});

test('tesseractLines: flattens blocks and drops empty words', () => {
  const bbox = (x0, x1) => ({ x0, y0: 10, x1, y1: 30 });
  const data = {
    blocks: [{
      paragraphs: [{
        lines: [
          { bbox: bbox(0, 100), baseline: { x0: 0, y0: 26, x1: 100, y1: 26 }, rowAttributes: { rowHeight: 14, descenders: -4 }, words: [{ text: 'Hi', bbox: bbox(0, 20) }, { text: '  ', bbox: bbox(30, 40) }, { text: 'there ', bbox: bbox(50, 100) }] },
          { bbox: bbox(0, 10), words: [{ text: ' ', bbox: bbox(0, 10) }] },
        ],
      }],
    }],
  };
  const lines = tesseractLines(data);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].words.map((w) => w.text), ['Hi', 'there']);
  assert.equal(lines[0].rowHeight, 14);
  assert.equal(lines[0].descenders, -4);
});

test('placeWord: image pixels to page points on an upright page', () => {
  const frame = { width: 600, height: 800, rotation: 0, toPage: (x, y) => ({ x, y }) };
  const ln = line([['Hello', 100, 300]]);
  const p = placeWord(ln.words[0], ln, { width: 1200, height: 1600 }, frame);
  near(p.x, 50, 1e-9, 'x');
  near(p.y, 800 - 232 / 2, 1e-9, 'baseline y');
  near(p.width, 100, 1e-9, 'width');
  near(p.angle, 0, 1e-9, 'angle');
  near(p.size, 20 / 0.925, 1e-6, 'size from line height');
  // Row metrics from Tesseract win over the box when they look sane.
  const withRows = { ...ln, rowHeight: 30, descenders: -7 };
  near(placeWord(ln.words[0], withRows, { width: 1200, height: 1600 }, frame).size, 37 / 2 / 0.925, 1e-6, 'size from rows');
});

test('placeWord: a line that rises to the right gets a matching angle; wild slopes lie flat', () => {
  const frame = { width: 100, height: 100, rotation: 0, toPage: (x, y) => ({ x, y }) };
  const image = { width: 100, height: 100 };
  const ln = line([['up', 10, 90]], { baseline: { x0: 10, y0: 60, x1: 90, y1: 52 } });
  const p = placeWord(ln.words[0], ln, image, frame);
  near(p.angle, (Math.atan(8 / 80) * 180) / Math.PI, 1e-9, 'angle');
  near(p.y, 40, 1e-9, 'baseline at word start');
  near(p.width, Math.hypot(80, 8), 1e-9, 'width along the slope');
  const wild = line([['x', 10, 90]], { baseline: { x0: 10, y0: 90, x1: 90, y1: 10 } });
  assert.equal(placeWord(wild.words[0], wild, image, frame).angle, 0);
});

test('squeezeFor: stretches text to fill the box', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const natural = font.widthOfTextAtSize('Hello', 10);
  near(squeezeFor(font, 'Hello', 10, natural * 2), 200, 1e-9, 'double');
  assert.equal(squeezeFor(font, '', 10, 50), 100);
});

// The full trip: draw the text layer, then ask pdf.js where it finds each word
// on the page as rendered, for every rotation and with a crop box. That is
// exactly what search highlights and text selection use.
for (const [rot, crop] of [[0, [50, 100, 450, 500]], [90, [50, 100, 450, 500]], [180, [50, 100, 450, 500]], [270, [50, 100, 450, 500]], [90, [-40, 300, 900, 900]]]) {
  test(`text layer lands on the scanned words (rotated ${rot}, crop box ${crop})`, async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(...crop);
    page.setRotation(degrees(rot));
    // A scan that leaves its transform changed (no q/Q) must not move our text.
    page.pushOperators(concatTransformationMatrix(1, 0, 0, 1, 37, 41));
    const frame = pageFrame(page);
    const scale = 2;
    const image = { width: frame.width * scale, height: frame.height * scale };
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ln = line([['Hello', 100, 300], ['World', 340, 560]]);
    assert.equal(addTextLayer(page, [ln], image, font), 2);
    const bytes = await doc.save();

    const { vp, items } = await textItems(bytes, scale);
    assert.match(items.map((it) => it.str).join(' ').replace(/\s+/g, ' '), /Hello World/);
    for (const w of ln.words) {
      const item = items.find((it) => it.str.trim() === w.text);
      assert.ok(item, `found ${w.text}`);
      const [a, b, , , e, f] = item.transform;
      const len = Math.hypot(a, b);
      const start = vp.convertToViewportPoint(e, f);
      // Width of the word alone (the item also holds the trailing space).
      const wordWidth = item.str.endsWith(' ') ? item.width * (font.widthOfTextAtSize(w.text, 1) / font.widthOfTextAtSize(`${w.text} `, 1)) : item.width;
      const end = vp.convertToViewportPoint(e + (a / len) * wordWidth, f + (b / len) * wordWidth);
      near(start[0], w.box.x0, 0.5, `${w.text} start x`);
      near(start[1], 232, 0.5, `${w.text} baseline`);
      // pdf.js measures Helvetica with its own built-in widths, a hair off
      // from pdf-lib's for some letters, so allow 1%.
      near(end[0], w.box.x1, (w.box.x1 - w.box.x0) * 0.01, `${w.text} end x`);
      near(end[1], 232, 0.5, `${w.text} end baseline`);
    }
  });
}

test('text layer is invisible and its words are in the content', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  addTextLayer(page, [line([['Invoice', 10, 200]])], { width: 300, height: 300 }, font);
  const contents = page.node.Contents();
  const streams = contents.asArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const text = streams.map((s) => Buffer.from(s.getUnencodedContents()).toString('latin1')).join('\n');
  assert.match(text, /3 Tr/);
  assert.match(text, /<496E766F696365>/i); // "Invoice" as hex
  assert.ok(page.node.Resources().lookup(PDFName.of('Font')));
});

test('ocrPdf: reads pages, skips ones with text, and counts', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  const bytes = await doc.save();
  const seen = [];
  const result = await ocrPdf(bytes, async (i) => (i === 1 ? null : { image: { width: 600, height: 600 }, lines: [line([[`Page${i + 1}`, 20, 300]])] }), (i, n) => seen.push(`${i + 1}/${n}`));
  assert.deepEqual(seen, ['1/3', '2/3', '3/3']);
  assert.deepEqual({ pages: result.pages, read: result.read, skipped: result.skipped, words: result.words }, { pages: 3, read: 2, skipped: 1, words: 2 });
  const task = pdfjsLib.getDocument({ data: result.bytes, disableWorker: true, verbosity: 0 });
  const pdf = await task.promise;
  const texts = [];
  for (let n = 1; n <= 3; n += 1) texts.push((await (await pdf.getPage(n)).getTextContent()).items.map((it) => it.str).join(''));
  await task.destroy();
  assert.deepEqual(texts, ['Page1', '', 'Page3']);
});

test('ocrPdf: plain messages when there is nothing to do or nothing found', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const bytes = await doc.save();
  await assert.rejects(ocrPdf(bytes, async () => null), (e) => e instanceof ToolError && /already has text/.test(e.message));
  await assert.rejects(ocrPdf(bytes, async () => ({ image: { width: 10, height: 10 }, lines: [] })), (e) => e instanceof ToolError && /No words were found/.test(e.message));
  await assert.rejects(ocrPdf(new Uint8Array([1, 2, 3]), async () => null), (e) => e instanceof ToolError);
});
