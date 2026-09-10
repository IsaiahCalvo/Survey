// Tilted plain shapes and drawn line/arrow coordinates in the exported PDF
// (2026-09-10).
//
// TWO DEFECTS THIS PINS DOWN.
//
// 1. A tilted plain rectangle and a tilted plain text box exported as an
//    axis-aligned /Square and /FreeText with NO appearance at all, so Acrobat,
//    Preview and pdf.js all drew them upright while the app (and the app's own
//    flattened print) drew them tilted. They now ship the same /AP shape the
//    cloud and ellipse writers use: the drawing UN-rotated, the tilt in the
//    form's /Matrix, /Rect grown to the rotated box, and /RD back to the base.
//
// 2. A line or arrow the user DRAWS stores x1..y2 CENTER-RELATIVE (fabric's
//    calcLinePoints contract, buildLineCommitJSON) and the renderer resolves
//    them through getLineEndpoints. The exporter and the print flattener read
//    the raw fields as if they were absolute page coordinates, which for a
//    drawn line is off by half the bounding box - far enough that the export's
//    own page-geometry guard threw the annotation away and a drawn line
//    reached the exported PDF as NOTHING. `angle` was ignored by both as well.
//
// The raster lane is the proof that matters: the app's own canvas painter
// (drawAnnotationObject - the documented twin of the SVG renderer, sharing
// getLineEndpoints / computeLineBboxCenter / buildLineRenderSpec with it) is
// rasterised with node-canvas and compared against pdf.js rasters of the
// exported /AP and of the flattened print. A lane whose rasteriser is missing
// skips with a reason; it never fakes a pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} = await import('../src/utils/pdfAnnotationsPdfLib.js');
const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
const { importAnnotationsFromPdf } = await import('../src/utils/pdfAnnotationImporter.js');

// Re-import through the real pdf.js reader, with our own sidecar metadata
// stripped first, so the geometry judged below is what the FILE carries.
const reimportWithoutMetadata = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.asArray().forEach((ref) => doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation')));
  }
  const stripped = await doc.save();
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(stripped),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: stripped });
    return imported.annotationsByPage[1]?.objects || [];
  } finally {
    await loadingTask.destroy();
  }
};

const PAGE = { width: 400, height: 300 };
const SCALE = 3;

const blankFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return {
    name: 'blank.pdf',
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
};

const exportAnnotated = async (object) => savePDFWithAnnotationsPdfLib(
  await blankFile(), { 1: { objects: [object] } }, { 1: PAGE }, null,
  { returnBytes: true, actionType: 'pdf-export', documentId: String(object.id) },
);
const exportFlattened = async (object) => savePDFWithFlattenedRegularAnnotationsForPrint(
  await blankFile(), { 1: { objects: [object] } }, { 1: PAGE }, { returnBytes: true },
);

const annotationDicts = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPages()[0].node.Annots();
  const out = [];
  for (let index = 0; index < (annots ? annots.size() : 0); index += 1) {
    out.push({ doc, dict: doc.context.lookup(annots.get(index)) });
  }
  return out;
};
const numbers = (doc, dict, key) => {
  const raw = dict.get(PDFName.of(key));
  if (!raw) return null;
  return doc.context.lookup(raw).asArray().map((value) => value.asNumber());
};
const appearanceForm = (doc, dict) => {
  const ap = dict.get(PDFName.of('AP'));
  if (!ap) return null;
  const form = doc.context.lookup(doc.context.lookup(ap).get(PDFName.of('N')));
  const read = (key) => {
    const raw = form?.dict?.get(PDFName.of(key));
    return raw ? doc.context.lookup(raw).asArray().map((value) => value.asNumber()) : null;
  };
  return { matrix: read('Matrix'), bbox: read('BBox') };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A line the user DRAWS: fabric stores the frame box and center-relative
// endpoints (buildLineCommitJSON), which is what the renderer resolves.
const drawnLine = (id, start, end, extra = {}) => {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  return {
    id, type: 'line', left, top, width, height,
    x1: start.x - centerX, y1: start.y - centerY,
    x2: end.x - centerX, y2: end.y - centerY,
    stroke: 'rgba(17, 17, 17, 1)', strokeWidth: 3, fill: 'rgb(0,0,0)',
    tool: 'line', data: { id },
    ...extra,
  };
};

const START = { x: 110, y: 90 };
const END = { x: 300, y: 205 };

const FIXTURES = {
  'drawn-line': drawnLine('drawn-line', START, END),
  'drawn-line-rotated': drawnLine('drawn-line-rotated', START, END, { angle: 34 }),
  'drawn-arrow': drawnLine('drawn-arrow', START, END, {
    tool: 'arrow', data: { id: 'drawn-arrow', arrowheadStyle: 'solidTriangle' },
  }),
  'drawn-arrow-rotated': drawnLine('drawn-arrow-rotated', START, END, {
    angle: -47, tool: 'arrow', data: { id: 'drawn-arrow-rotated', arrowheadStyle: 'solidTriangle' },
  }),
  'tilted-rect': {
    id: 'tilted-rect', type: 'rect', left: 90, top: 70, width: 190, height: 120, angle: 26,
    stroke: 'rgba(28, 111, 208, 1)', strokeWidth: 3, fill: 'rgba(28, 111, 208, 0.25)',
  },
};

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test('a drawn line and arrow export /L at the endpoints the renderer resolves, tilt included', async () => {
  const { getLineEndpoints, computeLineBboxCenter } = await import('../src/utils/svgBoundingBox.js');
  for (const name of ['drawn-line', 'drawn-line-rotated', 'drawn-arrow', 'drawn-arrow-rotated']) {
    const object = FIXTURES[name];
    const [entry] = await annotationDicts(await exportAnnotated(object));
    assert.ok(entry, `${name}: the annotation survived the export (it used to be dropped entirely)`);
    const line = numbers(entry.doc, entry.dict, 'L');
    assert.ok(Array.isArray(line) && line.length === 4, `${name}: /L present`);

    const endpoints = getLineEndpoints(object);
    const angle = Number(object.angle) || 0;
    const pivot = computeLineBboxCenter(endpoints, null);
    const rotate = (x, y) => {
      if (!angle) return { x, y };
      const radians = (angle * Math.PI) / 180;
      const cos = Math.cos(radians); const sin = Math.sin(radians);
      const dx = x - pivot.x; const dy = y - pivot.y;
      return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
    };
    const first = rotate(endpoints.x1, endpoints.y1);
    const second = rotate(endpoints.x2, endpoints.y2);
    const expected = [first.x, PAGE.height - first.y, second.x, PAGE.height - second.y];
    for (let index = 0; index < 4; index += 1) {
      assert.ok(Math.abs(line[index] - expected[index]) < 1e-6,
        `${name}: /L[${index}] ${line[index]} != ${expected[index]}`);
    }
    // And the values are the world coordinates, not the stored center-relative
    // ones - the specific bug: |x1| here is ~95, the half-width.
    assert.ok(Math.abs(line[0] - object.x1) > 50, `${name}: /L is not the raw center-relative field`);
  }
});

test('a tilted rect and a tilted text box ship an /AP whose /Matrix carries the tilt', async () => {
  const cases = [
    ['tilted-rect', FIXTURES['tilted-rect'], 26],
    ['tilted-text', {
      id: 'tilted-text', type: 'textbox', left: 90, top: 70, width: 190, height: 44, angle: 18,
      text: 'Tilted note', fontSize: 16, fill: '#222222', fontFamily: 'Helvetica',
      stroke: '#222222', strokeWidth: 1,
    }, 18],
  ];
  for (const [name, object, angle] of cases) {
    const [entry] = await annotationDicts(await exportAnnotated(object));
    assert.ok(entry, `${name}: exported`);
    const form = appearanceForm(entry.doc, entry.dict);
    assert.ok(form, `${name}: has an /AP /N form (it used to have none at all)`);
    assert.ok(Array.isArray(form.matrix), `${name}: the form carries a /Matrix`);
    const [a, b] = form.matrix;
    const recovered = -Math.atan2(b, a) * 180 / Math.PI;
    assert.ok(Math.abs(recovered - angle) < 1e-6, `${name}: /Matrix encodes ${angle} degrees, got ${recovered}`);
    // /Rect must be the page box of /Matrix x /BBox, or the viewer silently
    // scales the form (PDF 32000 12.5.5).
    const rect = numbers(entry.doc, entry.dict, 'Rect');
    const width = form.bbox[2] - form.bbox[0];
    const height = form.bbox[3] - form.bbox[1];
    const fittedWidth = Math.abs(width * a) + Math.abs(height * b);
    const fittedHeight = Math.abs(width * b) + Math.abs(height * a);
    assert.ok(Math.abs((rect[2] - rect[0]) - fittedWidth) < 1e-3, `${name}: /Rect width fits the transformed /BBox`);
    assert.ok(Math.abs((rect[3] - rect[1]) - fittedHeight) < 1e-3, `${name}: /Rect height fits the transformed /BBox`);
    const rd = numbers(entry.doc, entry.dict, 'RD');
    assert.ok(Array.isArray(rd) && rd.every((value) => value >= 0), `${name}: /RD back to the base box`);
  }
});

test('a tilted rect and text box re-import with their angle and their size', async () => {
  const cases = [
    ['tilted-rect', FIXTURES['tilted-rect'], 26],
    ['tilted-text', {
      id: 'tilted-text', type: 'textbox', left: 90, top: 70, width: 190, height: 44, angle: 18,
      text: 'Tilted note', fontSize: 16, fill: '#222222', fontFamily: 'Helvetica',
      stroke: '#222222', strokeWidth: 1,
    }, 18],
  ];
  for (const [name, object, angle] of cases) {
    const objects = await reimportWithoutMetadata(await exportAnnotated(object));
    const shape = objects.find((entry) => ['rect', 'textbox'].includes(String(entry?.type)));
    assert.ok(shape, `${name}: something imported (${objects.map((entry) => entry?.type).join(', ')})`);
    assert.ok(Math.abs((Number(shape.angle) || 0) - angle) < 0.2,
      `${name}: the angle round-trips (${shape.angle} vs ${angle})`);
    if (name === 'tilted-rect') {
      // /RD is read back in the rotation branch now, so the box comes home the
      // size it left instead of a stroke-plus-margin larger every trip.
      assert.ok(Math.abs(shape.width - object.width) < 1, `${name}: width ${shape.width} vs ${object.width}`);
      assert.ok(Math.abs(shape.height - object.height) < 1, `${name}: height ${shape.height} vs ${object.height}`);
    }
  }
});

test('a cloud whose scalloped hull spills off the page stays in the export', async () => {
  // A 45-degree polygon cloud whose corner crosses y = 0. The flattened print
  // draws it clipped by the page; the export used to drop it outright with
  // reason 'invalid-or-outside-page-geometry', so print and export disagreed
  // about whether the annotation existed.
  const object = {
    id: 'spill', type: 'polygon', left: 40, top: 30, angle: 45,
    points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 140 }, { x: 0, y: 140 }],
    pathOffset: { x: 0, y: 0 },
    stroke: 'rgba(196,39,71,1)', strokeWidth: 6, fill: 'rgba(0,0,255,0.3)',
    data: { pdfCloudIntensity: 2 },
  };
  const dicts = await annotationDicts(await exportAnnotated(object));
  assert.equal(dicts.length, 1, 'the spilling cloud is exported, not skipped');
  const rect = numbers(dicts[0].doc, dicts[0].dict, 'Rect');
  assert.ok(rect.every(Number.isFinite));
  assert.ok(rect[2] >= 0 && rect[0] <= PAGE.width && rect[3] >= 0 && rect[1] <= PAGE.height,
    'and its box still overlaps the page');

  // Wild geometry is still rejected: this is a bounded allowance, not an
  // open door.
  const wild = { id: 'wild', type: 'line', x1: -9000, y1: 10, x2: 9000, y2: 20, stroke: '#ff0000' };
  assert.equal((await annotationDicts(await exportAnnotated(wild))).length, 0,
    'a line thousands of points off the page is still dropped');
});

// ---------------------------------------------------------------------------
// Raster lanes: app painter vs the exported /AP vs the flattened print.
// ---------------------------------------------------------------------------

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const tmp = mkdtempSync(join(tmpdir(), 'plain-tilt-'));
const has = (binary) => spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;

let nodeCanvas = null;
try { nodeCanvas = await import('canvas'); } catch { nodeCanvas = null; }
let napiCanvas = null;
try { napiCanvas = await import('@napi-rs/canvas'); } catch { napiCanvas = null; }

// Ink = any pixel that is not the white page, by a comfortable margin so
// antialiasing at the very edge of a stroke cannot swing the metrics.
const inkStats = (png) => {
  let count = 0;
  let sumX = 0; let sumY = 0;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const dark = 255 - Math.min(png.data[index], png.data[index + 1], png.data[index + 2]);
      if (dark < 40) continue;
      count += 1; sumX += x; sumY += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return count === 0 ? null : {
    count,
    centroid: { x: sumX / count / SCALE, y: sumY / count / SCALE },
    box: { minX: minX / SCALE, maxX: maxX / SCALE, minY: minY / SCALE, maxY: maxY / SCALE },
  };
};

const paintWithApp = (object) => {
  const canvas = nodeCanvas.createCanvas(PAGE.width * SCALE, PAGE.height * SCALE);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  drawAnnotationObject(context, object, 1);
  return PNG.sync.read(canvas.toBuffer('image/png'));
};

const rasterWithPdfjs = async (bytes) => {
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

const rasterWithPoppler = (bytes, label) => {
  const pdfPath = join(tmp, `${label}.pdf`);
  writeFileSync(pdfPath, bytes);
  const result = spawnSync('pdftoppm', ['-r', String(72 * SCALE), '-png', '-singlefile', pdfPath, join(tmp, label)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return PNG.sync.read(readFileSync(join(tmp, `${label}.png`)));
};

const RASTER_CASES = ['drawn-line', 'drawn-line-rotated', 'drawn-arrow', 'drawn-arrow-rotated', 'tilted-rect'];

test('raster: the app painter, the exported /AP and the flattened print put the ink in the same place', {
  skip: nodeCanvas && napiCanvas ? false : 'node-canvas + @napi-rs/canvas not installed',
}, async () => {
  for (const name of RASTER_CASES) {
    const object = FIXTURES[name];
    const app = inkStats(paintWithApp(object));
    assert.ok(app, `${name}: the app paints ink`);
    const lanes = {
      'pdf.js /AP': inkStats(await rasterWithPdfjs(await exportAnnotated(object))),
      'pdf.js print': inkStats(await rasterWithPdfjs(await exportFlattened(object))),
    };
    if (has('pdftoppm')) {
      lanes['poppler /AP'] = inkStats(rasterWithPoppler(await exportAnnotated(object), `${name}-ap`));
      lanes['poppler print'] = inkStats(rasterWithPoppler(await exportFlattened(object), `${name}-print`));
    }
    for (const [lane, stats] of Object.entries(lanes)) {
      assert.ok(stats, `${name} / ${lane}: the lane has ink at all`);
      const centroid = Math.hypot(stats.centroid.x - app.centroid.x, stats.centroid.y - app.centroid.y);
      // 1.5pt: an arrowhead's fill differs by a hair between a canvas
      // rasteriser and a PDF one, and a stroke's antialiased edge moves the
      // centroid a fraction. The defect this catches moved a drawn line by
      // ~110pt (half its bounding box) or dropped it entirely.
      assert.ok(centroid < 1.5, `${name} / ${lane}: ink centroid is ${centroid.toFixed(2)}pt from the app's`);
      for (const edge of ['minX', 'maxX', 'minY', 'maxY']) {
        assert.ok(Math.abs(stats.box[edge] - app.box[edge]) < 2.5,
          `${name} / ${lane}: ink ${edge} ${stats.box[edge].toFixed(2)} vs the app's ${app.box[edge].toFixed(2)}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The OTHER line-storage convention: absolute endpoints. Imported /Line
// annotations store them that way (left/top/width/height all zero), and so do
// legacy saved arrows - a fabric GROUP holding a Line child plus a triangle,
// which the exporter maps onto a modern line and the print flattener recurses
// into. Both must stay exactly where they were: resolveLineWorldGeometry adds
// a frame box centre when there is one, so the two paths that hand it absolute
// endpoints have to hand it no box.
// ---------------------------------------------------------------------------

test('imported and legacy-group lines keep their absolute endpoints', async () => {
  const imported = {
    id: 'imported-line', type: 'line', left: 0, top: 0, width: 0, height: 0,
    x1: 120, y1: 100, x2: 320, y2: 210, stroke: '#008000', strokeWidth: 2,
  };
  const [entry] = await annotationDicts(await exportAnnotated(imported));
  assert.ok(entry, 'imported-style line exported');
  const line = numbers(entry.doc, entry.dict, 'L');
  assert.deepEqual(line.map((value) => Number(value.toFixed(4))),
    [120, PAGE.height - 100, 320, PAGE.height - 210],
    'absolute endpoints are written through unchanged');

  // Legacy arrow group: the Line child's endpoints are relative to the group
  // origin, so the writers add the group origin and nothing else.
  const legacy = {
    id: 'legacy-arrow', type: 'group', left: 40, top: 30,
    stroke: '#804000', strokeWidth: 2,
    objects: [
      { type: 'line', x1: 20, y1: 10, x2: 180, y2: 120, left: 20, top: 10, width: 160, height: 110, stroke: '#804000', strokeWidth: 2 },
      { type: 'triangle', name: 'arrowHead', left: 180, top: 120, width: 10, height: 10, fill: '#804000' },
    ],
  };
  const [legacyEntry] = await annotationDicts(await exportAnnotated(legacy));
  assert.ok(legacyEntry, 'the legacy arrow group still exports as a /Line');
  const legacyLine = numbers(legacyEntry.doc, legacyEntry.dict, 'L');
  assert.deepEqual(legacyLine.map((value) => Number(value.toFixed(4))),
    [60, PAGE.height - 40, 220, PAGE.height - 150],
    'group origin added once, the child frame box never');
});

// The export maps a legacy arrow GROUP onto one /Line with a /LE head while
// the print flattener recurses and draws the group's own triangle child, so
// the two lanes have never agreed on the HEAD's shape (measured 4.1pt of
// centroid between them, on this branch and before it). What they must agree
// on - and what the frame-box rule above protects - is where the SHAFT is.
test('raster: a legacy arrow group prints on the endpoints it exports', {
  skip: napiCanvas ? false : '@napi-rs/canvas not installed',
}, async () => {
  const legacy = {
    id: 'legacy-arrow-raster', type: 'group', left: 40, top: 30,
    stroke: '#804000', strokeWidth: 3,
    objects: [
      { type: 'line', x1: 20, y1: 10, x2: 180, y2: 120, left: 20, top: 10, width: 160, height: 110, stroke: '#804000', strokeWidth: 3 },
    ],
  };
  const start = { x: 60, y: 40 };
  const end = { x: 220, y: 150 };
  const [entry] = await annotationDicts(await exportAnnotated(legacy));
  assert.deepEqual(numbers(entry.doc, entry.dict, 'L').map((value) => Number(value.toFixed(4))),
    [start.x, PAGE.height - start.y, end.x, PAGE.height - end.y]);
  const print = inkStats(await rasterWithPdfjs(await exportFlattened(legacy)));
  assert.ok(print, 'the flattened print has ink');
  // Half a stroke width plus a pixel of antialiasing around the chord.
  const margin = 3;
  assert.ok(Math.abs(print.box.minX - start.x) < margin, `print ink starts at x ${print.box.minX.toFixed(2)}, not ${start.x}`);
  assert.ok(Math.abs(print.box.minY - start.y) < margin, `print ink starts at y ${print.box.minY.toFixed(2)}, not ${start.y}`);
  assert.ok(Math.abs(print.box.maxX - end.x) < margin, `print ink ends at x ${print.box.maxX.toFixed(2)}, not ${end.x}`);
  assert.ok(Math.abs(print.box.maxY - end.y) < margin, `print ink ends at y ${print.box.maxY.toFixed(2)}, not ${end.y}`);
});
