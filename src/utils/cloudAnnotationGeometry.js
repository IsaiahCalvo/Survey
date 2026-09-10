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

/**
 * Selection chrome proportions, measured on a selected cloud in Drawboard PDF
 * (2026-09-09, stroke 2 page units): the hover glow is a 5.7-unit (2.85x)
 * blue stroke at 0.666 opacity hugging the scallops and it stays on while the
 * cloud is selected; its dashed frame sits past the outer edge of the ink,
 * with its eight grabbers exactly on the frame corners / edge midpoints. The
 * app pads the frame by one full stroke width (owner brief) so the 2px dashes
 * clear the crowns' outer half-stroke at every zoom.
 */
export const CLOUD_FRAME_PAD_STROKE_RATIO = 1;
export const CLOUD_HOVER_GLOW_WIDTH_RATIO = 2.85;
export const CLOUD_HOVER_GLOW_OPACITY = 0.666;

/** Hover-glow stroke width for a cloud, in page units (scales with zoom like the ink). */
export function cloudHoverGlowWidth(strokeWidth) {
  return Math.max(0, num(strokeWidth)) * CLOUD_HOVER_GLOW_WIDTH_RATIO;
}

/**
 * UX 2026-09-09 (rev 2, Drawboard PDF): selection chrome for a cloud. The
 * dashed frame is the outer hull of the humps padded by one stroke width (in
 * page units, so it scales with zoom exactly like the ink) - the dashes clear
 * the crowns instead of crossing the outer half of their stroke. The eight
 * resize grabbers sit ON that frame, at its four corners and four edge
 * midpoints, outside the cloud - never on the inner box the cloud was built
 * from and never stacked on a shared crown (the earlier nearest-cusp snapping
 * put rectangle corner handles 18 units inside the frame and doubled up
 * grabbers whenever fewer than eight crowns existed). The handles are visual
 * anchors only: the resize delta math still runs off the handle id, so
 * dragging 'mr' from the frame resizes exactly as before.
 *
 * Everything returned is in the UNROTATED page frame (local + origin); the
 * overlay rotates the whole group about `rotationCenter`, which is the same
 * pivot the cloud itself rotates around, so rotated clouds line up too.
 *
 * @returns {{ frame:{left,top,width,height}, pad:number,
 *   anchors:Object<string,{x,y}>, rotationCenter:{x,y}, angle:number,
 *   cusps:{x,y}[] }|null}
 */
export function cloudSelectionChrome(obj, geometry = null) {
  const resolved = geometry || (resolveAnnotationCloudSpec(obj) ? resolveCloudAnnotationGeometry(obj) : null);
  if (!resolved) return null;
  const hull = cloudOutlineBounds(resolved);
  if (!hull) return null;
  const origin = resolved.origin;
  const pad = Math.max(0, num(resolved.strokeWidth)) * CLOUD_FRAME_PAD_STROKE_RATIO;
  const frame = {
    left: hull.left - pad + origin.x,
    top: hull.top - pad + origin.y,
    width: hull.width + pad * 2,
    height: hull.height + pad * 2,
  };
  const right = frame.left + frame.width;
  const bottom = frame.top + frame.height;
  const midX = frame.left + frame.width / 2;
  const midY = frame.top + frame.height / 2;
  const anchors = {
    tl: { x: frame.left, y: frame.top },
    mt: { x: midX, y: frame.top },
    tr: { x: right, y: frame.top },
    mr: { x: right, y: midY },
    br: { x: right, y: bottom },
    mb: { x: midX, y: bottom },
    bl: { x: frame.left, y: bottom },
    ml: { x: frame.left, y: midY },
  };
  const cusps = Array.isArray(resolved.cusps) && resolved.cusps.length > 0
    ? resolved.cusps
    : resolved.points;
  return {
    frame,
    pad,
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
