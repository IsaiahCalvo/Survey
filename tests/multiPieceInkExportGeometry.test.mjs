// Multi-piece ink: one pen stroke, many /InkList arrays (2026-09-10, export
// round 7).
//
// THE DEFECT. exportAnnotationRefHasValidGeometry judged the annotation's
// coordinate arrays ONE AT A TIME and returned false the moment any single
// array failed. /InkList carries one array PER STROKE PIECE, and one pen
// stroke is routinely many pieces:
//
//   * the eraser splits a stroke into several subpaths inside ONE annotation
//     (paperInkEraser: "multiple subpaths inside ONE annotation"), and
//   * a DASHED pen stroke materialises into one subpath per painted dash
//     (materializeDashedInkPath - tens of them for a short stroke).
//
// So dragging an erased or dashed stroke until ONE piece left the page by 3pt
// exported ZERO /Annots while the flattened print drew every piece still on
// the paper: the whole stroke vanished from the exported file, silently, on
// all four page edges and on rotated / offset page frames alike. Measured on
// main with a three-piece stroke on a 320x240 page:
//
//   piece 3 on the page   -> annots=1, poppler ink 7680 (annotated) / 7680 (print)
//   piece 3 3pt past right-> annots=0, poppler ink    0 (annotated) / 7680 (print)
//   ...same for left, top and bottom.
//
// THE CONTRACT. The annotation is judged by the UNION of its arrays' bounds
// (inflated by the ink reach /Rect records) against the page: keep it when ANY
// of its ink overlaps the page, drop it only when EVERYTHING is off the page,
// non-finite or degenerate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { PNG } from 'pngjs';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { materializeDashedInkPath } from '../src/utils/paperInkEraser.js';

const STROKE = '#c42747';
const RASTER_DPI = 144;
const tmp = mkdtempSync(join(tmpdir(), 'multi-piece-ink-'));

// The three page frames the export has to survive: an ordinary page, a page
// turned 90 degrees, and one whose boxes do not start at (0, 0). The app's
// frame is pdf.js' default viewport, so /Rotate swaps width and height and the
// box origin drops out.
const FRAMES = {
  base: { mediaBox: [0, 0, 612, 792], app: { width: 612, height: 792 } },
  rot90: { mediaBox: [0, 0, 612, 792], rotate: 90, app: { width: 792, height: 612 } },
  offset: { mediaBox: [100, 50, 712, 842], app: { width: 612, height: 792 } },
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

const exportAnnotated = async (frame, objects) => quiet(() => withWindow(async () => (
  savePDFWithAnnotationsPdfLib(
    await frameFile(frame), { 1: { objects } }, { 1: frame.app }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'multi-piece-ink' },
  )
)));

const printFlattened = async (frame, objects) => quiet(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await frameFile(frame), { 1: { objects } }, { 1: frame.app },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'multi-piece-ink' },
  )
)));

const annotDicts = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return { doc, dicts: [] };
  return { doc, dicts: annots.asArray().map((ref) => doc.context.lookup(ref)).filter((entry) => entry instanceof PDFDict) };
};

const inkListArrays = (doc, dict) => {
  const raw = doc.context.lookup(dict.get(PDFName.of('InkList')));
  if (!(raw instanceof PDFArray)) return [];
  return raw.asArray().map((entry) => doc.context.lookup(entry).asArray().map((value) => value.asNumber()));
};

const has = (command) => spawnSync('which', [command], { encoding: 'utf8' }).status === 0;

// Ink = any pixel that is not the white page, by a comfortable margin so a
// stroke's antialiased edge cannot swing the count.
const rasterInk = (bytes, label) => {
  const pdfPath = join(tmp, `${label}.pdf`);
  writeFileSync(pdfPath, bytes);
  const result = spawnSync('pdftoppm', ['-r', String(RASTER_DPI), '-cropbox', '-png', '-singlefile', pdfPath, join(tmp, label)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const png = PNG.sync.read(readFileSync(join(tmp, `${label}.png`)));
  let count = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const dark = 255 - Math.min(png.data[index], png.data[index + 1], png.data[index + 2]);
    if (dark >= 40) count += 1;
  }
  return count;
};

// A fabric Path stored the way the app stores one: page-coordinate commands,
// `left`/`top` at the object's page position, `pathOffset` at the centre of the
// path's own bounds.
const inkObject = (id, pathData) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const command of pathData) {
    for (let index = 1; index + 1 < command.length; index += 2) {
      const x = Number(command[index]); const y = Number(command[index + 1]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return {
    id,
    type: 'path',
    path: pathData,
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY,
    pathOffset: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: STROKE,
    strokeWidth: 3,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    data: { id },
  };
};

const pieces = (subpaths) => subpaths.flatMap((points) => (
  points.map((point, index) => [index === 0 ? 'M' : 'L', point.x, point.y])
));

const onPagePieces = (app) => [
  [
    { x: app.width * 0.12, y: app.height * 0.30 },
    { x: app.width * 0.30, y: app.height * 0.44 },
    { x: app.width * 0.38, y: app.height * 0.34 },
  ],
  [
    { x: app.width * 0.46, y: app.height * 0.40 },
    { x: app.width * 0.62, y: app.height * 0.52 },
  ],
];

// The stray piece starts 3pt past the named edge - the exact placement the
// defect lost - and runs 60pt further out.
const strayPiece = (app, edge) => ({
  right: [{ x: app.width + 3, y: app.height * 0.5 }, { x: app.width + 60, y: app.height * 0.6 }],
  left: [{ x: -3, y: app.height * 0.5 }, { x: -60, y: app.height * 0.6 }],
  top: [{ x: app.width * 0.5, y: -3 }, { x: app.width * 0.6, y: -60 }],
  bottom: [{ x: app.width * 0.5, y: app.height + 3 }, { x: app.width * 0.6, y: app.height + 60 }],
}[edge]);

const EDGES = ['right', 'left', 'top', 'bottom'];

for (const [frameName, frame] of Object.entries(FRAMES)) {
  for (const edge of EDGES) {
    test(`an erased stroke on a ${frameName} page keeps every piece in the export when one piece leaves the ${edge} edge`, async () => {
      const object = inkObject(
        `ink-split-${edge}`,
        pieces([...onPagePieces(frame.app), strayPiece(frame.app, edge)]),
      );

      const exported = await exportAnnotated(frame, [object]);
      const { doc, dicts } = await annotDicts(exported);
      assert.equal(dicts.length, 1, `${frameName}/${edge}: the stroke must reach the exported file`);

      // The file describes the WHOLE stroke, off-page piece included - the
      // viewer clips what runs past the edge.
      const strokes = inkListArrays(doc, dicts[0]);
      assert.equal(strokes.length, 3, `${frameName}/${edge}: all three pieces must be written`);
      assert.ok(strokes.every((stroke) => stroke.length >= 4 && stroke.every(Number.isFinite)));

      // ...and the appearance the viewer paints is the print's own drawing.
      assert.ok(dicts[0].get(PDFName.of('AP')) !== undefined, `${frameName}/${edge}: the ink keeps its /AP`);
    });
  }

  test(`a dashed stroke on a ${frameName} page survives with tens of /InkList pieces when the tail leaves the page`, async () => {
    const { app } = frame;
    const dashed = materializeDashedInkPath([
      ['M', app.width * 0.08, app.height * 0.72],
      ['L', app.width * 1.35, app.height * 0.86],
    ], { dashArray: [6, 4], lineCap: 'round' });
    assert.equal(dashed.materialized, true, 'the dash materialiser must expand the stroke');
    const subpathCount = dashed.pathData.filter((command) => command[0] === 'M').length;
    assert.ok(subpathCount > 20, `a dashed stroke is many subpaths (got ${subpathCount})`);

    const object = inkObject('ink-dashed', dashed.pathData);
    const exported = await exportAnnotated(frame, [object]);
    const { doc, dicts } = await annotDicts(exported);
    assert.equal(dicts.length, 1, `${frameName}: a dashed stroke whose tail leaves the page must still export`);
    assert.equal(
      inkListArrays(doc, dicts[0]).length,
      subpathCount,
      `${frameName}: every dash must be written to /InkList`,
    );
  });

  test(`a stroke entirely off a ${frameName} page is still dropped, and the print draws nothing`, async () => {
    const { app } = frame;
    const object = inkObject('ink-all-off', pieces([
      [{ x: -900, y: app.height * 0.3 }, { x: -820, y: app.height * 0.4 }],
      [{ x: -780, y: app.height * 0.5 }, { x: -700, y: app.height * 0.6 }],
    ]));
    const { dicts } = await annotDicts(await exportAnnotated(frame, [object]));
    assert.equal(dicts.length, 0, `${frameName}: ink that is entirely off the page must not be exported`);
  });
}

// The union rule loosens WHERE ink may sit, never WHAT may be written. A
// non-finite coordinate never reaches the file: the ink writer coerces one to
// a finite number long before the geometry guard sees it (finiteNumber, inside
// createInkPathAffine / normalizeOperationalInkPath), and the guard's own
// readers reject any array that still is not finite. Both halves are checked
// here so a future "just widen the guard" change cannot let a NaN through.
test('a non-finite ink coordinate never reaches the exported file', async () => {
  const frame = FRAMES.base;
  const broken = inkObject('ink-nan', pieces([
    [{ x: 100, y: 100 }, { x: 200, y: 150 }],
    [{ x: Number.NaN, y: 200 }, { x: 300, y: 250 }],
  ]));
  const { doc, dicts } = await annotDicts(await exportAnnotated(frame, [broken]));
  for (const dict of dicts) {
    const rect = doc.context.lookup(dict.get(PDFName.of('Rect'))).asArray().map((value) => value.asNumber());
    assert.ok(rect.every(Number.isFinite), '/Rect must be finite');
    for (const stroke of inkListArrays(doc, dict)) {
      assert.ok(stroke.every(Number.isFinite), '/InkList must be finite');
    }
  }
});

// The guard's own half of that rule, on an annotation family whose coordinate
// array is written straight through: a polygon whose /Vertices carry a
// non-finite value is rejected outright.
test('the export guard still rejects a coordinate array that is not finite', async () => {
  const frame = FRAMES.base;
  const polygon = {
    id: 'poly-nan',
    type: 'polygon',
    left: 100,
    top: 100,
    points: [{ x: 0, y: 0 }, { x: 120, y: 10 }, { x: Number.POSITIVE_INFINITY, y: 90 }],
    pathOffset: { x: 0, y: 0 },
    stroke: STROKE,
    strokeWidth: 2,
    fill: 'transparent',
  };
  const { doc, dicts } = await annotDicts(await exportAnnotated(frame, [polygon]));
  for (const dict of dicts) {
    const vertices = doc.context.lookup(dict.get(PDFName.of('Vertices')));
    const values = vertices instanceof PDFArray ? vertices.asArray().map((value) => value.asNumber()) : [];
    assert.ok(values.every(Number.isFinite), 'no non-finite /Vertices may be written');
  }
});

test('raster: the exported multi-piece stroke and the flattened print carry the same ink', {
  skip: has('pdftoppm') ? false : 'poppler (pdftoppm) not installed',
}, async () => {
  for (const [frameName, frame] of Object.entries(FRAMES)) {
    for (const edge of EDGES) {
      const object = inkObject(
        `ink-split-${edge}`,
        pieces([...onPagePieces(frame.app), strayPiece(frame.app, edge)]),
      );
      // eslint-disable-next-line no-await-in-loop
      const annotated = rasterInk(await exportAnnotated(frame, [object]), `${frameName}-${edge}-ap`);
      // eslint-disable-next-line no-await-in-loop
      const printed = rasterInk(await printFlattened(frame, [object]), `${frameName}-${edge}-print`);
      assert.ok(printed > 0, `${frameName}/${edge}: the print must draw the on-page pieces`);
      assert.ok(annotated > 0, `${frameName}/${edge}: the exported file must show the on-page pieces`);
      // 2%: the same operators inside an /AP form versus inlined in the page
      // content stream antialias a hair differently. The defect this catches
      // took the annotated count to ZERO.
      assert.ok(
        Math.abs(annotated - printed) <= printed * 0.02,
        `${frameName}/${edge}: exported ink ${annotated} vs printed ${printed}`,
      );
    }
  }
});
