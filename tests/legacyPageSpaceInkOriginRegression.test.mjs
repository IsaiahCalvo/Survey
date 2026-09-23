/**
 * Regression (2026-09-23): legacy pen strokes piled into the page's top-left
 * corner.
 *
 * The owner's "Benjamin Franklin Elementary.pdf" held red pen strokes saved
 * with left 0 / top 0, commands in PAGE coordinates, NO inkGeometrySpace
 * flag — and a Fabric origin pair originX 'left' / originY 'top'. Two
 * producers wrote that shape, both long before this fix:
 *   - the Fabric 5.5.2 FabricDrawingCanvas path:created handler (plain
 *     stroked paths: it zeroed left/top over page-coordinate commands), and
 *   - the SVG pen commit until 2026-07-25 (outline ink: PEN_FABRIC_RESIDUE's
 *     originX/originY leaked through createProductionPaperInk; 76c03744f
 *     stripped them for new strokes), plus eraser survivors of either baked
 *     before inkGeometrySpace existed.
 * The renderer of that era ignored the origin pair. createInkPathAffine
 * (4d64669b2, 2026-07-25) started honouring any explicit Fabric origin, so
 * each such stroke is drawn with its bounding box on the page origin — every
 * stroke lands in the top-left corner, overlapping. The move commit localizes
 * through the same affine, so moving one baked the corner position in.
 *
 * Pinned: the render affine, the selection bbox and the move commit all place
 * the legacy row where its commands say; genuinely local rows are unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commitInkObjectMove,
  createInkPathAffine,
  getInkCommandBounds,
  isAbsoluteInkGeometry,
} from '../src/utils/inkGeometryTransform.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';

const near = (actual, expected, label, tol = 0.75) => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ~${expected}, got ${actual}`,
  );
};

// Where the renderer puts the commands' bounding box on the page.
const drawnBounds = (object) => {
  const affine = createInkPathAffine(object, object.path);
  const b = getInkCommandBounds(object.path);
  const p1 = affine.point(b.minX, b.minY);
  const p2 = affine.point(b.maxX, b.maxY);
  return {
    minX: Math.min(p1.x, p2.x),
    minY: Math.min(p1.y, p2.y),
    maxX: Math.max(p1.x, p2.x),
    maxY: Math.max(p1.y, p2.y),
  };
};

// Outline ink exactly as the pre-2026-07-25 pen commit saved it: the
// production builder's output plus the leaked Fabric origin pair.
const legacyOutlineInk = () => ({
  ...createProductionPaperInk({
    id: 'legacy-outline',
    tool: 'pen',
    color: '#ff0000',
    width: 4,
    points: [
      { x: 945, y: 320 }, { x: 1010, y: 380 }, { x: 1060, y: 330 }, { x: 1124, y: 473 },
    ],
    data: {},
  }),
  originX: 'left',
  originY: 'top',
  version: '7.4.0',
});

// A Fabric 5.5.2 FabricDrawingCanvas stroke: plain stroked path, left/top
// zeroed, commands in page coordinates, Fabric 5's default left/top origin.
const legacyFabric5Stroke = () => ({
  type: 'path',
  version: '5.5.2',
  originX: 'left',
  originY: 'top',
  left: 0,
  top: 0,
  width: 256,
  height: 86,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  fill: null,
  stroke: '#ff0000',
  strokeWidth: 3,
  path: [['M', 550, 366], ['Q', 640, 400, 700, 420], ['L', 806, 452]],
  data: { id: 'legacy-fabric5' },
});

// A single-point tap: the builder's dot with the same leaked origin pair.
const legacyTap = () => ({
  ...createProductionPaperInk({
    id: 'legacy-tap',
    tool: 'pen',
    color: '#ff0000',
    width: 4,
    points: [{ x: 90, y: 530 }],
    data: {},
  }),
  originX: 'left',
  originY: 'top',
});

for (const [name, make] of [
  ['pre-07-25 outline pen ink', legacyOutlineInk],
  ['Fabric 5.5.2 stroked pen path', legacyFabric5Stroke],
  ['single-point tap', legacyTap],
]) {
  test(`${name} (left/top 0 + origin left/top, no space flag) renders at its page commands`, () => {
    const row = make();
    assert.ok(isAbsoluteInkGeometry(row), 'fixture is the legacy page-space shape');
    const cmd = getInkCommandBounds(row.path);
    const drawn = drawnBounds(row);
    near(drawn.minX, cmd.minX, 'drawn minX');
    near(drawn.minY, cmd.minY, 'drawn minY');
    near(drawn.maxX, cmd.maxX, 'drawn maxX');
    near(drawn.maxY, cmd.maxY, 'drawn maxY');

    const bbox = getAnnotationBBox(row);
    assert.ok(
      bbox.left > cmd.minX - 10 && bbox.top > cmd.minY - 10,
      `selection bbox must sit on the stroke, got ${JSON.stringify(bbox)}`,
    );
  });

  test(`${name}: moving it keeps its place plus the drag delta`, () => {
    const row = make();
    const cmd = getInkCommandBounds(row.path);
    const moved = commitInkObjectMove(row, 40, -25);
    const drawn = drawnBounds(moved);
    near(drawn.minX, cmd.minX + 40, 'moved minX');
    near(drawn.minY, cmd.minY - 25, 'moved minY');
  });
}

test('genuinely local rows keep Fabric origin semantics', () => {
  // A Fabric-serialized path positioned by left/top (non-zero): Fabric's
  // left/top origin places its box at left/top, whatever the commands say.
  const local = { ...legacyFabric5Stroke(), left: 300, top: 200 };
  assert.equal(isAbsoluteInkGeometry(local), false);
  const drawn = drawnBounds(local);
  // Fabric includes the stroke width in the placed box, so the geometry
  // starts half a stroke inside left/top.
  near(drawn.minX, 300 + 1.5, 'local minX');
  near(drawn.minY, 200 + 1.5, 'local minY');

  // An explicit 'local' declaration at left/top 0 is not reinterpreted.
  const declaredLocal = { ...legacyFabric5Stroke(), inkGeometrySpace: 'local' };
  const d2 = drawnBounds(declaredLocal);
  near(d2.minX, 1.5, 'declared-local minX');
  near(d2.minY, 1.5, 'declared-local minY');
});

test('fresh pen commits (no origin pair) are unchanged', () => {
  const fresh = createProductionPaperInk({
    id: 'fresh',
    tool: 'pen',
    color: '#ff0000',
    width: 4,
    points: [{ x: 200, y: 300 }, { x: 260, y: 340 }],
    data: {},
  });
  const cmd = getInkCommandBounds(fresh.path);
  const drawn = drawnBounds(fresh);
  near(drawn.minX, cmd.minX, 'fresh minX');
  near(drawn.minY, cmd.minY, 'fresh minY');
});
