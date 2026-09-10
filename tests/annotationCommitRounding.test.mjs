// Transform commits round their geometry exactly like creation commits
// (verify-export-3p round 3, 2026-09-09).
//
// Creation has always rounded committed geometry to 2 decimals
// (annotationCreationCommit's round2). A RESIZE commit did not: it stored the
// raw float result of the drag - e.g. `scaleX: 1.3846070545520617`. A PDF
// carries coordinates as decimal text, so a metadata-STRIPPED re-import of a
// resized shape came back a whisker different, and the revision-cloud engine -
// a pure function of the vertices it is handed - re-fitted a different number
// of crowns at a different phase (measured: 40 of 150 random resize cases, up
// to 1.58pt of crown movement).
//
// The fix has TWO layers and this file asserts both:
//   1. transform commits round LENGTHS / POSITIONS / ANGLES to 2 decimals, so
//      the stored geometry (and the decimals the exporter writes) stay stable;
//   2. the crown engine snaps every DERIVED size onto the same 1e-6 grid the
//      importer uses, because a live resized shape reaches it as a product
//      (238 * 0.9 = 214.20000000000002) while a re-import reaches it as one
//      decimal (214.2) - the last test here is that difference on its own,
//      with no PDF in the loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

import {
  round2,
  roundScale,
  roundCommittedAnnotationGeometry,
  roundCommittedAnnotationsGeometry,
} from '../src/utils/annotationCommitRounding.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  resolveCloudAnnotationGeometry,
  sampleCloudCommands,
  transformCloudCommandsToWorld,
} from '../src/utils/cloudAnnotationGeometry.js';

const STROKE = '#c42747';

// ---------------------------------------------------------------------------
// The rounding helper itself
// ---------------------------------------------------------------------------

test('every LENGTH / POSITION / ANGLE a transform commit writes is rounded to 2 decimals', () => {
  const obj = roundCommittedAnnotationGeometry({
    type: 'rect',
    left: 12.3456789, top: 45.6789012, width: 100.987654321, height: 60.123456789,
    scaleX: 1.3846070545520617, scaleY: 0.8712345678,
    angle: 27.123456789,
    rx: 3.14159, ry: 2.71828,
    x1: -1.234567, y1: 2.345678, x2: 3.456789, y2: -4.56789,
    points: [{ x: 0.123456, y: 9.876543 }, { x: 5.5555555, y: 1.1111111 }],
    pathOffset: { x: 0.987654, y: 1.234567 },
    data: { midpoint: { x: 10.111111, y: 20.999999 } },
  });
  assert.equal(obj.left, 12.35);
  assert.equal(obj.top, 45.68);
  assert.equal(obj.width, 100.99);
  assert.equal(obj.height, 60.12);
  // Scales are MULTIPLIERS: 0.01 of scale is rawWidth/100 page units, so they
  // keep the 1e-6 grid (float tail clipped, geometry unmoved). See the header.
  assert.equal(obj.scaleX, 1.384607);
  assert.equal(obj.scaleY, 0.871235);
  assert.equal(obj.angle, 27.12);
  assert.equal(obj.rx, 3.14);
  assert.equal(obj.ry, 2.72);
  assert.deepEqual([obj.x1, obj.y1, obj.x2, obj.y2], [-1.23, 2.35, 3.46, -4.57]);
  assert.deepEqual(obj.points, [{ x: 0.12, y: 9.88 }, { x: 5.56, y: 1.11 }]);
  assert.deepEqual(obj.pathOffset, { x: 0.99, y: 1.23 });
  assert.deepEqual(obj.data.midpoint, { x: 10.11, y: 21 });
});

test('a scale ULP is a LENGTH: the 2-decimal grid moved the box, the 1e-6 grid does not', () => {
  // The live symptom: a rect cloud resized with the mr grabber. rawWidth is
  // 238 page units, so one 0.01 step of scaleX is 2.38 units wide and the
  // committed box could land up to 1.19 units off the preview.
  const rawWidth = 238;
  for (const target of [261.5, 190.37, 333.33, 238.07]) {
    const previewScale = target / rawWidth;
    const oldBox = rawWidth * round2(previewScale);
    const newBox = rawWidth * roundScale(previewScale);
    assert.ok(Math.abs(newBox - target) <= 0.01,
      `1e-6 grid: committed ${newBox} vs preview ${target}`);
    assert.ok(Math.abs(oldBox - target) > 0.01,
      `fixture must exhibit the old jump (got ${(oldBox - target).toFixed(4)})`);
  }
  // ...and the whole-object path agrees.
  const committed = roundCommittedAnnotationGeometry({
    type: 'rect', width: rawWidth, height: 176, scaleX: 261.5 / rawWidth, scaleY: 1,
  });
  assert.ok(Math.abs(committed.width * committed.scaleX - 261.5) <= 0.01);
});

test('rounding never moves a shape by more than half a hundredth of a point', () => {
  const before = { type: 'rect', left: 100.004999, top: 200.005001, width: 50.994999, height: 30.995001 };
  const after = roundCommittedAnnotationGeometry({ ...before });
  for (const key of ['left', 'top', 'width', 'height']) {
    assert.ok(Math.abs(after[key] - before[key]) <= 0.005 + 1e-9, `${key} moved ${after[key] - before[key]}`);
  }
});

test('freehand ink is left alone: its left/top is an offset into its own path data', () => {
  const ink = {
    type: 'path',
    left: 10.123456, top: 20.987654,
    path: [['M', 1.111111, 2.222222], ['L', 3.333333, 4.444444]],
  };
  const out = roundCommittedAnnotationGeometry({ ...ink, path: ink.path });
  assert.equal(out.left, 10.123456);
  assert.equal(out.top, 20.987654);
  assert.deepEqual(out.path, ink.path);
});

test('missing and non-numeric fields are left exactly as they are', () => {
  const out = roundCommittedAnnotationGeometry({ type: 'rect', left: 5, angle: null, width: 'x', data: null });
  assert.equal(out.left, 5);
  assert.equal(out.angle, null);
  assert.equal(out.width, 'x');
  assert.equal(out.data, null);
  assert.equal(out.top, undefined);
});

test('the payload helper rounds only the objects a commit touched', () => {
  const annotations = {
    objects: [
      { type: 'rect', left: 1.23456 },
      { type: 'rect', left: 7.65432 },
      { type: 'rect', left: 9.87654 },
    ],
  };
  roundCommittedAnnotationsGeometry(annotations, [0, 2]);
  assert.equal(annotations.objects[0].left, 1.23);
  assert.equal(annotations.objects[1].left, 7.65432, 'an untouched annotation is not rewritten');
  assert.equal(annotations.objects[2].left, 9.88);
});

test('round2 is the single rule creation and transform commits share', async () => {
  const creation = await import('../src/utils/annotationCreationCommit.js');
  const json = creation.buildBoundaryShapeCommitJSON({
    tool: 'rect',
    id: 'r1',
    start: { x: 10.123456, y: 20.654321 },
    end: { x: 110.987654, y: 80.111111 },
    strokeColor: '#000000', strokeOpacity: 100,
    fillColor: 'transparent', fillOpacity: 0,
    strokeWidth: 2,
    lineBorderStyle: 'solid',
  });
  for (const key of ['left', 'top', 'width', 'height']) {
    assert.equal(json[key], round2(json[key]), `${key} is already 2-decimal rounded at creation`);
  }
});

// ---------------------------------------------------------------------------
// Round trip: a RESIZED cloud through the exporter and back with no metadata
// ---------------------------------------------------------------------------

const makePdfFile = async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([420, 320]);
  page.setMediaBox(0, 0, 420, 320);
  page.setCropBox(0, 0, 420, 320);
  const bytes = await source.save();
  return {
    name: 'resize.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const exportObject = async (file, object) => {
  const original = globalThis.window;
  globalThis.window = {};
  try {
    return await quiet(() => savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [object] } },
      { 1: { width: 420, height: 320 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'resize-round-trip' },
    ));
  } finally {
    globalThis.window = original;
  }
};

const reimportWithoutMetadata = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.asArray().forEach((ref) => doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation')));
  }
  const stripped = await doc.save();
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(stripped), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdfDoc = await task.promise;
  try {
    const imported = await quiet(() => importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: stripped }));
    return imported.annotationsByPage?.[1]?.objects || [];
  } finally {
    await task.destroy();
  }
};

const crowns = (object) => {
  const geometry = resolveCloudAnnotationGeometry(object);
  if (!geometry) return null;
  const world = transformCloudCommandsToWorld(geometry.outline, geometry);
  return { commands: geometry.outline.length, points: sampleCloudCommands(world, 6).flat() };
};

const pointSetHausdorff = (a, b) => {
  const directed = (from, to) => {
    let worst = 0;
    for (const p of from) {
      let best = Infinity;
      for (const q of to) {
        const distance = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        if (distance < best) best = distance;
      }
      if (best > worst) worst = best;
    }
    return Math.sqrt(worst);
  };
  return Math.max(directed(a, b), directed(b, a));
};

// The resize commit's own arithmetic: a handle drag multiplies the original
// scale by the drag ratio, which is where the long float tails come from.
const resizeCommit = ({ base, scaleX, scaleY, left, top, round }) => {
  const resized = {
    ...base,
    scaleX: (base.scaleX ?? 1) * scaleX,
    scaleY: (base.scaleY ?? 1) * scaleY,
    left,
    top,
  };
  return round ? roundCommittedAnnotationGeometry(resized) : resized;
};

let seed = 0x9e3779b1;
const random = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0xffffffff;
};

const CASE_COUNT = 40;

const resizeCases = () => {
  seed = 0x9e3779b1;
  const cases = [];
  for (let index = 0; index < CASE_COUNT; index += 1) {
    // Ratios with long tails, the way a pointer drag produces them.
    const scaleX = 0.4 + random() * 1.7;
    const scaleY = 0.4 + random() * 1.7;
    const left = 30 + random() * 40;
    const top = 25 + random() * 35;
    const bump = 2 + (index % 4);
    const kind = index % 3;
    const base = kind === 0
      ? { id: `rz-rect-${index}`, type: 'rect', left, top, width: 120, height: 84, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump } }
      : kind === 1
        ? { id: `rz-ellipse-${index}`, type: 'ellipse', left, top, rx: 60, ry: 42, width: 120, height: 84, angle: 0, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump } }
        : {
            id: `rz-polygon-${index}`, type: 'polygon', left, top,
            points: [{ x: 0, y: 12 }, { x: 70, y: 0 }, { x: 118, y: 30 }, { x: 84, y: 82 }, { x: 12, y: 66 }],
            pathOffset: { x: 0, y: 0 },
            stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump },
          };
    cases.push({ base, scaleX, scaleY, left, top });
  }
  return cases;
};

const runRoundTrip = async (round) => {
  const file = await makePdfFile();
  const mismatches = [];
  for (const spec of resizeCases()) {
    const object = resizeCommit({ ...spec, round });
    // eslint-disable-next-line no-await-in-loop
    const bytes = await exportObject(file, object);
    // eslint-disable-next-line no-await-in-loop
    const back = await reimportWithoutMetadata(bytes);
    const drawn = crowns(object);
    const restored = back.map(crowns).filter(Boolean);
    if (restored.length !== 1 || !drawn) {
      mismatches.push({ id: object.id, reason: `expected one cloud back, got ${restored.length}` });
      continue;
    }
    const shift = pointSetHausdorff(drawn.points, restored[0].points);
    if (drawn.commands !== restored[0].commands || shift > 0.01) {
      mismatches.push({
        id: object.id,
        commands: [drawn.commands, restored[0].commands],
        shiftPt: Number(shift.toFixed(4)),
      });
    }
  }
  return mismatches;
};

test('a RESIZED cloud survives a metadata-stripped round trip crown-for-crown', async () => {
  const mismatches = await runRoundTrip(true);
  assert.deepEqual(mismatches, [], `rounded resize commits must round-trip exactly (${mismatches.length}/${CASE_COUNT} failed)`);
});

test('raw-float resize commits round-trip too - the second half of the fix', async () => {
  // The commit rounding is one of TWO layers. It keeps the STORED geometry
  // stable (and the exported decimals short), but the drift that changed crown
  // counts came from the DERIVED product the engine is handed: a live resized
  // shape reaches it as `width * scaleX` while the same shape re-imported from
  // a PDF reaches it as one decimal read back from /Rect, and 238 * 0.9 is
  // 214.20000000000002 in floating point. cloudAnnotationGeometry now snaps
  // every derived size onto the 1e-6 grid the importer already used, so even
  // an un-rounded commit survives. Both layers are asserted, so neither can be
  // dropped silently.
  const mismatches = await runRoundTrip(false);
  assert.deepEqual(mismatches, [], `un-rounded resize commits must round-trip too (${mismatches.length}/${CASE_COUNT} failed)`);
});

test('the crown engine cannot tell a float-tail product from its exact decimal', async () => {
  // The sharp form of the defect, with no PDF in the loop: these two objects
  // are the SAME rectangle - one sized by a live resize (238 * 0.9), one by the
  // single decimal a re-import reads back. Before the engine snapped its
  // derived sizes they fitted 163 and 162 crowns.
  const drawn = {
    id: 'float-tail', type: 'rect', left: 59, top: 95,
    width: 176, height: 238, scaleX: 1.31, scaleY: 0.9,
    stroke: STROKE, strokeWidth: 2.5, fill: 'transparent',
    data: { pdfCloudIntensity: 2 },
  };
  const restored = {
    ...drawn,
    id: 'exact-decimal',
    width: 176 * 1.31, height: 214.2, scaleX: 1, scaleY: 1,
  };
  assert.notEqual(238 * 0.9, 214.2, 'the premise: the product carries a float tail');
  const a = crowns(drawn);
  const b = crowns(restored);
  assert.ok(a && b, 'both resolve as clouds');
  assert.equal(a.commands, b.commands, 'same crown count');
  assert.ok(pointSetHausdorff(a.points, b.points) <= 1e-6, 'same crowns, in the same place');
});
