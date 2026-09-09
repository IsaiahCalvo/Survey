// cloudAnnotationGeometry.js — the ONE place a Fabric annotation becomes the
// studio's cloud: which vertices the engine is handed, in which frame, and how
// that frame is placed on the page.
//
// The SVG layer (visible ink, hover glow, hit target), the canvas presentation
// painter, the pdf-lib flattener and the vertex-drag interaction all resolve
// the same object here, so no render path can grow its own opinion about a
// cloud's vertices or transform. Studio parity rules encoded here:
//
//  * Vertices are handed to the engine in the shape's LOCAL, UNROTATED frame
//    with any Fabric scaleX/scaleY already baked into the coordinates. The
//    studio resizes a polygon by rewriting its vertices and re-fitting
//    constant-size crowns; stretching a crown path under a scale() transform
//    (the old polygon/polyline chain) squashed every scallop instead.
//  * Rotation is applied to the finished crowns as a whole (a rotate() on the
//    group on screen, a point rotation of the commands for print), never by
//    rotating the vertices first — the engine's rectangle fit reads the
//    axis-aligned box, so pre-rotated corners changed the crown count.
//  * The crown outline and the scalloped fill region come from one engine
//    pass (buildCloudRenderPaths), so fill and stroke can never disagree.

import {
  buildCloudRenderPaths,
  cloudCommandsToPathData,
  ellipseCloudPoints,
  hasVisibleCloudFill,
  resolveAnnotationCloudSpec,
} from './pdfAnnotationAppearance.js';

const num = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * Polygon / polyline vertices in the engine frame: Fabric stores `points` in
 * local unscaled space with a `pathOffset`; the rendered chain is
 * translate(left, top) rotate(angle, centre) scale(sx, sy) translate(-offset).
 * Everything after the rotate is folded into the coordinates here.
 */
export function cloudPolyEnginePoints(obj) {
  const points = Array.isArray(obj?.points) ? obj.points : [];
  const scaleX = num(obj?.scaleX, 1) || 1;
  const scaleY = num(obj?.scaleY, 1) || 1;
  const offsetX = num(obj?.pathOffset?.x);
  const offsetY = num(obj?.pathOffset?.y);
  return points.map((point) => ({
    x: (num(point?.x) - offsetX) * scaleX,
    y: (num(point?.y) - offsetY) * scaleY,
  }));
}

const bboxCenter = (points) => {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
};

/**
 * Resolve a cloud annotation into everything a renderer needs, or null when
 * the object is not a cloud (or has no drawable geometry yet).
 *
 * @returns {{
 *   spec: object, kind: string, type: string,
 *   points: {x:number,y:number}[],   // engine vertices, local unrotated frame
 *   origin: {x:number,y:number},     // page position of the local origin
 *   angle: number,                   // degrees, applied to the whole cloud
 *   pivot: {x:number,y:number},      // rotation pivot in the local frame
 *   strokeWidth: number,             // painted line width (page units)
 *   outline: Array,                  // engine crowns, M/C commands
 *   fill: Array|null,                // scalloped region, M/L/C/Z, null when open
 *   transform: string,               // SVG transform placing the local frame
 * }|null}
 */
export function resolveCloudAnnotationGeometry(obj) {
  const spec = resolveAnnotationCloudSpec(obj);
  if (!spec) return null;
  const type = String(obj?.type || '').toLowerCase();
  const angle = num(obj?.angle);
  const origin = { x: num(obj?.left), y: num(obj?.top) };
  let points;
  let pivot;
  let strokeWidth;

  if (spec.kind === 'rectangle') {
    const scaleX = Math.abs(num(obj?.scaleX, 1) || 1);
    const scaleY = Math.abs(num(obj?.scaleY, 1) || 1);
    const width = Math.abs(num(obj?.width)) * scaleX;
    const height = Math.abs(num(obj?.height)) * scaleY;
    if (!(width > 0) || !(height > 0)) return null;
    // Imported /Square clouds carry the /RD inset the authoring app used.
    const insets = Array.isArray(obj?.data?.pdfCloudInsets) ? obj.data.pdfCloudInsets : [0, 0, 0, 0];
    const insetLeft = num(insets[0]) * scaleX;
    const insetTop = num(insets[1]) * scaleY;
    const insetRight = num(insets[2]) * scaleX;
    const insetBottom = num(insets[3]) * scaleY;
    points = [
      { x: insetLeft, y: insetTop },
      { x: width - insetRight, y: insetTop },
      { x: width - insetRight, y: height - insetBottom },
      { x: insetLeft, y: height - insetBottom },
    ];
    pivot = { x: width / 2, y: height / 2 };
    strokeWidth = num(obj?.strokeWidth);
  } else if (spec.kind === 'ellipse') {
    // renderEllipse sizes off the LIVE radius/rx/ry (never width/height).
    const isCircle = type === 'circle' || obj?.radius != null;
    const rx = (isCircle ? num(obj?.radius) : num(obj?.rx)) * Math.abs(num(obj?.scaleX, 1) || 1);
    const ry = (isCircle ? num(obj?.radius) : num(obj?.ry)) * Math.abs(num(obj?.scaleY, 1) || 1);
    if (!(rx > 0) || !(ry > 0)) return null;
    points = ellipseCloudPoints(0, 0, rx * 2, ry * 2);
    pivot = { x: rx, y: ry };
    strokeWidth = num(obj?.strokeWidth);
  } else {
    points = cloudPolyEnginePoints(obj);
    if (points.length < (spec.kind === 'polyline' ? 2 : 3)) return null;
    pivot = bboxCenter(points);
    strokeWidth = num(obj?.strokeWidth) || 1;
  }

  // Open polylines never fill; closed shapes only build the (costlier) fill
  // contour when there is a visible fill paint to put on it.
  const filled = spec.kind !== 'polyline' && hasVisibleCloudFill(obj?.fill);
  const paths = buildCloudRenderPaths(
    points,
    spec.intensity,
    strokeWidth,
    spec.unitScale,
    spec.kind,
    { vertexState: spec.vertexState || null, fill: filled },
  );
  if (!paths) return null;
  const transform = `translate(${origin.x}, ${origin.y})${
    angle ? ` rotate(${angle}, ${pivot.x}, ${pivot.y})` : ''
  }`;
  return {
    spec,
    kind: spec.kind,
    type,
    points,
    origin,
    angle,
    pivot,
    strokeWidth,
    filled,
    outline: paths.outline,
    fill: filled ? paths.fill : null,
    cusps: paths.cusps || [],
    transform,
  };
}

const rotatePoint = (x, y, pivot, radians) => {
  if (!radians) return { x, y };
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - pivot.x;
  const dy = y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
};

/**
 * Flatten absolute M/L/C/Z commands into sampled subpaths (arrays of points in
 * the commands' own frame). Shared by the outer-hull frame, the geometry hit
 * test and the tests, so "where is the scalloped edge" has one answer.
 */
export function sampleCloudCommands(commands, steps = 8) {
  const subpaths = [];
  let current = null;
  let cursor = { x: 0, y: 0 };
  for (const command of commands || []) {
    const verb = command[0];
    if (verb === 'M') {
      cursor = { x: command[1], y: command[2] };
      current = [cursor];
      current.closed = false;
      subpaths.push(current);
    } else if (verb === 'L') {
      cursor = { x: command[1], y: command[2] };
      if (!current) { current = [cursor]; current.closed = false; subpaths.push(current); } else current.push(cursor);
    } else if (verb === 'C') {
      if (!current) { current = [cursor]; current.closed = false; subpaths.push(current); }
      const p0 = cursor;
      const [x1, y1, x2, y2, x3, y3] = command.slice(1);
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const mt = 1 - t;
        const a = mt * mt * mt;
        const b = 3 * mt * mt * t;
        const c = 3 * mt * t * t;
        const d = t * t * t;
        current.push({ x: a * p0.x + b * x1 + c * x2 + d * x3, y: a * p0.y + b * y1 + c * y2 + d * y3 });
      }
      cursor = { x: x3, y: y3 };
    } else if (verb === 'Z' && current) {
      current.closed = true;
    }
  }
  return subpaths;
}

/** Axis-aligned bounds of a point list, or null when empty. */
const boundsOf = (points) => {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX)) return null;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * The outer hull of the crowns in the local frame - the box Drawboard PDF
 * draws its dashed selection frame on (humps included), never the inner box
 * the cloud was built from.
 */
export function cloudOutlineBounds(geometry) {
  if (!geometry?.outline) return null;
  const points = [];
  for (const subpath of sampleCloudCommands(geometry.outline, 6)) points.push(...subpath);
  return boundsOf(points);
}

const HANDLE_IDS = ['tl', 'mt', 'tr', 'mr', 'br', 'mb', 'bl', 'ml'];

/**
 * UX 2026-09-09: selection chrome for a cloud, matching Drawboard PDF - the
 * eight resize handles sit ON the outer scallop cusps nearest the eight box
 * positions (corners + edge midpoints) instead of on the inner rectangle the
 * cloud was built from, and the dashed frame is the outer hull of the humps.
 * The handles are visual anchors only: the resize delta math still runs off
 * the handle id, so dragging 'mr' from a cusp resizes exactly as before.
 *
 * Everything returned is in the UNROTATED page frame (local + origin); the
 * overlay rotates the whole group about `rotationCenter`, which is the same
 * pivot the cloud itself rotates around, so rotated clouds line up too.
 *
 * @returns {{ frame:{left,top,width,height}, anchors:Object<string,{x,y}>,
 *   rotationCenter:{x,y}, angle:number, cusps:{x,y}[] }|null}
 */
export function cloudSelectionChrome(obj, geometry = null) {
  const resolved = geometry || (resolveAnnotationCloudSpec(obj) ? resolveCloudAnnotationGeometry(obj) : null);
  if (!resolved) return null;
  const hull = cloudOutlineBounds(resolved);
  if (!hull) return null;
  const cusps = Array.isArray(resolved.cusps) && resolved.cusps.length > 0
    ? resolved.cusps
    : resolved.points;
  const origin = resolved.origin;
  // The eight box positions are taken on the hull so an anchor snaps to the
  // cusp that visually "is" that corner / edge middle of the cloud.
  const targets = {
    tl: { x: hull.left, y: hull.top },
    mt: { x: hull.left + hull.width / 2, y: hull.top },
    tr: { x: hull.left + hull.width, y: hull.top },
    mr: { x: hull.left + hull.width, y: hull.top + hull.height / 2 },
    br: { x: hull.left + hull.width, y: hull.top + hull.height },
    mb: { x: hull.left + hull.width / 2, y: hull.top + hull.height },
    bl: { x: hull.left, y: hull.top + hull.height },
    ml: { x: hull.left, y: hull.top + hull.height / 2 },
  };
  // Each handle claims its own cusp (nearest first, tightest fit wins) so an
  // open polyline's hollow side cannot stack two grabbers on one peak.
  const ranked = HANDLE_IDS.map((id) => {
    const target = targets[id];
    const order = cusps
      .map((cusp, index) => ({ index, distance: Math.hypot(cusp.x - target.x, cusp.y - target.y) }))
      .sort((a, b) => a.distance - b.distance);
    return { id, order };
  }).sort((a, b) => (a.order[0]?.distance ?? Infinity) - (b.order[0]?.distance ?? Infinity));
  const claimed = new Set();
  const anchors = {};
  for (const { id, order } of ranked) {
    const pick = order.find((entry) => !claimed.has(entry.index)) || order[0];
    const best = pick ? cusps[pick.index] : targets[id];
    if (pick) claimed.add(pick.index);
    anchors[id] = { x: best.x + origin.x, y: best.y + origin.y };
  }
  return {
    frame: { left: hull.left + origin.x, top: hull.top + origin.y, width: hull.width, height: hull.height },
    anchors,
    rotationCenter: { x: resolved.pivot.x + origin.x, y: resolved.pivot.y + origin.y },
    angle: resolved.angle,
    cusps: cusps.map((cusp) => ({ x: cusp.x + origin.x, y: cusp.y + origin.y })),
  };
}

/**
 * Map local-frame commands to page coordinates: rotate every coordinate pair
 * about the pivot, then translate by the origin. The engine emits absolute
 * M/L/C (and the fill's Z), so pairs are all a command carries.
 */
export function transformCloudCommandsToWorld(commands, geometry) {
  const radians = (num(geometry?.angle) * Math.PI) / 180;
  const pivot = geometry?.pivot || { x: 0, y: 0 };
  const origin = geometry?.origin || { x: 0, y: 0 };
  return (commands || []).map(([verb, ...values]) => {
    const out = [verb];
    for (let index = 0; index + 1 < values.length; index += 2) {
      const point = rotatePoint(values[index], values[index + 1], pivot, radians);
      out.push(point.x + origin.x, point.y + origin.y);
    }
    return out;
  });
}

export { cloudCommandsToPathData };
