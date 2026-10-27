// Codex on #1220: a smoothed Lasso area is drawn as a curve, so a click or an
// Erase press inside the curve must hit it, even where the straight lines
// between its control points would miss.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { withRegionOutlineCoordinates } from '../src/utils/regionOutline.js';

const REGION_SOURCE = fs.readFileSync(new URL('../src/RegionSelectionTool.jsx', import.meta.url), 'utf8');

const isPointInFlatPolygon = (x, y, coords) => {
  let inside = false;
  const n = coords.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = coords[i * 2]; const yi = coords[i * 2 + 1];
    const xj = coords[j * 2]; const yj = coords[j * 2 + 1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
};

test('a point inside a smoothed diamond\'s curve but outside its control lines hits the drawn outline', () => {
  const region = { regionId: 'r', coordinates: [100, 0, 200, 100, 100, 200, 0, 100], smoothVertices: [1, 1, 1, 1] };
  assert.equal(isPointInFlatPolygon(45, 45, region.coordinates), false, 'the straight diamond misses it');
  assert.equal(isPointInFlatPolygon(45, 45, withRegionOutlineCoordinates(region).coordinates), true, 'the curve holds it');
});

test('click-pick and Erase both test the drawn outline', () => {
  assert.match(REGION_SOURCE, /isPointInFlatPolygon\(x, y, withRegionOutlineCoordinates\(list\[i\]\)\.coordinates\)/);
  assert.match(REGION_SOURCE, /outline = withRegionOutlineCoordinates\(region\)\.coordinates;/);
  assert.doesNotMatch(REGION_SOURCE, /isPointInFlatPolygon\(\w+, \w+, (list\[i\]|region)\.coordinates\)/);
});
