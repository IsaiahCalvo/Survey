/**
 * Regression: a box-selected mix of marks must move as one rigid group, and no
 * member may land on the page origin.
 *
 * The 2026-09-22 bug (owner video, desktop web at 81%): after box-selecting a
 * red pen stroke, a cloud rectangle, a cloud polyline and a filled cloud and
 * dragging them, pieces of the ink appeared in the page's TOP-LEFT corner
 * instead of where they were dropped, and each further drag stranded another
 * piece there.
 *
 * Root cause: an eraser survivor is re-baked into PAGE space (left/top 0,
 * commands in page coordinates, inkGeometrySpace 'page'), but the bake copied
 * the source object's Fabric `originX`/`originY` across. A move stamps
 * originX/originY 'center', so erasing a stroke that had been moved produced a
 * page-space row carrying a centre origin — and createInkPathAffine then applied
 * Fabric's centre offset a SECOND time, parking the stroke's own centre on the
 * page origin. createProductionPaperInk strips exactly that pair for exactly
 * this reason (PEN_FABRIC_RESIDUE, annotationCreationCommit.js).
 *
 * Both halves are pinned here: the producer (the bake must not emit the pair)
 * and the consumer (a declared page-space carrier must ignore it, so rows
 * already saved that way still render where their commands say).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commitInkObjectMove,
  createInkPathAffine,
  getInkCommandBounds,
  isAbsoluteInkGeometry,
} from '../src/utils/inkGeometryTransform.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';

const DX = 120;
const DY = -60;
const PAGE = { width: 612, height: 792 };

// A multi-segment pen stroke in page space, exactly as the pen commits one.
const makePenStroke = (offsetX = 0, offsetY = 0) => createProductionPaperInk({
  points: [
    { x: 160 + offsetX, y: 220 + offsetY, pressure: 0.5 },
    { x: 210 + offsetX, y: 300 + offsetY, pressure: 0.7 },
    { x: 180 + offsetX, y: 380 + offsetY, pressure: 0.6 },
    { x: 260 + offsetX, y: 430 + offsetY, pressure: 0.8 },
  ],
  color: '#ff0000',
  width: 6,
  tool: 'pen',
  id: `stroke-${offsetX}-${offsetY}`,
  data: {},
  metadata: {},
});

const cloudRect = () => ({
  type: 'Rect',
  left: 140,
  top: 500,
  width: 180,
  height: 120,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  originX: 'left',
  originY: 'top',
  stroke: '#ff0000',
  strokeWidth: 3,
  fill: null,
  data: { type: 'rect', borderStyle: 'cloud' },
});

const cloudPolyline = () => ({
  type: 'polyline',
  left: 330,
  top: 480,
  width: 150,
  height: 140,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  pathOffset: { x: 0, y: 0 },
  originX: 'left',
  originY: 'top',
  points: [{ x: 0, y: 140 }, { x: 40, y: 20 }, { x: 110, y: 90 }, { x: 150, y: 0 }],
  stroke: '#ff0000',
  strokeWidth: 3,
  fill: null,
  data: { type: 'polyline', borderStyle: 'cloud' },
});

const filledCloudPolygon = () => ({
  type: 'polygon',
  left: 360,
  top: 180,
  width: 120,
  height: 110,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  pathOffset: { x: 0, y: 0 },
  originX: 'left',
  originY: 'top',
  points: [{ x: 0, y: 0 }, { x: 120, y: 15 }, { x: 100, y: 110 }, { x: 10, y: 95 }],
  stroke: '#ff0000',
  strokeWidth: 3,
  fill: 'rgba(255, 0, 0, 1)',
  data: { type: 'polygon', borderStyle: 'cloud' },
});

// The one-partial-erase survivor of a stroke that has already been moved once.
// This is the shape the owner's document was full of.
const makeMovedThenErasedStroke = () => {
  const moved = commitInkObjectMove(makePenStroke(0, 0), 30, 20);
  assert.equal(moved.originX, 'center', 'a move stamps a Fabric centre origin');
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [moved] },
    eraserPoints: [{ x: 240, y: 320 }],
    eraserRadius: 5,
    mode: 'partial',
  });
  assert.equal(erased.didChange, true, 'the partial erase produced a survivor');
  const survivor = erased.pageAnnotations.objects[0];
  assert.equal(survivor.inkGeometrySpace, 'page', 'the survivor is baked into page space');
  return survivor;
};

// Where a mark actually draws, in page units: the affine for ink, left/top for
// everything else. This is the same resolution the SVG layer and the selection
// overlay use.
const drawnTopLeft = (obj) => {
  if (String(obj.type || '').toLowerCase() === 'path' && Array.isArray(obj.path)) {
    const bounds = getInkCommandBounds(obj.path);
    const affine = createInkPathAffine(obj, obj.path);
    const corners = [
      affine.point(bounds.minX, bounds.minY),
      affine.point(bounds.maxX, bounds.minY),
      affine.point(bounds.maxX, bounds.maxY),
      affine.point(bounds.minX, bounds.maxY),
    ];
    return {
      x: Math.min(...corners.map((p) => p.x)),
      y: Math.min(...corners.map((p) => p.y)),
    };
  }
  const bbox = getAnnotationBBox(obj);
  return { x: bbox.left, y: bbox.top };
};

// The group-move commit in useSVGInteraction: absolute-space ink goes through
// commitInkObjectMove, every other type accumulates the delta onto its captured
// left/top. Mirrored here so the test moves the mix exactly as a drag does.
const groupMove = (objects, dx, dy) => objects.map((obj) => {
  if (isAbsoluteInkGeometry(obj)) return commitInkObjectMove(obj, dx, dy);
  return { ...obj, left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy };
});

test('a box-selected mix of marks moves rigidly and never lands on the page origin', () => {
  const mix = [
    makePenStroke(0, 0),
    makeMovedThenErasedStroke(),
    cloudRect(),
    cloudPolyline(),
    filledCloudPolygon(),
  ];
  const before = mix.map(drawnTopLeft);

  // Nothing starts stranded in the corner: a page-space survivor renders where
  // its own commands are, whatever Fabric origin history it carries.
  before.forEach((point, index) => {
    assert.ok(
      point.x > 20 || point.y > 20,
      `member ${index} starts at the page origin (${point.x}, ${point.y})`,
    );
  });

  const moved = groupMove(mix, DX, DY);
  const after = moved.map(drawnTopLeft);

  after.forEach((point, index) => {
    assert.ok(
      Math.abs((point.x - before[index].x) - DX) < 1e-6
      && Math.abs((point.y - before[index].y) - DY) < 1e-6,
      `member ${index} moved by (${point.x - before[index].x}, ${point.y - before[index].y})`
      + ` instead of (${DX}, ${DY})`,
    );
    assert.ok(
      point.x > 20 || point.y > 20,
      `member ${index} landed on the page origin (${point.x}, ${point.y})`,
    );
    assert.ok(
      point.x < PAGE.width && point.y < PAGE.height,
      `member ${index} left the page (${point.x}, ${point.y})`,
    );
  });

  // Repeated drags must keep tracking: the owner's report was that each further
  // move stranded another piece.
  let carried = moved;
  let expectedX = after.map((p) => p.x);
  let expectedY = after.map((p) => p.y);
  for (let pass = 0; pass < 3; pass += 1) {
    carried = groupMove(carried, 10, 12);
    expectedX = expectedX.map((x) => x + 10);
    expectedY = expectedY.map((y) => y + 12);
    carried.map(drawnTopLeft).forEach((point, index) => {
      assert.ok(
        Math.abs(point.x - expectedX[index]) < 1e-6
        && Math.abs(point.y - expectedY[index]) < 1e-6,
        `pass ${pass}: member ${index} drifted to (${point.x}, ${point.y})`,
      );
    });
  }
});

test('every point of an erased-then-moved stroke shifts by the same delta', () => {
  const survivor = makeMovedThenErasedStroke();
  const affineBefore = createInkPathAffine(survivor, survivor.path);
  const movedSurvivor = commitInkObjectMove(survivor, DX, DY);
  const affineAfter = createInkPathAffine(movedSurvivor, movedSurvivor.path);

  assert.deepEqual(
    movedSurvivor.path,
    survivor.path,
    'a move never rewrites the authored commands',
  );

  const samples = [];
  for (const command of survivor.path) {
    for (let index = 1; index + 1 < command.length; index += 2) {
      const x = Number(command[index]);
      const y = Number(command[index + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) samples.push({ x, y });
    }
  }
  assert.ok(samples.length > 8, 'the survivor has real geometry to check');

  for (const sample of samples) {
    const from = affineBefore.point(sample.x, sample.y);
    const to = affineAfter.point(sample.x, sample.y);
    assert.ok(
      Math.abs((to.x - from.x) - DX) < 1e-6 && Math.abs((to.y - from.y) - DY) < 1e-6,
      `point (${sample.x}, ${sample.y}) moved by (${to.x - from.x}, ${to.y - from.y})`,
    );
  }

  // Every polygon vertex rides the same affine, so the filled outline the user
  // sees cannot part company with the stroke's path.
  for (const polygon of movedSurvivor.polygons || []) {
    for (const ring of polygon || []) {
      for (const [x, y] of ring) {
        const from = affineBefore.point(x, y);
        const to = affineAfter.point(x, y);
        assert.ok(
          Math.abs((to.x - from.x) - DX) < 1e-6 && Math.abs((to.y - from.y) - DY) < 1e-6,
          `polygon vertex (${x}, ${y}) moved by (${to.x - from.x}, ${to.y - from.y})`,
        );
      }
    }
  }
});

test('a page-space eraser survivor carries no Fabric origin, and a stale one is ignored', () => {
  const survivor = makeMovedThenErasedStroke();
  assert.equal(survivor.originX, undefined, 'the bake drops the source originX');
  assert.equal(survivor.originY, undefined, 'the bake drops the source originY');

  // Rows already saved with the stale pair (the owner's document) must still
  // resolve to their command coordinates, so no migration is needed.
  const stale = { ...survivor, originX: 'center', originY: 'center' };
  const bounds = getInkCommandBounds(stale.path);
  const healthy = createInkPathAffine(survivor, survivor.path).point(bounds.minX, bounds.minY);
  const repaired = createInkPathAffine(stale, stale.path).point(bounds.minX, bounds.minY);
  assert.ok(
    Math.abs(repaired.x - healthy.x) < 1e-9 && Math.abs(repaired.y - healthy.y) < 1e-9,
    `a stale centre origin still renders at ${JSON.stringify(repaired)}`,
  );

  // And a move of such a row lands it where the drag put it, not on the origin.
  const movedStale = commitInkObjectMove(stale, DX, DY);
  const landed = createInkPathAffine(movedStale, movedStale.path).point(bounds.minX, bounds.minY);
  assert.ok(
    Math.abs(landed.x - (healthy.x + DX)) < 1e-6
    && Math.abs(landed.y - (healthy.y + DY)) < 1e-6,
    `a stale-origin row landed at ${JSON.stringify(landed)}`,
  );
});
