// w38 (2026-09-25): the owner's own red pen strokes on page 1 of
// "Package 2 - Rev 4 -- IC.pdf", read once from the stored snapshot.
//
// Each of these two strokes carries TWO eraser lanes (one per writer session:
// an older session's vertical wipe and today's dab). Each lane's own survivor
// is exact. The screen showed their composition, which used to be a Martinez
// polygon INTERSECTION of the two survivors. Both survivors are cut from the
// same base outline, so ~200 of their edges are byte-identical, and Martinez
// 0.7.4 mishandles coincident edges: on 6a89a34c it painted today's eraser dab
// back in red and dropped a 20 x 32 block above it (the owner's "rectangular
// chunk + red blob"); on c0ae58b9 it left a 1 px red sliver inside the dab and
// a 1.6 px white hairline splitting the stroke below it (the "streaks").
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as Y from 'yjs';

import {
  docToByPage,
  getEraserOpsMap,
  materializeObjectUnderLanes,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';
import { intersectPolygonSets, polygonSetToCommands } from '../src/utils/paperAnnotationGeometry.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/package2-page1-two-lane-erase.json', import.meta.url),
  'utf8',
));

const pathRings = (path) => {
  const rings = [];
  let current = null;
  for (const command of path) {
    if (command[0] === 'M') {
      current = [[command[1], command[2]]];
      rings.push(current);
    } else if (command[0] === 'L') {
      current.push([command[1], command[2]]);
    } else if (command[0] !== 'Z') {
      throw new Error(`unexpected command ${command[0]}`);
    }
  }
  return rings;
};

// The renderers fill erased ink with the even-odd rule over every ring.
const evenOdd = (rings, x, y) => {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
};

const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

// Signed distance from the eraser's swept disk (negative = inside it).
const eraserDistance = (p, gestures) => {
  let best = Infinity;
  for (const { points, radius } of gestures) {
    let d = Math.hypot(p.x - points[0].x, p.y - points[0].y);
    for (let i = 1; i < points.length; i += 1) d = Math.min(d, segmentDistance(p, points[i - 1], points[i]));
    best = Math.min(best, d - radius);
  }
  return best;
};

/**
 * Compare shown ink with the exact answer (base minus every gesture) on a grid
 * over every gesture's neighbourhood (30 units around its points; the worst
 * real defect reached 25). `tolerance` absorbs the eraser disk's polygon
 * facets (<= 0.02 page units); the defects are 1-30 units across.
 */
function compareWithExact({ base, shownPath, gestures, step = 0.25, tolerance = 0.1 }) {
  const baseRings = pathRings(base.path);
  const shownRings = pathRings(shownPath);
  const points = gestures.flatMap((gesture) => gesture.points);
  const near = (x, y) => points.some((point) => (
    Math.abs(point.x - x) <= 30 && Math.abs(point.y - y) <= 30
  ));
  const minX = Math.min(...points.map((point) => point.x)) - 30;
  const maxX = Math.max(...points.map((point) => point.x)) + 30;
  const minY = Math.min(...points.map((point) => point.y)) - 30;
  const maxY = Math.max(...points.map((point) => point.y)) + 30;
  let paintedInsideEraser = 0;
  let missingOutsideEraser = 0;
  for (let row = Math.floor(minY / step); row * step <= maxY; row += 1) {
    const y = row * step;
    for (let column = Math.floor(minX / step); column * step <= maxX; column += 1) {
      const x = column * step;
      if (!near(x, y)) continue;
      const inBase = evenOdd(baseRings, x, y);
      const shown = evenOdd(shownRings, x, y);
      if (!inBase && !shown) continue;
      if (shown && !inBase) {
        paintedInsideEraser += 1;
        continue;
      }
      const distance = eraserDistance({ x, y }, gestures);
      if (shown && distance < -tolerance) paintedInsideEraser += 1;
      if (!shown && distance > tolerance) missingOutsideEraser += 1;
    }
  }
  return {
    paintedInsideEraserArea: paintedInsideEraser * step * step,
    missingOutsideEraserArea: missingOutsideEraser * step * step,
  };
}

const marks = Object.entries(fixture.marks);

test('fixture: the owner\'s two strokes each carry two eraser lanes, each exact on its own', () => {
  assert.equal(marks.length, 2);
  for (const [, { base, lanes }] of marks) {
    const laneList = Object.values(lanes);
    assert.equal(laneList.length, 2);
    for (const lane of laneList) {
      const own = compareWithExact({
        base,
        shownPath: lane.survivor.path,
        gestures: lane.gestures,
      });
      // The older session's lane was written by an older build; allow its
      // own tiny historical residue (10 units^2 on c0ae58b9, far from today's
      // dab) but nothing like the composed defect.
      assert.ok(own.paintedInsideEraserArea === 0, JSON.stringify(own));
      assert.ok(own.missingOutsideEraserArea <= 12, JSON.stringify(own));
    }
  }
});

// The composition keeps one lane's stored survivor as it is, so any residue an
// older build left inside that lane's own survivor may remain (never more).
const ownResidue = (base, lanes) => Math.max(...Object.values(lanes).map((lane) => (
  compareWithExact({ base, shownPath: lane.survivor.path, gestures: lane.gestures })
    .missingOutsideEraserArea
)));

const assertExact = (result, allowedMissing) => {
  assert.equal(result.paintedInsideEraserArea, 0, JSON.stringify(result));
  assert.ok(result.missingOutsideEraserArea <= allowedMissing, JSON.stringify({ result, allowedMissing }));
};

for (const [storageKey, { base, lanes }] of marks) {
  const gestures = Object.values(lanes).flatMap((lane) => lane.gestures);
  const allowedMissing = ownResidue(base, lanes);

  test(`composed lanes on ${storageKey.slice(0, 8)} erase exactly: no ink painted back, none lost`, () => {
    const doc = new Y.Doc();
    const laneEntries = Object.entries(lanes).sort(([a], [b]) => a.localeCompare(b));
    doc.transact(() => {
      for (const [laneKey, lane] of laneEntries) getEraserOpsMap(doc).set(laneKey, lane);
    });
    const shown = materializeObjectUnderLanes(doc, storageKey, base);
    assert.ok(shown, 'the stroke is still shown');
    assertExact(compareWithExact({ base, shownPath: shown.path, gestures }), allowedMissing);
  });

  test(`docToByPage shows ${storageKey.slice(0, 8)} the same exact composition on every screen`, () => {
    const seed = new Y.Doc();
    syncByPageToDoc(seed, { 1: { objects: [base] } });
    seed.transact(() => {
      for (const [laneKey, lane] of Object.entries(lanes)) getEraserOpsMap(seed).set(laneKey, lane);
    });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(seed));
    const first = docToByPage(seed);
    assert.deepEqual(docToByPage(other), first, 'two screens converge byte-for-byte');
    const shown = first[1].objects.find((object) => object?.data?.id === storageKey);
    assert.ok(shown);
    assert.equal(shown.fillRule, 'evenodd');
    assertExact(compareWithExact({ base, shownPath: shown.path, gestures }), allowedMissing);
    // The same answer comes back from the cache on the next build.
    assert.deepEqual(docToByPage(seed), first);
  });
}

test('the plain intersection of the two real survivors is exact on the Clipper2 engine', () => {
  const [, { base, lanes }] = marks.find(([key]) => key.startsWith('6a89a34c'));
  const [first, second] = Object.values(lanes).map((lane) => lane.survivor.polygons);
  const result = compareWithExact({
    base,
    shownPath: polygonSetToCommands(intersectPolygonSets(first, second)),
    gestures: Object.values(lanes).flatMap((lane) => lane.gestures),
  });
  // w38 pinned this as the failure of the old engine (Martinez painted about
  // 200 units^2 back inside the erased area and lost about 400 outside it on
  // these coincident edges) and said to delete the pin once an engine got it
  // right. w39 (2026-09-25) moved the eraser booleans to Clipper2's exact
  // integer grid, which gets it right, so the pin now asserts that instead.
  assert.equal(result.paintedInsideEraserArea, 0, JSON.stringify(result));
  assert.equal(result.missingOutsideEraserArea, 0, JSON.stringify(result));
});
