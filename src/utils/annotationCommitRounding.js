/**
 * annotationCommitRounding.js — the ONE geometry rounding rule every commit
 * shares.
 *
 * Creation has always rounded its committed geometry to 2 decimals
 * (annotationCreationCommit's round2), but a TRANSFORM commit (resize, rotate,
 * vertex/endpoint drag, move) wrote raw float results. A PDF stores
 * coordinates as decimal text, so long float tails made a metadata-stripped
 * export → re-import come back a whisker different. Rounding a transform
 * commit the same way creation does makes a resized shape exactly as
 * round-trip-stable as a freshly drawn one.
 *
 * 2 decimals = 1/100 pt = ~1/7200 inch: far below anything the user can see or
 * a viewer can render, so this changes no visible geometry.
 *
 * SCALE IS THE EXCEPTION (UX 2026-09-10, round 4 "release jump"). scaleX /
 * scaleY are MULTIPLIERS, not lengths: one 0.01 step of scale is rawWidth/100
 * PAGE UNITS wide, so rounding them to 2 decimals moved the committed box by
 * up to rawSize * 0.005 — a 238-unit shape jumped 1.19 units (~1.35 CSS px at
 * 195%) the instant the pointer was released, after a live preview that had
 * tracked the cursor exactly. The user sees the shape nudge on release.
 *
 * The scale rounding was never load-bearing: an independent export checker ran
 * 648 metadata-stripped cloud round trips with RAW unrounded scales and every
 * one came back crown-exact (the same result tests/annotationCommitRounding
 * pins in "raw-float resize commits round-trip too"). What actually fixed the
 * re-import drift is the OTHER half, in cloudAnnotationGeometry: the crown
 * engine snaps every DERIVED size (width * scaleX and friends) onto the same
 * 1e-6 grid the PDF importer uses, because a live resized shape reaches it as
 * a product — 238 * 0.9 is 214.20000000000002, not 214.2 — while a re-import
 * reaches it as one decimal.
 *
 * So: LENGTHS, POSITIONS AND ANGLES round to 0.01 page units; SCALES round to
 * 1e-6 (enough to clip a float tail like 1.3846070545520617, at most
 * rawSize * 5e-7 of movement — under a thousandth of a unit on any real
 * shape). Committed geometry therefore equals the live preview to within 0.01
 * units on every axis and nothing moves on release.
 *
 * Pure JS — the Node test runner imports this directly.
 */

export const round2 = (value) => Number((Number(value) || 0).toFixed(2));

// Scale grid. 1e-6 is the same grid cloudAnnotationGeometry snaps its derived
// sizes onto and the one the PDF importer's decimals land on, so a committed
// scale and a re-imported one agree bit-for-bit without the commit having to
// move the shape.
export const roundScale = (value) => Number((Number(value) || 0).toFixed(6));

// Deliberately numbers only: `null` coerces to 0, and a commit that stored an
// explicit null (an absent angle, a cleared midpoint) must keep it.
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const roundIfFinite = (value) => (isFiniteNumber(value) ? round2(value) : value);

// Scalar geometry fields shared by every fabric-shaped annotation object.
// LENGTHS / POSITIONS / ANGLES — 0.01 page units is invisible on all of them
// because they are measured in page units themselves.
const SCALAR_GEOMETRY_KEYS = [
  'left', 'top', 'width', 'height',
  'angle',
  'rx', 'ry', 'radius',
  'x1', 'y1', 'x2', 'y2',
];

// MULTIPLIERS — see the header. Rounded on the 1e-6 grid, never on 0.01,
// because 0.01 of scale is rawSize/100 page units of visible movement.
const SCALE_GEOMETRY_KEYS = ['scaleX', 'scaleY'];

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
  for (const key of SCALE_GEOMETRY_KEYS) {
    if (isFiniteNumber(obj[key])) obj[key] = roundScale(obj[key]);
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
