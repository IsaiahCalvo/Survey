import test from 'node:test';
import assert from 'node:assert/strict';
import { fitStroke, fittedPreviewPoints } from '../src/utils/smartInk.js';

const wobble = (i) => Math.sin(i * 1.7) * 1.5;
function lineStroke(ax, ay, bx, by, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: ax + ((bx - ax) * i) / n + wobble(i), y: ay + ((by - ay) * i) / n + wobble(i + 3) }));
}
function boxStroke(x, y, w, h, n = 20) {
  const pts = [];
  const side = (ax, ay, bx, by) => { for (let i = 0; i < n; i += 1) pts.push({ x: ax + ((bx - ax) * i) / n + wobble(pts.length), y: ay + ((by - ay) * i) / n + wobble(pts.length + 2) }); };
  side(x, y, x + w, y); side(x + w, y, x + w, y + h); side(x + w, y + h, x, y + h); side(x, y + h, x, y + 4);
  return pts;
}
function ovalStroke(cx, cy, a, b, n = 80, sweep = 1.95) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * sweep;
    return { x: cx + a * Math.cos(t) + wobble(i), y: cy + b * Math.sin(t) + wobble(i + 5) };
  });
}

test('a shaky straight stroke becomes a line between its ends', () => {
  const fit = fitStroke(lineStroke(100, 100, 400, 180));
  assert.equal(fit.kind, 'line');
  assert.ok(Math.abs(fit.start.x - 100) < 3 && Math.abs(fit.end.x - 400) < 3);
});

test('a box drawn round becomes a rectangle; a loop becomes an ellipse', () => {
  const rect = fitStroke(boxStroke(50, 60, 200, 120));
  assert.equal(rect.kind, 'rect');
  assert.ok(Math.abs(rect.start.x - 50) < 4 && Math.abs(rect.end.y - 180) < 4);
  const oval = fitStroke(ovalStroke(300, 300, 120, 70));
  assert.equal(oval.kind, 'ellipse');
});

test('scribbles, ticks and tiny strokes stay ink', () => {
  // A zigzag: long stroke, short chord.
  const zig = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 4, y: i % 2 ? 100 : 140 }));
  assert.equal(fitStroke(zig), null);
  // A check mark: two straight legs, not one line, not closed.
  const tick = [...lineStroke(0, 0, 40, 60, 10), ...lineStroke(40, 60, 140, -60, 20)];
  assert.equal(fitStroke(tick), null);
  // An open arc (half a circle) is neither closed nor straight.
  assert.equal(fitStroke(ovalStroke(200, 200, 100, 100, 60, 1)), null);
  assert.equal(fitStroke([{ x: 0, y: 0 }, { x: 5, y: 5 }]), null);
  assert.equal(fitStroke([]), null);
});

test('the highlighter only straightens', () => {
  assert.equal(fitStroke(lineStroke(10, 10, 300, 10), { lineOnly: true }).kind, 'line');
  assert.equal(fitStroke(boxStroke(50, 60, 200, 120), { lineOnly: true }), null);
});

test('the snapped preview traces the shape', () => {
  assert.equal(fittedPreviewPoints({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 9, y: 9 } }).length, 2);
  assert.equal(fittedPreviewPoints({ kind: 'rect', start: { x: 0, y: 0 }, end: { x: 9, y: 9 } }).length, 5);
  const oval = fittedPreviewPoints({ kind: 'ellipse', start: { x: 0, y: 0 }, end: { x: 20, y: 10 } });
  assert.ok(oval.length > 30);
  assert.ok(oval.every((p) => p.x >= -0.01 && p.x <= 20.01 && p.y >= -0.01 && p.y <= 10.01));
  assert.equal(fittedPreviewPoints(null), null);
});
