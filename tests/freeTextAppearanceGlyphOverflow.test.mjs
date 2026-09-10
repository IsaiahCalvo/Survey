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
// THE CONTRACT. The appearance box is measured from the ACTUAL drawn text -
// the laid-out runs, each measured in the font that draws it - so what
// pdf.js, poppler and Quick Look paint is what the print paints. A box whose
// text fits inside it is untouched: same /Rect, same /BBox, same stream.
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
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const alpha = png.data[index + 3] / 255;
      const channel = (offset) => png.data[index + offset] * alpha + 255 * (1 - alpha);
      if (255 - Math.min(channel(0), channel(1), channel(2)) < 40) continue;
      count += 1; sumX += x; sumY += y;
    }
  }
  return count === 0 ? null : { count, centroid: { x: sumX / count / SCALE, y: sumY / count / SCALE } };
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

for (const [label, object] of Object.entries(OVERFLOW_BOXES)) {
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
