// Owner 2026-10-22: Smart fill reads a vector PDF's own tag outlines first, so
// a tag touching a wall, a leader line or the next tag still fills exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractClosedShapes, pickShapeAtPoint, pixelsBeatVector, pointInRing, vectorAnswerIsTagSized } from '../src/survey/smartFillVector.js';
import { makeTemplateShape, vectorShapeMatchesTemplate } from '../src/survey/smartFillTemplates.js';

const { OPS } = pdfjs;
const K = 0.5523; // bezier circle constant

function circlePath(cx, cy, r) {
  const k = K * r;
  return new Float32Array([
    0, cx + r, cy,
    2, cx + r, cy + k, cx + k, cy + r, cx, cy + r,
    2, cx - k, cy + r, cx - r, cy + k, cx - r, cy,
    2, cx - r, cy - k, cx - k, cy - r, cx, cy - r,
    2, cx + k, cy - r, cx + r, cy - k, cx + r, cy,
    4,
  ]);
}
function rectPath(x, y, w, h) {
  return new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]);
}
function opList(items) {
  const fnArray = []; const argsArray = [];
  for (const it of items) {
    if (it.op === 'path') { fnArray.push(OPS.constructPath); argsArray.push([it.paint ?? OPS.stroke, [it.data], null]); }
    else { fnArray.push(OPS[it.op]); argsArray.push(it.args ?? null); }
  }
  return { fnArray, argsArray };
}
const box = (ring) => {
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 10) / 10);
};

test('a circle drawn as four curves is one closed tag shape, through transforms', () => {
  const list = opList([
    { op: 'save' }, { op: 'transform', args: [2, 0, 0, 2, 100, 100] },
    { op: 'path', data: circlePath(0, 0, 10) }, { op: 'restore' },
  ]);
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, -1, 0, 500]);
  assert.equal(shapes.length, 1);
  assert.deepEqual(box(shapes[0].ring), [80, 380, 120, 420]);
  assert.equal(shapes[0].curved, true);
});

test('clip-only paths, open lines and room-sized loops are not tag shapes', () => {
  const list = opList([
    { op: 'path', paint: OPS.endPath, data: rectPath(0, 0, 20, 20) },
    { op: 'path', data: new Float32Array([0, 0, 0, 1, 50, 0, 1, 50, 30]) },
    { op: 'path', data: rectPath(0, 0, 400, 300) },
    { op: 'path', data: rectPath(10, 10, 20, 12) },
  ]);
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]);
  assert.equal(shapes.length, 1);
  assert.deepEqual(box(shapes[0].ring), [10, 10, 30, 22]);
});

test('a tap anywhere in a tag fills the whole tag, even on its divider or inside a cell drawn as its own loop', () => {
  const list = opList([
    { op: 'path', data: rectPath(0, 0, 40, 20) },           // the tag
    { op: 'path', data: rectPath(0, 10, 20, 10) },          // its lower-left cell
    { op: 'path', data: new Float32Array([0, 0, 10, 1, 40, 10]) }, // divider (open)
  ]);
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]);
  for (const p of [{ x: 5, y: 15 }, { x: 30, y: 5 }, { x: 20, y: 10 }]) {
    assert.deepEqual(box(pickShapeAtPoint(shapes, p).ring), [0, 0, 40, 20], JSON.stringify(p));
  }
  assert.equal(pickShapeAtPoint(shapes, { x: 60, y: 60 }), null);
});

test('two overlapping tags: the tap goes to the one whose middle is nearer', () => {
  const list = opList([{ op: 'path', data: circlePath(50, 50, 10) }, { op: 'path', data: circlePath(64, 50, 10) }]);
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(box(pickShapeAtPoint(shapes, { x: 55, y: 50 }).ring), [40, 40, 60, 60]);
  assert.deepEqual(box(pickShapeAtPoint(shapes, { x: 59, y: 50 }).ring), [54, 40, 74, 60]);
});

test('a taught tag shape wins over a smaller symbol under the tap', () => {
  const list = opList([{ op: 'path', data: circlePath(50, 50, 10) }, { op: 'path', data: rectPath(52, 44, 6, 6) }]);
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(box(pickShapeAtPoint(shapes, { x: 55, y: 47 }).ring), [52, 44, 58, 50]);
  const taught = [makeTemplateShape(shapes.find((s) => s.curved).ring)];
  const pick = pickShapeAtPoint(shapes, { x: 55, y: 47 }, { prefer: (v) => vectorShapeMatchesTemplate(v, taught) });
  assert.deepEqual(box(pick.ring), [40, 40, 60, 60]);
});

test('a big vector answer gives way to a smaller pixel outline inside it', () => {
  const room = { minX: 0, minY: 0, maxX: 80, maxY: 60, width: 80, height: 60 };
  assert.equal(vectorAnswerIsTagSized(room), false);
  assert.equal(pixelsBeatVector(room, [[10, 10], [30, 10], [30, 25], [10, 25]]), true);
  assert.equal(pixelsBeatVector(room, [[-5, 10], [30, 10], [30, 25], [-5, 25]]), false);
});

// The real Schneider drawing (Package 2 - Rev 4, sheet SEC-B01E-P2): every
// tag on the sheet fills exactly from a tap at its middle (on its divider).
test('Package 2 Rev 4 page 7: every Schneider tag fills from its middle', async () => {
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync('debug/fixtures/package2-rev4.pdf')), verbosity: 0, disableFontFace: true, isEvalSupported: false });
  const doc = await task.promise;
  const page = await doc.getPage(7);
  const vp = page.getViewport({ scale: 1 });
  const shapes = extractClosedShapes(await page.getOperatorList({ intent: 'display', annotationMode: 0 }), OPS, vp.transform);
  const tags = shapes.filter((s) => s.curved && Math.abs(s.width - 20.2) < 0.5 && Math.abs(s.height - 20.2) < 0.5);
  assert.ok(tags.length >= 60, `found ${tags.length} tag circles`);
  for (const tag of tags) {
    const mid = { x: (tag.minX + tag.maxX) / 2, y: (tag.minY + tag.maxY) / 2 };
    assert.ok(pointInRing(mid.x, mid.y, tag.ring));
    assert.equal(pickShapeAtPoint(shapes, mid), tag);
  }
  await task.destroy();
});

// --- Revision clouds (owner 2026-10-26: "fill any type of cloud") ----------

// A cloud round a box: `perSide` scallops a side, each a curve bulging out.
function cloudArcs(x0, y0, x1, y1, perSide, bulge = 4) {
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const arcs = [];
  for (let side = 0; side < 4; side += 1) {
    const [ax, ay] = corners[side];
    const [bx, by] = corners[(side + 1) % 4];
    const [nx, ny] = normals[side];
    for (let i = 0; i < perSide; i += 1) {
      const p = [ax + ((bx - ax) * i) / perSide, ay + ((by - ay) * i) / perSide];
      const q = [ax + ((bx - ax) * (i + 1)) / perSide, ay + ((by - ay) * (i + 1)) / perSide];
      arcs.push([p, [p[0] + nx * bulge, p[1] + ny * bulge], [q[0] + nx * bulge, q[1] + ny * bulge], q]);
    }
  }
  return arcs;
}
const arcPath = ([p, c1, c2, q]) => new Float32Array([0, p[0], p[1], 2, c1[0], c1[1], c2[0], c2[1], q[0], q[1]]);
const cloudOnePath = (arcs) => new Float32Array([0, arcs[0][0][0], arcs[0][0][1],
  ...arcs.flatMap(([, c1, c2, q]) => [2, c1[0], c1[1], c2[0], c2[1], q[0], q[1]]), 4]);

test('a cloud drawn as separate arcs, end to start, is one cloud shape (Schneider style)', () => {
  const arcs = cloudArcs(100, 100, 400, 260, 8);
  const list = opList(arcs.map((a) => ({ op: 'path', data: arcPath(a) })));
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]);
  const clouds = shapes.filter((s) => s.cloud);
  assert.equal(clouds.length, 1);
  const [x0, y0, x1, y1] = box(clouds[0].ring);
  assert.ok(x0 < 100 && y0 < 100 && x1 > 400 && y1 > 260, `${x0},${y0},${x1},${y1}`);
});

test('a cloud drawn as one path of curves is a cloud shape too, bigger than any tag', () => {
  const list = opList([{ op: 'path', data: cloudOnePath(cloudArcs(50, 50, 650, 450, 12, 8)) }]);
  const clouds = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]).filter((s) => s.cloud);
  assert.equal(clouds.length, 1);
  assert.ok(clouds[0].width > 600);
});

test('circles, rounded boxes, open arc runs and broken chains are not clouds', () => {
  const rounded = new Float32Array([0, 110, 100, 1, 290, 100, 2, 300, 100, 300, 100, 300, 110, 1, 300, 190,
    2, 300, 200, 300, 200, 290, 200, 1, 110, 200, 2, 100, 200, 100, 200, 100, 190, 1, 100, 110,
    2, 100, 100, 100, 100, 110, 100, 4]);
  const arcs = cloudArcs(500, 100, 700, 200, 6);
  const list = opList([
    { op: 'path', data: circlePath(50, 50, 40) },
    { op: 'path', data: rounded },
    // A run of arcs that never closes (a door swing row, a cloud cut short).
    ...arcs.slice(0, 15).map((a) => ({ op: 'path', data: arcPath(a) })),
    { op: 'path', data: rectPath(800, 100, 20, 20) },
    ...arcs.slice(15).map((a) => ({ op: 'path', data: arcPath(a) })),
  ]);
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]);
  assert.equal(shapes.filter((s) => s.cloud).length, 0);
});

test('a tap on a tag inside a cloud fills the tag; elsewhere in the cloud, the cloud', () => {
  const arcs = cloudArcs(100, 100, 400, 260, 8);
  const list = opList([
    ...arcs.map((a) => ({ op: 'path', data: arcPath(a) })),
    { op: 'path', data: circlePath(150, 150, 10) },
  ]);
  const shapes = extractClosedShapes(list, OPS, [1, 0, 0, 1, 0, 0]);
  const tag = pickShapeAtPoint(shapes, { x: 150, y: 152 });
  assert.deepEqual(box(tag.ring), [140, 140, 160, 160]);
  assert.equal(tag.cloud, undefined);
  const cloud = pickShapeAtPoint(shapes, { x: 300, y: 200 });
  assert.equal(cloud.cloud, true);
  assert.equal(vectorAnswerIsTagSized(cloud), true);
});

test('cloud marks on the page (imported or drawn in Survey) are cloud shapes', async () => {
  const { cloudMarkShapes } = await import('../src/survey/smartFillClouds.js');
  const shapes = cloudMarkShapes([
    { type: 'polygon', left: 100, top: 100, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }], data: { pdfCloudIntensity: 2 } },
    { type: 'rect', left: 300, top: 300, width: 100, height: 50, data: { pdfCloudIntensity: 1 } },
    { type: 'rect', left: 0, top: 0, width: 10, height: 10, data: {} },
    { type: 'polygon', left: 0, top: 0, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], data: { pdfCloudIntensity: 2 }, visible: false },
  ]);
  assert.equal(shapes.length, 2);
  assert.ok(shapes.every((s) => s.cloud && s.mark));
  assert.ok(pointInRing(220, 120, shapes[0].ring));
  assert.ok(pointInRing(350, 320, shapes[1].ring));
});
