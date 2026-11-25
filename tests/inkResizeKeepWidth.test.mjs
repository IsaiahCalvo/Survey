import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import {
  applyPageAffineToInkObject,
  createInkPathAffine,
  getInkCommandBounds,
  scaleInRotatedFrameAroundMatrix,
} from '../src/utils/inkGeometryTransform.js';
import {
  canRebuildInkWidth,
  readRestyleStyle,
  rebuildInkAtWidth,
  rebuildResizedPaperInk,
} from '../src/utils/selectionRestyle.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

test('KAL-812: uniform 2x resize of a 3 pt pen stroke keeps its 3 pt width and stretches its length', () => {
  const stroke = createProductionPaperInk({
    id: 'pen-horiz',
    tool: 'pen',
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    color: 'rgba(255, 0, 0, 1)',
    width: 3,
  });
  const resizedRaw = applyPageAffineToInkObject(stroke, [2, 0, 0, 2, -100, -100]);
  const rebuilt = rebuildResizedPaperInk(resizedRaw, stroke);

  assert.equal(rebuilt.scaleX, 1);
  assert.equal(rebuilt.scaleY, 1);
  assert.equal(rebuilt.sourceWidth, 3);
  assert.equal(readRestyleStyle(rebuilt).width, 3);
  assert.equal(canRebuildInkWidth(rebuilt), true);

  const affine = createInkPathAffine(rebuilt, rebuilt.path);
  const start = affine.point(rebuilt.paperCenterline[0]);
  const end = affine.point(rebuilt.paperCenterline[rebuilt.paperCenterline.length - 1]);
  assert.ok(Math.abs(start.x - 100) < 0.05 && Math.abs(start.y - 100) < 0.05);
  assert.ok(Math.abs(end.x - 300) < 0.05 && Math.abs(end.y - 100) < 0.05);

  const bounds = getInkCommandBounds(rebuilt.path);
  assert.ok(Math.abs(bounds.height - 3) < 0.25, `horizontal stroke thickness stays ~3 pt, got ${bounds.height}`);
  assert.ok(Math.abs(bounds.width - 203) < 0.5, `horizontal stroke length is ~203 pt, got ${bounds.width}`);

  // Width can still be changed afterward in Properties.
  const widened = rebuildInkAtWidth(rebuilt, 6);
  assert.equal(widened.sourceWidth, 6);
  assert.equal(readRestyleStyle(widened).width, 6);
});

test('KAL-812: non-uniform stretch (3x X, 0.5x Y) keeps uniform 3 pt stroke thickness on both axes', () => {
  const stroke = createProductionPaperInk({
    id: 'pen-L',
    tool: 'pen',
    points: [
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ],
    color: 'rgba(17, 24, 39, 1)',
    width: 3,
  });
  const resizedRaw = applyPageAffineToInkObject(stroke, [3, 0, 0, 0.5, 0, 0]);
  const rebuilt = rebuildResizedPaperInk(resizedRaw, stroke);

  assert.equal(rebuilt.scaleX, 1);
  assert.equal(rebuilt.scaleY, 1);
  assert.equal(readRestyleStyle(rebuilt).width, 3);

  // Measure vertical arm width near top cap (x=300, y=50) and horizontal arm
  // height near right cap (x=600, y=100) — straight segments have vertices at
  // their caps and join.
  const affine = createInkPathAffine(rebuilt, rebuilt.path);
  const pagePts = rebuilt.polygons[0][0].map(([x, y]) => affine.point(x, y));
  const vertCapXs = pagePts.filter((p) => p.y < 55).map((p) => p.x);
  const vertThickness = Math.max(...vertCapXs) - Math.min(...vertCapXs);
  const horizCapYs = pagePts.filter((p) => p.x > 590).map((p) => p.y);
  const horizThickness = Math.max(...horizCapYs) - Math.min(...horizCapYs);
  assert.ok(Math.abs(vertThickness - 3) < 0.3, `vertical arm thickness ~3 pt, got ${vertThickness}`);
  assert.ok(Math.abs(horizThickness - 3) < 0.3, `horizontal arm thickness ~3 pt, got ${horizThickness}`);
});

test('KAL-812: resizing a rotated pen stroke preserves its rotation angle, exact page position, and 3 pt width', () => {
  const base = createProductionPaperInk({
    id: 'pen-rot',
    tool: 'pen',
    points: [{ x: 100, y: 100 }, { x: 200, y: 140 }],
    color: 'rgba(0, 0, 255, 1)',
    width: 3,
  });
  const rotated = applyPageAffineToInkObject(base, [1, 0, 0, 1, 0, 0]);
  rotated.angle = 30;
  const beforeAffine = createInkPathAffine(rotated, rotated.path);
  const beforePts = rotated.paperCenterline.map((pt) => beforeAffine.point(pt));

  const pageMatrix = scaleInRotatedFrameAroundMatrix(2, 1.5, 30, 100, 100);
  const resizedRaw = applyPageAffineToInkObject(rotated, pageMatrix);
  const rebuilt = rebuildResizedPaperInk(resizedRaw, rotated);

  assert.equal(rebuilt.angle, 30);
  assert.equal(rebuilt.scaleX, 1);
  assert.equal(rebuilt.scaleY, 1);
  assert.equal(readRestyleStyle(rebuilt).width, 3);

  const afterAffine = createInkPathAffine(rebuilt, rebuilt.path);
  const [a, b, c, d, e, f] = pageMatrix;
  rebuilt.paperCenterline.forEach((pt, idx) => {
    const actual = afterAffine.point(pt);
    const expected = {
      x: a * beforePts[idx].x + c * beforePts[idx].y + e,
      y: b * beforePts[idx].x + d * beforePts[idx].y + f,
    };
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.05);
  });
});

test('KAL-812: variable-width Pro/Calligraphy pen and Highlighter keep original width and variable factors on resize', () => {
  const pro = createProductionPaperInk({
    id: 'pen-pro',
    tool: 'pen',
    points: [
      { x: 50, y: 50, f: 0.4 },
      { x: 100, y: 60, f: 1.0 },
      { x: 150, y: 50, f: 0.6 },
    ],
    color: 'rgba(0, 0, 0, 1)',
    width: 4,
    data: { penType: 'pro' },
  });
  const rebuiltPro = rebuildResizedPaperInk(
    applyPageAffineToInkObject(pro, [2.5, 0, 0, 2.5, 0, 0]),
    pro,
  );
  assert.equal(rebuiltPro.sourceWidth, 4);
  assert.equal(rebuiltPro.scaleX, 1);
  assert.equal(rebuiltPro.scaleY, 1);
  assert.deepEqual(rebuiltPro.data.penWidths, pro.data.penWidths);
  assert.equal(readRestyleStyle(rebuiltPro).width, 4);

  const hl = createProductionPaperInk({
    id: 'hl-1',
    tool: 'highlighter',
    points: [{ x: 40, y: 80 }, { x: 140, y: 80 }],
    color: 'rgba(255, 235, 59, 0.35)',
    width: 14,
  });
  const rebuiltHl = rebuildResizedPaperInk(
    applyPageAffineToInkObject(hl, [2, 0, 0, 2, 0, 0]),
    hl,
  );
  assert.equal(rebuiltHl.sourceWidth, 14);
  assert.equal(rebuiltHl.scaleX, 1);
  assert.equal(rebuiltHl.scaleY, 1);
  assert.equal(readRestyleStyle(rebuiltHl).width, 14);
});

test('KAL-812: partly erased strokes and imported outlines stay on affine transform without repainting erased ink', () => {
  const stroke = createProductionPaperInk({
    id: 'pen-erased',
    tool: 'pen',
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    color: 'rgba(255, 0, 0, 1)',
    width: 4,
  });
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [stroke] },
    eraserPoints: [{ x: 150, y: 90 }, { x: 150, y: 110 }],
    eraserRadius: 8,
    mode: 'partial',
  }).pageAnnotations.objects[0];
  assert.equal(erased.paperEraserGeometry, 'v1');
  const resizedRaw = applyPageAffineToInkObject(erased, [2, 0, 0, 2, 0, 0]);
  assert.equal(rebuildResizedPaperInk(resizedRaw, erased), resizedRaw);
});

test('KAL-812: a resized pen stroke can be partially erased cleanly at its new location', () => {
  const stroke = createProductionPaperInk({
    id: 'pen-resize-erase',
    tool: 'pen',
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    color: 'rgba(255, 0, 0, 1)',
    width: 4,
  });
  const rebuilt = rebuildResizedPaperInk(
    applyPageAffineToInkObject(stroke, [2, 0, 0, 2, -100, -100]),
    stroke,
  );
  // Stroke now runs from x=100 to x=300 at y=100. Cut across x=250 (past old maxX=200!).
  const res = erasePageAnnotations({
    pageAnnotations: { objects: [rebuilt] },
    eraserPoints: [{ x: 250, y: 90 }, { x: 250, y: 110 }],
    eraserRadius: 6,
    mode: 'partial',
  });
  assert.equal(res.didChange, true);
  assert.equal(res.deletedIds.length, 0);
  assert.equal(res.pageAnnotations.objects[0].polygons.length, 2, 'split into two halves at x=250');
});

test('KAL-812: useSVGInteraction invokes rebuildResizedPaperInk on both single and group path resize commits', () => {
  const src = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(src, /rebuildResizedPaperInk\(\s*applyPageAffineToInkObject\(obj,\s*pathResizePageMatrix\),\s*obj\s*\)/);
  assert.match(src, /rebuildResizedPaperInk\([\s\S]*?applyPageAffineToInkObject\([\s\S]*?groupPageMatrix/);
});
