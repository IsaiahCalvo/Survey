// Snap to content (Nightly 'snap-content', Drawboard PDF Pro trial 2026-11-10):
// a drawn point lands on the PDF drawing's own line ends, then midpoints, then
// along a straight line, within the screen-constant snap radius.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, rgb } from 'pdf-lib';
import { createSnapContentIndex } from '../src/utils/snapContent.js';
import { createStraightSegmentReader, extractStraightSegments, SNAP_SEGMENT_CAP } from '../src/survey/smartFillVector.js';
import { buildSnapContentIndex } from '../src/survey/snapContentIndex.js';
import { resolveDrawSnap } from '../src/utils/drawSnap.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const { OPS } = pdfjs;

function opList(items) {
  const fnArray = []; const argsArray = [];
  for (const it of items) {
    if (it.op === 'path') { fnArray.push(OPS.constructPath); argsArray.push([it.paint ?? OPS.stroke, [it.data], null]); }
    else { fnArray.push(OPS[it.op]); argsArray.push(it.args ?? null); }
  }
  return { fnArray, argsArray };
}

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('flag: snap-content is a Nightly beta flag', () => {
  assert.equal(FEATURE_FLAGS['snap-content']?.stage, 'beta');
});

test('index: an end beats a nearer midpoint or line; then midpoint; then the nearest point on the line', () => {
  const index = createSnapContentIndex();
  index.add(100, 100, 300, 100); // a wall, mid at (200, 100)
  index.add(100, 100, 100, 300);
  // 4 units off the corner: the corner.
  let hit = index.query(103, 97.5, 8);
  assert.equal(hit.kind, 'end');
  assert.deepEqual([hit.x, hit.y], [100, 100]);
  // Right on the line 6 units from the end: still the end (ends win).
  hit = index.query(294, 100, 8);
  assert.equal(hit.kind, 'end');
  assert.deepEqual([hit.x, hit.y], [300, 100]);
  // Near the middle.
  hit = index.query(205, 103, 8);
  assert.equal(hit.kind, 'mid');
  assert.deepEqual([hit.x, hit.y], [200, 100]);
  assert.deepEqual(hit.segment, [100, 100, 300, 100]);
  // Along the line, away from ends and midpoint: the foot of the perpendicular.
  hit = index.query(150, 104, 8);
  assert.equal(hit.kind, 'on');
  close(hit.x, 150); close(hit.y, 100);
  close(hit.distance, 4);
});

test('index: the tolerance is respected (inclusive) and nothing is found past it', () => {
  const index = createSnapContentIndex();
  index.add(0, 0, 500, 0);
  assert.equal(index.query(250, 8, 8)?.kind, 'mid');
  assert.equal(index.query(150, 8.01, 8), null);
  assert.equal(index.query(150, 7.9, 8)?.kind, 'on');
  assert.equal(index.query(-9, 0, 8), null);
  assert.equal(index.query(150, 5, 0), null);
  // Screen-constant: 8 px at scale 4 is 2 page units.
  assert.equal(index.query(150, 3, 8 / 4), null);
});

test('index: onSegment false (Shift angle lock) keeps ends and midpoints only', () => {
  const index = createSnapContentIndex();
  index.add(0, 0, 400, 0);
  assert.equal(index.query(100, 3, 8, { onSegment: false }), null);
  assert.equal(index.query(198, 3, 8, { onSegment: false })?.kind, 'mid');
});

test('index: long diagonal pieces are found anywhere along their length (grid walk)', () => {
  const index = createSnapContentIndex({ cellSize: 16 });
  index.add(3, 7, 2003, 1507);
  for (const t of [0.1, 0.33, 0.77, 0.9]) {
    const x = 3 + 2000 * t; const y = 7 + 1500 * t;
    // 5 units off the line, perpendicular.
    const hit = index.query(x - 3, y + 4, 6);
    assert.equal(hit?.kind, 'on', `t=${t}`);
    close(hit.x, x, 1e-6); close(hit.y, y, 1e-6);
  }
  assert.ok(index.cellCount < 400);
});

test('index: zero-length pieces (curve ends) are end targets only', () => {
  const index = createSnapContentIndex();
  index.add(50, 50, 50, 50);
  assert.deepEqual(index.query(53, 52, 8), { x: 50, y: 50, kind: 'end', distance: Math.hypot(3, 2), segment: [50, 50, 50, 50] });
});

test('reader: straight pieces through transforms, closes, curves (ends only) and clip-only paths', () => {
  const list = opList([
    { op: 'save' }, { op: 'transform', args: [2, 0, 0, 2, 10, 10] },
    { op: 'path', data: new Float32Array([0, 0, 0, 1, 50, 0, 1, 50, 30, 4]) },
    { op: 'restore' },
    { op: 'path', paint: OPS.endPath, data: new Float32Array([0, 0, 0, 1, 999, 0]) },
    { op: 'path', data: new Float32Array([0, 300, 300, 2, 310, 300, 320, 310, 320, 320]) },
  ]);
  const { segments, count, truncated } = extractStraightSegments(list, OPS, [1, 0, 0, -1, 0, 500]);
  assert.equal(truncated, false);
  // Triangle: 3 sides; curve: its two ends.
  assert.equal(count, 5);
  assert.deepEqual(segments.slice(0, 4), [10, 490, 110, 490]);
  assert.deepEqual(segments.slice(8, 12), [110, 430, 10, 490]); // the close-path side
  assert.deepEqual(segments.slice(12), [300, 200, 300, 200, 320, 180, 320, 180]);
});

test('reader: pieces wholly outside the clip are dropped', () => {
  const list = opList([
    { op: 'save' },
    { op: 'clip' }, { op: 'path', paint: OPS.endPath, data: new Float32Array([0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 0, 100, 4]) },
    { op: 'path', data: new Float32Array([0, 10, 10, 1, 90, 10]) },
    { op: 'path', data: new Float32Array([0, 300, 300, 1, 400, 300]) },
    { op: 'restore' },
    { op: 'path', data: new Float32Array([0, 300, 300, 1, 400, 300]) },
  ]);
  const { segments } = extractStraightSegments(list, OPS, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(segments, [10, 10, 90, 10, 300, 300, 400, 300]);
});

test('reader: the segment cap stops the read and says so', () => {
  const data = [];
  for (let i = 0; i < 200; i += 1) data.push(0, i, 0, 1, i, 10);
  const list = opList([{ op: 'path', data: new Float32Array(data) }]);
  const capped = extractStraightSegments(list, OPS, null, { maxSegments: 50 });
  assert.equal(capped.count, 50);
  assert.equal(capped.segments.length, 200);
  assert.equal(capped.truncated, true);
  assert.equal(extractStraightSegments(list, OPS, null).count, 200);
  assert.equal(SNAP_SEGMENT_CAP, 50000);
});

test('reader: resumable in small steps with the same result', () => {
  const items = [];
  for (let i = 0; i < 40; i += 1) items.push({ op: 'path', data: new Float32Array([0, i, 0, 1, i, 5]) });
  const list = opList(items);
  const got = [];
  const reader = createStraightSegmentReader(list, OPS, null, (...s) => got.push(...s));
  let steps = 0;
  while (!reader.step(3)) steps += 1;
  assert.ok(steps >= 12);
  assert.deepEqual(got, extractStraightSegments(list, OPS, null).segments);
});

test('build: sliced build yields between slices; over the cap it keeps the longest pieces', async () => {
  const items = [];
  // 3000 pieces, i units long (1..3000): the cap of 2000 keeps 1001..3000.
  for (let i = 1; i <= 3000; i += 1) items.push({ op: 'path', data: new Float32Array([0, 0, i * 2, 1, i, i * 2]) });
  let yields = 0;
  const built = await buildSnapContentIndex(opList(items), OPS, null, { sliceMs: 0, maxSegments: 2000, yieldSlice: async () => { yields += 1; } });
  assert.ok(yields >= 2);
  assert.equal(built.read, 3000);
  assert.equal(built.count, 2000);
  assert.equal(built.truncated, true);
  assert.equal(built.index.size, 2000);
  // The 3000-long piece is in; the 10-long one is not.
  assert.equal(built.index.query(2999, 6000, 2)?.kind, 'end');
  assert.equal(built.index.query(9, 20, 2), null);
  const small = await buildSnapContentIndex(opList(items.slice(0, 50)), OPS, null, { yieldSlice: async () => {} });
  assert.equal(small.count, 50);
  assert.equal(small.truncated, false);
});

test('reader: a run of tiny pieces (text strokes, flattened arcs) gives only its two ends', () => {
  const data = [0, 10, 10];
  for (let k = 1; k <= 20; k += 1) data.push(1, 10 + k * 0.2, 10);
  data.push(1, 50, 10);
  const { segments } = extractStraightSegments(opList([{ op: 'path', data: new Float32Array(data) }]), OPS, null);
  const rows = [];
  for (let i = 0; i < segments.length; i += 4) rows.push(segments.slice(i, i + 4).map((v) => Math.round(v * 100) / 100));
  assert.deepEqual(rows, [[10, 10, 10, 10], [14, 10, 14, 10], [14, 10, 50, 10]]);
});

test('resolveDrawSnap: mark ends win, then the drawing; Shift keeps only ends and midpoints', () => {
  const index = createSnapContentIndex();
  index.add(0, 0, 400, 0);
  const contentSnap = (p, tol, opts) => index.query(p.x, p.y, tol, opts);
  let r = resolveDrawSnap(null, { x: 3, y: 4 }, { tolPage: 8, contentSnap });
  assert.deepEqual(r.point, { x: 0, y: 0 });
  assert.equal(r.endpoint.content, true);
  assert.equal(r.endpoint.kind, 'end');
  r = resolveDrawSnap(null, { x: 3, y: 4 }, { tolPage: 8, contentSnap, candidates: [{ x: 5, y: 5 }] });
  assert.deepEqual(r.point, { x: 5, y: 5 });
  assert.equal(r.endpoint.content, undefined);
  r = resolveDrawSnap({ x: 100, y: 100 }, { x: 120, y: 3 }, { tolPage: 8, contentSnap, shiftKey: true, stepDeg: 45 });
  assert.notEqual(r.endpoint?.content, true);
  r = resolveDrawSnap(null, { x: 120, y: 3 }, { tolPage: 8, contentSnap });
  assert.equal(r.endpoint.kind, 'on');
  assert.deepEqual(r.point, { x: 120, y: 0 });
  r = resolveDrawSnap(null, { x: 120, y: 3 }, { tolPage: 8, contentSnap: null });
  assert.equal(r.endpoint, null);
});

test('real PDF: a pdf-lib line reads back at its page-unit ends (y down)', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawLine({ start: { x: 100, y: 692 }, end: { x: 400, y: 692 }, thickness: 2, color: rgb(0, 0, 0) });
  const bytes = await doc.save();
  const task = pdfjs.getDocument({ data: bytes, disableWorker: true, verbosity: pdfjs.VerbosityLevel.ERRORS });
  const pdf = await task.promise;
  const p1 = await pdf.getPage(1);
  const list = await p1.getOperatorList({ intent: 'display', annotationMode: 0 });
  const { index, count } = await buildSnapContentIndex(list, OPS, p1.getViewport({ scale: 1 }).transform, { yieldSlice: async () => {} });
  assert.equal(count, 1);
  const a = index.query(103, 97, 8);
  assert.equal(a.kind, 'end');
  close(a.x, 100, 0.01); close(a.y, 100, 0.01);
  const b = index.query(397, 103, 8);
  close(b.x, 400, 0.01); close(b.y, 100, 0.01);
  await task.destroy();
});
