// Multi-piece ink that is ENTIRELY off the page (2026-09-10, adversarial
// verification of export round 7).
//
// THE DEFECT. Export round 7 replaced exportAnnotationRefHasValidGeometry's
// per-array coordinate check with the UNION of every /InkList array, so that a
// stroke with one piece off the page keeps the pieces that are still on it.
// The union of two boxes on OPPOSITE sides of the page overlaps the page even
// though neither box does, so a stroke whose every piece is off the page - one
// piece past the left edge, one past the right - now passes the guard.
//
// Measured on this page (420 x 320, poppler / pdf.js / Quick Look at 216 dpi):
//
//   main 2848dcf5           annots=0   (dropped, matching the print)
//   claude/export-round7-integration
//                           annots=1   /Rect [-121.5 158.5 541.5 221.5]
//                                      ink on the page: 0 in all three
//                                      renderers; the print draws nothing.
//
// So the exported file carries an /Ink annotation that spans the WHOLE page
// width, paints nothing, is selectable across that band in Acrobat / Preview
// and shows up in the comments list - while the flattened print of the same
// page has no such mark. Reachable by scaling an erased two-piece stroke up
// until both surviving pieces leave the page in opposite directions.
//
// THE CONTRACT (round 7 states it itself, in the comment above the union):
// "keep the annotation when ANY of its ink overlaps the page; drop it only
// when EVERYTHING is off the page". The union of the pieces' boxes is not the
// same thing as the ink, so the guard has to judge the PIECES against the page
// and keep the annotation when ANY ONE of them overlaps - never the union
// alone.

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

const STROKE = '#c42747';
const RASTER_DPI = 216;
const tmp = mkdtempSync(join(tmpdir(), 'ink-offpage-union-'));

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

const exportAnnotated = async (frame, objects) => quiet(() => withWindow(async () => (
  savePDFWithAnnotationsPdfLib(
    await frameFile(frame), { 1: { objects } }, { 1: frame.app }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'ink-offpage-union' },
  )
)));

const printFlattened = async (frame, objects) => quiet(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await frameFile(frame), { 1: { objects } }, { 1: frame.app },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'ink-offpage-union' },
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

const has = (command) => spawnSync('which', [command], { encoding: 'utf8' }).status === 0;

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

// A fabric Path the way the app stores one: `left`/`top` at the object's
// CENTRE (the center-v1 origin the ink transform uses), `pathOffset` at the
// centre of the path's own bounds, page-coordinate commands.
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
    left: (minX + maxX) / 2,
    top: (minY + maxY) / 2,
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

const STRADDLES = {
  'left and right': (app) => [
    [{ x: -120, y: app.height * 0.31 }, { x: -5, y: app.height * 0.5 }],
    [{ x: app.width + 5, y: app.height * 0.31 }, { x: app.width + 120, y: app.height * 0.5 }],
  ],
  'top and bottom': (app) => [
    [{ x: app.width * 0.24, y: -120 }, { x: app.width * 0.48, y: -5 }],
    [{ x: app.width * 0.24, y: app.height + 5 }, { x: app.width * 0.48, y: app.height + 120 }],
  ],
};

for (const [frameName, frame] of Object.entries(FRAMES)) {
  for (const [where, build] of Object.entries(STRADDLES)) {
    test(`a stroke whose every piece is off the ${where} edges of a ${frameName} page is dropped, like the print drops it`, async () => {
      const object = inkObject(`ink-straddle-${frameName}`, pieces(build(frame.app)));

      const printed = await printFlattened(frame, [object]);
      const exported = await exportAnnotated(frame, [object]);
      const { doc, dicts } = await annotDicts(exported);

      if (has('pdftoppm')) {
        assert.equal(
          rasterInk(printed, `${frameName}-${where.replace(/\s+/g, '-')}-print`),
          0,
          `${frameName}/${where}: the flattened print must draw nothing - no piece touches the page`,
        );
      }

      assert.equal(
        dicts.length,
        0,
        `${frameName}/${where}: every piece is off the page, so the export must drop the stroke`
          + ` (got ${dicts.length}, /Rect ${dicts.length ? JSON.stringify(
            doc.context.lookup(dicts[0].get(PDFName.of('Rect'))).asArray().map((value) => value.asNumber()),
          ) : '-'})`,
      );

      if (has('pdftoppm')) {
        assert.equal(
          rasterInk(exported, `${frameName}-${where.replace(/\s+/g, '-')}-ap`),
          0,
          `${frameName}/${where}: the exported file must paint nothing on the page either`,
        );
      }
    });
  }

  // The guard must not be tightened back into the round-7 defect: a stroke
  // with ONE piece still on the page keeps every piece.
  test(`a stroke with one piece still on a ${frameName} page is kept whole`, async () => {
    const { app } = frame;
    const object = inkObject('ink-one-on', pieces([
      [{ x: app.width * 0.24, y: app.height * 0.31 }, { x: app.width * 0.48, y: app.height * 0.5 }],
      [{ x: app.width + 40, y: app.height * 0.31 }, { x: app.width + 140, y: app.height * 0.5 }],
    ]));
    const { doc, dicts } = await annotDicts(await exportAnnotated(frame, [object]));
    assert.equal(dicts.length, 1, `${frameName}: the stroke must still be exported`);
    const inkList = doc.context.lookup(dicts[0].get(PDFName.of('InkList')));
    assert.ok(inkList instanceof PDFArray && inkList.size() === 2, `${frameName}: both pieces must reach /InkList`);
  });
}
