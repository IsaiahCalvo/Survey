/**
 * Mocks the martinez clipping module before regionMath.js binds its imports.
 * After a small throw/empty/multi budget, calls fall through to the real
 * martinez implementation.
 *
 * regionMath has imported a vendored copy (src/vendor/martinezPolygonClipping.js)
 * instead of the npm package since 1f3d1ed29, so that is the module mocked here.
 */
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const martinezUrl = pathToFileURL(resolve('src/vendor/martinezPolygonClipping.js')).href;
const real = await import(martinezUrl);

const budget = {
  intersectionThrows: 2,
  unionThrows: 1,
  diffThrows: 2,
  unionSpecial: 4, // [], multi, short, NaN-center
};

mock.module(martinezUrl, {
  namedExports: {
    intersection: (...args) => {
      if (budget.intersectionThrows > 0) {
        budget.intersectionThrows -= 1;
        throw new Error('intersection-boom');
      }
      return real.intersection(...args);
    },
    union: (...args) => {
      if (budget.unionThrows > 0) {
        budget.unionThrows -= 1;
        throw new Error('union-boom');
      }
      if (budget.unionSpecial > 0) {
        const mode = budget.unionSpecial;
        budget.unionSpecial -= 1;
        if (mode === 4) return [];
        if (mode === 3) {
          return [
            [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
            [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
          ];
        }
        if (mode === 2) {
          // short ring → polygonToRegionCoords returns null
          return [[[[0, 0], [1, 0], [0, 0]]]];
        }
        // All-NaN ring → calculateRegionCenter non-finite bounds (144-145)
        return [[[[NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN]]]];
      }
      return real.union(...args);
    },
    diff: (...args) => {
      if (budget.diffThrows > 0) {
        budget.diffThrows -= 1;
        throw new Error('diff-boom');
      }
      return real.diff(...args);
    },
  },
});

const {
  mergeRegions,
  subtractRegionFromRegion,
  REGION_OPERATIONS,
} = await import('../src/utils/regionMath.js');

function square(x, y, w, h, operation = REGION_OPERATIONS.ADD) {
  return {
    regionId: `r-${x}-${y}`,
    pageId: 'p1',
    shapeType: 'rectangular',
    operation,
    coordinates: [x, y, x + w, y, x + w, y + h, x, y + h],
  };
}

test('regionMath martinez throw/empty/multi/short paths', () => {
  const a = square(0, 0, 10, 10);
  const b = square(5, 5, 10, 10);

  // intersection throw → overlap true → union throw → merge catch null
  assert.equal(mergeRegions(a, b), null);

  // intersection throw #2 → overlap true → union special [] → null
  assert.equal(mergeRegions(a, b), null);

  // real intersection → union multi → null
  assert.equal(mergeRegions(a, b), null);

  // real intersection → union short → null
  assert.equal(mergeRegions(a, b), null);

  // real intersection → union NaN ring → calculateRegionCenter null path
  const nanMerge = mergeRegions(a, b);
  assert.ok(nanMerge === null || nanMerge.originCenter == null);

  // diff throw → subtract catch returns [subject]
  const sub = subtractRegionFromRegion(a, b);
  assert.ok(Array.isArray(sub));
  assert.equal(sub[0], a);

  // second diff throw
  const sub2 = subtractRegionFromRegion(a, b);
  assert.ok(Array.isArray(sub2));

  // regionsOverlap early-false (163-164)
  assert.equal(mergeRegions(a, { ...b, coordinates: null }), null);
});
