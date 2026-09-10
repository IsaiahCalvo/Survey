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

import { diff as polygonDiff, union as polygonUnion } from 'martinez-polygon-clipping';
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
 *   outline: Array,                  // engine crowns, M/C commands (all runs)
 *   outlineRuns: Array<Array>,       // the same crowns, one command array per run
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
    outlineRuns: Array.isArray(paths.outlineRuns) && paths.outlineRuns.length > 0
      ? paths.outlineRuns
      : [paths.outline],
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
 * FILL KNOCKOUT for render paths without a mask primitive (the PDF /AP and
 * the flattened print) — Drawboard parity, 2026-09-09.
 *
 * SVG and canvas knock the fill out under the stroke band with a mask /
 * destination-out (see cloudSvgPaint.js, annotationCanvasPainter.js). PDF has
 * no stroke-to-path, and its transparency tools were rejected after probing:
 * a knockout group (/K true) is ignored by pdf.js, and a luminosity soft mask
 * is dropped by Quartz inside annotation appearance streams (Preview would
 * show the cloud with NO fill at all). So the region is computed here, in
 * plain geometry, as the task's fallback: the scalloped fill region MINUS the
 * union of every painted run's stroke band (each run sampled into capsules of
 * the ink width with round caps), through the app's polygon-clipping
 * dependency. The result is exact everywhere the band goes — along the
 * crowns AND under the short inward tails — to sampling precision, and
 * paints with plain fills that every viewer honours.
 *
 * @returns {{x:number,y:number}[][]|null} rings in the cloud's local frame
 *   (outer rings and holes; paint with the even-odd rule), or null when the
 *   cloud has no fill or no stroke to knock out.
 */
export function cloudFillKnockoutRings(geometry, options = {}) {
  if (!geometry?.fill || !(num(geometry.strokeWidth) > 0)) return null;
  const half = num(geometry.strokeWidth) / 2;
  const steps = Math.max(2, Math.round(num(options.steps, 8)));
  const capSteps = Math.max(3, Math.round(num(options.capSteps, 8)));

  // 1. The fill region: every closed subpath of the nonzero fill (contour +
  //    safety pieces) unioned together.
  const fillRings = sampleCloudCommands(geometry.fill, steps)
    .filter((ring) => ring.length >= 3)
    .map((ring) => [closeRing(ring.map((point) => [point.x, point.y]))]);
  if (fillRings.length === 0) return null;
  const region = unionAll(fillRings);
  if (region.length === 0) return null;

  // 2. The stroke band. Each run is sampled cubic by cubic; a cubic whose
  //    offset stays well formed (curvature radius above the half width)
  //    becomes ONE round-capped sausage ring, a tighter one (a tail's bend)
  //    falls back to a capsule per sampled segment. Unions run balanced
  //    (pairwise halves) so the cost stays n·log n instead of quadratic.
  const runs = Array.isArray(geometry.outlineRuns) && geometry.outlineRuns.length > 0
    ? geometry.outlineRuns
    : [geometry.outline];
  const bandPieces = [];
  for (const run of runs) {
    for (const polyline of sampleCloudCubics(run, steps)) {
      const sausage = polylineSausage(polyline, half, capSteps);
      if (sausage) {
        bandPieces.push([sausage]);
        continue;
      }
      for (let index = 0; index + 1 < polyline.length; index += 1) {
        const capsule = segmentCapsule(polyline[index], polyline[index + 1], half, capSteps);
        if (capsule) bandPieces.push([capsule]);
      }
    }
  }
  if (bandPieces.length === 0) return null;
  const band = unionAll(bandPieces);
  if (band.length === 0) return null;

  // 3. Fill minus band.
  const knockedOut = normalizeMulti(polygonDiff(region, band));
  const rings = [];
  for (const polygon of knockedOut) {
    for (const ring of polygon) {
      const points = ring.map(([x, y]) => ({ x, y }));
      if (points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) points.pop();
      }
      if (points.length >= 3) rings.push(points);
    }
  }
  return rings.length > 0 ? rings : null;
}

const closeRing = (ring) => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};

// martinez returns a polygon or a multipolygon depending on the result;
// always work with a multipolygon (array of polygons, each an array of rings).
const normalizeMulti = (result) => {
  if (!Array.isArray(result) || result.length === 0) return [];
  const isRing = (value) => Array.isArray(value) && Array.isArray(value[0]) && typeof value[0][0] === 'number';
  if (isRing(result[0])) return [result];
  return result.filter((polygon) => Array.isArray(polygon) && polygon.length > 0);
};

// Balanced pairwise union of polygons (each `[ring]`), as one multipolygon.
const unionAll = (polygons) => {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return normalizeMulti(polygons[0].length && typeof polygons[0][0][0][0] === 'number' ? [polygons[0]] : polygons[0]);
  const middle = Math.floor(polygons.length / 2);
  const left = unionAll(polygons.slice(0, middle));
  const right = unionAll(polygons.slice(middle));
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  return normalizeMulti(polygonUnion(left, right));
};

// Sample every cubic of a run (M/C commands) into its own polyline.
const sampleCloudCubics = (commands, steps) => {
  const polylines = [];
  let cursor = null;
  for (const command of commands || []) {
    if (command[0] === 'M') {
      cursor = { x: command[1], y: command[2] };
    } else if (command[0] === 'L' && cursor) {
      const end = { x: command[1], y: command[2] };
      polylines.push([cursor, end]);
      cursor = end;
    } else if (command[0] === 'C' && cursor) {
      const [x1, y1, x2, y2, x3, y3] = command.slice(1);
      const points = [cursor];
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const mt = 1 - t;
        const a = mt * mt * mt;
        const b = 3 * mt * mt * t;
        const c = 3 * mt * t * t;
        const d = t * t * t;
        points.push({ x: a * cursor.x + b * x1 + c * x2 + d * x3, y: a * cursor.y + b * y1 + c * y2 + d * y3 });
      }
      polylines.push(points);
      cursor = { x: x3, y: y3 };
    }
  }
  return polylines;
};

// The round-capped stroke outline of a polyline as ONE ring, or null when
// the inner offset would fold back on itself (curvature tighter than `half`).
const polylineSausage = (points, half, capSteps) => {
  const count = points.length;
  if (count < 2) return null;
  const tangents = [];
  for (let index = 0; index < count; index += 1) {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(count - 1, index + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-9)) return null;
    tangents.push({ x: dx / length, y: dy / length });
  }
  const left = [];
  const right = [];
  for (let index = 0; index < count; index += 1) {
    const normal = { x: -tangents[index].y, y: tangents[index].x };
    left.push([points[index].x + half * normal.x, points[index].y + half * normal.y]);
    right.push([points[index].x - half * normal.x, points[index].y - half * normal.y]);
  }
  for (let index = 0; index + 1 < count; index += 1) {
    const dx = points[index + 1].x - points[index].x;
    const dy = points[index + 1].y - points[index].y;
    if ((left[index + 1][0] - left[index][0]) * dx + (left[index + 1][1] - left[index][1]) * dy <= 0) return null;
    if ((right[index + 1][0] - right[index][0]) * dx + (right[index + 1][1] - right[index][1]) * dy <= 0) return null;
  }
  const ring = [...left];
  const end = points[count - 1];
  const endTangent = tangents[count - 1];
  const endNormal = { x: -endTangent.y, y: endTangent.x };
  for (let step = 1; step < capSteps; step += 1) {
    const theta = (Math.PI * step) / capSteps;
    ring.push([
      end.x + half * (Math.cos(theta) * endNormal.x + Math.sin(theta) * endTangent.x),
      end.y + half * (Math.cos(theta) * endNormal.y + Math.sin(theta) * endTangent.y),
    ]);
  }
  for (let index = count - 1; index >= 0; index -= 1) ring.push(right[index]);
  const start = points[0];
  const startTangent = tangents[0];
  const startNormal = { x: -startTangent.y, y: startTangent.x };
  for (let step = 1; step < capSteps; step += 1) {
    const theta = (Math.PI * step) / capSteps;
    ring.push([
      start.x + half * (-Math.cos(theta) * startNormal.x - Math.sin(theta) * startTangent.x),
      start.y + half * (-Math.cos(theta) * startNormal.y - Math.sin(theta) * startTangent.y),
    ]);
  }
  ring.push(ring[0]);
  return ring;
};

// A round-capped band of half-width `half` around the segment a→b.
const segmentCapsule = (a, b, half, capSteps) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9) || !(half > 0)) return null;
  const angle = Math.atan2(dy, dx);
  const ring = [];
  // cap around b (from +90° to -90° relative to the direction), then cap
  // around a (from -90° to +90° going the long way): one convex loop.
  for (let step = 0; step <= capSteps; step += 1) {
    const theta = angle + Math.PI / 2 - (Math.PI * step) / capSteps;
    ring.push([b.x + half * Math.cos(theta), b.y + half * Math.sin(theta)]);
  }
  for (let step = 0; step <= capSteps; step += 1) {
    const theta = angle - Math.PI / 2 - (Math.PI * step) / capSteps;
    ring.push([a.x + half * Math.cos(theta), a.y + half * Math.sin(theta)]);
  }
  ring.push(ring[0]);
  return ring;
};

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
