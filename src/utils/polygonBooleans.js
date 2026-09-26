/**
 * Polygon booleans for the paper eraser, on Clipper2 (vendored under
 * src/vendor/clipper2: dist/Core.js and dist/Engine.js of the npm package
 * clipper2-ts 2.0.1-18, unmodified apart from dropped source-map comments;
 * Boost Software License, see LICENSE there), in the multipolygon format
 * the eraser already uses: [[outerRing, ...holeRings], ...], each ring a
 * closed list of [x, y] (first point repeated last). Results come back with
 * outers counter-clockwise (positive shoelace area) and holes clockwise.
 *
 * Why not Martinez (w39, 2026-09-25): Martinez decides every crossing in
 * floating point. Nearly collinear or nearly coincident edges — a straight
 * wipe whose samples turn by float noise, a second drag along the same line,
 * round caps of neighbouring pieces meeting on one circle, a cut mask built
 * from a survivor that shares the outline's edges — gave it false holes
 * (ink islands inside a wipe), wrong unions, or an endless subdivision that
 * ate 4 GB and froze the page. Clipper2 snaps every coordinate to an integer
 * grid and computes on that grid exactly, so those cases are ordinary.
 *
 * Fill rule: each operand is read even-odd over all of its rings, exactly as
 * Martinez read it and as the renderers paint stored polygons.
 *
 * Grid: a call maps a box onto integers around the box centre, about 2^48
 * steps across its larger side (coordinates stay inside +-2^47, well within
 * Clipper2's 2^53 limit). The step is a power-of-two fraction of the box, so
 * it is scale-relative (microscopic and huge page geometry behave alike).
 * For a difference or an intersection the answer lies inside the SUBJECT, so
 * the box is the bounds of the subject polygons it can touch (plus a margin;
 * the others pass straight through) and the other operand
 * is first cut to that box in plain floating point: a long eraser drag over
 * a small mark must not coarsen the grid the mark is cut on (w39 review: a
 * joint box made the step exceed the subtraction containment proof's
 * allowance, 128 ulps of the mark's extent, and long drags were rejected).
 * Input vertices that survive come back with their exact original
 * coordinates; only new crossing points carry the snap, at most about one
 * step (Clipper2 truncates), ~4e-15 of the box.
 */
import { ClipType, FillRule } from '../vendor/clipper2/Core.js';
import { Clipper64, PolyTree64 } from '../vendor/clipper2/Engine.js';

const GRID_BITS = 48;
// The subject box is widened by this fraction of its extent before the other
// operand is cut to it, so the cut edges never meet the subject.
const BOX_MARGIN = 1 / 8;

// A Polygon is [ring, ...] (its first element's first element is a point);
// a MultiPolygon is [[ring, ...], ...].
function asMultiPolygon(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  const firstPoint = value[0]?.[0];
  if (Array.isArray(firstPoint) && typeof firstPoint[0] === 'number') return [value];
  return value.filter((polygon) => Array.isArray(polygon) && polygon.length > 0);
}

function boundsOf(multiPolygons) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const multiPolygon of multiPolygons) {
    for (const polygon of multiPolygon) {
      for (const ring of polygon) {
        for (const point of ring) {
          const x = point?.[0];
          const y = point?.[1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (x < bounds.minX) bounds.minX = x;
          if (y < bounds.minY) bounds.minY = y;
          if (x > bounds.maxX) bounds.maxX = x;
          if (y > bounds.maxY) bounds.maxY = y;
        }
      }
    }
  }
  return Number.isFinite(bounds.minX) ? bounds : null;
}

function widen(bounds, fraction) {
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const margin = extent * fraction;
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
}

function gridFor(bounds) {
  if (!bounds) return null;
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (!(extent > 0) || !Number.isFinite(extent)) return null;
  // The smallest power of two >= extent, settled with exact power-of-two
  // comparisons: Math.log2 may round differently between JavaScript engines
  // (V8 on desktop, JavaScriptCore on iOS), and two screens must pick the
  // same grid to reach byte-identical results.
  let exponent = Math.ceil(Math.log2(extent));
  while (2 ** exponent < extent) exponent += 1;
  while (2 ** (exponent - 1) >= extent) exponent -= 1;
  const scale = 2 ** (GRID_BITS - exponent);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError(`polygon boolean box extent ${extent} is outside the representable range`);
  }
  return {
    originX: bounds.minX / 2 + bounds.maxX / 2,
    originY: bounds.minY / 2 + bounds.maxY / 2,
    scale,
    // grid x -> (grid y -> original [x, y]); nested maps, not string keys,
    // which cost about a third of each call (w39 review).
    originals: new Map(),
  };
}

function rememberOriginal(grid, x, y, point) {
  let column = grid.originals.get(x);
  if (!column) {
    column = new Map();
    grid.originals.set(x, column);
  }
  if (!column.has(y)) column.set(y, point);
}

const originalAt = (grid, x, y) => grid.originals.get(x)?.get(y);

// Sutherland-Hodgman against an axis-aligned box. A ring that leaves and
// re-enters the box gains zero-width runs along the box edge; they sit
// outside the subject (see BOX_MARGIN) and cancel under the even-odd rule.
function clipRingToBox(ring, box) {
  let points = ring;
  const edges = [
    [(p) => p[0] >= box.minX, (a, b) => { const t = (box.minX - a[0]) / (b[0] - a[0]); return [box.minX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= box.maxX, (a, b) => { const t = (box.maxX - a[0]) / (b[0] - a[0]); return [box.maxX, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= box.minY, (a, b) => { const t = (box.minY - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, box.minY]; }],
    [(p) => p[1] <= box.maxY, (a, b) => { const t = (box.maxY - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, box.maxY]; }],
  ];
  for (const [inside, cross] of edges) {
    if (!points.length) break;
    const output = [];
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[(index + points.length - 1) % points.length];
      const currentIn = inside(current);
      const previousIn = inside(previous);
      if (currentIn) {
        if (!previousIn) output.push(cross(previous, current));
        output.push(current);
      } else if (previousIn) {
        output.push(cross(previous, current));
      }
    }
    points = output;
  }
  return points;
}

function clipToBox(multiPolygon, box) {
  const result = [];
  for (const polygon of multiPolygon) {
    const clipped = [];
    for (const ring of polygon) {
      const finite = ring.filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]));
      const inside = finite.every((point) => (
        point[0] >= box.minX && point[0] <= box.maxX && point[1] >= box.minY && point[1] <= box.maxY
      ));
      const kept = inside ? finite : clipRingToBox(finite, box);
      if (kept.length >= 3) clipped.push(kept);
    }
    if (clipped.length) result.push(clipped);
  }
  return result;
}

const pathSignedArea = (path) => {
  let twice = 0;
  for (let index = 0, previous = path.length - 1; index < path.length; previous = index, index += 1) {
    twice += path[previous].x * path[index].y - path[index].x * path[previous].y;
  }
  return twice / 2;
};

function toPaths(multiPolygon, grid) {
  const paths = [];
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      const path = [];
      let last = null;
      for (const point of ring) {
        if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) continue;
        const x = Math.round((point[0] - grid.originX) * grid.scale);
        const y = Math.round((point[1] - grid.originY) * grid.scale);
        // Remember the exact input coordinates of every grid point, so an
        // input vertex that survives comes back bit for bit (see fromPath).
        rememberOriginal(grid, x, y, point);
        if (last && last.x === x && last.y === y) continue;
        last = { x, y };
        path.push(last);
      }
      while (path.length > 1 && path[0].x === path.at(-1).x && path[0].y === path.at(-1).y) path.pop();
      if (path.length >= 3 && pathSignedArea(path) !== 0) paths.push(path);
    }
  }
  return paths;
}

function fromPath(path, grid, wantPositive) {
  // Untouched input vertices keep their exact coordinates, so unchanged
  // boundary stays byte-identical across repeated cuts (the containment
  // proof and the proportional-geometry guarantees rely on it). Only new
  // crossing points carry the grid snap.
  const ring = path.map((point) => {
    const original = originalAt(grid, point.x, point.y);
    return original
      ? [original[0], original[1]]
      : [point.x / grid.scale + grid.originX, point.y / grid.scale + grid.originY];
  });
  if ((pathSignedArea(path) > 0) !== wantPositive) ring.reverse();
  ring.push([...ring[0]]);
  return ring;
}

function treeToMultiPolygon(tree, grid) {
  const result = [];
  const addOuter = (node) => {
    if (!node.polygon || node.polygon.length < 3) return;
    const polygon = [fromPath(node.polygon, grid, true)];
    for (let index = 0; index < node.count; index += 1) {
      const hole = node.child(index);
      if (hole.polygon && hole.polygon.length >= 3) polygon.push(fromPath(hole.polygon, grid, false));
      for (let inner = 0; inner < hole.count; inner += 1) addOuter(hole.child(inner));
    }
    result.push(polygon);
  };
  for (let index = 0; index < tree.count; index += 1) addOuter(tree.child(index));
  return result;
}

function execute(clipType, fillRule, subject, clip, grid) {
  const clipper = new Clipper64();
  const subjectPaths = toPaths(subject, grid);
  const clipPaths = toPaths(clip, grid);
  if (subjectPaths.length) clipper.addSubject(subjectPaths);
  if (clipPaths.length) clipper.addClip(clipPaths);
  const tree = new PolyTree64();
  clipper.execute(clipType, fillRule, tree);
  return treeToMultiPolygon(tree, grid);
}

const boxesMeet = (a, b) => (
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
);

// A subject polygon returned untouched: closed rings, outer counter-
// clockwise and holes clockwise like every computed result, coordinates
// exactly as given.
function passThrough(polygon) {
  return polygon
    .map((ring) => ring.filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1])))
    .filter((ring) => ring.length >= 3)
    .map((ring, ringIndex) => {
      const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
        ? ring.map((point) => [point[0], point[1]])
        : [...ring.map((point) => [point[0], point[1]]), [ring[0][0], ring[0][1]]];
      let twice = 0;
      for (let index = 1; index < closed.length; index += 1) {
        twice += closed[index - 1][0] * closed[index][1] - closed[index][0] * closed[index - 1][1];
      }
      return ((twice > 0) !== (ringIndex === 0)) ? closed.reverse() : closed;
    });
}

function run(clipType, subjectValue, clipValue) {
  const subject = asMultiPolygon(subjectValue);
  let clip = asMultiPolygon(clipValue);
  if (clipType === ClipType.Difference || clipType === ClipType.Intersection) {
    // Subject polygons nowhere near the other operand come through untouched
    // (difference) or drop out (intersection) without entering the engine:
    // a stroke already cut into hundreds of pieces otherwise re-processes
    // every piece on every bite (w39 review: 1.4-1.6x slower than Martinez
    // on 500 crossing cuts). The rest is gridded on its own box.
    const clipBoxes = clip.map((polygon) => boundsOf([[polygon]])).filter(Boolean);
    const touched = [];
    const untouched = [];
    for (const polygon of subject) {
      const bounds = boundsOf([[polygon]]);
      if (!bounds) continue;
      (clipBoxes.some((box) => boxesMeet(bounds, box)) ? touched : untouched).push(polygon);
    }
    const kept = clipType === ClipType.Difference ? untouched.map(passThrough).filter((polygon) => polygon.length) : [];
    if (!touched.length) return kept;
    const box = widen(boundsOf([touched]), BOX_MARGIN);
    clip = clipToBox(clip, box);
    const grid = gridFor(box);
    if (!grid) return clipType === ClipType.Difference ? [...touched.map(passThrough), ...kept] : kept;
    return [...execute(clipType, FillRule.EvenOdd, touched, clip, grid), ...kept];
  }
  const grid = gridFor(boundsOf([subject, clip]));
  if (!grid) return [...subject, ...clip];
  return execute(clipType, FillRule.EvenOdd, subject, clip, grid);
}

export const union = (subject, clip) => run(ClipType.Union, subject, clip);
export const diff = (subject, clip) => run(ClipType.Difference, subject, clip);
export const intersection = (subject, clip) => run(ClipType.Intersection, subject, clip);
export const xor = (subject, clip) => run(ClipType.Xor, subject, clip);
