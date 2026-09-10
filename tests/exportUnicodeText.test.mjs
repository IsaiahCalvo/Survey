// Text the standard PDF fonts cannot encode must still PRINT and still EXPORT
// (2026-09-10, export round 7).
//
// Two defects, both proven by an adversarial export checker on main:
//
//  1. UNENCODABLE GLYPHS. A text box holding an emoji or any CJK character was
//     dropped from the flattened print entirely — pdf-lib throws
//     `WinAnsi cannot encode "屋" (0x5c4b)` out of its text drawer and the
//     print flattener's per-annotation fence caught it and skipped the whole
//     annotation. The /Annots writer had the same problem one level down: its
//     appearance stream IS the flattener's output, so the exported /FreeText
//     went out with NO /AP and every viewer fell back to whatever its own
//     /DA-only rendering does (Quick Look: nothing at all). The fix is a font
//     fallback chain — standard-14 first, then an embedded CJK font, then an
//     embedded monochrome emoji font — with the text split into runs by which
//     font can actually draw each character.
//
//  2. /CONTENTS MOJIBAKE. pdf-lib's `PDFString.of()` writes a JS string one
//     byte per UTF-16 code unit, truncated. Ordinary typography the /AP drew
//     perfectly still landed in /Contents wrong: em dash U+2014 → 0x14, curly
//     quotes U+201C/D → 0x1C/0x1D, bullet, en dash and ellipsis likewise, and
//     CJK/emoji became noise. It also never escaped "(", ")" or "\", so a text
//     box containing an unbalanced paren could corrupt the object. Text
//     strings now go out as UTF-16BE hex with a BOM (PDF 32000-1 §7.9.2.2)
//     whenever they are not plain ASCII, and the app's own importer reads them
//     back exactly.
//
// Everything below drives the app's REAL writers and the app's REAL importer.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { buildTextFontRuns, needsUtf16PdfString, pdfTextString } from '../src/utils/pdfUnicodeText.js';

const LETTER = { width: 612, height: 792 };

// Every character the adversarial checker caught, in one string per family.
const EM_DASH = '—';
const EN_DASH = '–';
const LEFT_QUOTE = '“';
const RIGHT_QUOTE = '”';
const BULLET = '•';
const ELLIPSIS = '…';
const EMOJI = '\u{1F642}'; // 🙂
const CJK = '鉄筋の腐食'; // 鉄筋の腐食

const TEXT_CASES = [
  ['em dash', `Bay 3 ${EM_DASH} check`],
  ['en dash', `Levels 1${EN_DASH}2`],
  ['curly quotes', `${LEFT_QUOTE}spalling${RIGHT_QUOTE} noted`],
  ['bullet', `Rebar ${BULLET} corrosion`],
  ['ellipsis', `Pending${ELLIPSIS}`],
  ['emoji', `Rebar ${EMOJI} spalling`],
  ['CJK', CJK],
  ['everything at once', `L3 ${BULLET} ${CJK} ${EMOJI} ${LEFT_QUOTE}ok${RIGHT_QUOTE} ${EM_DASH} 1${EN_DASH}2${ELLIPSIS}`],
  // Not a Unicode problem — a pdf-lib escaping one. An unbalanced paren or a
  // backslash written into a literal string corrupts the object.
  ['unbalanced parens and a backslash', 'Grid (A\\B) ) note'],
];

const makePdfFile = async ({ width, height } = LETTER, decorate = null) => {
  const source = await PDFDocument.create();
  const page = source.addPage([width, height]);
  page.setMediaBox(0, 0, width, height);
  page.setCropBox(0, 0, width, height);
  if (decorate) await decorate(source, page);
  // pdf-lib regenerates field appearances on save with the standard fonts, and
  // that regeneration is exactly what cannot encode CJK. The app's own writers
  // save with this flag too.
  const bytes = await source.save({ updateFieldAppearances: false });
  return {
    name: 'unicode-text.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const textbox = (text, overrides = {}) => ({
  id: 'note-1',
  type: 'textbox',
  left: 40,
  top: 60,
  width: 480,
  height: 90,
  text,
  fontSize: 16,
  fill: '#111111',
  stroke: 'transparent',
  strokeWidth: 0,
  ...overrides,
});

const exportAnnotated = async (objects, pageSize = LETTER) => quiet(() => withWindow(async () => (
  savePDFWithAnnotationsPdfLib(
    await makePdfFile(pageSize),
    { 1: { objects } },
    { 1: pageSize },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'unicode-text' },
  )
)));

const exportFlattened = async (objects, pageSize = LETTER, options = {}) => quiet(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(pageSize, options.decorate),
    { 1: { objects } },
    { 1: pageSize },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'unicode-text' },
  )
)));

const firstAnnot = (doc) => {
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots instanceof PDFArray && annots.size() > 0, 'the export wrote no /Annots at all');
  const dict = doc.context.lookup(annots.get(0));
  assert.ok(dict instanceof PDFDict, '/Annots[0] is not a dictionary');
  return dict;
};

const appearanceStream = (doc, dict) => {
  const ap = doc.context.lookup(dict.get(PDFName.of('AP')));
  if (!(ap instanceof PDFDict)) return null;
  const normal = doc.context.lookup(ap.get(PDFName.of('N')));
  return normal instanceof PDFRawStream ? normal : null;
};

const streamText = (stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());

const pageContentText = (doc) => {
  const contents = doc.getPage(0).node.get(PDFName.of('Contents'));
  const resolved = doc.context.lookup(contents);
  const streams = resolved instanceof PDFArray
    ? resolved.asArray().map((ref) => doc.context.lookup(ref))
    : [resolved];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map(streamText)
    .join('\n');
};

// The glyph codes a content stream shows, in order: every <hex> handed to Tj.
// Comparing these between the print and the /AP proves both drew the same
// glyphs from the same fonts, without needing a rasteriser.
const shownGlyphs = (content) => (content.match(/<([0-9a-fA-F]+)>\s*Tj/g) || [])
  .map((token) => token.replace(/\s*Tj$/, '').toLowerCase());

// Font dictionaries reachable from a resources dict.
const fontSubtypes = (doc, resources) => {
  if (!(resources instanceof PDFDict)) return [];
  const fonts = doc.context.lookup(resources.get(PDFName.of('Font')));
  if (!(fonts instanceof PDFDict)) return [];
  return fonts.values()
    .map((ref) => doc.context.lookup(ref))
    .filter((font) => font instanceof PDFDict)
    .map((font) => String(font.get(PDFName.of('Subtype'))));
};

// ---------------------------------------------------------------------------
// 1. The string encoder itself
// ---------------------------------------------------------------------------

test('pdfTextString keeps plain ASCII in the cheap literal form', () => {
  const value = pdfTextString('Bay 3 check');
  assert.ok(value instanceof PDFString, 'ASCII should stay a literal string');
  assert.equal(value.decodeText(), 'Bay 3 check');
  assert.equal(needsUtf16PdfString('Bay 3 check'), false);
});

test('pdfTextString escapes nothing by hand — parens and backslashes go out as hex', () => {
  for (const value of ['Grid (A)', 'Grid )', 'path\\to\\bay']) {
    assert.equal(needsUtf16PdfString(value), true, `${value} must not be written as a literal`);
    const encoded = pdfTextString(value);
    assert.ok(encoded instanceof PDFHexString);
    assert.equal(encoded.decodeText(), value);
  }
});

for (const [label, text] of TEXT_CASES) {
  test(`pdfTextString round-trips ${label} as UTF-16BE with a BOM`, () => {
    const encoded = pdfTextString(text);
    assert.ok(encoded instanceof PDFHexString, `${label} must use the hex form`);
    assert.ok(encoded.asString().toLowerCase().startsWith('feff'), `${label} is missing the UTF-16 BOM`);
    assert.equal(encoded.decodeText(), text);
  });
}

// ---------------------------------------------------------------------------
// 1b. The run splitter
// ---------------------------------------------------------------------------

// A pair of stand-in fonts so the splitter can be tested on its own: the
// "standard" one refuses anything outside Latin-1, exactly as WinAnsi does.
const latinOnlyFont = {
  encodeText(value) {
    for (const character of value) {
      if (character.codePointAt(0) > 0xff) throw new Error('WinAnsi cannot encode');
    }
    return value;
  },
  widthOfTextAtSize: (value, size) => value.length * size * 0.5,
};
const fakeFallback = (id, covered) => ({
  id,
  kit: { hasGlyphForCodePoint: (codePoint) => covered.has(codePoint) },
  pdfFont: { widthOfTextAtSize: (value, size) => value.length * size },
});

test('an all-Latin line stays ONE run on the standard font', () => {
  const { runs, dropped } = buildTextFontRuns('Bay 3 check', latinOnlyFont, []);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].font, latinOnlyFont);
  assert.equal(runs[0].text, 'Bay 3 check');
  assert.deepEqual(dropped, []);
});

test('a mixed line splits into one run per font, in reading order', () => {
  const cjk = fakeFallback('cjk', new Set([...'鉄筋'].map((character) => character.codePointAt(0))));
  const emoji = fakeFallback('emoji', new Set([EMOJI.codePointAt(0)]));
  const { runs, dropped } = buildTextFontRuns(`Bay 鉄筋 ${EMOJI} end`, latinOnlyFont, [cjk, emoji]);
  assert.deepEqual(
    runs.map((run) => run.text),
    ['Bay ', '鉄筋', ' ', EMOJI, ' end'],
  );
  assert.deepEqual(runs.map((run) => run.font === latinOnlyFont ? 'latin' : (run.font === cjk.pdfFont ? 'cjk' : 'emoji')),
    ['latin', 'cjk', 'latin', 'emoji', 'latin']);
  assert.deepEqual(dropped, []);
});

test('a character no font in the chain covers is reported and left out, not drawn as tofu', () => {
  // Cyrillic: covered by neither shipped fallback. The text still goes into
  // /Contents verbatim — see the /Contents tests above — but nothing is drawn.
  const { runs, dropped } = buildTextFontRuns('Бетон ok', latinOnlyFont, []);
  assert.equal(runs.map((run) => run.text).join(''), ' ok');
  assert.deepEqual(dropped.map((codePoint) => String.fromCodePoint(codePoint)).join(''), 'Бетон');
});

test('a zero-width joiner or variation selector never splits a run and is never reported as lost', () => {
  const emoji = fakeFallback('emoji', new Set([0x26a0]));
  const { runs, dropped } = buildTextFontRuns('⚠️', latinOnlyFont, [emoji]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, '⚠');
  assert.deepEqual(dropped, []);
});

// ---------------------------------------------------------------------------
// 2. /Contents in the real exported file
// ---------------------------------------------------------------------------

for (const [label, text] of TEXT_CASES) {
  test(`the exported /FreeText carries ${label} verbatim in /Contents`, async () => {
    const doc = await PDFDocument.load(await exportAnnotated([textbox(text)]));
    const dict = firstAnnot(doc);
    assert.equal(String(dict.get(PDFName.of('Subtype'))), '/FreeText');
    const contents = doc.context.lookup(dict.get(PDFName.of('Contents')));
    assert.equal(contents?.decodeText?.(), text, `${label}: /Contents did not survive the export`);
  });
}

test('the app reads its own text back through the real importer', async () => {
  const text = TEXT_CASES.at(-2)[1]; // "everything at once"
  const bytes = await exportAnnotated([textbox(text)]);
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 });
  const pdfDoc = await task.promise;
  try {
    const imported = await quiet(() => importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes }));
    const objects = imported.annotationsByPage?.[1]?.objects || [];
    const restored = objects.find((obj) => typeof obj?.text === 'string' && obj.text.length > 0);
    assert.ok(restored, 'the importer brought back no text object');
    assert.equal(restored.text, text);
  } finally {
    await task.destroy();
  }
});

test('pdf.js extracts the same characters out of the flattened print', async () => {
  const text = `${CJK} ${EMOJI} ${LEFT_QUOTE}ok${RIGHT_QUOTE} ${EM_DASH}`;
  const bytes = await exportFlattened([textbox(text)]);
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 });
  try {
    const pdfDoc = await task.promise;
    const page = await pdfDoc.getPage(1);
    const content = await page.getTextContent();
    const extracted = content.items.map((item) => item.str).join('');
    for (const character of [...new Set([...text])]) {
      if (character === ' ') continue;
      assert.ok(
        extracted.includes(character),
        `pdf.js could not read "${character}" (U+${character.codePointAt(0).toString(16).toUpperCase()}) back out of the print`,
      );
    }
  } finally {
    await task.destroy();
  }
});

// ---------------------------------------------------------------------------
// 3. Glyphs: the print draws them, the /AP draws the same ones
// ---------------------------------------------------------------------------

for (const [label, text] of [['an emoji', `Rebar ${EMOJI} spalling`], ['CJK', CJK]]) {
  test(`${label} in a text box is drawn by BOTH the print and the exported /AP`, async () => {
    const objects = [textbox(text)];
    const printed = await PDFDocument.load(await exportFlattened(objects));
    const exported = await PDFDocument.load(await exportAnnotated(objects));

    const printedContent = pageContentText(printed);
    const printedGlyphs = shownGlyphs(printedContent);
    assert.ok(printedGlyphs.length > 0, `${label}: the flattened print drew no glyphs at all`);

    const appearance = appearanceStream(exported, firstAnnot(exported));
    assert.ok(appearance, `${label}: the exported /FreeText has no /AP /N stream`);
    const appearanceGlyphs = shownGlyphs(streamText(appearance));
    assert.deepEqual(
      appearanceGlyphs,
      printedGlyphs,
      `${label}: the exported appearance and the flattened print drew different glyphs`,
    );

    // A composite (Type0/CID) font is the embedded fallback; its presence is
    // what makes the non-WinAnsi glyphs drawable at all.
    const printedResources = printed.getPage(0).node.Resources();
    assert.ok(
      fontSubtypes(printed, printedResources).includes('/Type0'),
      `${label}: the print embedded no Unicode fallback font`,
    );
    const appearanceResources = exported.context.lookup(appearance.dict.get(PDFName.of('Resources')));
    assert.ok(
      fontSubtypes(exported, appearanceResources).includes('/Type0'),
      `${label}: the appearance stream embedded no Unicode fallback font`,
    );
  });
}

test('a text box mixing Latin, CJK and emoji draws all three, in order', async () => {
  const objects = [textbox(`Bay ${CJK} ${EMOJI} end`)];
  const printed = await PDFDocument.load(await exportFlattened(objects));
  const content = pageContentText(printed);
  // Three fonts on one line means three font selections and three show
  // operators, laid down left to right by the run splitter.
  assert.ok(shownGlyphs(content).length >= 3, 'expected one show operator per font run');
  const subtypes = fontSubtypes(printed, printed.getPage(0).node.Resources());
  assert.ok(subtypes.includes('/Type1'), 'the Latin run should still use a standard-14 font');
  assert.equal(
    subtypes.filter((subtype) => subtype === '/Type0').length,
    2,
    'the CJK run and the emoji run should come from two different embedded fonts',
  );
});

// ---------------------------------------------------------------------------
// 4. Nothing changes for text that never needed any of this
// ---------------------------------------------------------------------------

test('an all-ASCII text box embeds no fallback font and keeps a literal /Contents', async () => {
  const text = 'Plain ASCII note, nothing exotic';
  const exported = await PDFDocument.load(await exportAnnotated([textbox(text)]));
  const dict = firstAnnot(exported);
  const contents = doc_contents(exported, dict);
  assert.equal(contents.text, text);
  assert.equal(contents.hex, false, 'ASCII should not have been promoted to a hex string');

  const printed = await PDFDocument.load(await exportFlattened([textbox(text)]));
  const subtypes = fontSubtypes(printed, printed.getPage(0).node.Resources());
  assert.ok(!subtypes.includes('/Type0'), 'an ASCII-only sheet must not carry an embedded fallback font');
});

function doc_contents(doc, dict) {
  const value = doc.context.lookup(dict.get(PDFName.of('Contents')));
  return { text: value?.decodeText?.(), hex: value instanceof PDFHexString };
}

// ---------------------------------------------------------------------------
// 5. The other place unencodable text used to kill the print outright
// ---------------------------------------------------------------------------

test('a form field holding CJK does not take the whole print down with it', async () => {
  // flattenFormWidgetsForPrint runs OUTSIDE the per-annotation fence, so an
  // unencodable field value aborted the ENTIRE print rather than one shape.
  // Driven the way the app drives it: a real widget in the source PDF plus the
  // stored form-field object the app writes when the user types into it.
  const decorate = async (source, page) => {
    const form = source.getForm();
    const field = form.createTextField('inspection.note');
    field.addToPage(page, { x: 60, y: 400, width: 320, height: 40 });
  };
  const file = await makePdfFile(LETTER, decorate);
  const sourceBytes = new Uint8Array(await file.arrayBuffer());

  // The stored object keys off the widget's pdf.js id, exactly like
  // buildFormFieldObject does in the running app.
  const task = pdfjsLib.getDocument({ data: sourceBytes.slice(), disableWorker: true, verbosity: 0 });
  const pdfDoc = await task.promise;
  let widget;
  try {
    const annotations = await (await pdfDoc.getPage(1)).getAnnotations({ intent: 'display' });
    widget = annotations.find((annotation) => annotation.subtype === 'Widget');
  } finally {
    await task.destroy();
  }
  assert.ok(widget, 'the fixture has no widget to fill');

  const typed = `${CJK} ${EMOJI}`;
  const formFieldObject = {
    type: 'form-field',
    pageNumber: 1,
    left: 60, top: 352, width: 320, height: 40,
    data: {
      id: `form-field:1:${widget.id}`,
      type: 'form-field',
      fieldId: widget.id,
      fieldName: widget.fieldName,
      fieldType: widget.fieldType,
      value: typed,
      pageNumber: 1,
      rect: widget.rect,
    },
  };
  const annotationsByPage = { 1: { objects: [textbox('A normal note'), formFieldObject] } };

  const bytes = await quiet(() => withWindow(() => savePDFWithFlattenedRegularAnnotationsForPrint(
    { name: 'form.pdf', async arrayBuffer() { return sourceBytes.buffer.slice(0); } },
    annotationsByPage,
    { 1: LETTER },
    {
      returnBytes: true,
      actionType: 'pdf-print',
      documentId: 'unicode-text',
      screenAnnotationsByPage: annotationsByPage,
    },
  )));
  assert.ok(bytes?.length > 0, 'the print produced no bytes');
  const printed = await PDFDocument.load(bytes);
  const subtypes = fontSubtypes(printed, printed.getPage(0).node.Resources());
  assert.ok(subtypes.includes('/Type0'), 'the field value should have been drawn with the fallback font');
});
