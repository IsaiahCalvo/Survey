// Callouts and text markups had no /AP (2026-09-10, export round 7).
//
// THE DEFECT. createCalloutAnnotations stamps `isCalloutPart: true`, which
// makes createLineAnnotation and createFreeTextAnnotation skip
// applyPlainShapeAppearanceToDict; buildTextMarkupDict never built an
// appearance at all. So a callout (leader + arrowhead + text box) and every
// text markup (highlight / underline / strikeout / squiggly) shipped with NO
// appearance stream, while the flattened print drew all of them. Measured on
// main, a 320x240 page, ink pixels at 288 dpi:
//
//   callout          annotated: quartz 0     print: quartz 10781
//   markup-highlight annotated: quartz 0     print: quartz 97920
//   markup-underline annotated: poppler 6808 print: poppler  5440
//   markup-squiggly  annotated: poppler 11740 print: poppler 7756
//
// macOS Preview / Quick Look paint ONLY what an appearance stream says, so
// they showed nothing; poppler improvised its own mark from /QuadPoints and
// drew a heavier underline and a denser squiggle than the app.
//
// THE CONTRACT. Each callout part carries its own /AP /N built from the SAME
// draw the print runs (calloutFlattenParts), so the composite of the three is
// the print piece for piece; each text markup carries the print's own mark.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { PNG } from 'pngjs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

let napiCanvas = null;
try { napiCanvas = await import('@napi-rs/canvas'); } catch { napiCanvas = null; }

const SCALE = 3;
const STROKE = '#c42747';
const tmp = mkdtempSync(join(tmpdir(), 'callout-markup-ap-'));

const FRAMES = {
  base: { mediaBox: [0, 0, 420, 320], app: { width: 420, height: 320 } },
  rot90: { mediaBox: [0, 0, 420, 320], rotate: 90, app: { width: 320, height: 420 } },
  offset: { mediaBox: [80, 40, 500, 360], app: { width: 420, height: 320 } },
};

const frameFile = async (frame) => {
  const source = await PDFDocument.create();
  const [x0, y0, x1, y1] = frame.mediaBox;
  const page = source.addPage([x1 - x0, y1 - y0]);
  page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
  page.setCropBox(x0, y0, x1 - x0, y1 - y0);
  if (frame.rotate) page.node.set(PDFName.of('Rotate'), source.context.obj(frame.rotate));
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

const exportAnnotated = async (frame, { objects = [], callouts = [] }) => quiet(() => withWindow(async () => (
  savePDFWithAnnotationsPdfLib(
    await frameFile(frame), { 1: { objects } }, { 1: frame.app }, null,
    {
      returnBytes: true, actionType: 'pdf-export', documentId: 'callout-markup-ap', callouts,
    },
  )
)));

const printFlattened = async (frame, { objects = [], callouts = [] }) => quiet(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await frameFile(frame), { 1: { objects } }, { 1: frame.app },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'callout-markup-ap', callouts },
  )
)));

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
  return resolved instanceof PDFArray ? resolved.asArray().map((entry) => doc.context.lookup(entry).asNumber()) : null;
};

const appearanceForm = (doc, dict) => {
  const ap = doc.context.lookup(dict.get(PDFName.of('AP')));
  if (!(ap instanceof PDFDict)) return null;
  const form = doc.context.lookup(ap.get(PDFName.of('N')));
  return form?.dict instanceof PDFDict ? form : null;
};

const applyMatrix = (matrix, x, y) => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5],
});

/** The user-space box the viewer maps an /AP /N /BBox onto. */
const transformedBBox = (doc, form) => {
  const bbox = numbers(doc, form.dict.get(PDFName.of('BBox')));
  const matrix = numbers(doc, form.dict.get(PDFName.of('Matrix'))) || [1, 0, 0, 1, 0, 0];
  const corners = [
    applyMatrix(matrix, bbox[0], bbox[1]),
    applyMatrix(matrix, bbox[2], bbox[1]),
    applyMatrix(matrix, bbox[2], bbox[3]),
    applyMatrix(matrix, bbox[0], bbox[3]),
  ];
  return [
    Math.min(...corners.map((point) => point.x)),
    Math.min(...corners.map((point) => point.y)),
    Math.max(...corners.map((point) => point.x)),
    Math.max(...corners.map((point) => point.y)),
  ];
};

const has = (command) => spawnSync('which', [command], { encoding: 'utf8' }).status === 0;

const inkStats = (png) => {
  let count = 0; let sumX = 0; let sumY = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const alpha = png.data[index + 3] / 255;
      const channel = (offset) => png.data[index + offset] * alpha + 255 * (1 - alpha);
      const dark = 255 - Math.min(channel(0), channel(1), channel(2));
      if (dark < 40) continue;
      count += 1; sumX += x; sumY += y;
    }
  }
  return count === 0 ? null : { count, centroid: { x: sumX / count / SCALE, y: sumY / count / SCALE } };
};

const rasterPoppler = (bytes, label) => {
  const pdfPath = join(tmp, `${label}.pdf`);
  writeFileSync(pdfPath, bytes);
  const result = spawnSync('pdftoppm', ['-r', String(72 * SCALE), '-cropbox', '-png', '-singlefile', pdfPath, join(tmp, label)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return PNG.sync.read(readFileSync(join(tmp, `${label}.png`)));
};

const rasterPdfjs = async (bytes) => {
  if (!napiCanvas) return null;
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

// macOS Quick Look / Quartz - the renderer that showed NOTHING for these two
// families, because it paints appearance streams and nothing else.
const rasterQuartz = (bytes, label) => {
  const pdfPath = join(tmp, `${label}.ql.pdf`);
  writeFileSync(pdfPath, bytes);
  const outDir = join(tmp, `_ql-${label}`);
  // qlmanage does NOT create -o; it fails with "no such directory" and writes
  // nothing, so without this the helper returned null and EVERY Quartz
  // assertion below was silently skipped - the one renderer whose regression
  // this file was written to catch. (scripts/cloud-export-fidelity.mjs has
  // always done the mkdir; the test lane was missing it.)
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync('qlmanage', ['-t', '-s', String(420 * SCALE), '-o', outDir, pdfPath], { encoding: 'utf8' });
  const produced = join(outDir, `${label}.ql.pdf.png`);
  if (result.status !== 0 || !existsSync(produced)) return null;
  return PNG.sync.read(readFileSync(produced));
};

const CALLOUT = {
  id: 'callout-ap',
  pageNumber: 1,
  arrowTip: { x: 0.74, y: 0.26 },
  knee: { x: 0.54, y: 0.5 },
  textBoxPosition: { x: 0.08, y: 0.4 },
  textBoxWidth: 0.36,
  textBoxHeight: 0.2,
  text: 'Check this detail',
  style: {
    borderColor: STROKE,
    fontColor: '#1e293b',
    backgroundColor: '#ffffff',
    fontSize: 11,
    lineThickness: 2,
  },
};

const quadRows = (rows) => rows.map(([left, top, width, height]) => ({
  x1: left, y1: top, x2: left + width, y2: top,
  x3: left, y3: top + height, x4: left + width, y4: top + height,
}));

const markupObject = (kind, app) => {
  const quads = quadRows([
    [app.width * 0.12, app.height * 0.24, app.width * 0.66, Math.max(9, app.height * 0.06)],
    [app.width * 0.12, app.height * 0.36, app.width * 0.44, Math.max(9, app.height * 0.06)],
  ]);
  return {
    id: `mk-${kind}`,
    type: 'group',
    left: quads[0].x1,
    top: quads[0].y1,
    width: quads[0].x2 - quads[0].x1,
    height: quads[1].y3 - quads[0].y1,
    fill: kind === 'highlight' ? '#f4d35e' : STROKE,
    stroke: kind === 'highlight' ? '#f4d35e' : STROKE,
    opacity: kind === 'highlight' ? 0.45 : 1,
    objects: [],
    data: {
      type: 'text-markup', markupType: kind, selectedText: 'sample text', quads,
    },
  };
};

const MARKUP_KINDS = ['highlight', 'underline', 'strikeout', 'squiggly'];

// ---------------------------------------------------------------------------
// The appearance exists at all, and /Rect is the box the viewer maps it onto
// ---------------------------------------------------------------------------
for (const [frameName, frame] of Object.entries(FRAMES)) {
  test(`every callout part on a ${frameName} page carries an /AP whose /BBox is its /Rect`, async () => {
    const { doc, dicts } = await annotDicts(await exportAnnotated(frame, { callouts: [CALLOUT] }));
    assert.equal(dicts.length, 3, 'a callout exports its leader, its arrow leader and its text box');
    for (const dict of dicts) {
      const subtype = String(dict.get(PDFName.of('Subtype')));
      const form = appearanceForm(doc, dict);
      assert.ok(form, `${frameName}: the ${subtype} part must carry an /AP /N form`);
      const rect = numbers(doc, dict.get(PDFName.of('Rect')));
      const mapped = transformedBBox(doc, form);
      // A pure translation fit: the viewer's BBox -> /Rect mapping must not
      // scale or move the ink.
      for (let index = 0; index < 4; index += 1) {
        assert.ok(
          Math.abs(rect[index] - mapped[index]) < 0.01,
          `${frameName}/${subtype}: /Rect[${index}] ${rect[index]} vs transformed /BBox ${mapped[index]}`,
        );
      }
    }
  });

  for (const kind of MARKUP_KINDS) {
    test(`a ${kind} on a ${frameName} page carries an /AP whose /BBox is its /Rect`, async () => {
      const { doc, dicts } = await annotDicts(
        await exportAnnotated(frame, { objects: [markupObject(kind, frame.app)] }),
      );
      assert.equal(dicts.length, 1, `${frameName}: the ${kind} must reach the exported file`);
      const form = appearanceForm(doc, dicts[0]);
      assert.ok(form, `${frameName}: the ${kind} must carry an /AP /N form`);
      const rect = numbers(doc, dicts[0].get(PDFName.of('Rect')));
      const mapped = transformedBBox(doc, form);
      for (let index = 0; index < 4; index += 1) {
        assert.ok(
          Math.abs(rect[index] - mapped[index]) < 0.01,
          `${frameName}/${kind}: /Rect[${index}] ${rect[index]} vs transformed /BBox ${mapped[index]}`,
        );
      }
      // /QuadPoints stays: the mark is still a real text markup, not a stamp.
      assert.ok(numbers(doc, dicts[0].get(PDFName.of('QuadPoints')))?.length === 16);
    });
  }
}

// ---------------------------------------------------------------------------
// Rasters: what a viewer actually paints, against the app's own print
// ---------------------------------------------------------------------------
const compareLanes = async (label, frame, payload) => {
  const annotated = await exportAnnotated(frame, payload);
  const printed = await printFlattened(frame, payload);
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
  return lanes;
};

// 0.5pt on the ink centroid and 3% on the ink count: the same operators inside
// an /AP form versus inlined in the page content stream antialias a shade
// differently, and Quick Look renders a scaled thumbnail. The defect this
// catches took the annotated count to ZERO (Quartz) or moved the mark's
// centroid by 0.35-1.65pt with 25% more ink (poppler improvising an underline
// or a squiggle from /QuadPoints).
const CENTROID_TOLERANCE_PT = 0.5;
const INK_COUNT_TOLERANCE = 0.03;

const assertLanes = (label, lanes) => {
  assert.ok(Object.keys(lanes).length > 0, `${label}: at least one renderer lane must run`);
  // A lane that quietly produces no raster is a lane that asserts nothing. The
  // Quartz helper failed that way for the whole life of this file (it passed
  // qlmanage an -o directory it never created), so where the tool exists the
  // lane must actually have run.
  if (has('qlmanage')) {
    assert.ok(lanes.quartz, `${label}: qlmanage is installed, so the Quartz lane must have rastered`);
  }
  for (const [lane, [annotated, printed]] of Object.entries(lanes)) {
    assert.ok(printed, `${label}/${lane}: the flattened print must draw ink`);
    assert.ok(annotated, `${label}/${lane}: the exported annotation must show ink`);
    const centroid = Math.hypot(
      annotated.centroid.x - printed.centroid.x,
      annotated.centroid.y - printed.centroid.y,
    );
    assert.ok(
      centroid <= CENTROID_TOLERANCE_PT,
      `${label}/${lane}: ink centroid ${centroid.toFixed(3)}pt from the print's`,
    );
    assert.ok(
      Math.abs(annotated.count - printed.count) <= printed.count * INK_COUNT_TOLERANCE,
      `${label}/${lane}: ink ${annotated.count} vs the print's ${printed.count}`,
    );
  }
};

for (const frameName of ['base', 'rot90']) {
  test(`raster: the exported callout paints what the print paints on a ${frameName} page`, async () => {
    assertLanes(
      `callout-${frameName}`,
      await compareLanes(`callout-${frameName}`, FRAMES[frameName], { callouts: [CALLOUT] }),
    );
  });

  for (const kind of MARKUP_KINDS) {
    test(`raster: the exported ${kind} paints what the print paints on a ${frameName} page`, async () => {
      const frame = FRAMES[frameName];
      assertLanes(
        `${kind}-${frameName}`,
        await compareLanes(`${kind}-${frameName}`, frame, { objects: [markupObject(kind, frame.app)] }),
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Round-trip: the appearance must not cost the app its own re-import
// ---------------------------------------------------------------------------
const reimport = async (bytes) => {
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

test('a callout still re-imports byte-for-byte through its own metadata', async () => {
  const imported = await reimport(await exportAnnotated(FRAMES.base, { callouts: [CALLOUT] }));
  const callouts = imported.calloutsByPage?.[1] || [];
  assert.equal(callouts.length, 1, 'exactly one callout must come back');
  const [back] = callouts;
  assert.equal(back.id, CALLOUT.id);
  assert.deepEqual(back.arrowTip, CALLOUT.arrowTip);
  assert.deepEqual(back.knee, CALLOUT.knee);
  assert.deepEqual(back.textBoxPosition, CALLOUT.textBoxPosition);
  assert.equal(back.textBoxWidth, CALLOUT.textBoxWidth);
  assert.equal(back.textBoxHeight, CALLOUT.textBoxHeight);
  assert.equal(back.text, CALLOUT.text);
  assert.deepEqual(back.style, CALLOUT.style);
});

for (const kind of MARKUP_KINDS) {
  test(`a ${kind} still re-imports with the same quads`, async () => {
    const object = markupObject(kind, FRAMES.base.app);
    const imported = await reimport(await exportAnnotated(FRAMES.base, { objects: [object] }));
    const objects = imported.annotationsByPage?.[1]?.objects || [];
    const marks = objects.filter((entry) => entry?.data?.type === 'text-markup');
    assert.equal(marks.length, 1, `exactly one ${kind} must come back`);
    assert.equal(String(marks[0].data.markupType).toLowerCase(), kind);
    const back = marks[0].data.quads;
    assert.equal(back.length, object.data.quads.length, 'every quad must come back');
    for (let index = 0; index < back.length; index += 1) {
      for (const key of ['x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'x4', 'y4']) {
        assert.ok(
          Math.abs(Number(back[index][key]) - Number(object.data.quads[index][key])) < 0.01,
          `${kind} quad ${index} ${key}: ${back[index][key]} vs ${object.data.quads[index][key]}`,
        );
      }
    }
  });
}
