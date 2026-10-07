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

import { union as polygonUnion } from '../vendor/martinezPolygonClipping.js';
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

// The crown engine is a PURE FUNCTION of the vertex coordinates it is handed:
// two inputs a millionth of a point apart can fit a different number of crowns
// at a different phase. A live resized shape reaches it as a PRODUCT
// (width * scaleX), while the same shape re-imported from a PDF reaches it as
// a single decimal read back from /Rect - and 238 * 0.9 is 214.20000000000002
// in binary floating point, not 214.2. Snapping every derived size onto the
// same 1e-6 grid the importer uses (snapCloudCoordinate in
// pdfAnnotationImporter) makes the two identical: measured as a 163 vs 162
// crown difference on a resized A5 rectangle before this.
const snapEngineCoordinate = (value) => Math.round(value * 1e6) / 1e6;

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
    x: snapEngineCoordinate((num(point?.x) - offsetX) * scaleX),
    y: snapEngineCoordinate((num(point?.y) - offsetY) * scaleY),
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
    const width = snapEngineCoordinate(Math.abs(num(obj?.width)) * scaleX);
    const height = snapEngineCoordinate(Math.abs(num(obj?.height)) * scaleY);
    if (!(width > 0) || !(height > 0)) return null;
    // Imported /Square clouds carry the /RD inset the authoring app used.
    const insets = Array.isArray(obj?.data?.pdfCloudInsets) ? obj.data.pdfCloudInsets : [0, 0, 0, 0];
    const insetLeft = snapEngineCoordinate(num(insets[0]) * scaleX);
    const insetTop = snapEngineCoordinate(num(insets[1]) * scaleY);
    const insetRight = snapEngineCoordinate(num(insets[2]) * scaleX);
    const insetBottom = snapEngineCoordinate(num(insets[3]) * scaleY);
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
    const rx = snapEngineCoordinate((isCircle ? num(obj?.radius) : num(obj?.rx)) * Math.abs(num(obj?.scaleX, 1) || 1));
    const ry = snapEngineCoordinate((isCircle ? num(obj?.radius) : num(obj?.ry)) * Math.abs(num(obj?.scaleY, 1) || 1));
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
  // A spread here passes one ARGUMENT per sample; a big cloud's outline blows
  // the call stack the same way getCloudPathBounds used to (see arrayExtrema).
  for (const subpath of sampleCloudCommands(geometry.outline, 6)) {
    for (let index = 0; index < subpath.length; index += 1) points.push(subpath[index]);
  }
  return boundsOf(points);
}

/**
 * Selection chrome proportions, measured on a selected cloud in Drawboard PDF
 * (2026-09-09, stroke 2 page units): the hover glow is a 5.7-unit (2.85x)
 * blue stroke at 0.666 opacity hugging the scallops and it stays on while the
 * cloud is selected; its dashed frame sits past the outer edge of the ink,
 * with its eight grabbers exactly on the frame corners / edge midpoints.
 *
 * The pad is measured from the ink's OUTER edge, not from the crown
 * CENTERLINE. `cloudOutlineBounds` samples the stroke's centreline, so the
 * painted crown already reaches half a stroke width past that hull; padding by
 * one stroke width from the centreline left only sw/2 of clear air and the
 * frame's 2px dashes kissed the humps at 100%. Pad = sw/2 (to the ink's outer
 * edge) + sw (Drawboard's clear gap) = 1.5 stroke widths, in page units so the
 * gap scales with zoom exactly like the ink.
 */
export const CLOUD_FRAME_PAD_STROKE_RATIO = 1.5;
export const CLOUD_HOVER_GLOW_WIDTH_RATIO = 2.85;
export const CLOUD_HOVER_GLOW_OPACITY = 0.666;

// Owner Test 45 (2026-10-06): a thin cloud (a 1 pt text box border) got a
// 2.85-unit glow - after the ink knockout a ring under one unit each side,
// too faint to read as the hover. Thin clouds keep at least a 1.5-unit ring
// each side of a 1-unit line; 2 pt and up keep Drawboard's 2.85x exactly.
export const CLOUD_HOVER_GLOW_MIN_WIDTH = 4;

/** Hover-glow stroke width for a cloud, in page units (scales with zoom like the ink). */
export function cloudHoverGlowWidth(strokeWidth) {
  const width = Math.max(0, num(strokeWidth));
  if (!(width > 0)) return 0;
  return Math.max(CLOUD_HOVER_GLOW_MIN_WIDTH, width * CLOUD_HOVER_GLOW_WIDTH_RATIO);
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


// Wall-clock budget for the whole capsule union, and the ceiling on how many
// capsules are worth handing it. Both are overridable per call (options
// `budgetMs` / `maxPieces`), which is how the fallback paths are tested.
const CLOUD_BAND_UNION_BUDGET_MS = 250;
const CLOUD_BAND_MAX_PIECES = 1500;
// The grid every coordinate handed to the clipper is snapped onto. 1e-4 of a
// PDF point is ~1/700 of a device pixel at 100% — invisible — and it is what
// turns "coincident to 12 decimal places" (undefined behaviour for a sweep
// line) into "the same number".
const CLOUD_CLIPPER_GRID = 1e-4;
const CLOUD_CLIPPER_MIN_AREA = 1e-6;

class CloudClipBudgetError extends Error {}

const snapClipperCoordinate = (value) => Math.round(value / CLOUD_CLIPPER_GRID) * CLOUD_CLIPPER_GRID;

const ringSignedArea = (ring) => {
  let total = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    total += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return total / 2;
};

/**
 * A ring the clipper can actually take: snapped onto the shared grid, with
 * duplicate and collinear vertices removed, closed, and rejected outright
 * when it has collapsed to a sliver. Returns null for anything degenerate.
 */
const sanitizeClipperRing = (ring) => {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const snapped = [];
  for (const point of ring) {
    const x = snapClipperCoordinate(Number(point[0]));
    const y = snapClipperCoordinate(Number(point[1]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const last = snapped[snapped.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    snapped.push([x, y]);
  }
  while (snapped.length > 1
    && snapped[0][0] === snapped[snapped.length - 1][0]
    && snapped[0][1] === snapped[snapped.length - 1][1]) snapped.pop();
  if (snapped.length < 3) return null;
  // Drop vertices whose two neighbours are collinear through them: they carry
  // no shape and every one of them is another chance for the sweep line to
  // meet a zero-area event.
  const simplified = [];
  for (let index = 0; index < snapped.length; index += 1) {
    const previous = simplified.length > 0 ? simplified[simplified.length - 1] : snapped[(index - 1 + snapped.length) % snapped.length];
    const current = snapped[index];
    const next = snapped[(index + 1) % snapped.length];
    const cross = (current[0] - previous[0]) * (next[1] - previous[1])
      - (current[1] - previous[1]) * (next[0] - previous[0]);
    if (Math.abs(cross) <= CLOUD_CLIPPER_MIN_AREA) continue;
    simplified.push(current);
  }
  const kept = simplified.length >= 3 ? simplified : snapped;
  if (Math.abs(ringSignedArea([...kept, kept[0]])) < CLOUD_CLIPPER_MIN_AREA) return null;
  return [...kept, [kept[0][0], kept[0][1]]];
};

/**
 * STROKE BAND for render paths without a stroke-to-path primitive (the PDF
 * /AP and the flattened print) — Drawboard parity, 2026-09-09, reworked
 * 2026-09-10.
 *
 * SVG and canvas knock the fill out under the stroke band with a mask /
 * destination-out (see cloudSvgPaint.js, annotationCanvasPainter.js). PDF has
 * no stroke-to-path, and its transparency tools were rejected after probing:
 * a knockout group (/K true) is ignored by pdf.js, and a luminosity soft mask
 * is dropped by Quartz inside annotation appearance streams (Preview would
 * show the cloud with NO fill at all). So the band is computed here, in plain
 * geometry — every painted run sampled into round-capped capsules of the ink
 * width — and the writer CLIPS the fill to the COMPLEMENT of it (PDF 32000
 * 8.5.4: a `W*` clip of the appearance box plus the band rings), which every
 * viewer honours.
 *
 * 2026-09-10 — WHY THE BAND AND NOT THE SUBTRACTED REGION. The first version
 * returned `fill MINUS band` as explicit rings, which meant unioning the
 * sampled fill contour with the crown lobes and the body polygon. Those three
 * families share long, exactly-coincident edges (the contour IS cut pieces of
 * the lobes; a lobe's chord is collinear with the body edge it spans), and
 * martinez-polygon-clipping — like every sweep-line clipper — is undefined on
 * that input. Measured on this branch: one plain convex filled polygon cloud
 * (left 40 / top 30, points (0,0) (210,20) (180,160) (30,130), stroke 6, bump
 * 2) spun inside `connectEdges` for over ten minutes, and a self-crossing
 * six-vertex one threw `Cannot read properties of undefined (reading 'depth')`
 * — in BOTH cases the export produced no /AP and no flattened page at all.
 * Clipping needs no region boolean at all: the fill keeps its own nonzero
 * path (its exact cubics, not an 8-step polygonal resample), and the only
 * boolean left is the union of the capsules, which overlap transversally.
 *
 * That union is still a third-party sweep line, so it is fenced three ways:
 *   * every ring is snapped onto a 1e-4 grid and stripped of duplicate and
 *     collinear vertices first, so "the same point" is bit-identical instead
 *     of a nanometre apart (the input class that breaks the sweep);
 *   * a wall-clock budget is checked before every union call and the piece
 *     count is capped, so a slow input degrades instead of stalling;
 *   * every call is wrapped, so a throw degrades too.
 * On any of those the result comes back as `mode: 'pieces'` — the raw
 * capsules, which the writer clips one after another (clip paths intersect,
 * so intersecting the complement of each capsule IS the complement of their
 * union: same picture, a longer stream). Past the piece cap the caller gets
 * null and paints the plain fill, with the stroke covering the band.
 *
 * @returns {{ rings:{x:number,y:number}[][], mode:'union'|'pieces' }|null}
 *   rings in the cloud's local frame, or null when the cloud has no fill or
 *   no stroke to knock out.
 */
export function cloudStrokeBandRings(geometry, options = {}) {
  if (!geometry?.fill || !(num(geometry.strokeWidth) > 0)) return null;
  const half = num(geometry.strokeWidth) / 2;
  const steps = Math.max(2, Math.round(num(options.steps, 8)));
  const capSteps = Math.max(3, Math.round(num(options.capSteps, 8)));
  const budgetMs = Math.max(1, num(options.budgetMs, CLOUD_BAND_UNION_BUDGET_MS));
  const maxPieces = Math.max(1, Math.round(num(options.maxPieces, CLOUD_BAND_MAX_PIECES)));

  const runs = Array.isArray(geometry.outlineRuns) && geometry.outlineRuns.length > 0
    ? geometry.outlineRuns
    : [geometry.outline];
  const pieces = [];
  for (const run of runs) {
    for (const polyline of sampleCloudCubics(run, steps)) {
      const sausage = sanitizeClipperRing(polylineSausage(polyline, half, capSteps));
      if (sausage) {
        pieces.push(sausage);
        continue;
      }
      for (let index = 0; index + 1 < polyline.length; index += 1) {
        const capsule = sanitizeClipperRing(segmentCapsule(polyline[index], polyline[index + 1], half, capSteps));
        if (capsule) pieces.push(capsule);
      }
    }
    if (pieces.length > maxPieces) return null;
  }
  if (pieces.length === 0) return null;

  const toRings = (multi) => {
    const rings = [];
    for (const polygon of multi) {
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
    return rings;
  };

  const deadline = Date.now() + budgetMs;
  try {
    const band = unionAll(pieces.map((ring) => [ring]), deadline);
    const rings = toRings(band);
    if (rings.length > 0) return { rings, mode: 'union' };
  } catch (error) {
    if (!(error instanceof CloudClipBudgetError)) {
      console.warn('Cloud stroke-band union failed; the writer clips the capsules one by one instead:', error?.message || error);
    }
  }
  const rings = toRings(pieces.map((ring) => [ring]));
  return rings.length > 0 ? { rings, mode: 'pieces' } : null;
}

// martinez returns a polygon or a multipolygon depending on the result;
// always work with a multipolygon (array of polygons, each an array of rings).
const normalizeMulti = (result) => {
  if (!Array.isArray(result) || result.length === 0) return [];
  const isRing = (value) => Array.isArray(value) && Array.isArray(value[0]) && typeof value[0][0] === 'number';
  if (isRing(result[0])) return [result];
  return result.filter((polygon) => Array.isArray(polygon) && polygon.length > 0);
};

// Balanced pairwise union of polygons (each `[ring]`), as one multipolygon.
// The deadline is checked BEFORE every clipper call: a sweep line cannot be
// interrupted once it is inside, so the only bound that can be enforced is
// on entering one.
const unionAll = (polygons, deadline) => {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return normalizeMulti(polygons[0].length && typeof polygons[0][0][0][0] === 'number' ? [polygons[0]] : polygons[0]);
  const middle = Math.floor(polygons.length / 2);
  const left = unionAll(polygons.slice(0, middle), deadline);
  const right = unionAll(polygons.slice(middle), deadline);
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  if (Number.isFinite(deadline) && Date.now() > deadline) throw new CloudClipBudgetError('cloud band union budget exceeded');
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
