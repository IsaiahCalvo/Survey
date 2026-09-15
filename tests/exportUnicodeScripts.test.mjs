// Every script the export claims to support must draw REAL GLYPHS — in the
// flattened print and in the exported /AP — and emoji must come out in colour
// where a colour rasteriser exists (2026-09-15, export round 8).
//
// This suite exists because every failure in this area is SILENT. Nothing
// throws; the text simply is not there:
//
//   * a font whose `glyf` entries are odd-length is subset by
//     @pdf-lib/fontkit@1.1.1 with the SHORT `loca` format (`offset >>>= 1`,
//     no evenness check), so every glyph after the first odd one decodes a
//     byte out of phase and renders blank. Noto Sans Symbols 2 ships 1,321
//     odd-length glyphs of 2,654 and loses ✓ ✗ ★ ⚠ ☐ without the build
//     script's padding pass;
//   * a complex script with its layout tables stripped renders NOTHING AT
//     ALL — Arabic's cursive joining forms are GSUB substitutions, and
//     fontkit's shaper emits the joined forms or nothing;
//   * a CFF (.otf) CJK face embeds as CIDFontType0/FontFile3, which Chrome's
//     PDFium draws as nothing while still extracting the text;
//   * Devanagari throws `regeneratorRuntime is not defined` out of fontkit's
//     Indic state machine, which takes the WHOLE export down rather than
//     degrading one glyph;
//   * a /DA naming the WinAnsi `/Helv` for CJK text is mozilla/pdf.js#20117:
//     a viewer that regenerates the appearance draws nothing.
//
// So the assertions here are structural and adversarial rather than "it did
// not throw": the committed font bytes are gated the way the build gates
// them, shaping is checked against the shaped glyph ids, and the drawn glyph
// codes in the print are compared against the ones in the /AP.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { FONT_COVERAGE } from '../src/assets/fonts/fontCoverage.js';
import {
  buildTextFontRuns,
  isEmojiGrapheme,
  segmentGraphemes,
  UNICODE_FALLBACK_FONTS,
} from '../src/utils/pdfUnicodeText.js';

const LETTER = { width: 612, height: 792 };
const FONT_DIR = new URL('../src/assets/fonts/', import.meta.url);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const makePdfFile = async (pageSize = LETTER) => {
  const doc = await PDFDocument.create();
  doc.addPage([pageSize.width, pageSize.height]);
  const bytes = await doc.save();
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};

// Swallow the export's own chatter but KEEP it, so a test can prove the
// "these characters were left out" warning never fired.
const captureLogs = async (fn) => {
  const { log, warn, error } = console;
  const lines = [];
  const sink = (...args) => lines.push(args.map((value) => String(value)).join(' '));
  console.log = sink; console.warn = sink; console.error = sink;
  try { return { value: await fn(), lines }; } finally { console.log = log; console.warn = warn; console.error = error; }
};

const textbox = (text, overrides = {}) => ({
  id: 'note-1',
  type: 'textbox',
  left: 40,
  top: 60,
  width: 480,
  height: 120,
  text,
  fontSize: 18,
  fill: '#111111',
  stroke: 'transparent',
  strokeWidth: 0,
  ...overrides,
});

const exportAnnotated = async (objects) => captureLogs(() => withWindow(async () => (
  savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects } },
    { 1: LETTER },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'unicode-scripts' },
  )
)));

const exportFlattened = async (objects) => captureLogs(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects } },
    { 1: LETTER },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'unicode-scripts' },
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
  const resolved = doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Contents')));
  const streams = resolved instanceof PDFArray
    ? resolved.asArray().map((ref) => doc.context.lookup(ref))
    : [resolved];
  return streams.filter((stream) => stream instanceof PDFRawStream).map(streamText).join('\n');
};

// Every <hex> handed to Tj, in order. Comparing these between the print and
// the /AP proves both drew the same glyphs from the same fonts without needing
// a rasteriser.
const shownGlyphs = (content) => (content.match(/<([0-9a-fA-F]+)>\s*Tj/g) || [])
  .map((token) => token.replace(/\s*Tj$/, '').toLowerCase());

const embeddedFontDescriptors = (doc) => {
  const found = [];
  doc.context.enumerateIndirectObjects().forEach(([, object]) => {
    if (!(object instanceof PDFDict)) return;
    if (String(object.get(PDFName.of('Type'))) !== '/Font') return;
    found.push({
      subtype: String(object.get(PDFName.of('Subtype'))),
      baseFont: String(object.get(PDFName.of('BaseFont')) || ''),
    });
  });
  return found;
};

// ---------------------------------------------------------------------------
// 1. The committed font bytes, gated the way the build script gates them
// ---------------------------------------------------------------------------

// A hand-downloaded replacement, an upstream font update or a "helpful" swap
// to a .otf all reintroduce a silent corruption. These run the build's own
// assertions against whatever is actually committed.
for (const entry of FONT_COVERAGE) {
  test(`${entry.file} is a TrueType face with no odd-length glyf entry`, async () => {
    const bytes = new Uint8Array(await readFile(new URL(entry.file, FONT_DIR)));
    assert.equal(bytes.length, entry.bytes, 'fontCoverage.js is stale — re-run the build script');
    const face = fontkit.create(bytes);
    // A CFF face embeds as CIDFontType0/FontFile3, which Chrome's PDFium
    // renders as nothing at all while still extracting the text.
    assert.ok(face.directory.tables.glyf, `${entry.file} has no glyf table (CFF outlines)`);
    assert.ok(face.directory.tables.loca, `${entry.file} has no loca table`);
    const offsets = face.loca.offsets;
    let odd = 0;
    for (let index = 0; index + 1 < offsets.length; index += 1) {
      if ((offsets[index + 1] - offsets[index]) % 2) odd += 1;
    }
    assert.equal(odd, 0, `${entry.file} has ${odd} odd-length glyf entries; fontkit's short loca would blank every glyph after the first`);
  });

  test(`${entry.file} keeps its layout tables exactly when it needs shaping`, async () => {
    const bytes = new Uint8Array(await readFile(new URL(entry.file, FONT_DIR)));
    const face = fontkit.create(bytes);
    if (entry.needsShaping) {
      // PROVEN: strip GSUB from Noto Sans Arabic and it renders NOTHING.
      assert.ok(face.directory.tables.GSUB, `${entry.file} needs shaping but has no GSUB`);
    }
  });
}

test('every registered fallback font has coverage data and a committed file', async () => {
  for (const descriptor of UNICODE_FALLBACK_FONTS) {
    const entry = FONT_COVERAGE.find((candidate) => candidate.id === descriptor.id);
    assert.ok(entry, `no coverage entry for "${descriptor.id}"`);
    assert.equal(entry.file, descriptor.file);
    const bytes = new Uint8Array(await readFile(descriptor.assetUrl()));
    assert.equal(bytes.length, entry.bytes);
  }
});

test('the coverage pre-filter answers exactly what the font cmap answers', async () => {
  // The old hand-written ranges claimed the arrow and geometric blocks for the
  // EMOJI font, so a plain "→" triggered a 777 KB download for a glyph that
  // font does not have. A generated range list cannot drift like that — this
  // proves it by asking both sides about a spread of code points.
  for (const descriptor of UNICODE_FALLBACK_FONTS) {
    const face = fontkit.create(new Uint8Array(await readFile(descriptor.assetUrl())));
    for (const codePoint of [0x2192, 0x2713, 0x2605, 0x26a0, 0x4e00, 0x5d0, 0x627, 0x915, 0xe01, 0x1f642, 0x3b1, 0x434, 0x1ec7]) {
      assert.equal(
        descriptor.mayCover(codePoint),
        face.hasGlyphForCodePoint(codePoint),
        `${descriptor.id} disagrees with its own cmap about U+${codePoint.toString(16).toUpperCase()}`,
      );
    }
  }
});

test('a plain arrow never reaches for the emoji font', () => {
  const emoji = UNICODE_FALLBACK_FONTS.find((descriptor) => descriptor.id === 'emoji');
  for (const codePoint of [0x2192 /* → */, 0x2713 /* ✓ */, 0x2717 /* ✗ */, 0x2605 /* ★ */, 0x25cf /* ● */, 0x25a0 /* ■ */]) {
    assert.equal(emoji.mayCover(codePoint), false, `the emoji font would be downloaded for U+${codePoint.toString(16)}`);
  }
  const symbols2 = UNICODE_FALLBACK_FONTS.find((descriptor) => descriptor.id === 'symbols2');
  for (const codePoint of [0x2713, 0x2717, 0x2605, 0x25cf, 0x25a0, 0x26a0, 0x2610, 0x2611]) {
    assert.ok(symbols2.mayCover(codePoint), `Noto Sans Symbols 2 should cover U+${codePoint.toString(16)}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Shaping — the failures that render nothing at all
// ---------------------------------------------------------------------------

const shapedGlyphIds = async (file, text) => {
  const face = fontkit.create(new Uint8Array(await readFile(new URL(file, FONT_DIR))));
  return { face, ids: face.layout(text).glyphs.map((glyph) => glyph.id) };
};

test('Arabic shapes into joined cursive forms, not the isolated cmap glyphs', async () => {
  const { face, ids } = await shapedGlyphIds('NotoSansArabic-Regular.ttf', 'مرحبا');
  assert.ok(ids.length > 0, 'Arabic produced no glyphs at all — GSUB was stripped');
  assert.ok(!ids.includes(0), 'Arabic shaping produced .notdef');
  const isolated = [...'مرحبا'].map((character) => face.glyphForCodePoint(character.codePointAt(0)).id);
  // Joining substitutes a different glyph for every letter that is not in
  // isolated position, so the shaped run cannot equal the raw cmap lookup.
  assert.notDeepEqual(ids, isolated, 'Arabic was not shaped — the joining substitutions did not run');
});

test('Devanagari lays out without the regeneratorRuntime throw, with real conjuncts', async () => {
  // fontkit's Indic state machine is regenerator-compiled; without the runtime
  // this call throws `regeneratorRuntime is not defined` and the whole export
  // dies. src/utils/pdfUnicodeText.js loads the runtime with the font.
  await import('regenerator-runtime/runtime.js');
  const { ids } = await shapedGlyphIds('NotoSansDevanagari-Regular.ttf', 'नमस्ते');
  assert.ok(ids.length > 0);
  assert.ok(!ids.includes(0), 'Devanagari shaping produced .notdef');
});

test('Thai and Hebrew shape without dropping a glyph', async () => {
  for (const [file, text] of [['NotoSansThai-Regular.ttf', 'สวัสดี'], ['NotoSansHebrew-Regular.ttf', 'שלום']]) {
    const { ids } = await shapedGlyphIds(file, text);
    assert.ok(ids.length > 0, `${file} produced no glyphs`);
    assert.ok(!ids.includes(0), `${file} shaping produced .notdef`);
  }
});

test('a pure RTL line comes out in VISUAL order — and a mixed one is the documented limit', async () => {
  // WHAT WORKS. fontkit reports direction 'rtl' and returns the glyphs already
  // reversed, so a Hebrew- or Arabic-ONLY line drawn left to right lands in
  // correct visual order. This checks that against the independently computed
  // answer (the logical code points, reversed) rather than against a picture.
  const face = fontkit.create(new Uint8Array(await readFile(new URL('NotoSansArabic-Regular.ttf', FONT_DIR))));
  const text = 'فحص العارضة';
  const run = face.layout(text);
  assert.equal(run.direction, 'rtl');
  assert.deepEqual(
    run.glyphs.flatMap((glyph) => glyph.codePoints),
    [...text].map((character) => character.codePointAt(0)).reverse(),
    'the Arabic run is not in visual order',
  );

  // WHAT DOES NOT. buildTextFontRuns splits per code point and the drawer lays
  // the runs out left to right at an accumulating x, so a line that MIXES
  // directions (a Latin label beside Hebrew body text, European digits inside
  // Arabic, an emoji inside an RTL run) comes out in the wrong visual order.
  // Fixing it needs a real Unicode Bidi Algorithm pass producing directional
  // runs BEFORE the font split, then laying those out in visual order. Until
  // that lands the honest claim is "RTL renders, single-direction only" — this
  // assertion PINS the current behaviour so the day someone implements bidi,
  // this test fails and tells them to update the claim.
  const helvetica = await (await PDFDocument.create()).embedFont('Helvetica');
  const { runs } = buildTextFontRuns('Bay 3 קורה', helvetica, []);
  assert.equal(runs[0].text, 'Bay 3 ', 'the Latin part should still be one leading run');
  assert.equal(runs.length, 1, 'no Hebrew font was embedded here, so the RTL part is dropped, not reordered');
});

// ---------------------------------------------------------------------------
// 3. Per script: real glyphs in BOTH the print and the exported /AP
// ---------------------------------------------------------------------------

const SCRIPT_CASES = [
  ['Latin Extended', 'Žluťoučký kůň — ő ø æ'],
  ['Greek', 'Επιθεώρηση δοκού'],
  ['Cyrillic', 'Осмотр балки — трещина'],
  ['Vietnamese', 'Kiểm tra dầm bê tông'],
  ['typographic punctuation', '“Spalling” • €120 ± 5° — noted…'],
  ['survey symbols', '☑ done ✓ ok ✗ fail ★ ● ■ ⚠ ☐'],
  ['arrows and circled numbers', '① → ⌀ 12mm'],
  ['Hebrew', 'בדיקת קורה'],
  ['Thai', 'ตรวจสอบคาน'],
  ['Arabic', 'فحص العارضة'],
  ['Devanagari', 'बीम की जाँच'],
  ['CJK', '鉄筋の腐食 / 한글 점검 / 中文检查'],
];

for (const [label, text] of SCRIPT_CASES) {
  test(`${label} draws real glyphs in the print AND in the exported /AP`, async () => {
    const { value: printBytes, lines: printLines } = await exportFlattened([textbox(text)]);
    const print = await PDFDocument.load(printBytes);
    const printGlyphs = shownGlyphs(pageContentText(print));
    assert.ok(printGlyphs.length > 0, `${label}: the flattened print drew no glyphs at all`);
    assert.ok(
      !printLines.some((line) => line.includes('no embedded font covers these characters')),
      `${label}: characters were dropped — ${printLines.filter((line) => line.includes('no embedded font')).join(' | ')}`,
    );

    const { value: annotatedBytes } = await exportAnnotated([textbox(text)]);
    const annotated = await PDFDocument.load(annotatedBytes);
    const stream = appearanceStream(annotated, firstAnnot(annotated));
    assert.ok(stream, `${label}: the exported /FreeText has no /AP — every viewer would draw it itself, or not at all`);
    const apGlyphs = shownGlyphs(streamText(stream));
    assert.deepEqual(
      apGlyphs,
      printGlyphs,
      `${label}: the /AP and the print drew different glyphs`,
    );

    // Real glyphs, not a row of .notdef. A subset always keeps gid 0 for
    // .notdef, so any <0000> in the drawn run is a missing glyph.
    assert.ok(
      !apGlyphs.some((token) => /^0+$/.test(token)),
      `${label}: the /AP drew .notdef`,
    );

    // The text itself survives verbatim for search and copy/paste.
    const contents = firstAnnot(annotated).get(PDFName.of('Contents'));
    assert.equal(contents.decodeText(), text);
  });
}

test('an embedded fallback goes out as CIDFontType2 with FontFile2, never CFF', async () => {
  const { value } = await exportAnnotated([textbox('鉄筋の腐食')]);
  const doc = await PDFDocument.load(value);
  const descriptors = embeddedFontDescriptors(doc);
  const composite = descriptors.filter((entry) => entry.subtype === '/Type0' || entry.subtype === '/CIDFontType2');
  assert.ok(composite.length > 0, 'no composite font was embedded for CJK');
  assert.ok(
    !descriptors.some((entry) => entry.subtype === '/CIDFontType0'),
    'a CFF composite font was embedded — Chrome/PDFium renders that as nothing',
  );
});

// ---------------------------------------------------------------------------
// 4. /DA and /DR — for the viewers that regenerate the appearance
// ---------------------------------------------------------------------------

test('a CJK text box points /DA at the embedded font and ships the /DR that resolves it', async () => {
  const { value } = await exportAnnotated([textbox('鉄筋の腐食')]);
  const doc = await PDFDocument.load(value);
  const dict = firstAnnot(doc);
  const da = dict.get(PDFName.of('DA')).decodeText();
  assert.ok(!/\/Helv\b/.test(da), `/DA still names the WinAnsi /Helv for CJK text: ${da}`);
  const name = da.match(/\/(\S+)\s+[\d.]+\s+Tf/)?.[1];
  assert.ok(name, `/DA has no font selector: ${da}`);

  // 1. the annotation's own /DR resolves the name …
  const dr = doc.context.lookup(dict.get(PDFName.of('DR')));
  assert.ok(dr instanceof PDFDict, 'no /DR on the annotation');
  const drFonts = doc.context.lookup(dr.get(PDFName.of('Font')));
  assert.ok(drFonts instanceof PDFDict, 'no /DR /Font');
  const fontRef = drFonts.get(PDFName.of(name));
  assert.ok(fontRef, `/DR does not resolve ${name}`);

  // 2. … and so does the AcroForm /DR, which is where PDF 32000-1 §12.5.6.6
  //    says a /FreeText's /DA font shall be found.
  const acroForm = doc.context.lookup(doc.catalog.get(PDFName.of('AcroForm')));
  assert.ok(acroForm instanceof PDFDict, 'no AcroForm to hold the /DR');
  const acroFonts = doc.context.lookup(
    doc.context.lookup(acroForm.get(PDFName.of('DR'))).get(PDFName.of('Font')),
  );
  assert.ok(acroFonts instanceof PDFDict, 'no AcroForm /DR /Font');
  assert.equal(String(acroFonts.get(PDFName.of(name))), String(fontRef), 'the two /DR levels name different fonts');

  // 3. the font it names is the CIDFontType2 subset, not a standard-14.
  const font = doc.context.lookup(fontRef);
  assert.equal(String(font.get(PDFName.of('Subtype'))), '/Type0');

  // 4. /NeedAppearances stays unset: it is deprecated in PDF 2.0 and it tells
  //    viewers to throw away the /AP this export worked to get right.
  assert.equal(acroForm.get(PDFName.of('NeedAppearances')), undefined);
});

test('/DA names the font that COVERS the most of the line, not the one that drew the most', async () => {
  // Noto Sans covers Latin AND Cyrillic, so it covers every character of this
  // line while Helvetica covers only the Latin half — a viewer regenerating
  // from /DA loses nothing if it is told to use Noto Sans.
  const mixed = await exportAnnotated([textbox('Beam 3 — Осмотр балки')]);
  const mixedDoc = await PDFDocument.load(mixed.value);
  const mixedDa = firstAnnot(mixedDoc).get(PDFName.of('DA')).decodeText();
  assert.ok(!/\/Helv\b/.test(mixedDa), `/DA kept /Helv for a line Noto Sans covers entirely: ${mixedDa}`);

  // The other way round: Droid Sans Fallback carries NO Latin, so on a
  // Latin-dominant line with one CJK word Helvetica still covers more and /DA
  // must keep /Helv — naming Droid would lose the Latin instead.
  const latinHeavy = await exportAnnotated([textbox('Check the beam here for 腐食 today')]);
  const latinDoc = await PDFDocument.load(latinHeavy.value);
  assert.match(firstAnnot(latinDoc).get(PDFName.of('DA')).decodeText(), /\/Helv \d+(\.\d+)? Tf$/);
});

test('an all-Latin text box keeps the standard-14 /DA and creates no AcroForm', async () => {
  const { value } = await exportAnnotated([textbox('Beam 3 spalling')]);
  const doc = await PDFDocument.load(value);
  const dict = firstAnnot(doc);
  assert.match(dict.get(PDFName.of('DA')).decodeText(), /\/Helv \d+(\.\d+)? Tf$/);
  assert.equal(dict.get(PDFName.of('DR')), undefined, 'a plain Latin note should not carry a /DR');
  assert.equal(doc.catalog.get(PDFName.of('AcroForm')), undefined, 'a plain Latin note should not invent an AcroForm');
});

// ---------------------------------------------------------------------------
// 5. Emoji
// ---------------------------------------------------------------------------

test('emoji graphemes cluster as one unit and keep their presentation rule', () => {
  assert.deepEqual(segmentGraphemes('a👷🏽‍♀️b'), ['a', '👷🏽‍♀️', 'b']);
  assert.deepEqual(segmentGraphemes('🇯🇵!'), ['🇯🇵', '!']);
  assert.equal(isEmojiGrapheme('👷🏽‍♀️'), true);
  assert.equal(isEmojiGrapheme('🇯🇵'), true);
  assert.equal(isEmojiGrapheme('🙂'), true);
  // The survey vocabulary is default-TEXT and must stay a real vector glyph.
  assert.equal(isEmojiGrapheme('⚠'), false, 'a bare ⚠ must stay a Symbols 2 glyph');
  assert.equal(isEmojiGrapheme('✓'), false, 'a tick must stay a Symbols 2 glyph');
  assert.equal(isEmojiGrapheme('☑'), false, 'a ballot box must stay a Symbols 2 glyph');
  // …unless the author asked for the emoji presentation explicitly.
  assert.equal(isEmojiGrapheme('⚠️'), true);
  assert.equal(isEmojiGrapheme('✓︎'), false);
});

test('in Node, with no canvas, emoji falls back to the monochrome outlines', async () => {
  const { value } = await exportAnnotated([textbox('Rebar 🙂 spalling')]);
  const doc = await PDFDocument.load(value);
  const stream = appearanceStream(doc, firstAnnot(doc));
  assert.ok(stream, 'no /AP for the emoji note');
  const content = streamText(stream);
  assert.ok(shownGlyphs(content).length > 0, 'nothing was drawn');
  // No image XObject (`/Name Do`): the Node path draws glyphs, which is what
  // keeps the fidelity harnesses byte-stable.
  assert.ok(!/\/\S+\s+Do\b/.test(content), 'Node embedded an image for the emoji');
});

// A minimal PNG encoder so the browser path can be exercised without pulling a
// canvas implementation into the gated test suite.
const solidPng = (size, [red, green, blue]) => {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 4;
      raw[at] = red; raw[at + 1] = green; raw[at + 2] = blue; raw[at + 3] = 255;
    }
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    // CRC32 over type + body.
    let crc = 0xffffffff;
    const scope = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    for (const byte of scope) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// Stand in for a browser's OffscreenCanvas. The real one paints the system
// emoji font; this one paints a flat colour, which is what lets the test prove
// the PLUMBING — canvas → PNG → image XObject → colour samples on the page —
// deterministically on any machine. The genuine system-font colour is proven
// separately by driving the real app.
const withStubCanvas = async (colour, fn) => {
  const original = globalThis.OffscreenCanvas;
  const painted = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }

    getContext() {
      const self = this;
      return {
        set font(value) { self.font = value; },
        get font() { return self.font; },
        textAlign: '',
        textBaseline: '',
        clearRect() {},
        fillText(text) { painted.push({ text, font: self.font, size: self.width }); },
      };
    }

    async convertToBlob() {
      const bytes = solidPng(this.width, colour);
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  };
  try { return { value: await fn(), painted }; } finally { globalThis.OffscreenCanvas = original; }
};

test('with a canvas, an emoji becomes a COLOUR image XObject and the monochrome font is never fetched', async () => {
  const RED = [220, 30, 40];
  const { value: exported, painted } = await withStubCanvas(RED, () => exportAnnotated([
    textbox('Heart ❤️ here', { fontSize: 18 }),
  ]));
  const { value } = exported;
  const doc = await PDFDocument.load(value);

  // 1. the emoji grapheme was handed to the canvas whole, at ~300 dpi for an
  //    18pt draw (18 * 4 = 72 px).
  assert.equal(painted.length, 1, 'the rasteriser ran the wrong number of times');
  assert.equal(painted[0].text, '❤️');
  assert.equal(painted[0].size, 72);
  assert.match(painted[0].font, /Apple Color Emoji/);

  // 2. the /AP paints an image, not a glyph, for it.
  const stream = appearanceStream(doc, firstAnnot(doc));
  assert.ok(stream, 'no /AP');
  const content = streamText(stream);
  assert.match(content, /\/\S+\s+Do\b/, 'the /AP drew no image XObject for the emoji');
  // …and the Latin around it is still ordinary text.
  assert.ok(shownGlyphs(content).length > 0, 'the surrounding Latin stopped being drawn');

  // 3. the image really is in COLOUR — read the samples back off the XObject.
  const images = [];
  doc.context.enumerateIndirectObjects().forEach(([, object]) => {
    if (!(object instanceof PDFRawStream)) return;
    if (String(object.dict.get(PDFName.of('Subtype'))) !== '/Image') return;
    images.push(object);
  });
  assert.equal(images.length, 1, 'expected exactly one embedded emoji image');
  const samples = decodePDFRawStream(images[0]).decode();
  assert.equal(String(images[0].dict.get(PDFName.of('ColorSpace'))), '/DeviceRGB');
  assert.deepEqual([samples[0], samples[1], samples[2]], RED, 'the embedded image is not the colour that was painted');
  assert.notEqual(samples[0], samples[1], 'a monochrome image would have equal channels');

  // 4. the 777 KB monochrome emoji font was never embedded.
  assert.ok(
    !embeddedFontDescriptors(doc).some((entry) => /NotoEmoji/i.test(entry.baseFont)),
    'the monochrome emoji font was embedded even though a colour raster existed',
  );

  // 5. the character still ships verbatim, so search and copy/paste work.
  assert.equal(firstAnnot(doc).get(PDFName.of('Contents')).decodeText(), 'Heart ❤️ here');
});

test('a canvas that refuses one emoji brings the monochrome font back rather than dropping it', async () => {
  // A raster store that answers "no image" for everything is the same shape as
  // a webview whose canvas is blocked. The chain must NOT retire the outlines
  // in that case — the run splitter's fall-through has nothing else to reach.
  const original = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }

    getContext() { return { clearRect() {}, fillText() {} }; }

    async convertToBlob() { throw new Error('canvas refused'); }
  };
  let exported;
  try { exported = await exportAnnotated([textbox('Rebar \u{1F642} spalling')]); }
  finally { globalThis.OffscreenCanvas = original; }
  const doc = await PDFDocument.load(exported.value);
  assert.ok(
    embeddedFontDescriptors(doc).some((entry) => /NotoEmoji/i.test(entry.baseFont)),
    'the monochrome emoji font was not embedded, so the emoji was dropped',
  );
  const content = streamText(appearanceStream(doc, firstAnnot(doc)));
  assert.ok(shownGlyphs(content).length > 0);
});

test('one emoji drawn twice at the same size embeds ONE image', async () => {
  const { value: exported } = await withStubCanvas([10, 200, 90], () => exportAnnotated([
    textbox('🙂 one', { id: 'a', fontSize: 18 }),
    textbox('🙂 two', { id: 'b', top: 300, fontSize: 18 }),
  ]));
  const doc = await PDFDocument.load(exported.value);
  let images = 0;
  doc.context.enumerateIndirectObjects().forEach(([, object]) => {
    if (object instanceof PDFRawStream && String(object.dict.get(PDFName.of('Subtype'))) === '/Image') images += 1;
  });
  assert.equal(images, 1, 'the same emoji at the same size was embedded twice');
});

test('an emoji drawn at a size the pre-pass never saw reuses a raster instead of vanishing', async () => {
  // An AcroForm field autosizes its text to the widget height, so a draw can
  // happen at a size collectDrawnTextSamples never reported. A strict miss
  // would DROP the emoji, because the monochrome font is deliberately not
  // embedded once a rasteriser exists.
  const { value: exported } = await withStubCanvas([12, 34, 200], () => exportAnnotated([
    textbox('\u{1F527} spanner', { fontSize: 12 }),
  ]));
  const doc = await PDFDocument.load(exported.value);
  let images = 0;
  doc.context.enumerateIndirectObjects().forEach(([, object]) => {
    if (object instanceof PDFRawStream && String(object.dict.get(PDFName.of('Subtype'))) === '/Image') images += 1;
  });
  assert.equal(images, 1);
  const content = streamText(appearanceStream(doc, firstAnnot(doc)));
  assert.match(content, /\/\S+\s+Do\b/, 'the emoji was dropped instead of reusing a raster');
});

test('an emoji run advances exactly one em so wrapping does not drift', () => {
  const fakeFont = {
    widthOfTextAtSize: (text, size) => text.length * size * 0.5,
    encodeText: () => {},
  };
  const store = { lookup: () => ({ id: 'image' }) };
  const { runs } = buildTextFontRuns('ab🙂cd', fakeFont, [], { emojiStore: store, fontSize: 20 });
  assert.equal(runs.length, 3);
  assert.equal(runs[1].emojiAdvanceEm, 1);
  assert.equal(runs[1].text, '🙂');
  assert.ok(!runs[0].emojiImage && !runs[2].emojiImage);
});

// ---------------------------------------------------------------------------
// 6. Size — subsetting is what makes "add more scripts" free
// ---------------------------------------------------------------------------

test('a sheet carrying CJK, Arabic and an emoji stays in the tens of KB', async () => {
  const baseline = (await exportAnnotated([textbox('Plain ASCII note')])).value.length;
  const { value } = await exportAnnotated([
    textbox('鉄筋の腐食', { id: 'cjk' }),
    textbox('فحص العارضة', { id: 'ar', top: 220 }),
    textbox('Rebar 🙂 spalling', { id: 'emoji', top: 380 }),
  ]);
  const added = value.length - baseline;
  // Unsubset these three fonts are 1.8 MB + 106 KB + 480 KB. Subsetting is not
  // an optimisation here, it is the difference between a usable export and an
  // unusable one — so this asserts the ORDER OF MAGNITUDE, not a byte count.
  assert.ok(added > 0, 'nothing was embedded at all');
  assert.ok(added < 250_000, `three scripts added ${added} B — subsetting is not working`);
});
