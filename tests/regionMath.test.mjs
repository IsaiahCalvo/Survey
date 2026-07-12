import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REGION_OPERATIONS,
  polygonContainsPoint,
  rectangleContainsPoint,
  regionContainsPoint,
  isPointInsideRegionSet,
  regionToPolygon,
  polygonToRegionCoords,
  mergeRegions,
  subtractRegionFromRegion,
  mergeOverlappingRegions,
  simplifyPolygon,
  normalizeRegionRotation,
  getRegionRotation,
  rotateCoordsAroundPoint,
  deriveRegionChromeGeometry,
} from '../src/utils/regionMath.js';

const rect = (coords, extras = {}) => ({
  regionId: extras.regionId || 'r1',
  pageId: extras.pageId || 'p1',
  shapeType: extras.shapeType || 'rectangular',
  operation: extras.operation || REGION_OPERATIONS.ADD,
  coordinates: coords,
  ...extras,
});

// Axis-aligned unit squares as flat [x,y,...] quads
const BOX_A = [0, 0, 10, 0, 10, 10, 0, 10];
const BOX_B = [5, 5, 15, 5, 15, 15, 5, 15]; // overlaps A
const BOX_FAR = [50, 50, 60, 50, 60, 60, 50, 60];

test('polygonContainsPoint / rectangleContainsPoint / regionContainsPoint guards', () => {
  assert.equal(polygonContainsPoint(1, 1, null), false);
  assert.equal(polygonContainsPoint(1, 1, [0, 0, 1, 0]), false);
  assert.equal(polygonContainsPoint(5, 5, BOX_A), true);
  assert.equal(polygonContainsPoint(20, 20, BOX_A), false);
  assert.equal(polygonContainsPoint(25, 25, BOX_A, 2), false); // outside 0..20 scaled box

  assert.equal(rectangleContainsPoint(1, 1, [0, 0]), false);
  assert.equal(rectangleContainsPoint(5, 5, BOX_A), true);
  assert.equal(rectangleContainsPoint(-1, 5, BOX_A), false);

  assert.equal(regionContainsPoint(1, 1, null), false);
  assert.equal(regionContainsPoint(5, 5, rect(BOX_A, { shapeType: 'rectangular' })), true);
  assert.equal(regionContainsPoint(5, 5, rect(BOX_A, { shapeType: 'polygon' })), true);
});

test('isPointInsideRegionSet respects add/subtract operations', () => {
  assert.equal(isPointInsideRegionSet(1, 1, null), false);
  assert.equal(isPointInsideRegionSet(1, 1, []), false);
  assert.equal(isPointInsideRegionSet(5, 5, [null, rect(BOX_A)]), true);
  assert.equal(
    isPointInsideRegionSet(5, 5, [
      rect(BOX_A),
      rect(BOX_A, { operation: REGION_OPERATIONS.SUBTRACT, regionId: 'sub' }),
    ]),
    false,
  );
  assert.equal(isPointInsideRegionSet(5, 5, [rect(BOX_A, { operation: 'unknown' })]), true);
});

test('regionToPolygon / polygonToRegionCoords round-trip and guards', () => {
  assert.equal(regionToPolygon(null), null);
  assert.equal(regionToPolygon({ coordinates: [0, 0] }), null);

  const poly = regionToPolygon(rect(BOX_A));
  assert.ok(Array.isArray(poly) && poly[0].length >= 4);
  // Already-closed ring
  const closed = [...BOX_A, 0, 0];
  assert.ok(regionToPolygon(rect(closed)));

  // Clockwise winding gets reversed to CCW for martinez
  const cw = [0, 0, 0, 10, 10, 10, 10, 0];
  assert.ok(regionToPolygon(rect(cw)));

  assert.equal(polygonToRegionCoords(null), null);
  assert.equal(polygonToRegionCoords([]), null);
  assert.equal(polygonToRegionCoords([[]]), null);
  assert.equal(polygonToRegionCoords([[[0, 0], [1, 0]]]), null);

  const coords = polygonToRegionCoords(poly);
  assert.ok(coords && coords.length >= 6);
});

test('mergeRegions unions overlapping same-op regions and rejects mismatches', () => {
  assert.equal(mergeRegions(null, rect(BOX_A)), null);
  assert.equal(
    mergeRegions(rect(BOX_A), rect(BOX_B, { operation: REGION_OPERATIONS.SUBTRACT })),
    null,
  );
  assert.equal(mergeRegions(rect(BOX_A), rect(BOX_FAR)), null);

  const merged = mergeRegions(rect(BOX_A, { regionId: 'a' }), rect(BOX_B, { regionId: 'b' }));
  assert.ok(merged);
  assert.equal(merged.operation, REGION_OPERATIONS.ADD);
  assert.ok(merged.coordinates.length >= 6);
  assert.ok(Array.isArray(merged.sourceRegions) && merged.sourceRegions.length === 2);
  assert.ok(merged.originCenter);

  // Preserve existing sourceRegions when present
  const withSources = mergeRegions(
    rect(BOX_A, { regionId: 'a', sourceRegions: [{ regionId: 'src-a' }] }),
    rect(BOX_B, { regionId: 'b', sourceRegions: [{ regionId: 'src-b' }] }),
  );
  assert.deepEqual(
    withSources.sourceRegions.map((s) => s.regionId),
    ['src-a', 'src-b'],
  );
});

test('subtractRegionFromRegion cuts overlap and no-ops when disjoint', () => {
  assert.equal(subtractRegionFromRegion(null, rect(BOX_A)), null);
  const untouched = subtractRegionFromRegion(rect(BOX_A), rect(BOX_FAR));
  assert.equal(untouched.length, 1);
  assert.equal(untouched[0].regionId, 'r1');

  const cut = subtractRegionFromRegion(rect(BOX_A, { regionId: 'subject' }), rect(BOX_B));
  assert.ok(Array.isArray(cut));
  assert.ok(cut.length >= 1);
  assert.ok(cut[0].coordinates.length >= 6);

  // Completely covering subtract → empty
  const gone = subtractRegionFromRegion(rect(BOX_A), rect([-1, -1, 20, -1, 20, 20, -1, 20]));
  assert.deepEqual(gone, []);
});

test('mergeOverlappingRegions merges additives and applies subtractives', () => {
  assert.deepEqual(mergeOverlappingRegions(null), []);
  assert.deepEqual(mergeOverlappingRegions([]), []);
  assert.deepEqual(mergeOverlappingRegions([rect(BOX_A)]), [rect(BOX_A)]);
  assert.deepEqual(
    mergeOverlappingRegions([rect(BOX_A, { operation: REGION_OPERATIONS.SUBTRACT })]),
    [],
  );

  const merged = mergeOverlappingRegions([
    rect(BOX_A, { regionId: 'a' }),
    rect(BOX_B, { regionId: 'b' }),
  ]);
  assert.equal(merged.length, 1);

  const afterSub = mergeOverlappingRegions([
    rect(BOX_A, { regionId: 'a' }),
    rect(BOX_B, { regionId: 'hole', operation: REGION_OPERATIONS.SUBTRACT }),
  ]);
  assert.ok(afterSub.length >= 1);
  assert.ok(afterSub.every((r) => normalizeOperationSafe(r.operation) === REGION_OPERATIONS.ADD));
});

function normalizeOperationSafe(op) {
  return op === REGION_OPERATIONS.SUBTRACT ? REGION_OPERATIONS.SUBTRACT : REGION_OPERATIONS.ADD;
}

test('simplifyPolygon reduces near-collinear vertices', () => {
  assert.deepEqual(simplifyPolygon(null), null);
  assert.deepEqual(simplifyPolygon([0, 0, 1, 1]), [0, 0, 1, 1]);

  // Middle point nearly on the line between ends
  const noisy = [0, 0, 5, 0.01, 10, 0, 10, 10, 0, 10];
  const simplified = simplifyPolygon(noisy, 1);
  assert.ok(simplified.length <= noisy.length);
  assert.ok(simplified.length >= 6);
});

test('rotation helpers and chrome geometry', () => {
  assert.equal(normalizeRegionRotation(90), 90);
  assert.equal(normalizeRegionRotation(360), 0);
  assert.equal(normalizeRegionRotation(-15), 345);
  assert.equal(normalizeRegionRotation('nope'), 0);
  assert.equal(getRegionRotation({ rotation: 45 }), 45);
  assert.equal(getRegionRotation(null), 0);

  const rotated = rotateCoordsAroundPoint(BOX_A, 5, 5, 90);
  assert.equal(rotated.length, BOX_A.length);
  assert.notDeepEqual(rotated, BOX_A);

  const chrome0 = deriveRegionChromeGeometry(BOX_A, 0);
  assert.ok(chrome0);
  assert.equal(chrome0.rotation, 0);

  const chrome45 = deriveRegionChromeGeometry(BOX_A, 45);
  assert.ok(chrome45);
  assert.ok(chrome45.bounds);
  assert.ok(chrome45.unrotatedCoords);
  assert.equal(chrome45.rotation, 45);
  assert.equal(deriveRegionChromeGeometry([0, 0], 10), null);
});


test('regionMath leftovers: disjoint subtractive remerge + bad coords', () => {
  // Two overlapping additives then a subtractive that splits — re-merge loop
  const left = rect([0, 0, 20, 0, 20, 10, 0, 10], { regionId: 'L' });
  const right = rect([10, 0, 30, 0, 30, 10, 10, 10], { regionId: 'R' });
  const hole = rect([8, -2, 22, -2, 22, 12, 8, 12], {
    regionId: 'H',
    operation: REGION_OPERATIONS.SUBTRACT,
  });
  const out = mergeOverlappingRegions([left, right, hole]);
  assert.ok(Array.isArray(out));
  assert.ok(out.length >= 1);

  // Invalid / short coords fall through guards
  assert.equal(regionContainsPoint(0, 0, { coordinates: [1, 2] }), false);
  assert.equal(regionToPolygon({ coordinates: [0, 0, 1, 1] }), null);
  assert.equal(deriveRegionChromeGeometry(['x', 'y', 'a', 'b'], 10), null);

  // Non-overlapping after subtractive on disjoint pair
  const far = mergeOverlappingRegions([
    rect([0, 0, 5, 0, 5, 5, 0, 5], { regionId: 'a' }),
    rect([50, 50, 60, 50, 60, 60, 50, 60], {
      regionId: 'sub',
      operation: REGION_OPERATIONS.SUBTRACT,
    }),
  ]);
  assert.equal(far.length, 1);
});
