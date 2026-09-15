// A /FreeText appearance /BBox must hold the glyphs the box really paints
// (2026-09-10, adversarial verification of export round 7).
//
// THE DEFECT. drawFlattenedText wraps PER CHARACTER, so a single glyph wider
// than its box's inner width is still drawn - outside the frame the box
// suggests. The exported appearance box was padded by a guess instead
// (fontSize * 0.35 + half the stroke + 1), and an /AP /BBox is a CLIP: every
// renderer cuts the ink at it. The flattened print has no such box and draws
// the whole glyph, so print and export disagreed about the mark itself.
//
// Measured on a 420 x 320 page, poppler at 216 dpi, dark >= 40:
//
//   case                         ink: print   export (round 7)   export (now)
//   emoji 28pt in a 20pt box        1388        1072  (-22.8%)      1388
//   right-aligned CJK 26pt          2655        2557  (-3.7%)       2655
//   callout label, CJK 30pt        11089       10656  (-3.9%)      11089
//
// and the boxes the cut showed up in:
//
//   emoji            /Rect [48.95 142.95  91.05 211.05] -> [... 101.796875 ...]
//   right-aligned    /Rect [189.65 145.65 228.35 210.35] -> [185.75 ...]
//                    (the overflow of a RIGHT-aligned line runs LEFT, so the
//                     glyph was cut on the left edge)
//   callout label    /Rect [29.25 112.05 75.75 188.75] -> [... 82.25 ...]
//
// THE SECOND DEFECT (2026-09-14, round 9). Measuring the laid-out runs is not
// enough while the measurement itself is made of the ADVANCE WIDTH and the
// NOMINAL DESCENDER: an italic face's ink leans past its advance and real
// tails run below the descender the font declares, so the box still clipped
// glyphs that fit their frame perfectly well. Section 4 below carries those
// cases and their measured cuts.
//
// THE CONTRACT. The appearance box is measured from the ACTUAL drawn text -
// the laid-out runs, each measured GLYPH BY GLYPH in the font that draws it -
// so what pdf.js, poppler and Quick Look paint is what the print paints. A box
// whose text fits inside it is untouched: same /Rect, same /BBox, same stream.
//
// Everything below drives the app's REAL writers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { PNG } from 'pngjs';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

let napiCanvas = null;
let pdfjsLib = null;
try { napiCanvas = await import('@napi-rs/canvas'); } catch { napiCanvas = null; }
try { pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch { pdfjsLib = null; }

const PAGE = { width: 420, height: 320 };
const SCALE = 3;
const RASTER_DPI = 72 * SCALE;
const tmp = mkdtempSync(join(tmpdir(), 'freetext-glyph-overflow-'));

const EMOJI = '\u{1F642}'; // 🙂 - NotoEmoji advances ~1.27 em, wider than one em
const CJK_ROOF = '屋'; // 屋
const CJK_IRON = '鉄'; // 鉄

// ---------------------------------------------------------------------------
// The app's writers
// ---------------------------------------------------------------------------
const pageFile = async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE.width, PAGE.height]);
  page.setMediaBox(0, 0, PAGE.width, PAGE.height);
  page.setCropBox(0, 0, PAGE.width, PAGE.height);
  const bytes = await source.save();
  return {
    name: 'frame.pdf',
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

const exportAnnotated = async ({ objects = [], callouts = [] }) => quiet(() => withWindow(async () => (
  savePDFWithAnnotationsPdfLib(
    await pageFile(), { 1: { objects } }, { 1: PAGE }, null,
    {
      returnBytes: true, actionType: 'pdf-export', documentId: 'freetext-glyph-overflow', callouts,
    },
  )
)));

const printFlattened = async ({ objects = [], callouts = [] }) => quiet(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await pageFile(), { 1: { objects } }, { 1: PAGE },
    {
      returnBytes: true, actionType: 'pdf-print', documentId: 'freetext-glyph-overflow', callouts,
    },
  )
)));

// ---------------------------------------------------------------------------
// Reading the exported dicts
// ---------------------------------------------------------------------------
const annotDicts = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return { doc, dicts: [] };
  return {
    doc,
    dicts: annots.asArray().map((ref) => doc.context.lookup(ref)).filter((entry) => entry instanceof PDFDict),
  };
};

const numbers = (doc, value) => {
  const resolved = doc.context.lookup(value);
  if (!(resolved instanceof PDFArray)) return null;
  return resolved.asArray().map((entry) => doc.context.lookup(entry).asNumber());
};

const appearanceForm = (doc, dict) => {
  const ap = doc.context.lookup(dict.get(PDFName.of('AP')));
  if (!(ap instanceof PDFDict)) return null;
  const normal = doc.context.lookup(ap.get(PDFName.of('N')));
  return normal?.dict instanceof PDFDict ? normal : null;
};

// /BBox mapped through the form's /Matrix, then framed - what the viewer fits
// into /Rect. A pure translation fit means the ink lands where the print puts
// it, at the size the print draws it.
const transformedBBox = (doc, form) => {
  const box = numbers(doc, form.dict.get(PDFName.of('BBox')));
  const matrix = numbers(doc, form.dict.get(PDFName.of('Matrix'))) || [1, 0, 0, 1, 0, 0];
  const [a, b, c, d, e, f] = matrix;
  const corners = [
    [box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

// The base box /RD points back to, in PDF page space (y-up).
const baseRectFromRD = (rect, rd) => [
  rect[0] + rd[0],
  rect[1] + rd[3],
  rect[2] - rd[2],
  rect[3] - rd[1],
];

// ---------------------------------------------------------------------------
// Rasters: what a reader actually paints
// ---------------------------------------------------------------------------
const has = (command) => spawnSync('which', [command], { encoding: 'utf8' }).status === 0;

const inkStats = (png) => {
  if (!png) return null;
  let count = 0; let sumX = 0; let sumY = 0;
  // The ink's own bounding box, in raster points. A /BBox is a rectangular
  // CLIP, so when it cuts, it cuts an EDGE - which makes this box, not the
  // pixel count, the direct proof that nothing was clipped.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const alpha = png.data[index + 3] / 255;
      const channel = (offset) => png.data[index + offset] * alpha + 255 * (1 - alpha);
      if (255 - Math.min(channel(0), channel(1), channel(2)) < 40) continue;
      count += 1; sumX += x; sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return count === 0 ? null : {
    count,
    centroid: { x: sumX / count / SCALE, y: sumY / count / SCALE },
    box: [minX / SCALE, minY / SCALE, (maxX + 1) / SCALE, (maxY + 1) / SCALE],
  };
};

const rasterPoppler = (bytes, label) => {
  const pdfPath = join(tmp, `${label}.pdf`);
  writeFileSync(pdfPath, bytes);
  const result = spawnSync('pdftoppm', ['-r', String(RASTER_DPI), '-cropbox', '-png', '-singlefile', pdfPath, join(tmp, label)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return PNG.sync.read(readFileSync(join(tmp, `${label}.png`)));
};

// macOS Quick Look / Quartz paints appearance streams and nothing else, so a
// /BBox that clips is a /BBox it obeys to the pixel. qlmanage does NOT create
// its -o directory - it exits 0 and writes nothing - so the mkdir is what
// keeps this lane from silently asserting on an empty raster.
const rasterQuartz = (bytes, label) => {
  const pdfPath = join(tmp, `${label}.ql.pdf`);
  writeFileSync(pdfPath, bytes);
  const outDir = join(tmp, `_ql-${label}`);
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync('qlmanage', ['-t', '-s', String(Math.max(PAGE.width, PAGE.height) * SCALE), '-o', outDir, pdfPath], { encoding: 'utf8' });
  const produced = join(outDir, `${label}.ql.pdf.png`);
  if (result.status !== 0 || !existsSync(produced)) return null;
  return PNG.sync.read(readFileSync(produced));
};

const rasterPdfjs = async (bytes) => {
  if (!napiCanvas || !pdfjsLib) return null;
  const task = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = napiCanvas.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
    return PNG.sync.read(canvas.toBuffer('image/png'));
  } finally {
    await task.destroy();
  }
};

const compareLanes = async (label, payload) => {
  const annotated = await exportAnnotated(payload);
  const printed = await printFlattened(payload);
  const lanes = {};
  if (has('pdftoppm')) {
    lanes.poppler = [
      inkStats(rasterPoppler(annotated, `${label}-ap`)),
      inkStats(rasterPoppler(printed, `${label}-print`)),
    ];
  }
  const annotatedPdfjs = await rasterPdfjs(annotated);
  const printedPdfjs = await rasterPdfjs(printed);
  if (annotatedPdfjs && printedPdfjs) {
    lanes.pdfjs = [inkStats(annotatedPdfjs), inkStats(printedPdfjs)];
  }
  if (has('qlmanage')) {
    const annotatedQuartz = rasterQuartz(annotated, `${label}-ap`);
    const printedQuartz = rasterQuartz(printed, `${label}-print`);
    if (annotatedQuartz && printedQuartz) {
      lanes.quartz = [inkStats(annotatedQuartz), inkStats(printedQuartz)];
    }
  }
  return { lanes, annotated };
};

// Anti-aliasing between the same operators inside an /AP form and inlined in a
// page content stream moves a handful of edge pixels; a clipped glyph moves
// 3.7% to 22.8% of them (the table at the top of this file).
const INK_COUNT_TOLERANCE = 0.01;
const CENTROID_TOLERANCE_PT = 0.5;

const assertPaintsWhatThePrintPaints = (label, lanes) => {
  assert.ok(Object.keys(lanes).length > 0, `${label}: at least one renderer lane must run`);
  if (has('qlmanage')) {
    assert.ok(lanes.quartz, `${label}: qlmanage is installed, so the Quartz lane must have rastered`);
  }
  for (const [lane, [annotated, printed]] of Object.entries(lanes)) {
    assert.ok(printed, `${label}/${lane}: the flattened print must draw ink`);
    assert.ok(annotated, `${label}/${lane}: the exported annotation must show ink`);
    assert.ok(
      Math.abs(annotated.count - printed.count) <= printed.count * INK_COUNT_TOLERANCE,
      `${label}/${lane}: the appearance paints ${annotated.count} ink pixels against the print's `
        + `${printed.count} (${(100 * (printed.count - annotated.count) / printed.count).toFixed(2)}% cut by the /BBox)`,
    );
    const centroid = Math.hypot(
      annotated.centroid.x - printed.centroid.x,
      annotated.centroid.y - printed.centroid.y,
    );
    assert.ok(
      centroid <= CENTROID_TOLERANCE_PT,
      `${label}/${lane}: ink centroid ${centroid.toFixed(3)}pt from the print's - a cut on one edge moves it`,
    );
  }
};

// A clip always insets an EDGE of the ink, so the appearance's ink box has to
// hold the print's on all four sides. One raster pixel of slack absorbs the
// antialiasing difference between operators inside an /AP form and the same
// operators inlined in a page content stream; a clip costs whole points
// (2.3pt off Courier's tails, 12pt off an oblique 'W').
const EDGE_SLACK_PT = 1 / SCALE + 1e-9;
// What "0% ink cut" means against a rasteriser: the two lanes differ only by
// that same antialiasing, never by the 1.1% - 7.7% the clip used to cost.
const ZERO_CUT_TOLERANCE = 0.002;

const assertNothingClipped = (label, lanes) => {
  assert.ok(Object.keys(lanes).length > 0, `${label}: at least one renderer lane must run`);
  if (has('qlmanage')) {
    assert.ok(lanes.quartz, `${label}: qlmanage is installed, so the Quartz lane must have rastered`);
  }
  for (const [lane, [annotated, printed]] of Object.entries(lanes)) {
    assert.ok(printed, `${label}/${lane}: the flattened print must draw ink`);
    assert.ok(annotated, `${label}/${lane}: the exported annotation must show ink`);
    // How far the appearance's ink stops SHORT of the print's, per edge.
    const edges = [
      ['left', annotated.box[0] - printed.box[0]],
      ['top', annotated.box[1] - printed.box[1]],
      ['right', printed.box[2] - annotated.box[2]],
      ['bottom', printed.box[3] - annotated.box[3]],
    ];
    for (const [edge, inset] of edges) {
      assert.ok(
        inset <= EDGE_SLACK_PT,
        `${label}/${lane}: the appearance's ink stops ${inset.toFixed(3)}pt short of the print's on the `
          + `${edge} edge - the /AP /BBox is clipping the glyph (print box `
          + `${printed.box.map((value) => value.toFixed(2)).join(' ')}, appearance box `
          + `${annotated.box.map((value) => value.toFixed(2)).join(' ')})`,
      );
    }
    assert.ok(
      printed.count - annotated.count <= printed.count * ZERO_CUT_TOLERANCE,
      `${label}/${lane}: the appearance paints ${annotated.count} ink pixels against the print's `
        + `${printed.count} (${(100 * (printed.count - annotated.count) / printed.count).toFixed(2)}% cut)`,
    );
  }
};

const freeText = (overrides) => ({
  id: 'note-overflow',
  type: 'textbox',
  fill: '#111111',
  stroke: 'transparent',
  strokeWidth: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1-2. The two plain text boxes that lost ink
// ---------------------------------------------------------------------------
const OVERFLOW_BOXES = {
  // 22.8% of the glyph was cut off the RIGHT edge.
  'an emoji wider than its box': freeText({
    left: 60, top: 120, width: 20, height: 46, text: EMOJI, fontSize: 28,
  }),
  // A right-aligned line that does not fit starts LEFT of the box, so the cut
  // lands on the left edge - the mirror case, and the one a right-to-left or
  // right-aligned note hits.
  'a right-aligned CJK glyph wider than its box': freeText({
    left: 200, top: 120, width: 18, height: 44, text: CJK_ROOF, fontSize: 26, textAlign: 'right',
  }),
};

for (const [label, object] of Object.entries(OVERFLOW_BOXES)) {
  test(`${label} is painted whole by the exported appearance`, async () => {
    const { lanes } = await compareLanes(label.replace(/\s+/g, '-'), { objects: [object] });
    assertPaintsWhatThePrintPaints(label, lanes);
  });

  test(`${label} keeps a translation-only /BBox fit and an /RD back to the box the user drew`, async () => {
    const { doc, dicts } = await annotDicts(await exportAnnotated({ objects: [object] }));
    assert.equal(dicts.length, 1, `${label}: the note must reach the exported file`);
    const form = appearanceForm(doc, dicts[0]);
    assert.ok(form, `${label}: the note must carry an /AP /N form`);
    const rect = numbers(doc, dicts[0].get(PDFName.of('Rect')));
    const mapped = transformedBBox(doc, form);
    for (let index = 0; index < 4; index += 1) {
      assert.ok(
        Math.abs(rect[index] - mapped[index]) < 0.01,
        `${label}: /Rect[${index}] ${rect[index]} vs transformed /BBox ${mapped[index]} - the grown box must still fit as a pure translation`,
      );
    }
    // Growing the appearance box must not lose where the user's box was: the
    // importer rebuilds the textbox from /Rect less /RD.
    const rd = numbers(doc, dicts[0].get(PDFName.of('RD')));
    assert.ok(Array.isArray(rd) && rd.length === 4, `${label}: /RD must be written`);
    assert.ok(rd.every((value) => value >= 0), `${label}: /RD insets must never go negative`);
    const authored = [
      object.left,
      PAGE.height - (object.top + object.height),
      object.left + object.width,
      PAGE.height - object.top,
    ];
    baseRectFromRD(rect, rd).forEach((value, index) => {
      assert.ok(
        Math.abs(value - authored[index]) < 0.01,
        `${label}: /Rect less /RD gives ${value} for edge ${index}, not the authored ${authored[index]}`,
      );
    });
  });
}

// The right-aligned cut ran LEFT, so pin the direction: the appearance box has
// to reach further left than the box the user drew.
test('the box grows on the side the overflow actually runs to', async () => {
  const object = OVERFLOW_BOXES['a right-aligned CJK glyph wider than its box'];
  const { doc, dicts } = await annotDicts(await exportAnnotated({ objects: [object] }));
  const rect = numbers(doc, dicts[0].get(PDFName.of('Rect')));
  const rd = numbers(doc, dicts[0].get(PDFName.of('RD')));
  assert.ok(
    rd[0] > rd[2] + 1,
    `a right-aligned overflow must grow the LEFT inset past the right one (got /RD ${JSON.stringify(rd)})`,
  );
  assert.ok(
    rect[0] < object.left - 10.35,
    `the appearance box must reach left of the old fontSize*0.35 pad (got ${rect[0]}, pad edge ${object.left - 10.35})`,
  );
});

// ---------------------------------------------------------------------------
// 3. The same clip on a callout's label - the other appearance box
// ---------------------------------------------------------------------------
const NARROW_CALLOUT = {
  id: 'callout-overflow',
  pageNumber: 1,
  arrowTip: { x: 0.74, y: 0.26 },
  knee: { x: 0.54, y: 0.5 },
  textBoxPosition: { x: 0.10, y: 0.45 },
  textBoxWidth: 0.05,
  textBoxHeight: 0.16,
  text: CJK_ROOF,
  style: {
    borderColor: '#c42747',
    fontColor: '#1e293b',
    backgroundColor: '#ffffff',
    fontSize: 30,
    lineThickness: 2,
  },
};

test("a callout label wider than its box is painted whole by the exported appearance", async () => {
  const { lanes } = await compareLanes('callout-narrow', { callouts: [NARROW_CALLOUT] });
  assertPaintsWhatThePrintPaints('callout label', lanes);
});

test('the callout text part still fits its /Rect as a pure translation', async () => {
  const { doc, dicts } = await annotDicts(await exportAnnotated({ callouts: [NARROW_CALLOUT] }));
  assert.equal(dicts.length, 3, 'a callout exports its leader, its arrow leader and its text box');
  const texts = dicts.filter((dict) => String(dict.get(PDFName.of('Subtype'))) === '/FreeText');
  assert.equal(texts.length, 1, 'exactly one callout part is the /FreeText label');
  const form = appearanceForm(doc, texts[0]);
  assert.ok(form, 'the callout label must carry an /AP /N form');
  const rect = numbers(doc, texts[0].get(PDFName.of('Rect')));
  const mapped = transformedBBox(doc, form);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(
      Math.abs(rect[index] - mapped[index]) < 0.01,
      `callout label: /Rect[${index}] ${rect[index]} vs transformed /BBox ${mapped[index]}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Italic overhang and real descenders
//
// The same clip, from the two things a line's ADVANCE WIDTH and a font's
// NOMINAL DESCENDER cannot describe:
//
//   - a slanted face's ink leans PAST its advance. Times-Italic's FontBBox
//     reaches 1010/1000 em against a 833 'W' advance; Helvetica-Oblique's
//     reaches 1116 against 944. Reachable from the Italic toggle, the
//     formatItalic toolbar action and callout italic.
//   - real tails run deeper than the nominal descender. Courier says
//     Descender -157/1000 em; its FontBBox bottom is -250. Reachable from the
//     font picker.
//
// Measured on this 420 x 320 page at 216 dpi, dark >= 40 (ink pixels,
// print vs the round-8 export, and the edge the /BBox cut):
//
//   case                                lane      print   round 8      cut
//   Times-Italic 'W' 46pt / 10pt box    poppler    3732      3639    2.49%  right
//                                       pdf.js     3663      3576    2.38%  right
//                                       Quartz     3322      3277    1.35%  right
//   Helvetica-Oblique 'W' 90pt          Quartz    18507     17144    7.36%  right
//   Courier New 'gjpqy' 70pt / 320x24   poppler   28254     26422    6.48%  bottom
//                                       pdf.js    27996     25847    7.68%  bottom
//                                       Quartz    28277     26449    6.46%  bottom
//   Times New Roman 'gjpqy' 50pt        pdf.js    11376     11251    1.10%  bottom
//   Times-BoldItalic 'W' 46pt           pdf.js     5300      5186    2.15%  right
//
// The last row is why a slanted standard-14 face gets more room than its own
// FontBBox: a reader with no copy of the face substitutes a metric-compatible
// one whose slant is its own, and pdf.js's Times-BoldItalic stand-in paints
// 0.09 em past the AFM box.
// ---------------------------------------------------------------------------
const GLYPH_REACH_BOXES = {
  // A. The two measured italic/oblique cases.
  "Times-Italic 'W' at 46pt in a 10pt-wide box": freeText({
    id: 'note-times-italic',
    left: 60, top: 120, width: 10, height: 60, text: 'W', fontSize: 46,
    fontFamily: 'Times New Roman', fontStyle: 'italic',
  }),
  "Helvetica-Oblique 'W' at 90pt": freeText({
    id: 'note-helvetica-oblique',
    left: 60, top: 100, width: 14, height: 110, text: 'W', fontSize: 90,
    fontFamily: 'Helvetica', fontStyle: 'italic',
  }),
  // B. The two measured descender cases.
  "Courier New 'gjpqy' at 70pt in a 320 x 24 box": freeText({
    id: 'note-courier-tails',
    left: 40, top: 120, width: 320, height: 24, text: 'gjpqy', fontSize: 70,
    fontFamily: 'Courier New',
  }),
  "Times New Roman 'gjpqy' at 50pt": freeText({
    id: 'note-times-tails',
    left: 40, top: 120, width: 320, height: 24, text: 'gjpqy', fontSize: 50,
    fontFamily: 'Times New Roman',
  }),
  // C. Bold-italic: both defects at once, and the face whose renderer
  // substitute leans furthest past its own metrics.
  "Times-BoldItalic 'W' at 46pt": freeText({
    id: 'note-times-bold-italic',
    left: 60, top: 120, width: 10, height: 60, text: 'W', fontSize: 46,
    fontFamily: 'Times New Roman', fontStyle: 'italic', fontWeight: 'bold',
  }),
  'Helvetica-BoldOblique at 64pt': freeText({
    id: 'note-helvetica-bold-oblique',
    left: 60, top: 110, width: 12, height: 80, text: 'W', fontSize: 64,
    fontStyle: 'italic', fontWeight: 'bold',
  }),
  "Courier-Oblique 'gjpqy' at 56pt - lean and tails together": freeText({
    id: 'note-courier-oblique-tails',
    left: 40, top: 120, width: 60, height: 24, text: 'gjpqy', fontSize: 56,
    fontFamily: 'Courier New', fontStyle: 'italic',
  }),
  // D. The decoration spans drawFlattenedText paints on the same line.
  'an italic span with underline and strikethrough': freeText({
    id: 'note-italic-decorated',
    left: 40, top: 110, width: 40, height: 40, text: 'Wgy', fontSize: 40,
    fontFamily: 'Times New Roman', fontStyle: 'italic', underline: true, linethrough: true,
  }),
  // E. Alignment decides which way the overflow runs, so pin both.
  'a right-aligned italic glyph - the overhang runs left': freeText({
    id: 'note-italic-right',
    left: 220, top: 120, width: 12, height: 60, text: 'W', fontSize: 46,
    fontFamily: 'Times New Roman', fontStyle: 'italic', textAlign: 'right',
  }),
  'a centred italic glyph - the overhang runs both ways': freeText({
    id: 'note-italic-centre',
    left: 180, top: 120, width: 12, height: 60, text: 'W', fontSize: 46,
    fontStyle: 'italic', textAlign: 'center',
  }),
};

for (const [label, object] of Object.entries(GLYPH_REACH_BOXES)) {
  test(`${label} is painted whole by the exported appearance`, async () => {
    const { lanes } = await compareLanes(
      String(object.id), { objects: [object] },
    );
    assertNothingClipped(label, lanes);
    assertPaintsWhatThePrintPaints(label, lanes);
  });

  test(`${label} keeps a translation-only /BBox fit and a non-negative /RD`, async () => {
    const { doc, dicts } = await annotDicts(await exportAnnotated({ objects: [object] }));
    assert.equal(dicts.length, 1, `${label}: the note must reach the exported file`);
    const form = appearanceForm(doc, dicts[0]);
    assert.ok(form, `${label}: the note must carry an /AP /N form`);
    const rect = numbers(doc, dicts[0].get(PDFName.of('Rect')));
    const mapped = transformedBBox(doc, form);
    for (let index = 0; index < 4; index += 1) {
      assert.ok(
        Math.abs(rect[index] - mapped[index]) < 0.01,
        `${label}: /Rect[${index}] ${rect[index]} vs transformed /BBox ${mapped[index]} - the grown box must still fit as a pure translation`,
      );
    }
    const rd = numbers(doc, dicts[0].get(PDFName.of('RD')));
    assert.ok(Array.isArray(rd) && rd.length === 4, `${label}: /RD must be written`);
    assert.ok(rd.every((value) => value >= 0), `${label}: /RD insets must never go negative`);
    const authored = [
      object.left,
      PAGE.height - (object.top + object.height),
      object.left + object.width,
      PAGE.height - object.top,
    ];
    baseRectFromRD(rect, rd).forEach((value, index) => {
      assert.ok(
        Math.abs(value - authored[index]) < 0.01,
        `${label}: /Rect less /RD gives ${value} for edge ${index}, not the authored ${authored[index]}`,
      );
    });
  });
}

// Three more shapes of the same two defects, each measured cut on round 8
// (print vs export, poppler / pdf.js / Quartz). A rotated box carries a
// /Matrix rather than a pure translation, and a bordered one has a stroke in
// its padding, so these are judged on the paint alone.
//
//   a bottom-aligned Courier line, tails below the box   5.36% / 3.89% / 5.36%
//   a rotated italic glyph                               1.96% / 0.00% / 1.50%
//   a bordered italic box                                1.27% / 1.13% / 0.62%
const GLYPH_REACH_PAINT_ONLY = {
  'a bottom-aligned Courier line whose tails fall below the box': freeText({
    id: 'note-courier-valign-bottom',
    left: 40, top: 100, width: 300, height: 30, text: 'gjpqy', fontSize: 48,
    fontFamily: 'Courier New', verticalAlign: 'bottom',
  }),
  'a rotated italic glyph': freeText({
    id: 'note-italic-rotated',
    left: 120, top: 110, width: 16, height: 70, text: 'W', fontSize: 50,
    fontFamily: 'Times New Roman', fontStyle: 'italic', angle: 30,
  }),
  'a bordered italic box': freeText({
    id: 'note-italic-bordered',
    left: 60, top: 120, width: 14, height: 60, text: 'W', fontSize: 46,
    fontFamily: 'Times New Roman', fontStyle: 'italic',
    stroke: '#c42747', strokeWidth: 3, backgroundColor: '#ffffff',
  }),
};

for (const [label, object] of Object.entries(GLYPH_REACH_PAINT_ONLY)) {
  test(`${label} is painted whole by the exported appearance`, async () => {
    const { lanes } = await compareLanes(String(object.id), { objects: [object] });
    assertNothingClipped(label, lanes);
    assertPaintsWhatThePrintPaints(label, lanes);
  });
}

// The lean has a direction: a left-aligned slanted glyph grows the box to the
// RIGHT of the advance, a right-aligned one to the LEFT of the box.
test('an italic overhang grows the box on the side the slant runs to', async () => {
  const leftAligned = GLYPH_REACH_BOXES["Times-Italic 'W' at 46pt in a 10pt-wide box"];
  const { doc, dicts } = await annotDicts(await exportAnnotated({ objects: [leftAligned] }));
  const rect = numbers(doc, dicts[0].get(PDFName.of('Rect')));
  // Where the advance alone stopped - the round-8 /Rect right edge, to the
  // hundredth: the pen starts a 6pt padding in, the 'W' advances 833/1000 em,
  // and the appearance box added its quarter-point.
  const advanceEdge = leftAligned.left + 6 + (833 / 1000) * 46 + 0.25;
  assert.ok(
    Math.abs(advanceEdge - 104.568) < 0.01,
    `the advance-only edge must be the round-8 number 104.568 (computed ${advanceEdge})`,
  );
  assert.ok(
    rect[2] > advanceEdge + 1,
    `the appearance box must reach past the advance-only edge ${advanceEdge.toFixed(3)} (got ${rect[2]})`,
  );

  const rightAligned = GLYPH_REACH_BOXES['a right-aligned italic glyph - the overhang runs left'];
  const right = await annotDicts(await exportAnnotated({ objects: [rightAligned] }));
  const rightRd = numbers(right.doc, right.dicts[0].get(PDFName.of('RD')));
  assert.ok(
    rightRd[0] > rightRd[2],
    `a right-aligned overflow must grow the LEFT inset past the right one (got /RD ${JSON.stringify(rightRd)})`,
  );
});

// The real tails have to clear the nominal descender by the amount the AFM
// FontBBox says they do - 0.093 em for Courier, which is the 2.3pt that was
// being shaved off 'gjpqy' at 70pt.
test("Courier's appearance box clears the nominal descender by the FontBBox depth", async () => {
  const object = GLYPH_REACH_BOXES["Courier New 'gjpqy' at 70pt in a 320 x 24 box"];
  const { doc, dicts } = await annotDicts(await exportAnnotated({ objects: [object] }));
  const rect = numbers(doc, dicts[0].get(PDFName.of('Rect')));
  // drawFlattenedText's baseline for a single line: top + padding + fontSize.
  const baselineAppY = object.top + 6 + object.fontSize;
  const nominalBottomAppY = baselineAppY + (157 / 1000) * object.fontSize;
  const realBottomAppY = baselineAppY + (250 / 1000) * object.fontSize;
  // PDF space is y-up, so the box's bottom edge is the LOWEST /Rect number.
  const boxBottomAppY = PAGE.height - rect[1];
  assert.ok(
    boxBottomAppY >= realBottomAppY,
    `the box bottom ${boxBottomAppY.toFixed(2)} must clear the FontBBox tails at ${realBottomAppY.toFixed(2)}`,
  );
  assert.ok(
    boxBottomAppY > nominalBottomAppY + 6,
    `the box bottom ${boxBottomAppY.toFixed(2)} must sit well below the nominal descender at ${nominalBottomAppY.toFixed(2)}`,
  );
});

// ---------------------------------------------------------------------------
// 5. The slant on a callout's label - italic is a callout style too
// ---------------------------------------------------------------------------
const ITALIC_CALLOUT = {
  id: 'callout-italic',
  pageNumber: 1,
  arrowTip: { x: 0.74, y: 0.26 },
  knee: { x: 0.54, y: 0.5 },
  textBoxPosition: { x: 0.10, y: 0.45 },
  textBoxWidth: 0.04,
  textBoxHeight: 0.18,
  text: 'W',
  style: {
    borderColor: '#c42747',
    fontColor: '#1e293b',
    backgroundColor: '#ffffff',
    fontSize: 44,
    lineThickness: 2,
    italic: true,
  },
};

test('an italic callout label is painted whole by the exported appearance', async () => {
  const { lanes } = await compareLanes('callout-italic', { callouts: [ITALIC_CALLOUT] });
  assertNothingClipped('italic callout label', lanes);
  assertPaintsWhatThePrintPaints('italic callout label', lanes);
});

test('the italic callout text part still fits its /Rect as a pure translation', async () => {
  const { doc, dicts } = await annotDicts(await exportAnnotated({ callouts: [ITALIC_CALLOUT] }));
  const texts = dicts.filter((dict) => String(dict.get(PDFName.of('Subtype'))) === '/FreeText');
  assert.equal(texts.length, 1, 'exactly one callout part is the /FreeText label');
  const form = appearanceForm(doc, texts[0]);
  assert.ok(form, 'the italic callout label must carry an /AP /N form');
  const rect = numbers(doc, texts[0].get(PDFName.of('Rect')));
  const mapped = transformedBBox(doc, form);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(
      Math.abs(rect[index] - mapped[index]) < 0.01,
      `italic callout label: /Rect[${index}] ${rect[index]} vs transformed /BBox ${mapped[index]}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The other half of the contract: a box whose text fits does not move
// ---------------------------------------------------------------------------
const FITTING_BOXES = {
  'an ordinary Latin note': freeText({
    id: 'note-fits',
    left: 40, top: 40, width: 260, height: 60, text: 'Bay 3 check', fontSize: 14,
  }),
  // Centred CJK overflows its inner width by less than the historic pad, so
  // even a box the fix inspects closely must come out at the same numbers.
  'a centred CJK glyph inside the historic pad': freeText({
    id: 'note-centred',
    left: 180, top: 200, width: 16, height: 44, text: CJK_IRON, fontSize: 26, textAlign: 'center',
  }),
  // The two faces whose measurement changed. An ordinary italic note still
  // leans, and an ordinary Courier note still has its real tails - but both
  // sit inside a roomy box, so both must come out at the historic numbers to
  // 1e-9. This is the guard that says the fix costs nothing on normal text.
  'an ordinary italic note': freeText({
    id: 'note-italic-fits',
    left: 40, top: 40, width: 260, height: 60, text: 'Bay 3 check', fontSize: 14, fontStyle: 'italic',
  }),
  'an ordinary Courier note': freeText({
    id: 'note-courier-fits',
    left: 40, top: 40, width: 260, height: 60, text: 'Bay 3 check', fontSize: 14, fontFamily: 'Courier New',
  }),
};

for (const [label, object] of Object.entries(FITTING_BOXES)) {
  test(`${label} keeps exactly the appearance box it always had`, async () => {
    const { doc, dicts } = await annotDicts(await exportAnnotated({ objects: [object] }));
    assert.equal(dicts.length, 1, `${label}: the note must reach the exported file`);
    const rect = numbers(doc, dicts[0].get(PDFName.of('Rect')));
    // The historic formula, unchanged: half the stroke (zero here) plus the
    // extra pad, plus a third of an em, plus 1.
    const pad = 0.25 + Math.max(4, object.fontSize) * 0.35 + 1;
    const expected = [
      object.left - pad,
      PAGE.height - (object.top + object.height) - pad,
      object.left + object.width + pad,
      PAGE.height - object.top + pad,
    ];
    expected.forEach((value, index) => {
      assert.ok(
        Math.abs(rect[index] - value) < 1e-9,
        `${label}: /Rect[${index}] moved to ${rect[index]} from the historic ${value}`,
      );
    });
    const form = appearanceForm(doc, dicts[0]);
    assert.ok(form, `${label}: the note must carry an /AP /N form`);
    numbers(doc, form.dict.get(PDFName.of('BBox'))).forEach((value, index) => {
      assert.ok(
        Math.abs(value - expected[index]) < 1e-9,
        `${label}: /BBox[${index}] moved to ${value} from the historic ${expected[index]}`,
      );
    });
  });

  test(`${label} paints what the print paints`, async () => {
    const { lanes } = await compareLanes(label.replace(/\s+/g, '-'), { objects: [object] });
    assertPaintsWhatThePrintPaints(label, lanes);
  });
}

// ---------------------------------------------------------------------------
// Round-trip: a grown appearance box must not move the note the app reads back
// ---------------------------------------------------------------------------
const reimport = async (bytes) => {
  if (!pdfjsLib) return null;
  const task = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  try {
    return await quiet(() => withWindow(() => importAnnotationsFromPdf(doc, { rawPdfBytes: bytes })));
  } finally {
    await task.destroy();
  }
};

for (const [label, object] of Object.entries({
  ...OVERFLOW_BOXES,
  // The slant allowance grows the box by up to 0.3 em on each side, which is
  // the most an ordinary note's /Rect ever moves - so it is the case most
  // likely to leak into the geometry the app reads back.
  "Times-Italic 'W' at 46pt in a 10pt-wide box":
    GLYPH_REACH_BOXES["Times-Italic 'W' at 46pt in a 10pt-wide box"],
  'a right-aligned italic glyph - the overhang runs left':
    GLYPH_REACH_BOXES['a right-aligned italic glyph - the overhang runs left'],
  "Courier New 'gjpqy' at 70pt in a 320 x 24 box":
    GLYPH_REACH_BOXES["Courier New 'gjpqy' at 70pt in a 320 x 24 box"],
})) {
  test(`${label} re-imports at the box the user drew, not the grown one`, async (t) => {
    const imported = await reimport(await exportAnnotated({ objects: [object] }));
    if (!imported) return t.skip('pdfjs-dist is not installed in this checkout');
    const objects = imported.annotationsByPage?.[1]?.objects || [];
    const box = objects.find((entry) => /textbox|text|i-text/i.test(String(entry?.type || '')));
    assert.ok(box, `${label}: the note must come back as a text box`);
    for (const [field, expected] of [['left', object.left], ['top', object.top], ['width', object.width], ['height', object.height]]) {
      assert.ok(
        Math.abs(Number(box[field]) - expected) < 0.5,
        `${label}: re-imported ${field} ${box[field]} is not the authored ${expected} - the /BBox growth leaked into the geometry`,
      );
    }
  });
}
