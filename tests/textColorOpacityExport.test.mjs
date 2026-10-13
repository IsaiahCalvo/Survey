/*
 * Regression (2026-09-23, w13): exported and printed PDFs must draw text at
 * the opacity the user picked. Text colour opacity is stored inside the text
 * colour itself (utils/textColorOpacity: `rgba(r, g, b, a)`; a text box keeps
 * it in `fill`, a callout in `style.fontColor`), so every writer has to carry
 * the alpha into the drawing, not just the r/g/b. Legacy `#rrggbb` text must
 * stay exactly full strength.
 *
 * Checked on 2026-09-23 against three independent renderers (Apple PDFKit,
 * pdf.js, Poppler): a 40% red text box and a 30% blue callout render at 40% /
 * 30% from both the export writer and the print flattener. These tests pin
 * that at the file level: the text run is drawn under an ExtGState whose
 * fill alpha (/ca) is the text's opacity, and in the text's own colour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const PAGE_SIZES = { 1: { width: 300, height: 300 } };

const textbox = (id, fill, text) => ({
  id, type: 'textbox', left: 10, top: 10, width: 140, height: 30, text, fill, fontSize: 18,
});

const callout = (id, fontColor, text) => ({
  id,
  pageNumber: 1,
  arrowTip: { x: 0.05, y: 0.5 },
  knee: { x: 0.1, y: 0.45 },
  textBoxPosition: { x: 0.3, y: 0.6 },
  textBoxWidth: 0.45,
  textBoxHeight: 0.12,
  text,
  style: { fontColor, fontSize: 18 },
});

const collectStreams = (doc) => {
  const streams = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let content;
    try {
      content = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
    } catch {
      continue;
    }
    streams.push({ stream: object, content });
  }
  return streams;
};

/** Every graphics-state dictionary in the file, by resource name. */
const collectExtGStates = (doc) => {
  const byName = new Map();
  const visit = (resources) => {
    const gsDict = resources?.lookup?.(PDFName.of('ExtGState'));
    if (!(gsDict instanceof PDFDict)) return;
    for (const [name, value] of gsDict.entries()) {
      const dict = doc.context.lookup(value);
      if (dict instanceof PDFDict) byName.set(name.decodeText(), dict);
    }
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) visit(object.dict.lookup(PDFName.of('Resources')));
    if (object instanceof PDFDict) visit(object.lookup(PDFName.of('Resources')));
  }
  return byName;
};

const hexOfText = (value) => Buffer.from(value, 'latin1').toString('hex').toUpperCase();

/**
 * The fill alpha and fill colour the text run `text` is drawn with: finds the
 * `q /GS gs BT <r g b> rg ... <hex> Tj` block that shows it.
 */
async function textPaint(bytes, text) {
  const doc = await PDFDocument.load(bytes);
  const gs = collectExtGStates(doc);
  const needle = `<${hexOfText(text)}> Tj`;
  for (const { content } of collectStreams(doc)) {
    const at = content.indexOf(needle);
    if (at < 0) continue;
    const before = content.slice(0, at);
    const block = before.slice(before.lastIndexOf('q\n'));
    const gsName = block.match(/\/(\S+) gs/)?.[1] || null;
    const rg = block.match(/([\d.]+) ([\d.]+) ([\d.]+) rg/);
    const ca = gsName ? gs.get(gsName)?.get(PDFName.of('ca'))?.asNumber?.() : undefined;
    return {
      alpha: ca === undefined ? 1 : ca,
      rgb: rg ? rg.slice(1, 4).map(Number) : null,
    };
  }
  return null;
}

const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
};

for (const [label, save] of [
  ['export', (objects, callouts) => makePdfFile().then((file) => (
    savePDFWithAnnotationsPdfLib(file, objects, PAGE_SIZES, null, { returnBytes: true, callouts })
  ))],
  ['print', (objects, callouts) => makePdfFile().then((file) => (
    savePDFWithFlattenedRegularAnnotationsForPrint(file, objects, PAGE_SIZES, { returnBytes: true, callouts })
  ))],
]) {
  test(`${label}: a see-through text box draws its text at the picked opacity`, async () => {
    const bytes = await save({ 1: { objects: [textbox('tb-40', 'rgba(255, 0, 0, 0.4)', 'Forty')] } }, []);
    const paint = await textPaint(bytes, 'Forty');
    assert.ok(paint, 'the text run must be drawn');
    near(paint.alpha, 0.4, 'text fill alpha');
    assert.deepEqual(paint.rgb, [1, 0, 0]);
  });

  test(`${label}: a see-through callout draws its text at the picked opacity`, async () => {
    const bytes = await save({}, [callout('co-30', 'rgba(0, 0, 255, 0.3)', 'Thirty')]);
    const paint = await textPaint(bytes, 'Thirty');
    assert.ok(paint, 'the callout text run must be drawn');
    near(paint.alpha, 0.3, 'callout text fill alpha');
    assert.deepEqual(paint.rgb, [0, 0, 1]);
  });

  test(`${label}: legacy hex text stays full strength`, async () => {
    const bytes = await save(
      { 1: { objects: [textbox('tb-hex', '#ff0000', 'Solid')] } },
      [callout('co-hex', '#0000ff', 'Opaque')],
    );
    const boxPaint = await textPaint(bytes, 'Solid');
    const calloutPaint = await textPaint(bytes, 'Opaque');
    near(boxPaint.alpha, 1, 'hex text box alpha');
    assert.deepEqual(boxPaint.rgb, [1, 0, 0]);
    near(calloutPaint.alpha, 1, 'hex callout alpha');
    assert.deepEqual(calloutPaint.rgb, [0, 0, 1]);
  });
}

test('a text box\'s own opacity multiplies with its text colour opacity', async () => {
  const file = await makePdfFile();
  const bytes = await savePDFWithAnnotationsPdfLib(file, {
    1: { objects: [{ ...textbox('tb-both', 'rgba(255, 0, 0, 0.5)', 'Both'), opacity: 0.5 }] },
  }, PAGE_SIZES, null, { returnBytes: true });
  const paint = await textPaint(bytes, 'Both');
  near(paint.alpha, 0.25, 'object opacity x text colour opacity');
});
