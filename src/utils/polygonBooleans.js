/**
 * Polygon booleans for the paper eraser, on Clipper2 (vendored under
 * src/vendor/clipper2, Boost Software License), in the multipolygon format
 * the eraser already uses: [[outerRing, ...holeRings], ...], each ring a
 * closed list of [x, y] (first point repeated last), outers counter-
 * clockwise (positive shoelace area), holes clockwise.
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
 * Grid: each call maps its operands' joint bounding box onto integers
 * around its own centre, with about 2^48 grid steps across the larger side
 * (coordinates stay inside +-2^47, well within Clipper2's 2^53 limit). The
 * step is a power-of-two fraction of the extent, so it is scale-relative
 * (microscopic and huge page geometry behave alike). Input vertices that
 * survive come back with their exact original coordinates; only new
 * crossing points carry the snap, at most half a step (about 2e-15 of the
 * extent) — inside the subtraction containment proof's own allowance
 * (128 ulps of the extent), which 2^40 steps was not.
 */
import { ClipType, FillRule } from '../vendor/clipper2/Core.js';
import { Clipper64, PolyTree64 } from '../vendor/clipper2/Engine.js';

const GRID_BITS = 48;

const isPointArray = (value) => (
  Array.isArray(value) && value.length >= 2
  && Number.isFinite(value[0]) && Number.isFinite(value[1])
);

// Accept a Polygon ([ring, ...]) or a MultiPolygon ([[ring, ...], ...]).
function asMultiPolygon(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (isPointArray(value[0]?.[0])) return [value];
  return value.filter((polygon) => Array.isArray(polygon) && polygon.length > 0);
}

function extendBounds(bounds, multiPolygon) {
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      for (const point of ring) {
        const x = point[0];
        const y = point[1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < bounds.minX) bounds.minX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y > bounds.maxY) bounds.maxY = y;
      }
    }
  }
  return bounds;
}

function gridFor(...multiPolygons) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const value of multiPolygons) extendBounds(bounds, value);
  if (!Number.isFinite(bounds.minX)) return null;
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (!(extent > 0) || !Number.isFinite(extent)) return null;
  const scale = 2 ** (GRID_BITS - Math.ceil(Math.log2(extent)));
  return {
    originX: bounds.minX / 2 + bounds.maxX / 2,
    originY: bounds.minY / 2 + bounds.maxY / 2,
    scale,
    originals: new Map(),
  };
}

const ringSignedArea = (ring) => {
  let twice = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    twice += ring[previous].x * ring[index].y - ring[index].x * ring[previous].y;
  }
  return twice / 2;
};

// Orient each input polygon (outer positive, holes negative) so the NonZero
// fill rule reads it exactly as the multipolygon it describes, and overlaps
// between its polygons read as a union.
function toPaths(multiPolygon, grid) {
  const paths = [];
  for (const polygon of multiPolygon) {
    polygon.forEach((ring, ringIndex) => {
      const path = [];
      let last = null;
      for (const point of ring) {
        const x = Math.round((point[0] - grid.originX) * grid.scale);
        const y = Math.round((point[1] - grid.originY) * grid.scale);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        // Remember the exact input coordinates of every grid point, so an
        // input vertex that survives comes back bit for bit (see fromPath).
        const key = `${x},${y}`;
        if (!grid.originals.has(key)) grid.originals.set(key, [point[0], point[1]]);
        if (last && last.x === x && last.y === y) continue;
        last = { x, y };
        path.push(last);
      }
      while (path.length > 1 && path[0].x === path.at(-1).x && path[0].y === path.at(-1).y) path.pop();
      if (path.length < 3) return;
      const area = ringSignedArea(path);
      if (area === 0) return;
      const wantPositive = ringIndex === 0;
      if ((area > 0) !== wantPositive) path.reverse();
      paths.push(path);
    });
  }
  return paths;
}

function fromPath(path, grid, wantPositive) {
  // Untouched input vertices keep their exact coordinates, so unchanged
  // boundary stays byte-identical across repeated cuts (the containment
  // proof and the proportional-geometry guarantees rely on it). Only new
  // crossing points carry the grid snap.
  const ring = path.map((point) => {
    const original = grid.originals.get(`${point.x},${point.y}`);
    return original
      ? [original[0], original[1]]
      : [point.x / grid.scale + grid.originX, point.y / grid.scale + grid.originY];
  });
  const area = ringSignedArea(path);
  if ((area > 0) !== wantPositive) ring.reverse();
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

function run(clipType, subjectValue, clipValue) {
  const subject = asMultiPolygon(subjectValue);
  const clip = asMultiPolygon(clipValue);
  const grid = gridFor(subject, clip);
  if (!grid) {
    if (clipType === ClipType.Union || clipType === ClipType.Difference || clipType === ClipType.Xor) {
      return clipType === ClipType.Difference ? subject : [...subject, ...clip];
    }
    return [];
  }
  const clipper = new Clipper64();
  const subjectPaths = toPaths(subject, grid);
  const clipPaths = toPaths(clip, grid);
  if (subjectPaths.length) clipper.addSubject(subjectPaths);
  if (clipPaths.length) clipper.addClip(clipPaths);
  const tree = new PolyTree64();
  clipper.execute(clipType, FillRule.NonZero, tree);
  return treeToMultiPolygon(tree, grid);
}

export const union = (subject, clip) => run(ClipType.Union, subject, clip);
export const diff = (subject, clip) => run(ClipType.Difference, subject, clip);
export const intersection = (subject, clip) => run(ClipType.Intersection, subject, clip);
export const xor = (subject, clip) => run(ClipType.Xor, subject, clip);
