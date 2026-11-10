/**
 * pageTurnMarks — a page turned a quarter (Rotate left / right) takes its
 * marks with it (Drawboard PDF Pro trial audit 2026-11-09, round 2: Survey
 * turned the PDF page but left every mark where it was, off its drawing).
 *
 * Marks live in the page's on-screen frame (the SVG viewBox is the page as
 * shown, width x height). A clockwise quarter turn maps that frame onto the
 * new, sideways one:  (x, y) -> (H - y, x);  anticlockwise:  (x, y) -> (y, W - x).
 *
 * Each mark turns the way a group turn moves it (hooks/useSVGInteraction.js
 * 'group-rotate'): its own pivot lands on the turned point and its angle takes
 * the quarter. Words stay readable, as in a flip (owner 2026-11-03): text
 * boxes, stamps / photos and callout cards move but do not tip over.
 *
 * Pure: (state, page, delta, size) -> next state. The page operation's state
 * step calls it (pageAnnotationReindex.transformPageState), so Undo and Redo
 * turn the marks back and forth with the page.
 */
import { getAnnotationBBox } from './svgBoundingBox.js';
import { isTextMark, lineWorldPoints, packLineWorldPoints } from './groupResize.js';
import { annotationObjectToCallout, calloutToAnnotationObject } from './calloutAnnotationBridge.js';

const asPage = (value) => {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
};

const normAngle = (angle) => {
  const a = ((Number(angle) || 0) % 360 + 360) % 360;
  return Math.abs(a) < 1e-9 ? 0 : a;
};

/** The point map for a quarter turn of a page shown width x height. */
export function quarterTurnPoint(delta, { width, height }) {
  return delta > 0
    ? (p) => ({ x: height - p.y, y: p.x })
    : (p) => ({ x: p.y, y: width - p.x });
}

const keepsUpright = (obj) => isTextMark(obj) || String(obj?.type || '').toLowerCase() === 'image';

function turnCallout(obj, turn, size) {
  const callout = annotationObjectToCallout(obj, size);
  if (!callout?.arrowTip || !callout?.textBoxPosition) return null;
  const px = (p) => ({ x: p.x * size.width, y: p.y * size.height });
  const next = { width: size.height, height: size.width };
  const frac = (p) => ({ x: p.x / next.width, y: p.y / next.height });
  const boxW = (callout.textBoxWidth || 0) * size.width;
  const boxH = (callout.textBoxHeight || 0) * size.height;
  const boxTopLeft = px(callout.textBoxPosition);
  // The card keeps its size and reads the same way; its centre turns.
  const centre = turn({ x: boxTopLeft.x + boxW / 2, y: boxTopLeft.y + boxH / 2 });
  const turned = {
    ...callout,
    arrowTip: frac(turn(px(callout.arrowTip))),
    knee: callout.knee ? frac(turn(px(callout.knee))) : callout.knee,
    textBoxPosition: frac({ x: centre.x - boxW / 2, y: centre.y - boxH / 2 }),
    textBoxWidth: boxW / next.width,
    textBoxHeight: boxH / next.height,
  };
  const rebuilt = calloutToAnnotationObject(turned, next);
  if (!rebuilt) return null;
  return { ...obj, ...rebuilt, data: { ...(obj.data || {}), ...(rebuilt.data || {}) } };
}

/** One page mark (annotationsByPage[page].objects[i]) after the turn. */
export function turnPageObject(obj, delta, size) {
  if (!obj || typeof obj !== 'object') return obj;
  const turn = quarterTurnPoint(delta, size);
  const type = String(obj.type || '').toLowerCase();
  if (obj?.data?.type === 'callout') return turnCallout(obj, turn, size) || obj;
  // Text markup (highlight, underline, strikeout, squiggly, redact) draws from
  // its quads, in page space, and ignores left / top / angle: turn every quad
  // corner. Corner roles hold, since the words turn with the page.
  if (obj?.data?.type === 'text-markup' && Array.isArray(obj.data.quads) && obj.data.quads.length) {
    const quads = obj.data.quads.map((q) => {
      const next = { ...q };
      for (const n of [1, 2, 3, 4]) {
        const p = turn({ x: Number(q[`x${n}`]) || 0, y: Number(q[`y${n}`]) || 0 });
        next[`x${n}`] = p.x;
        next[`y${n}`] = p.y;
      }
      return next;
    });
    const xs = quads.flatMap((q) => [q.x1, q.x2, q.x3, q.x4]);
    const ys = quads.flatMap((q) => [q.y1, q.y2, q.y3, q.y4]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      ...obj,
      left,
      top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top,
      data: { ...obj.data, quads },
    };
  }
  if (type === 'line') {
    const { p1, p2, mid } = lineWorldPoints(obj);
    const next = { ...obj, ...packLineWorldPoints(turn(p1), turn(p2)) };
    if (mid) next.data = { ...(obj.data || {}), midpoint: turn(mid) };
    return next;
  }
  if (obj?.data?.type === 'counter') {
    const r = (obj.radius || 14) * Math.abs(obj.scaleX || 1);
    const c = turn({ x: (obj.left || 0) + r, y: (obj.top || 0) + r });
    const basePa = obj.data.pointerAngle != null ? obj.data.pointerAngle : 225;
    return {
      ...obj,
      left: c.x - r,
      top: c.y - r,
      data: { ...obj.data, pointerAngle: normAngle(basePa + delta) },
    };
  }
  let box = null;
  try { box = getAnnotationBBox(obj); } catch { box = null; }
  const pivot = box
    ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    : { x: obj.left || 0, y: obj.top || 0 };
  const moved = turn(pivot);
  return {
    ...obj,
    left: (obj.left || 0) + (moved.x - pivot.x),
    top: (obj.top || 0) + (moved.y - pivot.y),
    ...(keepsUpright(obj) ? {} : { angle: normAngle((obj.angle || 0) + delta) }),
  };
}

/** A Survey Marker's (or survey annotation's) bounds after the turn. */
export function turnMarkerBounds(bounds, delta, size) {
  if (!bounds || !Number.isFinite(Number(bounds.x))) return bounds;
  const turn = quarterTurnPoint(delta, size);
  const w = Number(bounds.width) || 0;
  const h = Number(bounds.height) || 0;
  const c = turn({ x: Number(bounds.x) + w / 2, y: Number(bounds.y) + h / 2 });
  const angle = ((((Number(bounds.angle) || 0) + delta) % 360) + 540) % 360 - 180;
  return { ...bounds, x: c.x - w / 2, y: c.y - h / 2, angle: angle === -180 ? 180 : angle };
}

function turnRegion(region, delta, size) {
  const coords = Array.isArray(region?.coordinates) ? region.coordinates : null;
  if (!coords || coords.length < 2) return region;
  const turn = quarterTurnPoint(delta, size);
  // A merged area keeps its parts and its centre for Unmerge: they turn too.
  const extra = {};
  if (Array.isArray(region.sourceRegions)) extra.sourceRegions = region.sourceRegions.map((r) => turnRegion(r, delta, size));
  if (region.originCenter && Number.isFinite(Number(region.originCenter.x))) {
    extra.originCenter = turn({ x: Number(region.originCenter.x), y: Number(region.originCenter.y) });
  }
  const points = [];
  for (let i = 0; i + 1 < coords.length; i += 2) points.push(turn({ x: coords[i], y: coords[i + 1] }));
  if (region.shapeType === 'rectangular') {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    return { ...region, ...extra, coordinates: [minX, minY, maxX, minY, maxX, maxY, minX, maxY] };
  }
  return { ...region, ...extra, coordinates: points.flatMap((p) => [p.x, p.y]) };
}

const onPage = (value, page) => asPage(value?.pageNumber ?? value?.pageId ?? value?.page) === page;

/**
 * The page structure state (pageAnnotationReindex) with every mark on `page`
 * turned by `delta` (+90 clockwise, -90 anticlockwise). `size` is the page as
 * shown BEFORE the turn. Without a size the state is returned unchanged.
 */
export function turnPageMarks(state, page, delta, size) {
  const p = asPage(page);
  const width = Number(size?.width);
  const height = Number(size?.height);
  const raw = Number(delta);
  if (!state || p == null || !Number.isFinite(raw) || !(width > 0) || !(height > 0)) return state;
  // Any whole number of quarter turns: one quarter at a time (a half turn,
  // e.g. an Undo that folds an old view turn, is two).
  const quarters = ((Math.round(raw / 90) % 4) + 4) % 4;
  if (quarters === 0) return state;
  if (quarters === 3) return turnOneQuarter(state, p, -90, { width, height });
  let next = state;
  let frame = { width, height };
  for (let i = 0; i < quarters; i += 1) {
    next = turnOneQuarter(next, p, 90, frame);
    frame = { width: frame.height, height: frame.width };
  }
  return next;
}

function turnOneQuarter(state, p, d, frame) {
  const next = { ...state };

  const byPage = state.annotationsByPage || {};
  const pageData = byPage[p] || byPage[String(p)];
  if (pageData && Array.isArray(pageData.objects)) {
    next.annotationsByPage = {
      ...byPage,
      [p]: { ...pageData, objects: pageData.objects.map((obj) => turnPageObject(obj, d, frame)) },
    };
  }

  for (const key of ['surveyMarkers', 'annotations']) {
    const source = state[key];
    if (!source || typeof source !== 'object') continue;
    let changed = false;
    const out = {};
    for (const [id, value] of Object.entries(source)) {
      if (onPage(value, p) && value?.bounds) {
        out[id] = { ...value, bounds: turnMarkerBounds(value.bounds, d, frame) };
        changed = true;
      } else {
        out[id] = value;
      }
    }
    if (changed) next[key] = out;
  }

  if (Array.isArray(state.spaces)) {
    next.spaces = state.spaces.map((space) => ({
      ...space,
      assignedPages: (Array.isArray(space?.assignedPages) ? space.assignedPages : []).map((entry) => (
        asPage(entry?.pageId ?? entry?.pageNumber) === p && Array.isArray(entry?.regions)
          ? { ...entry, regions: entry.regions.map((region) => turnRegion(region, d, frame)) }
          : entry
      )),
    }));
  }
  return next;
}
