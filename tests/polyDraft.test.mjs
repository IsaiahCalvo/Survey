import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLY_CLOSE_MIN_POINTS,
  POLY_DRAFT_TOOLS,
  POLY_MIN_POINTS,
  addPolyDraftPoint,
  canClosePolyDraft,
  canFinishPolyDraft,
  compactPolyDraftPoints,
  createPolyDraft,
  isPointNearPolyDraftFirstPoint,
  isPolyDraftTool,
  movePolyVertexPoints,
  normalizePolyPointsToLocal,
  polyDraftFinishControlPoints,
  resolvePolyDraftFinish,
  snapPolySegmentAngle,
  updatePolyDraftPreview,
} from '../src/utils/polyDraft.js';
import { buildPolyShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';

const draftFrom = (tool, points) => points
  .slice(1)
  .reduce((draft, point) => addPolyDraftPoint(draft, point), createPolyDraft(tool, points[0]));

// ---------------------------------------------------------------------------
// Draft construction
// ---------------------------------------------------------------------------

test('polygon and polyline are the two click-to-place tools', () => {
  assert.deepEqual(POLY_DRAFT_TOOLS, ['polygon', 'polyline']);
  assert.equal(isPolyDraftTool('polygon'), true);
  assert.equal(isPolyDraftTool('polyline'), true);
  assert.equal(isPolyDraftTool('rect'), false);
  assert.equal(createPolyDraft('rect', { x: 1, y: 2 }), null);
});

test('each click appends exactly one vertex and never mutates the previous draft', () => {
  const first = createPolyDraft('polygon', { x: 10, y: 10 });
  const second = addPolyDraftPoint(first, { x: 40, y: 10 });
  const third = addPolyDraftPoint(second, { x: 40, y: 50 });

  assert.equal(first.points.length, 1);
  assert.equal(second.points.length, 2);
  assert.equal(third.points.length, 3);
  assert.notEqual(first, second);
  assert.deepEqual(first.points, [{ x: 10, y: 10 }]);
  assert.deepEqual(third.points.at(-1), { x: 40, y: 50 });
});

test('Shift constrains the new segment to a 45 degree ray', () => {
  const snapped = snapPolySegmentAngle({ x: 0, y: 0 }, { x: 100, y: 6 });
  assert.equal(Math.round(snapped.y), 0);
  assert.equal(Math.round(snapped.x), 100);

  const draft = addPolyDraftPoint(createPolyDraft('polyline', { x: 0, y: 0 }), { x: 100, y: 6 }, { shiftKey: true });
  assert.equal(Math.round(draft.points[1].y), 0);
});

// ---------------------------------------------------------------------------
// Finish / close rules
// ---------------------------------------------------------------------------

test('minimum point counts: polygon needs 3, polyline needs 2, closing needs 3', () => {
  assert.equal(POLY_MIN_POINTS.polygon, 3);
  assert.equal(POLY_MIN_POINTS.polyline, 2);
  assert.equal(POLY_CLOSE_MIN_POINTS, 3);
});

test('a polygon draft cannot finish until it has three corners', () => {
  const two = draftFrom('polygon', [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  assert.equal(canFinishPolyDraft(two), false);
  assert.equal(canClosePolyDraft(two), false);
  assert.equal(resolvePolyDraftFinish(two, 'finish').ok, false);

  const three = addPolyDraftPoint(two, { x: 10, y: 10 });
  assert.equal(canFinishPolyDraft(three), true);
  assert.equal(canClosePolyDraft(three), true);
  const resolved = resolvePolyDraftFinish(three, 'finish');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.finalType, 'polygon');
  assert.equal(resolved.closed, true);
});

test('a polyline finishes open at two points but only closes at three', () => {
  const two = draftFrom('polyline', [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  assert.equal(canFinishPolyDraft(two), true);
  assert.equal(canClosePolyDraft(two), false);

  const openFinish = resolvePolyDraftFinish(two, 'finish');
  assert.equal(openFinish.ok, true);
  assert.equal(openFinish.finalType, 'polyline');
  assert.equal(openFinish.closed, false);

  assert.equal(resolvePolyDraftFinish(two, 'close').ok, false);

  const three = addPolyDraftPoint(two, { x: 10, y: 10 });
  const closed = resolvePolyDraftFinish(three, 'close');
  assert.equal(closed.ok, true);
  assert.equal(closed.finalType, 'polygon');
  assert.equal(closed.closed, true);
});

test('closing a polygon draft still produces a polygon', () => {
  const three = draftFrom('polygon', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  assert.equal(resolvePolyDraftFinish(three, 'close').finalType, 'polygon');
});

test('a rejected finish reports why and keeps the placed points', () => {
  const one = createPolyDraft('polygon', { x: 5, y: 5 });
  const resolved = resolvePolyDraftFinish(one, 'finish');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'too-few-points');
  assert.equal(resolved.minimum, 3);
  assert.equal(resolved.points.length, 1);
});

test('a duplicate final click is dropped instead of blocking the finish', () => {
  const compacted = compactPolyDraftPoints([
    { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 30.5, y: 30.2 },
  ]);
  assert.equal(compacted.length, 3);

  const draft = draftFrom('polygon', [
    { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 30.5, y: 30.2 },
  ]);
  const resolved = resolvePolyDraftFinish(draft, 'finish');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.points.length, 3);
});

// ---------------------------------------------------------------------------
// First-point hit detection + finish controls
// ---------------------------------------------------------------------------

test('finish controls sit on the first and the latest vertex', () => {
  const draft = draftFrom('polyline', [{ x: 1, y: 2 }, { x: 20, y: 2 }, { x: 20, y: 30 }]);
  const controls = polyDraftFinishControlPoints(draft);
  assert.deepEqual(controls.first, { x: 1, y: 2 });
  assert.deepEqual(controls.last, { x: 20, y: 30 });
  assert.equal(polyDraftFinishControlPoints(null), null);
});

test('first-point hit detection respects the radius and the close minimum', () => {
  const two = draftFrom('polygon', [{ x: 100, y: 100 }, { x: 200, y: 100 }]);
  // Two points can never close, so the first point is not a target yet.
  assert.equal(isPointNearPolyDraftFirstPoint({ x: 100, y: 100 }, two, 14), false);

  const three = addPolyDraftPoint(two, { x: 200, y: 200 });
  assert.equal(isPointNearPolyDraftFirstPoint({ x: 100, y: 100 }, three, 14), true);
  assert.equal(isPointNearPolyDraftFirstPoint({ x: 109, y: 100 }, three, 14), true);
  assert.equal(isPointNearPolyDraftFirstPoint({ x: 120, y: 100 }, three, 14), false);
  // A zero/absent radius never snaps.
  assert.equal(isPointNearPolyDraftFirstPoint({ x: 100, y: 100 }, three, 0), false);
});

test('the rubber-band preview snaps onto the first point inside the magnet', () => {
  const three = draftFrom('polygon', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);

  const away = updatePolyDraftPreview(three, { x: 60, y: 60 }, { snapRadius: 14 });
  assert.equal(away.snapToFirst, false);
  assert.deepEqual(away.preview, { x: 60, y: 60 });

  const near = updatePolyDraftPreview(three, { x: 4, y: 3 }, { snapRadius: 14 });
  assert.equal(near.snapToFirst, true);
  assert.deepEqual(near.preview, { x: 0, y: 0 });
  // Preview updates never touch the placed points.
  assert.deepEqual(near.points, three.points);
});

// ---------------------------------------------------------------------------
// Vertex editing
// ---------------------------------------------------------------------------

test('moving one vertex leaves every other vertex identical', () => {
  const points = [
    { x: 10, y: 10 }, { x: 90, y: 12 }, { x: 95, y: 80 }, { x: 12, y: 77 },
  ];
  const moved = movePolyVertexPoints(points, 2, { x: 140.25, y: 33.75 });

  assert.deepEqual(moved[2], { x: 140.25, y: 33.75 });
  assert.deepEqual(moved[0], points[0]);
  assert.deepEqual(moved[1], points[1]);
  assert.deepEqual(moved[3], points[3]);
  // The source array is untouched.
  assert.deepEqual(points[2], { x: 95, y: 80 });
});

test('an out-of-range vertex index is a no-op, not a hole in the point list', () => {
  const points = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
  assert.deepEqual(movePolyVertexPoints(points, 7, { x: 1, y: 1 }), points);
  assert.deepEqual(movePolyVertexPoints(points, -1, { x: 1, y: 1 }), points);
});

// ---------------------------------------------------------------------------
// Point list → annotation object
// ---------------------------------------------------------------------------

test('page points normalize to left/top plus local offsets', () => {
  const { left, top, points } = normalizePolyPointsToLocal([
    { x: 120, y: 200 }, { x: 80, y: 260 }, { x: 160, y: 300 },
  ]);
  assert.equal(left, 80);
  assert.equal(top, 200);
  assert.deepEqual(points, [{ x: 40, y: 0 }, { x: 0, y: 60 }, { x: 80, y: 100 }]);
});

test('a finished polygon commits as a filled, closed polygon object', () => {
  const json = buildPolyShapeCommitJSON({
    tool: 'polygon',
    id: 'poly-1',
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 180 }],
    strokeColor: '#ff0000',
    strokeOpacity: 100,
    fillColor: '#0000ff',
    fillOpacity: 50,
    strokeWidth: 4,
    lineBorderStyle: 'solid',
  });

  assert.equal(json.type, 'polygon');
  assert.equal(json.left, 100);
  assert.equal(json.top, 100);
  assert.equal(json.width, 100);
  assert.equal(json.height, 80);
  assert.deepEqual(json.points, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }]);
  assert.deepEqual(json.pathOffset, { x: 0, y: 0 });
  assert.equal(json.stroke, 'rgba(255, 0, 0, 1)');
  assert.equal(json.fill, 'rgba(0, 0, 255, 0.5)');
  assert.equal(json.strokeWidth, 4);
  assert.equal(json.strokeUniform, true);
  assert.equal(json.strokeDashArray, null);
  assert.equal(json.id, 'poly-1');
  assert.equal(json.data.id, 'poly-1');
  assert.equal(json.angle, 0);
  assert.equal(json.scaleX, 1);
  assert.equal(json.scaleY, 1);
});

test('a finished polyline commits open and unfilled', () => {
  const json = buildPolyShapeCommitJSON({
    tool: 'polyline',
    id: 'poly-2',
    points: [{ x: 0, y: 0 }, { x: 50, y: 25 }],
    strokeColor: '#00ff00',
    strokeOpacity: 100,
    fillColor: '#0000ff',
    fillOpacity: 100,
    strokeWidth: 2,
    lineBorderStyle: 'dashed',
  });

  assert.equal(json.type, 'polyline');
  assert.equal(json.fill, 'transparent');
  assert.deepEqual(json.strokeDashArray, [6, 4]);
});

test('the dotted border style reaches the committed object', () => {
  const json = buildPolyShapeCommitJSON({
    tool: 'polygon',
    id: 'poly-3',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    strokeColor: '#000000',
    strokeOpacity: 100,
    fillColor: 'transparent',
    fillOpacity: 100,
    strokeWidth: 1,
    lineBorderStyle: 'dotted',
  });
  assert.deepEqual(json.strokeDashArray, [2, 4]);
});

test('commit refuses point lists that are too short for the requested shape', () => {
  const shared = {
    id: 'x',
    strokeColor: '#000000',
    strokeOpacity: 100,
    fillColor: 'transparent',
    fillOpacity: 100,
    strokeWidth: 1,
    lineBorderStyle: 'solid',
  };
  assert.equal(buildPolyShapeCommitJSON({ ...shared, tool: 'polygon', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }), null);
  assert.equal(buildPolyShapeCommitJSON({ ...shared, tool: 'polyline', points: [{ x: 0, y: 0 }] }), null);
  assert.equal(buildPolyShapeCommitJSON({ ...shared, tool: 'rect', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }), null);
});

test('module and region scope stamp onto a committed polygon', () => {
  const json = buildPolyShapeCommitJSON({
    tool: 'polygon',
    id: 'poly-4',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    strokeColor: '#000000',
    strokeOpacity: 100,
    fillColor: 'transparent',
    fillOpacity: 100,
    strokeWidth: 1,
    lineBorderStyle: 'solid',
    selectedModuleId: 'module-9',
    stampRegionId: true,
    activeRegionId: 'region-3',
  });
  assert.equal(json.moduleId, 'module-9');
  assert.equal(json.regionId, 'region-3');
});
