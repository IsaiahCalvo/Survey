// Owner 2026-10-22: tag shapes the user teaches Smart fill. Once taught, a tag
// is found on pixels too (scans), even where it touches walls or other tags,
// which the plain flood fill cannot do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { adaptiveInkMaskFromRgba, findSimilarTags, findTagOutlineTolerant, traceOuterLoop } from '../src/survey/smartFillEngine.js';
import { extractClosedShapes, pointInRing } from '../src/survey/smartFillVector.js';
import {
  findOutlineWithTemplates,
  isTemplateShape,
  makeTemplateShape,
  outlineFromBox,
} from '../src/survey/smartFillTemplates.js';

function canvas(w, h) {
  const mask = new Uint8Array(w * h);
  const ink = (x, y) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1; };
  const circle = (cx, cy, r) => { for (let a = 0; a < 720; a += 1) { const t = (a / 720) * Math.PI * 2; ink(cx + r * Math.cos(t), cy + r * Math.sin(t)); } };
  const hline = (y, x0, x1) => { for (let x = x0; x <= x1; x += 1) ink(x, y); };
  const vline = (x, y0, y1) => { for (let y = y0; y <= y1; y += 1) ink(x, y); };
  return { mask, ink, circle, hline, vline };
}
const circleRing = (cx, cy, r) => Array.from({ length: 48 }, (_, k) => [cx + r * Math.cos((k / 48) * Math.PI * 2), cy + r * Math.sin((k / 48) * Math.PI * 2)]);
const bbox = (ring) => {
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('a taught shape keeps its outline in a unit box, its size and a fill signature', () => {
  const shape = makeTemplateShape(circleRing(50, 50, 10), { name: 'Device tag', now: 0 });
  assert.equal(isTemplateShape(shape), true);
  assert.equal(shape.name, 'Device tag');
  assert.ok(Math.abs(shape.width - 20) < 0.1 && Math.abs(shape.height - 20) < 0.1);
  assert.equal(shape.ring.length, 64);
  assert.ok(shape.ring.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1));
  assert.equal(shape.grid.length, 24 * 24);
  assert.equal(makeTemplateShape([[0, 0], [1, 1]]), null);
});

test('a divided circle touching a wall and the next tag: flood leaks, the taught shape fills it', () => {
  const W = 200; const H = 140;
  const { mask, circle, hline, vline } = canvas(W, H);
  hline(40, 0, W - 1);                 // a wall the tag touches
  circle(70, 70, 30); hline(70, 40, 100); vline(70, 70, 100); // the tag, with dividers
  circle(130, 70, 30);                 // the next tag, touching it
  vline(130, 100, 139);                // a leader line to its device
  const flood = findTagOutlineTolerant(mask, W, H, 60, 85);
  const floodOk = flood.ok && near(bbox(flood.ring), [40, 40, 101, 101], 3);
  assert.equal(floodOk, false, 'the flood fill should not get this one right');
  const taught = [makeTemplateShape(circleRing(0, 0, 30))];
  const found = findOutlineWithTemplates(mask, W, H, 60, 85, taught, 1);
  assert.equal(found.ok, true);
  assert.ok(near(bbox(found.ring), [40, 40, 100, 100], 2), JSON.stringify(bbox(found.ring)));
  // A tap in the other tag fills the other tag.
  const other = findOutlineWithTemplates(mask, W, H, 140, 60, taught, 1);
  assert.ok(near(bbox(other.ring), [100, 40, 160, 100], 2), JSON.stringify(bbox(other.ring)));
});

test('a taught shape does not match blank paper or solid ink', () => {
  const W = 120; const H = 120;
  const taught = [makeTemplateShape(circleRing(0, 0, 20))];
  const blank = new Uint8Array(W * H);
  assert.equal(findOutlineWithTemplates(blank, W, H, 60, 60, taught, 1).ok, false);
  const solid = new Uint8Array(W * H).fill(1);
  assert.equal(findOutlineWithTemplates(solid, W, H, 60, 60, taught, 1).ok, false);
});

test('a taught shape is found at 90-110% of its size and turned a quarter', () => {
  const W = 160; const H = 160;
  const { mask, hline, vline } = canvas(W, H);
  // A 44 x 22 box drawn upright as 22 x 44 (turned), at 105% size.
  hline(50, 60, 83); hline(96, 60, 83); vline(60, 50, 96); vline(83, 50, 96);
  const taught = [makeTemplateShape([[0, 0], [44, 0], [44, 22], [0, 22]])];
  const found = findOutlineWithTemplates(mask, W, H, 70, 70, taught, 1);
  assert.equal(found.ok, true);
  assert.ok(near(bbox(found.ring), [60, 50, 83, 96], 2), JSON.stringify(bbox(found.ring)));
});

test('find more: taught shapes find touching tags the flood cannot close', () => {
  const W = 300; const H = 120;
  const { mask, circle, hline } = canvas(W, H);
  hline(30, 0, W - 1);
  for (const cx of [50, 110, 170, 230]) { circle(cx, 60, 30); hline(60, cx - 30, cx + 30); }
  const taught = [makeTemplateShape(circleRing(0, 0, 30))];
  const sample = { width: 60, height: 60, grid: taught[0].grid };
  const found = findSimilarTags(mask, W, H, sample, { templates: taught, pxPerUnit: 1, outlineAt: findOutlineWithTemplates });
  assert.equal(found.length, 4);
});

test('teaching from a box: a round tag snaps to an ellipse; an empty box is the box', () => {
  const W = 64; const H = 64;
  const { mask, circle, hline } = canvas(W, H);
  circle(32, 32, 28); hline(32, 4, 60);
  const round = outlineFromBox(mask, W, H, traceOuterLoop);
  assert.equal(round.kind, 'ellipse');
  assert.ok(near(bbox(round.ring), [4, 4, 61, 61], 2), JSON.stringify(bbox(round.ring)));
  const empty = outlineFromBox(new Uint8Array(W * H), W, H, traceOuterLoop);
  assert.equal(empty.kind, 'box');
  assert.deepEqual(bbox(empty.ring), [0, 0, W, H]);
});

// The real Schneider sheet, read as pixels only (as a scan would be): tags
// that touch walls or each other. One taught tag fixes all of them.
test('Package 2 Rev 4 page 7 pixels: touching tags fail the flood, a taught tag fills them', async () => {
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync('debug/fixtures/package2-rev4.pdf')), verbosity: 0, disableFontFace: true, isEvalSupported: false });
  const doc = await task.promise;
  const page = await doc.getPage(7);
  const vp = page.getViewport({ scale: 1 });
  const shapes = extractClosedShapes(await page.getOperatorList({ intent: 'display', annotationMode: 0 }), pdfjs.OPS, vp.transform);
  const tags = shapes.filter((s) => s.curved && Math.abs(s.width - 20.2) < 0.5);
  // A 200-unit window holding a row of tags (the open-office cameras).
  const K = 3; const left = 60; const top = 500; const size = 200;
  const inWindow = tags.filter((t) => t.minX > left + 2 && t.maxX < left + size - 2 && t.minY > top + 2 && t.maxY < top + size - 2);
  assert.ok(inWindow.length >= 5, `tags in window: ${inWindow.length}`);
  const c = createCanvas(size * K, size * K);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: page.getViewport({ scale: K }), transform: [1, 0, 0, 1, -left * K, -top * K], background: 'white', annotationMode: 0 }).promise;
  const mask = adaptiveInkMaskFromRgba(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  const taught = [makeTemplateShape(tags[0].ring)];
  const iouish = (ring, tag) => {
    const [a, b, cc, d] = bbox(ring.map(([x, y]) => [left + x / K, top + y / K]));
    return Math.abs(a - tag.minX) < 1.5 && Math.abs(b - tag.minY) < 1.5 && Math.abs(cc - tag.maxX) < 1.5 && Math.abs(d - tag.maxY) < 1.5;
  };
  let floodRight = 0; let taughtRight = 0;
  for (const tag of inWindow) {
    const mx = ((tag.minX + tag.maxX) / 2 - left) * K; const my = ((tag.minY + tag.maxY) / 2 - top) * K + 4;
    const f = findTagOutlineTolerant(mask, c.width, c.height, mx, my);
    if (f.ok && iouish(f.ring, tag)) floodRight += 1;
    const t = findOutlineWithTemplates(mask, c.width, c.height, mx, my, taught, K);
    if (t.ok && iouish(t.ring, tag)) taughtRight += 1;
    assert.ok(pointInRing(tag.minX + tag.width / 2, tag.minY + tag.height / 2, tag.ring));
  }
  assert.equal(taughtRight, inWindow.length, `taught: ${taughtRight}/${inWindow.length}`);
  assert.ok(floodRight < inWindow.length, `flood: ${floodRight}/${inWindow.length}`);
  await task.destroy();
});
