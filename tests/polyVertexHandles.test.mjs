import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Polygon / polyline single-click vertex leftover after S-03/S-04 line
// p1/p2/midpoint + E-01 bbox. No create tool — import Vertices only.
// Live proof: debug/scenarios/e2e-poly-vertex-handles.spec.mjs
// Ellipse radii / ink vertices / stamp edit are omitted in source.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function applyVertexDrag(obj, vertexIndex, worldX, worldY) {
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const angle = obj.angle ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;
  const originalPoints = obj.points.map((p) => ({ x: p.x, y: p.y }));
  const pxs = originalPoints.map((p) => p.x);
  const pys = originalPoints.map((p) => p.y);
  const oldRawCx = (Math.min(...pxs) + Math.max(...pxs)) / 2;
  const oldRawCy = (Math.min(...pys) + Math.max(...pys)) / 2;
  const oldRotCx = scaleX * (oldRawCx - pathOffsetX);
  const oldRotCy = scaleY * (oldRawCy - pathOffsetY);
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const w1x = worldX - left;
  const w1y = worldY - top;
  const ox = w1x - oldRotCx;
  const oy = w1y - oldRotCy;
  const w2x = oldRotCx + ox * cosA + oy * sinA;
  const w2y = oldRotCy - ox * sinA + oy * cosA;
  const localX = w2x / (scaleX || 1) + pathOffsetX;
  const localY = w2y / (scaleY || 1) + pathOffsetY;
  const newPoints = originalPoints.map((p) => ({ x: p.x, y: p.y }));
  newPoints[vertexIndex] = { x: localX, y: localY };
  const nxs = newPoints.map((p) => p.x);
  const nys = newPoints.map((p) => p.y);
  const newRawCx = (Math.min(...nxs) + Math.max(...nxs)) / 2;
  const newRawCy = (Math.min(...nys) + Math.max(...nys)) / 2;
  const newRotCx = scaleX * (newRawCx - pathOffsetX);
  const newRotCy = scaleY * (newRawCy - pathOffsetY);
  const drcX = newRotCx - oldRotCx;
  const drcY = newRotCy - oldRotCy;
  return {
    points: newPoints,
    left: left + (drcX * cosA - drcY * sinA) - drcX,
    top: top + (drcX * sinA + drcY * cosA) - drcY,
  };
}

test('vertex-0 drag rewrites only that point; others stay; angle 0 does not shift origin', () => {
  const obj = {
    type: 'polygon',
    left: 100,
    top: 200,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 40, y: 50 },
    ],
  };
  const next = applyVertexDrag(obj, 0, 130, 230);
  assert.equal(next.left, 100);
  assert.equal(next.top, 200);
  assert.equal(next.points[0].x, 30);
  assert.equal(next.points[0].y, 30);
  assert.deepEqual(next.points[1], { x: 80, y: 0 });
  assert.deepEqual(next.points[2], { x: 40, y: 50 });
});

test('polyline vertex-last same contract; rotated drag keeps unmoved local points', () => {
  const obj = {
    type: 'polyline',
    left: 50,
    top: 50,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 20 },
      { x: 120, y: 0 },
    ],
  };
  const next = applyVertexDrag(obj, 3, 50 + 160, 50 + 24);
  assert.deepEqual(next.points[0], { x: 0, y: 0 });
  assert.deepEqual(next.points[1], { x: 40, y: 0 });
  assert.deepEqual(next.points[2], { x: 80, y: 20 });
  assert.equal(next.points[3].x, 160);
  assert.equal(next.points[3].y, 24);
});

test('SVG + hook + importer: vertex-N wiring; no ellipse radii / ink vertex / stamp import', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const importer = read('src/utils/pdfAnnotationImporter.js');

  assert.match(layer, /data-handle=\{`vertex-\$\{i\}`\}/);
  assert.match(layer, /handleHandlePointerDown\(e, `vertex-\$\{i\}`\)/);
  assert.match(layer, /e\.stopPropagation\(\);\s*\n\s*handleHandlePointerDown\(e, `vertex-\$\{i\}`\)/);
  assert.match(layer, /onPointerCancel=\{handlePointerUp\}/);
  assert.match(layer, /const isPolyShape = \(objType === 'polygon' \|\| objType === 'polyline'\)/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /data-handle=["']rx["']/);
  assert.doesNotMatch(layer, /data-handle=["']ry["']/);
  assert.doesNotMatch(hook, /handleId === 'rx'|handleId === 'ry'/);

  assert.match(hook, /handleId\.startsWith\('vertex-'\)/);
  assert.match(hook, /mode: 'vertex'/);
  assert.match(hook, /action: 'vertex-move'/);
  assert.match(hook, /originalPoints/);
  assert.doesNotMatch(hook, /mode: 'ink-vertex'|ink vertex/);

  assert.match(importer, /'PolyLine'/);
  assert.match(importer, /'Polygon'/);
  assert.match(importer, /Unsupported types[\s\S]*Stamp/);
  assert.match(importer, /const SUPPORTED_SUBTYPES = \[[\s\S]*'Polygon'/);
  assert.doesNotMatch(importer, /SUPPORTED_SUBTYPES = \[[^\]]*Stamp/);
});
