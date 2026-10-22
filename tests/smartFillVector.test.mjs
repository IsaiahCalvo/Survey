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
