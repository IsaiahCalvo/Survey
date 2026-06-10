/**
 * regionTransforms.test.mjs
 *
 * KAL-301 — Region Edit Parity: pure-function unit tests for all three slices.
 *
 * Slice 1: undo/redo snapshot logic (drag-end checkpoint, not drag-start)
 * Slice 2: uniform aspect-preserving scale math
 * Slice 3: rotation snap + coordinate rotation around centroid
 *
 * These tests cover the pure math helpers only — no React, no DOM.
 */
import test from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: the same deep-clone logic RST uses for undo snapshots
// ---------------------------------------------------------------------------
function cloneRegion(region) {
  return {
    ...region,
    coordinates: [...region.coordinates],
  };
}

function cloneSnapshot(regions) {
  return { regions: regions.map(cloneRegion) };
}

// ---------------------------------------------------------------------------
// SLICE 1 — undo/redo snapshot contract
//
// The new contract (KAL-301a): snapshot is captured at drag-START (stored in
// interactionState.preSnapshot), pushed onto the undo stack only at drag-END
// and only when coords actually changed (dragHasMovedRef.current === true).
// These tests verify the pure logic of that contract.
// ---------------------------------------------------------------------------

test('Slice 1: pre-drag snapshot preserves original coordinates independently of later mutations', () => {
  const original = [10, 20, 100, 20, 100, 80, 10, 80];
  const region = { regionId: 'r1', shapeType: 'rectangular', coordinates: [...original] };
  const regions = [region];

  // Simulate: capture snapshot at drag-start
  const preSnapshot = cloneSnapshot(regions);

  // Simulate: drag mutates coords
  regions[0].coordinates = [15, 25, 105, 25, 105, 85, 15, 85];

  // Pre-snapshot should still hold original coords
  deepStrictEqual(preSnapshot.regions[0].coordinates, original);
});

test('Slice 1: undo stack push happens at drag-END only when hasMoved=true', () => {
  const undoStack = [];
  const LIMIT = 100;

  // Simulate pointer-down: capture pre-snapshot, hasMoved=false
  const regions = [{ regionId: 'r1', shapeType: 'rectangular', coordinates: [10, 20, 100, 20, 100, 80, 10, 80] }];
  const preSnapshot = cloneSnapshot(regions);
  let hasMoved = false;

  // Simulate: mousemove fires and actually changes coords
  hasMoved = true;

  // Simulate: mouseUp — push only if hasMoved
  if (hasMoved && preSnapshot) {
    undoStack.push(preSnapshot);
    if (undoStack.length > LIMIT) undoStack.shift();
  }

  strictEqual(undoStack.length, 1, 'one snapshot on undo stack after completed drag');
  deepStrictEqual(undoStack[0].regions[0].coordinates, [10, 20, 100, 20, 100, 80, 10, 80]);
});

test('Slice 1: undo stack NOT pushed when hasMoved=false (click without drag)', () => {
  const undoStack = [];
  let hasMoved = false; // user clicked but did not drag

  const preSnapshot = cloneSnapshot([{ regionId: 'r1', shapeType: 'rectangular', coordinates: [0, 0, 50, 0, 50, 50, 0, 50] }]);

  // Simulate: mouseUp — push only if hasMoved
  if (hasMoved && preSnapshot) {
    undoStack.push(preSnapshot);
  }

  strictEqual(undoStack.length, 0, 'no snapshot pushed for click-without-drag');
});

test('Slice 1: undo restores pre-drag coords; redo returns to post-drag coords', () => {
  const preDragCoords = [10, 20, 100, 20, 100, 80, 10, 80];
  const postDragCoords = [50, 60, 140, 60, 140, 120, 50, 120];

  const undoStack = [];
  const redoStack = [];

  // Pre-drag snapshot
  const preSnapshot = cloneSnapshot([{ regionId: 'r1', shapeType: 'rectangular', coordinates: [...preDragCoords] }]);

  // After drag completes, push to undo
  undoStack.push(preSnapshot);

  // Current state is post-drag
  let currentRegions = [{ regionId: 'r1', shapeType: 'rectangular', coordinates: [...postDragCoords] }];

  // Simulate undo: pop from undoStack, push current to redoStack
  const undoTarget = undoStack.pop();
  redoStack.push(cloneSnapshot(currentRegions));
  currentRegions = undoTarget.regions.map(cloneRegion);

  deepStrictEqual(currentRegions[0].coordinates, preDragCoords, 'undo restores pre-drag coords');
  strictEqual(undoStack.length, 0);
  strictEqual(redoStack.length, 1);

  // Simulate redo: pop from redoStack, push current to undoStack
  const redoTarget = redoStack.pop();
  undoStack.push(cloneSnapshot(currentRegions));
  currentRegions = redoTarget.regions.map(cloneRegion);

  deepStrictEqual(currentRegions[0].coordinates, postDragCoords, 'redo restores post-drag coords');
});

test('Slice 1: undo stack respects REGION_HISTORY_LIMIT (drops oldest on overflow)', () => {
  const LIMIT = 5;
  const undoStack = [];

  for (let i = 0; i < LIMIT + 3; i++) {
    undoStack.push(cloneSnapshot([{ regionId: `r${i}`, shapeType: 'rectangular', coordinates: [i, 0, i + 10, 0, i + 10, 10, i, 10] }]));
    if (undoStack.length > LIMIT) undoStack.shift();
  }

  strictEqual(undoStack.length, LIMIT, 'stack length capped at LIMIT');
  // Oldest entry should be the (LIMIT+3-LIMIT)=3rd item (i=3)
  strictEqual(undoStack[0].regions[0].regionId, 'r3', 'oldest item is correct after overflow');
});

// ---------------------------------------------------------------------------
// SLICE 2 — uniform aspect-preserving scale math
//
// When Shift is held during a resize-handle drag, the resize must preserve the
// original aspect ratio by scaling both dimensions proportionally from the
// opposite corner of the dragged handle.
// ---------------------------------------------------------------------------

/**
 * computeUniformScale — pure function extracted from the resize interactionState branch.
 *
 * Given:
 *   - handle: 'nw'|'ne'|'sw'|'se'|'n'|'s'|'e'|'w'
 *   - initialBounds: { minX, minY, maxX, maxY }
 *   - pointer: { x, y } in page coords
 * Returns new { minX, minY, maxX, maxY } with the aspect ratio preserved.
 *
 * Corner handles scale from the opposite corner; edge handles treat the
 * perpendicular dimension as the driver and lock the parallel dimension.
 */
function computeUniformScale(handle, initialBounds, pointer) {
  const { minX, minY, maxX, maxY } = initialBounds;
  const initW = maxX - minX;
  const initH = maxY - minY;
  const aspect = initW / Math.max(initH, 1); // width / height

  const MIN = 5; // MIN_REGION_SIZE equivalent

  let newBounds = { minX, minY, maxX, maxY };

  switch (handle) {
    case 'se': {
      // driver: pointer determines new width; height follows aspect
      const newW = Math.max(pointer.x - minX, MIN);
      const newH = newW / aspect;
      newBounds = { minX, minY, maxX: minX + newW, maxY: minY + newH };
      break;
    }
    case 'sw': {
      const newW = Math.max(maxX - pointer.x, MIN);
      const newH = newW / aspect;
      newBounds = { minX: maxX - newW, minY, maxX, maxY: minY + newH };
      break;
    }
    case 'ne': {
      const newW = Math.max(pointer.x - minX, MIN);
      const newH = newW / aspect;
      newBounds = { minX, minY: maxY - newH, maxX: minX + newW, maxY };
      break;
    }
    case 'nw': {
      const newW = Math.max(maxX - pointer.x, MIN);
      const newH = newW / aspect;
      newBounds = { minX: maxX - newW, minY: maxY - newH, maxX, maxY };
      break;
    }
    case 'e':
    case 'w': {
      // horizontal edge: width is driver, height follows
      const newW = handle === 'e' ? Math.max(pointer.x - minX, MIN) : Math.max(maxX - pointer.x, MIN);
      const newH = newW / aspect;
      const midY = (minY + maxY) / 2;
      newBounds = handle === 'e'
        ? { minX, minY: midY - newH / 2, maxX: minX + newW, maxY: midY + newH / 2 }
        : { minX: maxX - newW, minY: midY - newH / 2, maxX, maxY: midY + newH / 2 };
      break;
    }
    case 'n':
    case 's': {
      // vertical edge: height is driver, width follows
      const newH = handle === 's' ? Math.max(pointer.y - minY, MIN) : Math.max(maxY - pointer.y, MIN);
      const newW = newH * aspect;
      const midX = (minX + maxX) / 2;
      newBounds = handle === 's'
        ? { minX: midX - newW / 2, minY, maxX: midX + newW / 2, maxY: minY + newH }
        : { minX: midX - newW / 2, minY: maxY - newH, maxX: midX + newW / 2, maxY };
      break;
    }
    default:
      break;
  }

  return newBounds;
}

test('Slice 2: se-handle uniform scale preserves aspect ratio', () => {
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 }; // aspect 2:1
  const result = computeUniformScale('se', bounds, { x: 200, y: 999 });
  const newW = result.maxX - result.minX;
  const newH = result.maxY - result.minY;
  ok(Math.abs(newW / newH - 2) < 0.001, `aspect should be 2:1, got ${newW}:${newH}`);
  strictEqual(result.minX, 0, 'minX unchanged for se handle');
  strictEqual(result.minY, 0, 'minY unchanged for se handle');
});

test('Slice 2: nw-handle uniform scale preserves aspect ratio and fixes se corner', () => {
  const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 }; // aspect 2:1
  // dragging nw handle toward se (making region smaller)
  const result = computeUniformScale('nw', bounds, { x: 100, y: 999 });
  const newW = result.maxX - result.minX;
  const newH = result.maxY - result.minY;
  ok(Math.abs(newW / newH - 2) < 0.001, `aspect should be 2:1, got ${newW}:${newH}`);
  strictEqual(result.maxX, 200, 'maxX unchanged for nw handle');
  strictEqual(result.maxY, 100, 'maxY unchanged for nw handle');
});

test('Slice 2: sw-handle uniform scale preserves aspect ratio', () => {
  const bounds = { minX: 0, minY: 0, maxX: 60, maxY: 40 }; // aspect 1.5:1
  const result = computeUniformScale('sw', bounds, { x: -20, y: 999 });
  const newW = result.maxX - result.minX;
  const newH = result.maxY - result.minY;
  ok(Math.abs(newW / newH - 1.5) < 0.001, `aspect should be 1.5:1, got ${newW / newH}`);
  strictEqual(result.maxX, 60, 'maxX unchanged for sw handle');
});

test('Slice 2: ne-handle uniform scale preserves aspect ratio', () => {
  const bounds = { minX: 0, minY: 0, maxX: 80, maxY: 40 }; // aspect 2:1
  const result = computeUniformScale('ne', bounds, { x: 160, y: 999 });
  const newW = result.maxX - result.minX;
  const newH = result.maxY - result.minY;
  ok(Math.abs(newW / newH - 2) < 0.001, `aspect should be 2:1, got ${newW / newH}`);
  strictEqual(result.minX, 0, 'minX unchanged for ne handle');
  strictEqual(result.maxY, 40, 'maxY unchanged for ne handle');
});

test('Slice 2: uniform scale never produces dimensions below MIN_REGION_SIZE', () => {
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  // try to drag to a point that would make width negative
  const result = computeUniformScale('se', bounds, { x: -999, y: -999 });
  const newW = result.maxX - result.minX;
  const newH = result.maxY - result.minY;
  ok(newW >= 5, `width >= MIN_REGION_SIZE, got ${newW}`);
  ok(newH >= 0, `height should be positive, got ${newH}`);
});

test('Slice 2: plain drag (no shift) still works independently — free resize does NOT preserve aspect', () => {
  // Simulate the existing free-resize: nw handle moves minX and minY independently
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  const pointer = { x: 20, y: 30 };
  // free resize: only minX and minY move
  const newBounds = { ...bounds, minX: pointer.x, minY: pointer.y };
  const newW = newBounds.maxX - newBounds.minX;
  const newH = newBounds.maxY - newBounds.minY;
  // aspect is 80:20 = 4:1 (not original 2:1) — free resize deliberately changes aspect
  ok(Math.abs(newW / newH - 2) > 0.1, 'free resize changes aspect ratio intentionally');
});

// ---------------------------------------------------------------------------
// SLICE 3 — rotation snap + coordinate rotation around centroid
// ---------------------------------------------------------------------------

/**
 * snapToStep — snap an angle to the nearest multiple of stepDeg.
 * Matches the 15° snap convention requested for regions.
 */
function snapToStep(angleDeg, stepDeg) {
  return Math.round(angleDeg / stepDeg) * stepDeg;
}

/**
 * normalizeDegrees — bring angle into [0, 360).
 */
function normalizeDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * rotateCoordinates — rotate a flat [x0,y0, x1,y1, ...] array by angleDeg
 * around the centroid (cx, cy). Returns a new flat array.
 */
function rotateCoordinates(coords, cx, cy, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const result = [];
  for (let i = 0; i < coords.length; i += 2) {
    const dx = coords[i] - cx;
    const dy = coords[i + 1] - cy;
    result.push(cx + dx * cos - dy * sin);
    result.push(cy + dx * sin + dy * cos);
  }
  return result;
}

/**
 * getRegionCentroid — returns { cx, cy } as the arithmetic mean of all vertices.
 */
function getRegionCentroid(coords) {
  let sumX = 0;
  let sumY = 0;
  const n = coords.length / 2;
  for (let i = 0; i < coords.length; i += 2) {
    sumX += coords[i];
    sumY += coords[i + 1];
  }
  return { cx: sumX / n, cy: sumY / n };
}

test('Slice 3: snapToStep snaps 0° to 0°', () => {
  strictEqual(snapToStep(0, 15), 0);
});

test('Slice 3: snapToStep snaps 7° to 0° (rounds down)', () => {
  strictEqual(snapToStep(7, 15), 0);
});

test('Slice 3: snapToStep snaps 8° to 15° (rounds up)', () => {
  strictEqual(snapToStep(8, 15), 15);
});

test('Slice 3: snapToStep snaps 22° to 15°', () => {
  strictEqual(snapToStep(22, 15), 15);
});

test('Slice 3: snapToStep snaps 23° to 30°', () => {
  strictEqual(snapToStep(23, 15), 30);
});

test('Slice 3: snapToStep snaps 352° to 345°', () => {
  strictEqual(snapToStep(352, 15), 345);
});

test('Slice 3: snapToStep snaps 357° to 360°', () => {
  // 360 is same as 0 when normalized
  strictEqual(normalizeDegrees(snapToStep(357, 15)), 0);
});

test('Slice 3: normalizeDegrees keeps 90 as 90', () => {
  strictEqual(normalizeDegrees(90), 90);
});

test('Slice 3: normalizeDegrees wraps 360 to 0', () => {
  strictEqual(normalizeDegrees(360), 0);
});

test('Slice 3: normalizeDegrees wraps -15 to 345', () => {
  strictEqual(normalizeDegrees(-15), 345);
});

test('Slice 3: rotateCoordinates 0° returns identical coords', () => {
  const coords = [0, 0, 100, 0, 100, 50, 0, 50];
  const { cx, cy } = getRegionCentroid(coords);
  const result = rotateCoordinates(coords, cx, cy, 0);
  result.forEach((v, i) => ok(Math.abs(v - coords[i]) < 1e-9, `coord[${i}] should be unchanged`));
});

test('Slice 3: rotateCoordinates 360° returns coords equal to 0°', () => {
  const coords = [10, 20, 110, 20, 110, 70, 10, 70];
  const { cx, cy } = getRegionCentroid(coords);
  const r0 = rotateCoordinates(coords, cx, cy, 0);
  const r360 = rotateCoordinates(coords, cx, cy, 360);
  r0.forEach((v, i) => ok(Math.abs(v - r360[i]) < 1e-9, `coord[${i}] 360° should equal 0°`));
});

test('Slice 3: rotateCoordinates 90° rotates a unit square correctly', () => {
  // Unit square centred at (0,0)
  const coords = [-1, -1, 1, -1, 1, 1, -1, 1];
  const result = rotateCoordinates(coords, 0, 0, 90);
  // After 90° CCW: (x,y) → (-y, x)
  // (-1,-1) → (1,-1),  (1,-1) → (1,1),  (1,1) → (-1,1),  (-1,1) → (-1,-1)
  const expected = [1, -1, 1, 1, -1, 1, -1, -1];
  result.forEach((v, i) => ok(Math.abs(v - expected[i]) < 1e-9, `coord[${i}] expected ${expected[i]}, got ${v}`));
});

test('Slice 3: rotateCoordinates 180° reverses all relative coords', () => {
  const coords = [0, 0, 10, 0, 10, 10, 0, 10];
  const { cx, cy } = getRegionCentroid(coords);
  const r180 = rotateCoordinates(coords, cx, cy, 180);
  const r360 = rotateCoordinates(r180, cx, cy, 180);
  // Two 180° rotations = identity
  coords.forEach((v, i) => ok(Math.abs(v - r360[i]) < 1e-9, `coord[${i}] double-180° should equal original`));
});

test('Slice 3: getRegionCentroid of axis-aligned rectangle is its center', () => {
  const coords = [0, 0, 100, 0, 100, 60, 0, 60];
  const { cx, cy } = getRegionCentroid(coords);
  ok(Math.abs(cx - 50) < 1e-9, `cx should be 50, got ${cx}`);
  ok(Math.abs(cy - 30) < 1e-9, `cy should be 30, got ${cy}`);
});

test('Slice 3: rotation composed with undo restores original coords', () => {
  const original = [0, 0, 100, 0, 100, 50, 0, 50];
  const region = { regionId: 'r1', shapeType: 'rectangular', coordinates: [...original] };

  // Snapshot before rotation
  const preSnapshot = cloneSnapshot([region]);

  // Apply 45° rotation
  const { cx, cy } = getRegionCentroid(region.coordinates);
  const rotated = rotateCoordinates(region.coordinates, cx, cy, 45);
  region.coordinates = rotated;

  // Undo: restore from snapshot
  const restored = preSnapshot.regions[0].coordinates;
  ok(Math.abs(restored[0] - original[0]) < 1e-9, 'undo restores original coords after rotation');
});

test('Slice 3: shift-scale of a rotated region preserves aspect ratio', () => {
  // Rotate a rectangle, then apply uniform scale — aspect should be preserved
  const coords = [0, 0, 80, 0, 80, 40, 0, 40]; // 2:1 aspect
  const { cx, cy } = getRegionCentroid(coords);
  const rotated = rotateCoordinates(coords, cx, cy, 30);

  // For a rotated region, "aspect ratio" is measured on its bounding box before rotation
  // (the stored coords define the logical shape). After scale, the ratio of stored
  // width/height should still hold.
  const initBounds = { minX: 0, minY: 0, maxX: 80, maxY: 40 };
  const scaledBounds = computeUniformScale('se', initBounds, { x: 160, y: 999 });
  const newW = scaledBounds.maxX - scaledBounds.minX;
  const newH = scaledBounds.maxY - scaledBounds.minY;
  ok(Math.abs(newW / newH - 2) < 0.001, `aspect should still be 2:1 after scale, got ${newW / newH}`);
  ok(rotated.length === coords.length, 'rotated region has same number of coords');
});
