// A multi-code-point emoji that lands on a WRAP BOUNDARY is silently dropped
// from the exported /AP and from the flattened print (adversarial verification
// of export round 8, 2026-09-15).
//
// WHY IT HAPPENS. `layoutFlattenedText` wraps by walking the paragraph one
// CODE POINT at a time and re-measuring the candidate line:
//
//     for (const character of paragraph) {
//       if (line && !fits(line + character)) { lines.push(line); line = character; }
//       else line += character;
//     }
//
// but measuring goes through `buildTextFontRuns`, which splits the candidate
// into GRAPHEME clusters and looks each emoji cluster up in the raster store by
// its exact string. Two consequences, both reproduced below:
//
//   1. A PREFIX of a cluster (U+1F1EF of U+1F1EF U+1F1F5, or U+1F477 of
//      U+1F477 U+1F3FD U+200D U+2640 U+FE0F) is itself an emoji grapheme with
//      no raster in the store. The colour rasteriser having run, the
//      monochrome fallback font is deliberately NOT embedded, so the splitter
//      has nothing to fall through to: the prefix measures as ZERO width and
//      its code points are recorded as "dropped".
//   2. Because the prefix measures as zero, the break is only detected when the
//      cluster's LAST code point arrives - and the wrapper then starts the new
//      line with `line = character`, i.e. that last code point ALONE. The rest
//      of the cluster stays behind on the previous line as a partial cluster
//      that also has no raster. The whole emoji disappears, and for regional
//      indicators the misalignment cascades through every later flag.
//
// A single-code-point emoji is immune, which is what makes the loss so quiet.
//
// The fix belongs in the wrapper: walk `segmentGraphemes(paragraph)` instead of
// the raw code points, so a cluster is never measured or broken in half.
//
// This test needs no canvas library: a minimal OffscreenCanvas stub is enough
// to put `embedEmojiRasters` on its BROWSER branch (which is the branch every
// real user exports from), and the assertion counts drawn image XObjects, not
// pixels, so it is deterministic on any machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const LETTER = { width: 612, height: 792 };

// Smallest valid PNG (1x1, fully transparent). The raster's CONTENT is
// irrelevant here - only that a raster exists, which is what retires the
// monochrome emoji font and puts the splitter on the image path.
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

const blankPdfFile = async () => {
  const doc = await PDFDocument.create();
  doc.addPage([LETTER.width, LETTER.height]);
  const bytes = await doc.save();
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

// A box 120pt wide holds exactly six one-em emoji at 18pt, so the seventh has
// to wrap - the boundary this test is about.
const narrowTextBox = (text) => ({
  id: 'note-1', type: 'textbox',
  left: 60, top: 80, width: 120, height: 300,
  text, fontSize: 18, fill: '#111111', stroke: 'transparent', strokeWidth: 0,
});

const silently = async (fn) => {
  const { log, warn, error } = console;
  const lines = [];
  console.log = console.warn = console.error = (...args) => lines.push(args.map(String).join(' '));
  try { return { value: await fn(), lines }; } finally { console.log = log; console.warn = warn; console.error = error; }
};

/** How many image XObjects the file actually PAINTS (one `Do` per emoji). */
const drawnImageCount = async (bytes) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let text = '';
    try { text = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()); } catch { continue; }
    count += (text.match(/(^|[\s>\]])Do(?=[\s/[<(]|$)/g) || []).length;
  }
  return count;
};

const exportAnnotated = (text) => withFakeCanvas(() => silently(async () => (
  savePDFWithAnnotationsPdfLib(
    await blankPdfFile(), { 1: { objects: [narrowTextBox(text)] } }, { 1: LETTER }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'emoji-wrap' },
  )
)));

const exportFlattened = (text) => withFakeCanvas(() => silently(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await blankPdfFile(), { 1: { objects: [narrowTextBox(text)] } }, { 1: LETTER },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'emoji-wrap' },
  )
)));

// The control. One code point per grapheme, so no candidate line can ever split
// a cluster - this case already passes and must keep passing.
test('a single-code-point emoji survives a wrap boundary', async () => {
  const text = '\u{1F525}'.repeat(10); // fire x10
  const flattened = await exportFlattened(text);
  assert.equal(await drawnImageCount(flattened.value), 10,
    'all ten single-code-point emoji should be painted across the two wrapped lines');
});

test('a two-code-point emoji (flag) survives a wrap boundary', async () => {
  const text = '\u{1F1EF}\u{1F1F5}'.repeat(10); // JP flag x10
  const flattened = await exportFlattened(text);
  assert.equal(await drawnImageCount(flattened.value), 10,
    'every flag must be painted; the wrapper must not break a regional-indicator pair');

  const annotated = await exportAnnotated(text);
  assert.equal(await drawnImageCount(annotated.value), 10,
    'the exported /AP must paint the same ten flags the print does');
});

test('a ZWJ emoji sequence survives a wrap boundary', async () => {
  const text = '\u{1F477}\u{1F3FD}‍♀️'.repeat(8); // woman construction worker x8
  const flattened = await exportFlattened(text);
  assert.equal(await drawnImageCount(flattened.value), 8,
    'every ZWJ cluster must be painted; the wrapper must not break one in half');
});

// The same root cause, seen from the diagnostics side: the wrapper's throwaway
// measurement probes feed `droppedCodePoints`, so the export warns that
// characters "were left out of the drawn text" even when every one of them was
// drawn. A support engineer reading that log is sent the wrong way.
test('an emoji that IS drawn does not warn that it was left out', async () => {
  // Wide enough that nothing wraps: the three clusters are all painted.
  const text = '\u{1F1EF}\u{1F1F5}'.repeat(3); // JP flag x3
  const wide = { ...narrowTextBox(text), width: 480 };
  const result = await withFakeCanvas(() => silently(async () => (
    savePDFWithFlattenedRegularAnnotationsForPrint(
      await blankPdfFile(), { 1: { objects: [wide] } }, { 1: LETTER },
      { returnBytes: true, actionType: 'pdf-print', documentId: 'emoji-warn' },
    )
  )));
  assert.equal(await drawnImageCount(result.value), 3, 'precondition: all three flags are painted');
  const dropWarnings = result.lines.filter((line) => /left out of the drawn text/.test(line));
  assert.deepEqual(dropWarnings, [],
    'nothing was left out, so nothing should be reported as left out');
});
