/**
 * polyDraft.js — the pure state machine behind the Polygon and Polyline
 * drawing tools.
 *
 * Both tools are CLICK-TO-PLACE (not drag-out like rect/ellipse): each click
 * commits one vertex, a rubber-band edge follows the cursor, and the shape is
 * finished explicitly — via a checkmark control on the first / latest vertex,
 * the Enter key, or by clicking back on the first point. This module owns the
 * draft geometry and every finish/close rule; SVGAnnotationLayer owns the
 * pixels and useSVGInteraction owns the pointer plumbing.
 *
 * Everything here is page-space (page units, y-down) and pure — the Node test
 * runner imports it directly.
 */

/** Tool ids that drive a click-to-place draft. */
export const POLY_DRAFT_TOOLS = Object.freeze(['polygon', 'polyline']);

/**
 * Minimum vertex count before a draft may be finished AS THAT TYPE.
 * A polygon needs 3 (two points can only ever be a line); an open polyline
 * needs 2. Closing a polyline into a polygon uses POLY_CLOSE_MIN_POINTS.
 */
export const POLY_MIN_POINTS = Object.freeze({ polygon: 3, polyline: 2 });

/** Closing any draft into a polygon needs a real area — three corners. */
export const POLY_CLOSE_MIN_POINTS = 3;

/**
 * UX: how close (in SCREEN pixels) the cursor must come to the first vertex
 * before that vertex becomes a magnetic "click here to close" target. Screen-
 * constant on purpose — per the project's zoom convention, geometry scales
 * with the page but hit targets and handles stay a constant size on screen,
 * so closing a shape feels identical at 50% and 400% zoom. Callers divide by
 * the live page scale to get the page-unit radius.
 */
export const POLY_FIRST_POINT_SNAP_SCREEN_RADIUS = 14;

/**
 * UX: radius (SCREEN pixels) of the invisible hit disc behind each finish
 * checkmark. Larger than the drawn ring (9.5) so the control is comfortable
 * to hit with a mouse without the ring itself looking heavy.
 */
export const POLY_FINISH_CONTROL_SCREEN_HIT_RADIUS = 20;

/** UX: drawn radius (SCREEN pixels) of the checkmark ring itself. */
export const POLY_FINISH_CONTROL_SCREEN_RADIUS = 9.5;

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const asPoint = (point) => ({ x: num(point?.x), y: num(point?.y) });

export const isPolyDraftTool = (tool) => POLY_DRAFT_TOOLS.includes(tool);

/**
 * Snap `point` so the segment from `anchor` lands on the nearest 45° ray.
 * Mirrors the reference build's Shift behavior for polygon/polyline segments.
 */
export function snapPolySegmentAngle(anchor, point) {
  const a = asPoint(anchor);
  const p = asPoint(point);
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: a.x, y: a.y };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
}

/** Start a draft at the first clicked point. */
export function createPolyDraft(tool, point) {
  if (!isPolyDraftTool(tool)) return null;
  const first = asPoint(point);
  return {
    tool,
    points: [first],
    preview: { ...first },
    snapToFirst: false,
  };
}

/**
 * Append a vertex. Returns a NEW draft (never mutates) so React state updates
 * stay referentially honest. Shift snaps the new segment to 45°.
 */
export function addPolyDraftPoint(draft, point, { shiftKey = false } = {}) {
  if (!draft || !isPolyDraftTool(draft.tool)) return draft;
  const previous = draft.points[draft.points.length - 1];
  const next = shiftKey && previous ? snapPolySegmentAngle(previous, point) : asPoint(point);
  return {
    ...draft,
    points: [...draft.points, next],
    preview: { ...next },
    snapToFirst: false,
  };
}

/**
 * Move the rubber-band end. When the cursor is inside the first vertex's
 * magnetic radius (and closing is legal) the preview snaps onto that vertex
 * so the user SEES the shape close before committing to the click.
 */
export function updatePolyDraftPreview(draft, point, { shiftKey = false, snapRadius = 0 } = {}) {
  if (!draft || !isPolyDraftTool(draft.tool)) return draft;
  const previous = draft.points[draft.points.length - 1];
  const snapToFirst = isPointNearPolyDraftFirstPoint(point, draft, snapRadius);
  const preview = snapToFirst
    ? { ...asPoint(draft.points[0]) }
    : (shiftKey && previous ? snapPolySegmentAngle(previous, point) : asPoint(point));
  return { ...draft, preview, snapToFirst };
}

/** Can this draft be finished as its own type? */
export function canFinishPolyDraft(draft) {
  if (!draft || !isPolyDraftTool(draft.tool)) return false;
  return draft.points.length >= POLY_MIN_POINTS[draft.tool];
}

/** Can this draft be closed into a polygon? */
export function canClosePolyDraft(draft) {
  if (!draft || !isPolyDraftTool(draft.tool)) return false;
  return draft.points.length >= POLY_CLOSE_MIN_POINTS;
}

/**
 * The two vertices that carry a finish checkmark: the FIRST point (closes the
 * shape) and the LATEST point (finishes it where it stands). Drawboard-style.
 */
export function polyDraftFinishControlPoints(draft) {
  if (!draft?.points?.length) return null;
  return {
    first: { ...asPoint(draft.points[0]) },
    last: { ...asPoint(draft.points[draft.points.length - 1]) },
  };
}

/**
 * True when `point` is inside the first vertex's magnetic close radius.
 * `radius` is in PAGE units (caller converts from the screen constant).
 */
export function isPointNearPolyDraftFirstPoint(point, draft, radius) {
  if (!canClosePolyDraft(draft)) return false;
  const r = num(radius);
  if (!(r > 0)) return false;
  const p = asPoint(point);
  const first = asPoint(draft.points[0]);
  return Math.hypot(p.x - first.x, p.y - first.y) <= r;
}

/**
 * Drop trailing points that landed on top of their predecessor (double-click
 * or a jittery click) so a 3-click polygon isn't rejected for having a
 * degenerate final edge.
 */
export function compactPolyDraftPoints(points, epsilon = 3) {
  const list = Array.isArray(points) ? points.map(asPoint) : [];
  while (list.length > 1) {
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    if (Math.hypot(last.x - prev.x, last.y - prev.y) >= epsilon) break;
    list.pop();
  }
  return list;
}

/**
 * Resolve what a finish/close request should produce.
 *
 * - 'finish' on a polygon draft → closed polygon.
 * - 'finish' on a polyline draft → open polyline.
 * - 'close' on either → polygon (this is how a polyline becomes a polygon).
 *
 * Returns `{ ok: false, reason }` when the draft is too short, so the caller
 * can leave the draft alive instead of silently discarding the user's clicks.
 */
export function resolvePolyDraftFinish(draft, action = 'finish') {
  if (!draft || !isPolyDraftTool(draft.tool)) return { ok: false, reason: 'no-draft' };
  const finalType = action === 'close' ? 'polygon' : draft.tool;
  const minimum = POLY_MIN_POINTS[finalType];
  const points = compactPolyDraftPoints(draft.points);
  if (points.length < minimum) {
    return { ok: false, reason: 'too-few-points', finalType, minimum, points };
  }
  return { ok: true, finalType, points, closed: finalType === 'polygon' };
}

/**
 * Replace ONE vertex and leave every other vertex byte-identical.
 * Shared by the live vertex-drag path so "drag one corner" can never disturb
 * a neighbour by a sub-pixel rounding wobble.
 */
export function movePolyVertexPoints(points, index, target) {
  const list = Array.isArray(points) ? points.map((p) => ({ x: num(p?.x), y: num(p?.y) })) : [];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  list[index] = asPoint(target);
  return list;
}

/**
 * Page-space points → the app's polygon/polyline storage convention:
 * `left`/`top` is the point-cloud's top-left and `points` are local offsets
 * from it (pathOffset stays 0). This matches what the PDF importer emits and
 * what renderPolygon / the pdf-lib exporter read back, so a drawn polygon and
 * an imported one are the same object shape.
 */
export function normalizePolyPointsToLocal(points) {
  const list = Array.isArray(points) ? points.map(asPoint) : [];
  if (list.length === 0) return { left: 0, top: 0, points: [] };
  let minX = Infinity;
  let minY = Infinity;
  for (const p of list) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  return {
    left: minX,
    top: minY,
    points: list.map((p) => ({ x: p.x - minX, y: p.y - minY })),
  };
}
