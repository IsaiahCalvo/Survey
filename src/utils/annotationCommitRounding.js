/**
 * annotationCommitRounding.js — the ONE geometry rounding rule every commit
 * shares.
 *
 * Creation has always rounded its committed geometry to 2 decimals
 * (annotationCreationCommit's round2), but a TRANSFORM commit (resize, rotate,
 * vertex/endpoint drag, move) wrote raw float results — e.g.
 * `scaleX: 1.3846070545520617`. A PDF stores coordinates as decimal text, so
 * those tails do not survive a metadata-stripped export → re-import: the shape
 * comes back a whisker different and the revision-cloud engine re-fits a
 * different crown count / phase (measured: 40 of 150 random resize cases, up
 * to 1.58pt). Rounding a transform commit the same way creation does makes a
 * resized shape exactly as round-trip-stable as a freshly drawn one.
 *
 * 2 decimals = 1/100 pt = ~1/7200 inch: far below anything the user can see or
 * a viewer can render, so this changes no visible geometry.
 *
 * This is HALF the fix. The other half lives in cloudAnnotationGeometry: the
 * crown engine now snaps every DERIVED size (width * scaleX and friends) onto
 * the same 1e-6 grid the PDF importer uses, because a live resized shape
 * reaches it as a product - 238 * 0.9 is 214.20000000000002, not 214.2 - while
 * a re-import reaches it as one decimal. Rounding here keeps the STORED
 * geometry (and the decimals the exporter writes) stable; the snap there makes
 * the engine indifferent to the last few bits either way.
 *
 * Pure JS — the Node test runner imports this directly.
 */

export const round2 = (value) => Number((Number(value) || 0).toFixed(2));

// Deliberately numbers only: `null` coerces to 0, and a commit that stored an
// explicit null (an absent angle, a cleared midpoint) must keep it.
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const roundIfFinite = (value) => (isFiniteNumber(value) ? round2(value) : value);

// Scalar geometry fields shared by every fabric-shaped annotation object.
const SCALAR_GEOMETRY_KEYS = [
  'left', 'top', 'width', 'height',
  'scaleX', 'scaleY', 'angle',
  'rx', 'ry', 'radius',
  'x1', 'y1', 'x2', 'y2',
];

// Ink ('path') objects carry their geometry inside `path` command arrays that
// the eraser / hit-test pipelines compare against un-rounded world coordinates,
// and their left/top is an offset into that path data. Rounding one half of
// that pair without the other would shift a stroke against its own hit region,
// so freehand is deliberately left untouched — it is not a shape the PDF
// re-import has to reconstruct from a /Rect either.
const isFreehandInk = (obj) => String(obj?.type || '').toLowerCase() === 'path';

/**
 * Round one annotation object's geometry IN PLACE and return it. Safe to call
 * on any object shape: only finite numeric fields that are present change.
 */
export function roundCommittedAnnotationGeometry(obj) {
  if (!obj || typeof obj !== 'object' || isFreehandInk(obj)) return obj;
  for (const key of SCALAR_GEOMETRY_KEYS) {
    if (isFiniteNumber(obj[key])) obj[key] = round2(obj[key]);
  }
  if (Array.isArray(obj.points)) {
    obj.points = obj.points.map((point) => (
      point && typeof point === 'object'
        ? { ...point, x: roundIfFinite(point.x), y: roundIfFinite(point.y) }
        : point
    ));
  }
  if (obj.pathOffset && typeof obj.pathOffset === 'object') {
    obj.pathOffset = {
      ...obj.pathOffset,
      x: roundIfFinite(obj.pathOffset.x),
      y: roundIfFinite(obj.pathOffset.y),
    };
  }
  // A line's curve control point lives in absolute page coords on data.midpoint
  // and moves with every endpoint / body drag, so it rounds with the rest.
  if (obj.data && typeof obj.data === 'object' && obj.data.midpoint && typeof obj.data.midpoint === 'object') {
    obj.data = {
      ...obj.data,
      midpoint: {
        ...obj.data.midpoint,
        x: roundIfFinite(obj.data.midpoint.x),
        y: roundIfFinite(obj.data.midpoint.y),
      },
    };
  }
  return obj;
}

/**
 * Round every object in an annotations payload (`{ objects: [...] }`) in place.
 * Used by the transform commits that hand the whole page payload to the save
 * pipeline (group resize / rotate, vertex drags) rather than one object.
 */
export function roundCommittedAnnotationsGeometry(annotations, indexes = null) {
  const objects = Array.isArray(annotations?.objects) ? annotations.objects : null;
  if (!objects) return annotations;
  if (indexes && typeof indexes[Symbol.iterator] === 'function') {
    for (const index of indexes) roundCommittedAnnotationGeometry(objects[index]);
    return annotations;
  }
  objects.forEach((obj) => roundCommittedAnnotationGeometry(obj));
  return annotations;
}
