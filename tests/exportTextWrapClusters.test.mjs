// The line wrapper walks GRAPHEME CLUSTERS, and nothing else about wrapping
// moved (2026-09-15, export round 9 — the fix for exportEmojiWrapBoundary).
//
// Three things are pinned here, because the fix touches the one function that
// lays out EVERY exported text box — `layoutFlattenedText`, which the exported
// /AP, the flattened print and the /AP /BBox all read from:
//
//   1. WIDTH SWEEP. A flag, a keycap, a skin-toned ZWJ sequence and a
//      subdivision flag are each repeated across a box that is swept through
//      thirteen widths, so every one of them lands on a wrap boundary at some
//      width. Every repeat must be PAINTED — counted as `Do` operators, which
//      is deterministic on any machine — in the print and in the /AP alike.
//   2. NO FALSE WARNING. `droppedCodePoints` is fed by the DRAWN runs only, so
//      the "no embedded font covers these characters" line cannot fire for a
//      character the export went on to draw.
//   3. LATIN / CJK / THAI ARE UNTOUCHED. The appearance stream and the printed
//      page content are hashed for a grid of non-emoji fixtures at several
//      widths and alignments, against hashes captured from the code BEFORE the
//      wrap rewrite. pdf-lib mints a fresh name for every font and ExtGState it
//      writes, so the names are normalised away first; everything that
//      describes the layout — the operators, the glyph bytes, the positions and
//      the /BBox — is still compared byte for byte.
//
// A zero-width combining mark is why (3) can hold at all: the OLD per-code-point
// walk never broke a Thai tone mark or a Hebrew niqqud off its base, because a
// zero-width continuation can never be the thing that overflows a line. Emoji
// failed for the mirror-image reason — the raster lookup put ALL of a cluster's
// width on its LAST code point and none on the prefix.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream,
} from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { segmentGraphemes } from '../src/utils/pdfUnicodeText.js';

const LETTER = { width: 612, height: 792 };

// 1x1 transparent PNG. Only the EXISTENCE of a raster matters: it is what
// retires the monochrome emoji font and puts the run splitter on the image
// path, which is the path the wrap boundary used to destroy.
const ONE_PIXEL_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
), (c) => c.charCodeAt(0));

const withFakeCanvas = async (fn) => {
  const hadOffscreen = 'OffscreenCanvas' in globalThis;
  const previousOffscreen = globalThis.OffscreenCanvas;
  const previousWindow = globalThis.window;
  class FakeOffscreenCanvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return {
        clearRect() {}, fillText() {},
        set font(_v) {}, get font() { return ''; },
        set textAlign(_v) {}, get textAlign() { return ''; },
        set textBaseline(_v) {}, get textBaseline() { return ''; },
      };
    }
    async convertToBlob() { return new Blob([ONE_PIXEL_PNG], { type: 'image/png' }); }
  }
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
  globalThis.window = previousWindow || {};
  try {
    return await fn();
  } finally {
    if (hadOffscreen) globalThis.OffscreenCanvas = previousOffscreen;
    else delete globalThis.OffscreenCanvas;
    globalThis.window = previousWindow;
  }
};

const withWindow = async (fn) => {
  const previous = globalThis.window;
  globalThis.window = previous || {};
  try { return await fn(); } finally { globalThis.window = previous; }
};

const blankPdfFile = async () => {
  const doc = await PDFDocument.create();
  doc.addPage([LETTER.width, LETTER.height]);
  const bytes = await doc.save();
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

const silently = async (fn) => {
  const { log, warn, error } = console;
  const lines = [];
  console.log = console.warn = console.error = (...args) => lines.push(args.map(String).join(' '));
  try { return { value: await fn(), lines }; } finally { console.log = log; console.warn = warn; console.error = error; }
};

const textbox = (text, overrides = {}) => ({
  id: 'note-1', type: 'textbox',
  left: 40, top: 60, width: 120, height: 320,
  text, fontSize: 18, fill: '#111111', stroke: 'transparent', strokeWidth: 0,
  ...overrides,
});

const exportAnnotated = (objects, wrap = withWindow) => wrap(() => silently(async () => (
  savePDFWithAnnotationsPdfLib(
    await blankPdfFile(), { 1: { objects } }, { 1: LETTER }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'wrap-clusters' },
  )
)));

const exportFlattened = (objects, wrap = withWindow) => wrap(() => silently(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await blankPdfFile(), { 1: { objects } }, { 1: LETTER },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'wrap-clusters' },
  )
)));

const streamText = (stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());

/** How many image XObjects the file actually PAINTS (one `Do` per emoji). */
const drawnImageCount = async (bytes) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let text = '';
    try { text = streamText(object); } catch { continue; }
    count += (text.match(/(^|[\s>\]])Do(?=[\s/[<(]|$)/g) || []).length;
  }
  return count;
};

const appearanceText = async (bytes) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots instanceof PDFArray && annots.size() > 0, 'the export wrote no /Annots');
  const dict = doc.context.lookup(annots.get(0));
  assert.ok(dict instanceof PDFDict, '/Annots[0] is not a dictionary');
  const ap = doc.context.lookup(dict.get(PDFName.of('AP')));
  assert.ok(ap instanceof PDFDict, 'the annotation carries no /AP');
  const normal = doc.context.lookup(ap.get(PDFName.of('N')));
  assert.ok(normal instanceof PDFRawStream, '/AP /N is not a stream');
  return `BBox=${String(normal.dict.get(PDFName.of('BBox')) || '')}\n${streamText(normal)}`;
};

const pageContentText = async (bytes) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const resolved = doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Contents')));
  const streams = resolved instanceof PDFArray
    ? resolved.asArray().map((ref) => doc.context.lookup(ref))
    : [resolved];
  return streams.filter((stream) => stream instanceof PDFRawStream).map(streamText).join('\n');
};

/** Every <hex> handed to Tj, joined — the glyph bytes the viewer will draw. */
const shownGlyphs = (content) => (content.match(/<([0-9a-fA-F]+)>\s*Tj/g) || [])
  .map((token) => token.replace(/\s*Tj$/, '').toLowerCase());

/** Latin text drawn by a standard-14 font decodes straight back out of <hex>. */
const drawnLatinLines = (content) => shownGlyphs(content).map((token) => (
  (token.slice(1, -1).match(/../g) || []).map((pair) => String.fromCharCode(parseInt(pair, 16))).join('')
));

// pdf-lib mints a fresh name for every font and ExtGState it embeds, so a raw
// stream is only comparable inside one process. Normalising the names away
// leaves the operators, the glyph bytes, the positions and the /BBox — the
// whole of what "the layout did not move" means.
const normalise = (text) => text
  .replace(/\/([A-Za-z0-9+#]+)-\d+/g, '/$1-X')
  .replace(/\/GS-\d+/g, '/GS-X');
const sha = (text) => createHash('sha256').update(normalise(text), 'latin1').digest('hex').slice(0, 32);

// ---------------------------------------------------------------------------
// 1. Every shape of multi-code-point emoji, swept across the wrap boundary
// ---------------------------------------------------------------------------

const CLUSTER_CASES = [
  { name: 'regional-indicator flag', cluster: '\u{1F1EF}\u{1F1F5}', repeats: 10 },
  { name: 'keycap sequence', cluster: '3️⃣', repeats: 10 },
  { name: 'skin-tone modifier', cluster: '\u{1F44D}\u{1F3FF}', repeats: 10 },
  { name: 'ZWJ sequence', cluster: '\u{1F477}\u{1F3FD}‍♀️', repeats: 8 },
  { name: 'family ZWJ sequence', cluster: '\u{1F468}‍\u{1F469}‍\u{1F467}', repeats: 8 },
  { name: 'tag subdivision flag', cluster: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', repeats: 6 },
];

// 13 widths from "one emoji per line" to "everything on one line". Whatever the
// cluster's measured width turns out to be, some width in this sweep puts a
// boundary inside it.
const SWEEP_WIDTHS = [36, 44, 52, 60, 72, 84, 96, 108, 120, 150, 200, 300, 480];

for (const { name, cluster, repeats } of CLUSTER_CASES) {
  test(`every ${name} is painted at every box width`, async () => {
    assert.ok(segmentGraphemes(cluster).length === 1,
      `the fixture is not one cluster: ${JSON.stringify(segmentGraphemes(cluster))}`);
    assert.ok([...cluster].length > 1, 'the fixture is not multi-code-point, so it proves nothing');
    const text = cluster.repeat(repeats);
    for (const width of SWEEP_WIDTHS) {
      const objects = [textbox(text, { width })];
      const flattened = await exportFlattened(objects, withFakeCanvas);
      assert.equal(await drawnImageCount(flattened.value), repeats,
        `print at width ${width}: a ${name} was broken across the wrap boundary and vanished`);
      const annotated = await exportAnnotated(objects, withFakeCanvas);
      assert.equal(await drawnImageCount(annotated.value), repeats,
        `/AP at width ${width}: the appearance disagrees with the print`);
    }
  });
}

test('an emoji next to Latin words survives every wrap boundary', async () => {
  // The mixed case is the real one: the cluster arrives mid-line at an offset
  // that changes with every width, so the boundary lands inside it eventually.
  const text = 'Bay \u{1F1EF}\u{1F1F5} level 4 \u{1F477}\u{1F3FD}‍♀️ signed off \u{1F44D}\u{1F3FF} today';
  for (const width of SWEEP_WIDTHS) {
    const objects = [textbox(text, { width, height: 600 })];
    const flattened = await exportFlattened(objects, withFakeCanvas);
    assert.equal(await drawnImageCount(flattened.value), 3,
      `print at width ${width}: an emoji was lost in mixed text`);
  }
});

test('a cluster wider than the whole box is still drawn once, not split', async () => {
  // A 40pt box cannot hold an 18pt emoji plus padding. The wrapper must put the
  // whole cluster on its own line and draw it, not shed half of it.
  const objects = [textbox('\u{1F477}\u{1F3FD}‍♀️'.repeat(3), { width: 20, height: 400 })];
  const flattened = await exportFlattened(objects, withFakeCanvas);
  assert.equal(await drawnImageCount(flattened.value), 3,
    'a cluster too wide for the box lost pieces instead of overflowing whole');
});

// ---------------------------------------------------------------------------
// 2. The warning tells the truth
// ---------------------------------------------------------------------------

test('no "left out of the drawn text" warning fires for an emoji that is drawn', async () => {
  const text = '\u{1F1EF}\u{1F1F5}\u{1F477}\u{1F3FD}‍♀️3️⃣\u{1F44D}\u{1F3FF}'.repeat(4);
  for (const width of SWEEP_WIDTHS) {
    const objects = [textbox(text, { width, height: 600 })];
    const flattened = await exportFlattened(objects, withFakeCanvas);
    assert.ok(await drawnImageCount(flattened.value) > 0, `width ${width}: precondition — nothing was painted`);
    assert.deepEqual(
      flattened.lines.filter((line) => /left out of the drawn text/.test(line)), [],
      `width ${width}: the export warned about characters it actually drew`,
    );
  }
});

test('the warning still fires for a character no embedded font covers', async () => {
  // The warning must not have been silenced, only made honest. U+10A00
  // (Kharoshthi) is in no font this export embeds, and it is not a format
  // character, so it is genuinely left out of the drawn text.
  const flattened = await exportFlattened([textbox('Bay \u{10A00} three', { width: 400 })]);
  assert.ok(
    flattened.lines.some((line) => /left out of the drawn text/.test(line) && /U\+10A00/.test(line)),
    'a character that really is uncovered stopped being reported',
  );
});

// ---------------------------------------------------------------------------
// 3. Latin, CJK and Thai wrap exactly where they always did
// ---------------------------------------------------------------------------

const SAMPLES = {
  latinLong: 'The quick brown fox jumps over the lazy dog near Bay 3 and then keeps running along the corridor past the stair core.',
  latinHyphenish: 'reinforcement-bar spacing verified 2026-09-15 by the site engineer on level 4',
  latinOneLongWord: 'Pneumonoultramicroscopicsilicovolcanoconiosis',
  latinTrailingSpaces: 'alpha   beta    gamma   delta   epsilon   zeta   eta   theta',
  cjk: '鉄筋コンクリートの梁は第三ベイで確認済みです。現場監督の署名が必要です。',
  cjkMixed: 'Bay 3 鉄筋 check 梁 done 柱 ok 壁 next 床 final',
  thai: 'ตรวจสอบคานคอนกรีตเสริมเหล็กที่ช่องที่สามเรียบร้อยแล้วครับ',
  hebrew: 'Bay 3 קורה',
  greek: 'Επιθεώρηση δοκού στο τρίτο άνοιγμα',
  multiline: 'line one here\nline two is quite a lot longer than line one is\n\nline four',
};

// Captured by running this same grid against the code as it stood BEFORE the
// grapheme-cluster wrap rewrite (commit 87bf3f47d). A change here means the
// rewrite moved a line break for text that has no emoji in it.
const FROZEN = [
  ['latinLong|w120|left', 'fbe4e5ce3298bf534afaa28e89f326e5', '354ac53c46dadf76085c74f5d035bf01'],
  ['latinLong|w120|center', '5d4faf36fd8b7ab973f6c93501770273', '288f436c4fa1ce2c62d7c003ecd62a3e'],
  ['latinLong|w260|right', '9c130bde2da5b64c9ff8a40a97fa10e3', '8544aa21eafc9b4a5b913ec723b5d38c'],
  ['latinOneLongWord|w90|left', '1a20283698d9ce04d7c1e93a4f886cfb', 'f352ba3a1ed546b0a922af16220c2fe4'],
  ['latinTrailingSpaces|w160|left', '0b904c3a0b0ecdc242e81421463c25c0', '3ea5eb6f008a4c1fefe5689347df198e'],
  ['latinHyphenish|w200|left', '3a8b966df3cc04d6b321b26f5733fab2', '21c8cadbc681fe1401d6cb503f0b2710'],
  ['cjk|w120|left', '9e655b56e3cdfe041d1ec3006eb1e685', 'af78900befb6d45e6a83a28a42469566'],
  ['cjk|w60|left', '108d20594744d0703055f521328869e9', '64815e9bc4d049215fc3c751cb405fca'],
  ['cjkMixed|w200|center', '9156b9a4abc45d4468c4086191efcdd4', '14b2bd0f149ef638a52262e076593253'],
  ['thai|w120|left', '36f1ac47812a734fc1fd62fc1838ed70', 'acc9008c9be6717738cf591a99bd70bf'],
  ['thai|w60|left', '276af44e6981831cf0ae2321f5c80000', 'be8468916c736b4d74ee2d64c26d7cfa'],
  ['hebrew|w90|left', 'd33add86d2a327b2f32dc176135d169c', 'c8daf61611913b730aeec8bf0140f521'],
  ['greek|w160|right', 'c3eb9cbc7aecadc084a247aca08275b5', '44ed6d286f928bd42a00959025f7818a'],
  ['multiline|w160|left', '4de86f6f4498bb49ffc1c6f8112cb082', 'e6592cd964e705a8cde532a7166f2b9e'],
];

for (const [key, expectedAp, expectedPrint] of FROZEN) {
  test(`${key} exports the same bytes the per-code-point wrap did`, async () => {
    const [name, widthToken, textAlign] = key.split('|');
    const objects = [textbox(SAMPLES[name], {
      width: Number(widthToken.slice(1)), height: 300, textAlign, left: 40, top: 60,
    })];
    const annotated = await exportAnnotated(objects);
    assert.equal(sha(await appearanceText(annotated.value)), expectedAp,
      `${key}: the /AP moved — the wrap rewrite changed a line break for non-emoji text`);
    const flattened = await exportFlattened(objects);
    assert.equal(sha(await pageContentText(flattened.value)), expectedPrint,
      `${key}: the printed page moved`);
  });
}

// ---------------------------------------------------------------------------
// 4. The wrap mode is the object's, not a guess
// ---------------------------------------------------------------------------

test('a textbox wraps per cluster, the way the canvas drew it', async () => {
  // Every text object this app creates sets fabric's `splitByGrapheme: true`
  // (PageAnnotationLayer, textEditCommit, calloutAnnotationBridge,
  // calloutEditAdapter), and fabric's own `_wrapLine` then breaks between
  // clusters with no regard for spaces. The export has to break in the same
  // places or an exported line lands somewhere the user never saw it.
  const annotated = await exportAnnotated([
    textbox('The quick brown fox jumps over the lazy dog', { width: 120, splitByGrapheme: true }),
  ]);
  const lines = drawnLatinLines(await appearanceText(annotated.value));
  assert.deepEqual(lines, ['The quick br', 'own fox jump', 's over the laz', 'y dog']);
});

test('a textbox that asks for word wrap breaks at the space instead', async () => {
  // fabric's OTHER mode. No object in this app produces it today, but it rides
  // along in every serialized Textbox, so honouring it is cheaper than assuming.
  const annotated = await exportAnnotated([
    textbox('The quick brown fox jumps over the lazy dog', { width: 120, splitByGrapheme: false }),
  ]);
  const lines = drawnLatinLines(await appearanceText(annotated.value));
  assert.deepEqual(lines, ['The quick', 'brown fox', 'jumps over', 'the lazy dog']);
  assert.ok(lines.every((line) => !/^\s|\s$/.test(line)), 'a wrapped line kept the space it broke at');
});

test('word wrap still breaks inside a word that is wider than the box', async () => {
  const annotated = await exportAnnotated([
    textbox('Bay Pneumonoultramicroscopicsilicovolcanoconiosis end', { width: 120, splitByGrapheme: false }),
  ]);
  const lines = drawnLatinLines(await appearanceText(annotated.value));
  assert.equal(lines[0], 'Bay');
  assert.ok(lines.length > 2, 'the over-long word was not broken at all');
  assert.equal(lines.join(''), 'BayPneumonoultramicroscopicsilicovolcanoconiosisend',
    'breaking inside the long word lost or duplicated characters');
});

// ---------------------------------------------------------------------------
// 5. The fallback splitter, for a runtime without Intl.Segmenter
// ---------------------------------------------------------------------------

test('the grapheme splitter agrees with Intl.Segmenter on the emoji it exists for', async () => {
  const cases = [
    '\u{1F1EF}\u{1F1F5}\u{1F1E9}\u{1F1EA}',
    '3️⃣',
    '\u{1F44D}\u{1F3FF}',
    '\u{1F477}\u{1F3FD}‍♀️',
    '\u{1F468}‍\u{1F469}‍\u{1F467}',
    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
    'Bay 3 \u{1F1EF}\u{1F1F5} ok',
    'ที่ช่อง',
  ];
  // Reload the module with Intl.Segmenter hidden so the fallback path is the
  // one under test, then compare it against the real segmenter's answer.
  const realIntl = globalThis.Intl;
  globalThis.Intl = { ...realIntl, Segmenter: undefined };
  let fallbackSegment;
  try {
    ({ segmentGraphemes: fallbackSegment } = await import(
      `../src/utils/pdfUnicodeText.js?no-segmenter=${Date.now()}`
    ));
  } finally {
    globalThis.Intl = realIntl;
  }
  for (const value of cases) {
    assert.deepEqual(fallbackSegment(value), segmentGraphemes(value),
      `the fallback splitter broke ${JSON.stringify(value)} differently`);
  }
});
