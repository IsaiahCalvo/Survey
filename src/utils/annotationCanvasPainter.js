/**
 * Canvas2D annotation painter.
 *
 * PIXEL-FIDELITY CONTRACT (2026-07-14, unified-renderer phase 2): this painter
 * serves ONLY the transient windows where the SVG layer is not the visible
 * truth — the eraser-mode raster base that FabricEraserCanvas snapshots and
 * carves, and the zoom/scroll interaction proxy. Its output must be visually
 * indistinguishable from the SVG renderers or the moment those windows
 * open/close reads as a glitch. Every drawing routine here mirrors its
 * svgAnnotationRenderers.jsx counterpart formula-for-formula and, wherever
 * possible, calls the SAME pure spec builders the SVG side uses
 * (buildLineRenderSpec / buildArrowheadRenderSpec / renderPathToSvgD /
 * buildCloudPathCommands / calculateCalloutConnection). If you change a
 * renderer in svgAnnotationRenderers.jsx, change the twin here.
 *
 * Known, accepted divergence: `mix-blend-mode: multiply` (highlighter) blends
 * with the PDF page in SVG; a transparent canvas can only multiply against its
 * own backdrop. Visible only inside the transient windows.
 *
 * Worker-safe: imported by annotationCanvasWorker.js — keep every import here
 * free of React/fabric/DOM side effects.
 */
import { calculateCalloutConnection } from './calloutGeometry.js';
import { segmentGraphemes } from './textGraphemes.js';
import { renderPathToSvgAttrs, renderPathToSvgD } from './svgPathAttrs.js';
import {
  ARROWHEAD_STYLES,
  buildArrowheadRenderSpec,
  buildLineRenderSpec,
  calloutLineDashArray,
} from './lineRenderHelpers.js';
import { countWrappedLines, getLineEndpoints } from './svgBoundingBox.js';
import { resolveAnnotationCloudSpec } from './pdfAnnotationAppearance.js';
// UX 2026-09-09: clouds paint from the shared resolver (engine vertices with
// scale baked in, translate + rotate frame, crown outline, scalloped fill) so
// the bitmap twin is the SVG layer's output, not a re-derivation of it.
import { resolveCloudAnnotationGeometry } from './cloudAnnotationGeometry.js';
import { DRAWN_CENTERED_STROKE_CONTRACT } from './shapeCommitGeometry.js';
import { createInkPathAffine } from './inkGeometryTransform.js';
import { normalizeOperationalInkPath } from './inkPathNormalization.js';
import { getCounterLabelLayout } from './counterGeometry.js';

const MAX_RASTER_SCALE = 2.5;
const MAX_BACKING_DIMENSION = 8192;
const MAX_BACKING_PIXELS = 4 * 1024 * 1024;
// Mirrors renderCallout defaults (svgAnnotationRenderers.jsx:1234-1236):
// line '#1e293b' (matches defaultCalloutStyle), fill transparent.
const DEFAULT_CALLOUT_COLOR = '#1e293b';
// Mirrors renderText's TEXT_PADDING gutter.
const TEXT_PADDING = 6;

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clampOpacity = (value) => Math.max(0, Math.min(1, toNumber(value, 1)));

const isVisiblePaint = (value) => {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== ''
    && normalized !== 'none'
    && normalized !== 'transparent'
    && normalized !== 'rgba(0,0,0,0)'
    && normalized !== 'rgba(0, 0, 0, 0)';
};

export function calculateAnnotationCanvasBackingStore({
  pageWidth,
  pageHeight,
  displayScale,
  devicePixelRatio = 1,
}) {
  const safeWidth = Math.max(1, toNumber(pageWidth, 1));
  const safeHeight = Math.max(1, toNumber(pageHeight, 1));
  const safeDisplayScale = Math.max(0.01, toNumber(displayScale, 1));
  const safeDpr = Math.max(1, Math.min(2, toNumber(devicePixelRatio, 1)));
  const requestedScale = Math.min(safeDisplayScale, MAX_RASTER_SCALE) * safeDpr;
  const requestedWidth = safeWidth * requestedScale;
  const requestedHeight = safeHeight * requestedScale;
  const dimensionFactor = Math.min(
    1,
    MAX_BACKING_DIMENSION / requestedWidth,
    MAX_BACKING_DIMENSION / requestedHeight,
  );
  const areaFactor = Math.min(
    1,
    Math.sqrt(MAX_BACKING_PIXELS / (requestedWidth * requestedHeight)),
  );
  const budgetFactor = Math.min(dimensionFactor, areaFactor);
  const idealScale = requestedScale * budgetFactor;

  // Canvas backing dims must be integers, so the returned scales are
  // RE-DERIVED from the rounded dims (independently per axis — the fractional
  // parts differ). Returning the unrounded scale painted a page extent that
  // missed the backing size by <1px; the CSS stretch back to the host then
  // scaled ALL geometry by extent/backing from the top-left origin — a
  // 1-2px linear drift vs the SVG layer (renderer-parity harness, 2026-07-14).
  const width = Math.max(1, Math.min(
    Math.round(safeWidth * idealScale), MAX_BACKING_DIMENSION,
  ));
  const height = Math.max(1, Math.min(
    Math.round(safeHeight * idealScale), MAX_BACKING_DIMENSION,
  ));

  return {
    width,
    height,
    drawScale: width / safeWidth,
    drawScaleY: height / safeHeight,
    // CSS box for an UNclamped presentation canvas. Stretching the bitmap to
    // the host's fractional CSS box (width:100% of e.g. 605.03125px) makes the
    // compositor's device-pixel snapping rescale the raster by ~1/width — a
    // linear geometry drift vs SVG plus a full-canvas resample (soft text).
    // An integer device extent (backing/dpr CSS px; both box edges share the
    // host's fractional offset) snaps 1:1 — ≤0.5px uniform shift, no stretch.
    // Meaningless when clamped: a clamped backing must stretch to fill 100%.
    cssWidth: width / safeDpr,
    cssHeight: height / safeDpr,
    clamped: safeDisplayScale > MAX_RASTER_SCALE || budgetFactor < 0.9999,
  };
}

export function traceFabricPath(context, commands) {
  context.beginPath();
  traceCommandsInto(context, commands);
}

// Traces an array of absolute [op, ...coords] commands into an ALREADY-begun
// path (callers own beginPath so multi-part geometry can share one path).
function traceCommandsInto(context, commands) {
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  for (const segment of commands || []) {
    if (!Array.isArray(segment) || segment.length === 0) continue;
    const op = String(segment[0]).toUpperCase();
    if (op === 'M') {
      currentX = toNumber(segment[1]);
      currentY = toNumber(segment[2]);
      startX = currentX;
      startY = currentY;
      context.moveTo(currentX, currentY);
    } else if (op === 'L') {
      currentX = toNumber(segment[1]);
      currentY = toNumber(segment[2]);
      context.lineTo(currentX, currentY);
    } else if (op === 'Q') {
      context.quadraticCurveTo(
        toNumber(segment[1]),
        toNumber(segment[2]),
        toNumber(segment[3]),
        toNumber(segment[4]),
      );
      currentX = toNumber(segment[3]);
      currentY = toNumber(segment[4]);
    } else if (op === 'C') {
      context.bezierCurveTo(
        toNumber(segment[1]),
        toNumber(segment[2]),
        toNumber(segment[3]),
        toNumber(segment[4]),
        toNumber(segment[5]),
        toNumber(segment[6]),
      );
      currentX = toNumber(segment[5]);
      currentY = toNumber(segment[6]);
    } else if (op === 'H') {
      currentX = toNumber(segment[1]);
      context.lineTo(currentX, currentY);
    } else if (op === 'V') {
      currentY = toNumber(segment[1]);
      context.lineTo(currentX, currentY);
    } else if (op === 'A' && segment.length >= 3) {
      currentX = toNumber(segment[segment.length - 2]);
      currentY = toNumber(segment[segment.length - 1]);
      context.lineTo(currentX, currentY);
    } else if (op === 'Z') {
      context.closePath();
      currentX = startX;
      currentY = startY;
    }
  }
}

// Parse an SVG path d-string (as emitted by renderPathToSvgD /
// buildCloudPathCommands joins: absolute M/L/Q/C/H/V/A/Z, space/comma
// separated) into [op, ...number] command arrays for traceCommandsInto.
// Keeping the parser here means Canvas follows the exact authored geometry
// emitted by the SVG lane, including legacy shorthand normalized upstream.
const ARG_COUNT = { M: 2, L: 2, Q: 4, C: 6, H: 1, V: 1, A: 7, Z: 0 };
export function parseSvgPathD(d) {
  const out = [];
  if (typeof d !== 'string' || !d) return out;
  const tokens = d.match(/[MLQCHVAZmlqchvaz]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || [];
  let index = 0;
  while (index < tokens.length) {
    const opToken = tokens[index];
    if (!/^[a-z]$/i.test(opToken)) { index += 1; continue; }
    const op = opToken.toUpperCase();
    index += 1;
    const argCount = ARG_COUNT[op];
    if (argCount == null) continue;
    if (argCount === 0) { out.push([op]); continue; }
    // repeat implicit commands (e.g. "L x y x y")
    while (index + argCount <= tokens.length && !/^[a-z]$/i.test(tokens[index])) {
      const args = tokens.slice(index, index + argCount).map(Number);
      if (args.some((value) => !Number.isFinite(value))) break;
      out.push([op, ...args]);
      index += argCount;
    }
  }
  return out;
}

function pathBounds(commands) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segment of commands || []) {
    for (let index = 1; index + 1 < segment.length; index += 2) {
      const x = Number(segment[index]);
      const y = Number(segment[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

// A ring counts only with at least three points besides a repeated closing
// point — exactly the SVG layer's rule (svgAnnotationRenderers
// paperCutsToSvgD). A closed 3-point ring [a, b, a] is a line: the SVG layer
// dropped it and the canvas traced it, so a survivor made only of such rings
// rendered differently on the two (w38 review).
function isClipRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const closed = ring.length > 1
    && ring[0]?.[0] === ring.at(-1)?.[0]
    && ring[0]?.[1] === ring.at(-1)?.[1];
  return (closed ? ring.length - 1 : ring.length) >= 3;
}

function tracePolygonSetInto(context, polygons) {
  for (const polygon of polygons || []) {
    for (const ring of polygon || []) {
      if (!isClipRing(ring)) continue;
      context.moveTo(toNumber(ring[0]?.[0]), toNumber(ring[0]?.[1]));
      for (let index = 1; index < ring.length; index += 1) {
        context.lineTo(toNumber(ring[index]?.[0]), toNumber(ring[index]?.[1]));
      }
      context.closePath();
    }
  }
}

function applyBlendAndOpacity(context, object, opacityOverride = null) {
  context.globalAlpha = clampOpacity(opacityOverride ?? object?.opacity ?? 1);
  context.globalCompositeOperation = object?.globalCompositeOperation === 'multiply'
    ? 'multiply'
    : 'source-over';
}

function applyRotation(context, angle, centerX, centerY) {
  if (!angle) return;
  context.translate(centerX, centerY);
  context.rotate((angle * Math.PI) / 180);
  context.translate(-centerX, -centerY);
}

function paintCurrentPath(context, { fill, stroke, strokeWidth, fillRule = 'nonzero' }) {
  if (isVisiblePaint(fill)) {
    context.fillStyle = fill;
    context.fill(fillRule);
  }
  if (isVisiblePaint(stroke) && strokeWidth > 0) {
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.stroke();
  }
}

// Rasterize a buildArrowheadRenderSpec result — the shared spec is the
// contract; this is the 1:1 canvas twin of renderArrowheadFromSpec (SVG).
function paintArrowheadSpec(context, spec) {
  if (!spec || spec.kind === 'none') return;
  context.save();
  if (typeof context.setLineDash === 'function') context.setLineDash([]);
  if (spec.kind === 'solidTriangle' || spec.kind === 'openTriangle') {
    const headSize = Math.max(8, (spec.sw || 0) * 3);
    context.translate(spec.tipX, spec.tipY);
    context.rotate(((spec.angleDeg || 0) * Math.PI) / 180);
    context.beginPath();
    context.moveTo(-headSize / 3, -headSize / 2);
    context.lineTo((headSize * 2) / 3, 0);
    context.lineTo(-headSize / 3, headSize / 2);
    context.closePath();
    if (spec.kind === 'solidTriangle') {
      context.fillStyle = spec.polygon.fill;
      context.fill();
    } else {
      context.strokeStyle = spec.polygon.stroke;
      context.lineWidth = spec.polygon.strokeWidth;
      context.lineJoin = 'round';
      context.stroke();
    }
  } else if (spec.kind === 'openCircle') {
    context.beginPath();
    context.arc(spec.circle.cx, spec.circle.cy, spec.circle.r, 0, Math.PI * 2);
    if (spec.circle.fill && spec.circle.fill !== 'none') {
      context.fillStyle = spec.circle.fill;
      context.fill();
    }
    context.strokeStyle = spec.circle.stroke;
    context.lineWidth = spec.circle.strokeWidth;
    context.stroke();
  } else if (spec.kind === 'vShape') {
    const pts = String(spec.polyline.points).split(' ').map((pair) => pair.split(',').map(Number));
    context.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.strokeStyle = spec.polyline.stroke;
    context.lineWidth = spec.polyline.strokeWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  } else if (spec.kind === 'diamond' || spec.kind === 'square') {
    const local = String(spec.polygon.points).split(' ').map((pair) => pair.split(',').map(Number));
    context.translate(spec.tipX, spec.tipY);
    context.rotate(((spec.angleDeg || 0) * Math.PI) / 180);
    context.beginPath();
    local.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.closePath();
    if (spec.polygon.fill && spec.polygon.fill !== 'none') {
      context.fillStyle = spec.polygon.fill;
      context.fill();
    }
    context.strokeStyle = spec.polygon.stroke;
    context.lineWidth = spec.polygon.strokeWidth;
    context.lineJoin = 'round';
    context.stroke();
  } else if (spec.kind === 'horizontalLine' || spec.kind === 'slash') {
    context.beginPath();
    context.moveTo(spec.line.x1, spec.line.y1);
    context.lineTo(spec.line.x2, spec.line.y2);
    context.strokeStyle = spec.line.stroke;
    context.lineWidth = spec.line.strokeWidth;
    context.lineCap = 'round';
    context.stroke();
  }
  context.restore();
}

function drawPath(context, object, displayScale) {
  if (!Array.isArray(object?.path) || object.path.length === 0) return;
  const attrs = renderPathToSvgAttrs(object);
  const isPdfHairline = attrs.vectorEffect === 'non-scaling-stroke';

  // SVG's non-scaling-stroke is defined after the complete object transform:
  // the centerline moves into page space, but its one-display-pixel outline
  // never inherits scale/skew. Applying a reciprocal geometric-mean width
  // inside Canvas's anisotropic CTM cannot reproduce that contract — a
  // scaleX=4/scaleY=1 object made horizontal and vertical hairlines 0.5px and
  // 2px respectively. Trace a read-only normalized copy through the same
  // affine used by SVG/hit-test/export, then stroke in page space instead.
  if (isPdfHairline) {
    const affine = createInkPathAffine(object, object.path);
    const pageCommands = normalizeOperationalInkPath(object.path).map((command) => {
      if (!Array.isArray(command) || command.length < 2) return command;
      const transformed = [command[0]];
      for (let index = 1; index + 1 < command.length; index += 2) {
        const point = affine.point(command[index], command[index + 1]);
        transformed.push(point.x, point.y);
      }
      return transformed;
    });

    context.save();
    applyBlendAndOpacity(context, object, attrs.opacity);
    context.lineCap = attrs.strokeLinecap || 'round';
    context.lineJoin = attrs.strokeLinejoin || 'round';
    context.miterLimit = toNumber(attrs.strokeMiterlimit, 10);
    if (typeof context.setLineDash === 'function') {
      context.setLineDash(Array.isArray(attrs.strokeDasharray) ? attrs.strokeDasharray : []);
    }
    context.lineDashOffset = toNumber(attrs.strokeDashoffset);
    context.beginPath();
    traceCommandsInto(context, pageCommands);
    paintCurrentPath(context, {
      fill: attrs.fill,
      stroke: attrs.stroke,
      strokeWidth: toNumber(attrs.strokeWidth, 1) / Math.max(0.01, toNumber(displayScale, 1)),
      fillRule: attrs.fillRule || 'nonzero',
    });
    context.restore();
    return;
  }

  const left = toNumber(object.left);
  const top = toNumber(object.top);
  const scaleX = toNumber(object.scaleX, 1) || 1;
  const scaleY = toNumber(object.scaleY, 1) || 1;
  const pathOffsetX = toNumber(object.pathOffset?.x);
  const pathOffsetY = toNumber(object.pathOffset?.y);
  const bounds = pathBounds(object.path);
  const rotationCenterX = bounds
    ? scaleX * ((bounds.minX + bounds.maxX) / 2 - pathOffsetX)
    : 0;
  const rotationCenterY = bounds
    ? scaleY * ((bounds.minY + bounds.maxY) / 2 - pathOffsetY)
    : 0;

  context.save();
  applyBlendAndOpacity(context, object, attrs.opacity);
  context.translate(left, top);
  applyRotation(context, toNumber(object.angle), rotationCenterX, rotationCenterY);
  context.scale(scaleX, scaleY);
  context.translate(-pathOffsetX, -pathOffsetY);
  context.lineCap = attrs.strokeLinecap || 'round';
  context.lineJoin = attrs.strokeLinejoin || 'round';
  context.miterLimit = toNumber(attrs.strokeMiterlimit, 10);
  if (typeof context.setLineDash === 'function') {
    context.setLineDash(Array.isArray(attrs.strokeDasharray) ? attrs.strokeDasharray : []);
  }
  context.lineDashOffset = toNumber(attrs.strokeDashoffset);

  // Partially erased authored curve: paint the exact source stroke clipped to
  // the SURVIVOR polygons (even-odd), the same clip the SVG layer uses
  // (svgAnnotationRenderers renderPath). w38 (2026-09-25): this used to clip
  // with (source bounds minus paperEraserCuts). The cuts come from a second
  // polygon boolean (source outline minus survivor) whose operands share most
  // of their edges, which Martinez gets wrong: the canvas painted slivers of
  // ink inside erased holes and notched the ink beside them while the SVG
  // layer was clean. The survivor is the eraser's own verified output.
  const paperSource = object?.paperSourceStroke;
  const paperSurvivors = object?.polygons;
  if (
    Array.isArray(paperSource?.path)
    && paperSource.path.length > 0
    && Array.isArray(paperSource.matrix)
    && paperSource.matrix.length === 6
    && Array.isArray(paperSurvivors)
    // Same test as the SVG layer's clip path: at least one real ring.
    && paperSurvivors.some((polygon) => Array.isArray(polygon) && polygon.some(isClipRing))
    && typeof context.clip === 'function'
    && typeof context.transform === 'function'
  ) {
    context.save();
    context.beginPath();
    tracePolygonSetInto(context, paperSurvivors);
    context.clip('evenodd');
    context.transform(...paperSource.matrix);
    context.lineCap = paperSource.strokeLineCap || 'round';
    context.lineJoin = paperSource.strokeLineJoin || 'round';
    context.miterLimit = toNumber(paperSource.strokeMiterLimit, 10);
    if (typeof context.setLineDash === 'function') {
      context.setLineDash(
        Array.isArray(paperSource.strokeDashArray)
          ? paperSource.strokeDashArray
          : [],
      );
    }
    context.lineDashOffset = toNumber(paperSource.strokeDashOffset);
    context.beginPath();
    traceCommandsInto(
      context,
      Array.isArray(paperSource.operationalPath)
        ? paperSource.operationalPath
        : normalizeOperationalInkPath(paperSource.path),
    );
    if (paperSource.paintMode === 'fill') {
      context.fillStyle = object.fill || attrs.fill || paperSource.fill;
      context.fill(paperSource.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    } else {
      context.strokeStyle = object.fill || attrs.fill || paperSource.stroke;
      context.lineWidth = toNumber(paperSource.strokeWidth);
      context.stroke();
    }
    context.restore();
    context.restore();
    return;
  }

  // Same exact authored geometry the SVG paints.
  context.beginPath();
  traceCommandsInto(
    context,
    normalizeOperationalInkPath(parseSvgPathD(renderPathToSvgD(object, attrs))),
  );

  const strokeWidth = toNumber(attrs.strokeWidth, 1);
  // Erased-outline override (renderPath:233-236): strokeWidth 0 + visible fill
  // means paper-eraser outline geometry — fill with evenodd so carved holes
  // stay holes instead of filling back in under the nonzero rule.
  const isErasedOutline = toNumber(object.strokeWidth, 0) === 0 && isVisiblePaint(object.fill);
  paintCurrentPath(context, {
    fill: attrs.fill,
    stroke: isErasedOutline ? null : attrs.stroke,
    strokeWidth,
    fillRule: isErasedOutline ? 'evenodd' : (attrs.fillRule || 'nonzero'),
  });
  context.restore();
}

// Twin of renderLine (svgAnnotationRenderers.jsx:471-608): shared
// buildLineRenderSpec geometry (center-relative endpoints, curved branch,
// triangle shaft shortening), dash on the shaft only, rotation about the
// curve-inclusive bbox center.
function drawLine(context, object) {
  const spec = buildLineRenderSpec(object);
  context.save();
  applyBlendAndOpacity(context, object);

  const angle = toNumber(object?.angle, 0);
  if (angle !== 0) {
    const rawEp = getLineEndpoints(object);
    const midPt = object?.data?.midpoint;
    const bxs = [rawEp.x1, rawEp.x2];
    const bys = [rawEp.y1, rawEp.y2];
    if (midPt) {
      const Cx = 2 * midPt.x - 0.5 * rawEp.x1 - 0.5 * rawEp.x2;
      const Cy = 2 * midPt.y - 0.5 * rawEp.y1 - 0.5 * rawEp.y2;
      const denomX = rawEp.x1 - 2 * Cx + rawEp.x2;
      const denomY = rawEp.y1 - 2 * Cy + rawEp.y2;
      if (Math.abs(denomX) > 1e-9) {
        const tx = (rawEp.x1 - Cx) / denomX;
        if (tx > 0 && tx < 1) {
          const o = 1 - tx;
          bxs.push(o * o * rawEp.x1 + 2 * o * tx * Cx + tx * tx * rawEp.x2);
        }
      }
      if (Math.abs(denomY) > 1e-9) {
        const ty = (rawEp.y1 - Cy) / denomY;
        if (ty > 0 && ty < 1) {
          const o = 1 - ty;
          bys.push(o * o * rawEp.y1 + 2 * o * ty * Cy + ty * ty * rawEp.y2);
        }
      }
    }
    const cx = (Math.min(...bxs) + Math.max(...bxs)) / 2;
    const cy = (Math.min(...bys) + Math.max(...bys)) / 2;
    applyRotation(context, angle, cx, cy);
  }

  const dash = Array.isArray(object?.strokeDashArray) && object.strokeDashArray.length > 0
    ? object.strokeDashArray
    : [];
  if (typeof context.setLineDash === 'function') context.setLineDash(dash);

  if (spec.kind === 'curved') {
    context.beginPath();
    traceCommandsInto(context, parseSvgPathD(spec.path.d));
    context.strokeStyle = spec.path.stroke;
    context.lineWidth = spec.path.strokeWidth;
    context.lineCap = 'round';
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(spec.line.x1, spec.line.y1);
    context.lineTo(spec.line.x2, spec.line.y2);
    context.strokeStyle = spec.line.stroke;
    context.lineWidth = spec.line.strokeWidth;
    context.lineCap = 'round';
    context.stroke();
  }
  paintArrowheadSpec(context, spec.arrowhead);
  context.restore();
}

// UX 2026-09-09 (Drawboard/studio parity, twin of CloudOutline in
// svgAnnotationRenderers.jsx / cloudSvgPaint.js):
//  * the scalloped fill region (one nonzero path, only when the fill paint is
//    visible) is KNOCKED OUT under the whole stroke band before the crowns are
//    painted, so a translucent stroke composites over the page and never over
//    its own fill. Canvas has no mask primitive, so the fill is painted on a
//    scratch layer, the stroke band is erased from it (destination-out with
//    the outline at the ink width, round caps/joins) and the layer is
//    composited back with the object's own opacity/blend — never a
//    destination-out on the shared canvas, which would punch holes in
//    annotations painted underneath.
//  * the crowns are stroked ONE RUN AT A TIME (the studio's per-run <path>s),
//    so overlapping run junctions composite per run like the SVG layer.
//  * the fill AND the runs are painted on that layer at FULL alpha and the
//    layer is composited once with the object's opacity — the SVG `<g opacity>`
//    group buffer, so a junction never double-counts the object's opacity.
// A context without a backing canvas (recording contexts, unsupported
// environments) falls back to painting inline, which keeps the geometry path
// identical; only the knockout and the group compositing are lost.
const scratchLayerByContext = typeof WeakMap === 'function' ? new WeakMap() : null;

const createScratchCanvas = (width, height, base) => {
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  } catch { /* fall through */ }
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  } catch { /* fall through */ }
  try {
    // node-canvas exposes a constructible Canvas class on the element.
    if (base && typeof base.constructor === 'function') {
      const canvas = new base.constructor(width, height);
      if (canvas && typeof canvas.getContext === 'function') return canvas;
    }
  } catch { /* fall through */ }
  return null;
};

const acquireScratchLayer = (context) => {
  const base = context?.canvas;
  const width = Number(base?.width);
  const height = Number(base?.height);
  if (!(width > 0) || !(height > 0) || typeof context.getTransform !== 'function') return null;
  let layer = scratchLayerByContext?.get(context) || null;
  if (!layer || layer.canvas.width !== width || layer.canvas.height !== height) {
    const canvas = createScratchCanvas(width, height, base);
    const scratch = canvas?.getContext?.('2d') || null;
    if (!scratch) return null;
    layer = { canvas, context: scratch };
    scratchLayerByContext?.set(context, layer);
  }
  return layer;
};

const strokeCloudRuns = (context, geometry, stroke, strokeWidth) => {
  const runs = Array.isArray(geometry.outlineRuns) && geometry.outlineRuns.length > 0
    ? geometry.outlineRuns
    : [geometry.outline];
  if (typeof context.setLineDash === 'function') context.setLineDash([]);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = stroke;
  context.lineWidth = strokeWidth;
  for (const run of runs) {
    context.beginPath();
    traceCommandsInto(context, run);
    context.stroke();
  }
};

// Paint the WHOLE cloud (knocked-out fill + every run) on the scratch layer at
// full alpha, then composite the layer ONCE with the object's opacity / blend
// mode — the canvas twin of the SVG `<g opacity>` the screen renders.
//
// UX 2026-09-09 (run-junction opacity parity): the runs must composite with
// each other BEFORE the object's opacity is applied, exactly as they do inside
// an SVG group buffer. Multiplying the opacity into every run stroke instead
// (globalAlpha per `stroke()`) makes a junction covered by two runs land at
// 1-(1-strokeAlpha*objectOpacity)^2 rather than (1-(1-strokeAlpha)^2)*objectOpacity
// — for rgba(...,.5) at opacity .5 that is .4375 vs .375, ~13/255 of visible
// double-darkening at every junction that the screen, the studio and Drawboard
// do not have.
//
// The same layer carries the fill knockout (canvas has no mask primitive): the
// fill is painted, the stroke band is erased from it (destination-out at the
// ink width) and the crowns are stroked over it — never a destination-out on
// the shared canvas, which would punch holes in annotations painted underneath.
//
// Returns false when no scratch layer is available (recording contexts,
// canvases without getTransform) so the caller paints inline instead; only the
// knockout and the group compositing are lost, never the geometry.
const paintCloudThroughLayer = (context, object, geometry, paint) => {
  const layer = acquireScratchLayer(context);
  if (!layer) return false;
  const scratch = layer.context;
  scratch.save();
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.globalAlpha = 1;
  scratch.globalCompositeOperation = 'source-over';
  scratch.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  scratch.setTransform(context.getTransform());
  if (paint.hasFill) {
    scratch.beginPath();
    traceCommandsInto(scratch, geometry.fill);
    scratch.fillStyle = object.fill;
    scratch.fill('nonzero');
    if (paint.hasStroke) {
      scratch.globalCompositeOperation = 'destination-out';
      strokeCloudRuns(scratch, geometry, '#000', geometry.strokeWidth);
      scratch.globalCompositeOperation = 'source-over';
    }
  }
  if (paint.hasStroke) strokeCloudRuns(scratch, geometry, paint.stroke, geometry.strokeWidth);
  scratch.restore();
  // One composite with the object's opacity / blend mode, which
  // applyBlendAndOpacity already put on `context`.
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(layer.canvas, 0, 0);
  context.restore();
  return true;
};

function drawCloud(context, object, geometry, strokeFallback = null) {
  const strokePaint = isVisiblePaint(object.stroke) ? object.stroke : strokeFallback;
  const hasStroke = isVisiblePaint(strokePaint) && geometry.strokeWidth > 0;
  const hasFill = Boolean(geometry.fill) && isVisiblePaint(object.fill);
  context.save();
  applyBlendAndOpacity(context, object);
  context.translate(geometry.origin.x, geometry.origin.y);
  applyRotation(context, geometry.angle, geometry.pivot.x, geometry.pivot.y);
  // The group buffer is what makes the knockout possible AND what keeps run
  // junctions off the object's opacity; either need is enough to want it.
  const wantsLayer = (hasFill && hasStroke) || (hasStroke && context.globalAlpha < 1);
  const painted = wantsLayer
    && paintCloudThroughLayer(context, object, geometry, { hasFill, hasStroke, stroke: strokePaint });
  if (!painted) {
    if (hasFill) {
      context.beginPath();
      traceCommandsInto(context, geometry.fill);
      paintCurrentPath(context, { fill: object.fill, stroke: null, strokeWidth: 0, fillRule: 'nonzero' });
    }
    if (hasStroke) strokeCloudRuns(context, geometry, strokePaint, geometry.strokeWidth);
  }
  context.restore();
}

// Twin of renderPolygon / renderPolyline: the exact SVG transform chain
// (translate → rotate about the pathOffset-corrected center → scale →
// translate(−pathOffset)) so points land where the SVG puts them.
function drawPoints(context, object, close) {
  const points = Array.isArray(object?.points) ? object.points : [];
  if (points.length === 0) return;
  // UX 2026-09-09: closed polygons AND open polylines both take the Cloud
  // style; resolveAnnotationCloudSpec decides, and the shared geometry
  // resolver hands back the studio's crowns with any scale already baked into
  // the vertices. An open polyline has no interior, so it never paints a fill.
  const cloudGeometry = resolveAnnotationCloudSpec(object)
    ? resolveCloudAnnotationGeometry(object)
    : null;
  if (cloudGeometry) {
    drawCloud(context, object, cloudGeometry, close ? null : '#000');
    return;
  }
  const scaleX = toNumber(object.scaleX, 1) || 1;
  const scaleY = toNumber(object.scaleY, 1) || 1;
  const pathOffsetX = toNumber(object.pathOffset?.x);
  const pathOffsetY = toNumber(object.pathOffset?.y);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const point of points) {
    const x = toNumber(point?.x);
    const y = toNumber(point?.y);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  context.save();
  applyBlendAndOpacity(context, object);
  context.translate(toNumber(object.left), toNumber(object.top));
  applyRotation(
    context,
    toNumber(object.angle),
    scaleX * ((minX + maxX) / 2 - pathOffsetX),
    scaleY * ((minY + maxY) / 2 - pathOffsetY),
  );
  context.scale(scaleX, scaleY);
  context.translate(-pathOffsetX, -pathOffsetY);

  const strokeWidth = toNumber(object.strokeWidth, 1);
  context.beginPath();
  points.forEach((point, index) => {
    const x = toNumber(point?.x);
    const y = toNumber(point?.y);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  if (close) context.closePath();

  if (typeof context.setLineDash === 'function') {
    context.setLineDash(Array.isArray(object.strokeDashArray) && object.strokeDashArray.length > 0
      ? object.strokeDashArray
      : []);
  }
  context.lineCap = 'round';
  context.lineJoin = 'round';
  paintCurrentPath(context, {
    // Polygon: stroke defaults to invisible like SVG (renderPolygon:780);
    // polyline defaults to '#000' (renderPolyline:858). Both honor fill.
    fill: isVisiblePaint(object.fill) ? object.fill : null,
    stroke: isVisiblePaint(object.stroke) ? object.stroke : (close ? null : '#000'),
    strokeWidth,
  });
  context.restore();
}

// --- CSS first-baseline resolution ------------------------------------------
// The SVG/CSS renderers place each line's glyph baseline by half-leading from
// the font's LAYOUT ascent/descent (CSS inline layout, and what SVG
// dominant-baseline='central' derives from), while canvas textBaseline='middle'
// anchors the em-square midpoint — Chromium lands 'middle'-anchored glyphs
// ~0.5-0.9px HIGHER than the same text in the SVG layer, so entering/leaving
// eraser mode visibly nudged text up/down. cssFirstBaseline resolves the CSS
// distance from a line box's TOP to its glyph baseline so the painter can
// anchor with textBaseline='alphabetic' at the exact SVG position.
//
// Worker-safety: this module must stay import-safe with no DOM (see header —
// annotationCanvasWorker.js imports it). The probe div is created lazily, only
// inside this call and only when `document` exists. Workers (OffscreenCanvas)
// and DOM-less Node tests use the measureText fallback:
// lineHeightPx/2 + (fontBoundingBoxAscent − fontBoundingBoxDescent)/2 — the
// dominant-baseline='central' formula. That fallback is exact for the metrics
// the canvas reports but APPROXIMATE for ascent-hacked fonts (e.g. macOS
// Helvetica) whose CSS layout metrics differ from the canvas bounding box.
// `context.font` must already be set to `cssFontShorthand` by the caller so
// the fallback measures the right font. Returns null when no baseline can be
// resolved — callers keep the legacy 'middle' anchoring in that case.
const cssFirstBaselineCache = new Map();
export function cssFirstBaseline(context, cssFontShorthand, lineHeightPx) {
  const key = `${cssFontShorthand}|${lineHeightPx}`;
  if (cssFirstBaselineCache.has(key)) return cssFirstBaselineCache.get(key);
  let offset = null;
  if (typeof document !== 'undefined' && document.body) {
    try {
      const probe = document.createElement('div');
      probe.style.position = 'fixed';
      probe.style.visibility = 'hidden';
      probe.style.left = '-9999px';
      // Order matters: the font shorthand RESETS line-height, so set it after.
      probe.style.font = cssFontShorthand;
      probe.style.lineHeight = `${lineHeightPx}px`;
      probe.textContent = 'Hg';
      // A zero-size inline-block sits ON the text baseline — its bottom edge
      // relative to the div top IS the first-line baseline offset.
      const marker = document.createElement('span');
      marker.style.display = 'inline-block';
      marker.style.width = '0';
      marker.style.height = '0';
      probe.appendChild(marker);
      document.body.appendChild(probe);
      const measured = marker.getBoundingClientRect().bottom
        - probe.getBoundingClientRect().top;
      probe.remove();
      if (Number.isFinite(measured) && measured > 0) offset = measured;
    } catch {
      offset = null;
    }
  }
  if (offset == null && context && typeof context.measureText === 'function') {
    const metrics = context.measureText('Hg');
    const ascent = metrics?.fontBoundingBoxAscent;
    const descent = metrics?.fontBoundingBoxDescent;
    if (Number.isFinite(ascent) && Number.isFinite(descent)) {
      offset = lineHeightPx / 2 + (ascent - descent) / 2;
    }
  }
  // Cache resolved offsets only — null (metrics unavailable) may be transient
  // (document.body not attached yet, stub contexts without font metrics) and
  // must not poison later lookups for the same font.
  if (offset != null) cssFirstBaselineCache.set(key, offset);
  return offset;
}

// break-all wrap, walked by GRAPHEME CLUSTER.
//
// 2026-09-15 (emoji changed shape mid-zoom): both wrappers here used to walk
// `for (const character of paragraph)`, which iterates CODE POINTS. A skin
// tone, a keycap, a flag or a ZWJ sequence is several code points, so the break
// could land INSIDE one emoji and paint the halves as separate glyphs on two
// lines. The SVG twin wraps with CSS `word-break: break-all`, and CSS breaks
// between typographic character units — it can never split a cluster. Since
// this painter IS the visible annotation surface for the zoom/scroll proxy
// window (LightweightAnnotationOverlay mounts with visible={suspendFullSvgForProxy}),
// the disagreement showed up as emoji mangling themselves the moment a zoom
// gesture started and healing again when the SVG came back. Same splitter as
// the PDF export wrapper (src/utils/textGraphemes.js).
function wrapByGraphemeBreakAll(context, paragraph, innerWidth) {
  const lines = [];
  let line = '';
  for (const cluster of segmentGraphemes(paragraph)) {
    const candidate = line + cluster;
    if (line && context.measureText(candidate).width > innerWidth) {
      lines.push(line);
      line = cluster;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

// Twin of renderText (svgAnnotationRenderers.jsx:964-1168): break-all wrap at
// the padded inner width, Fabric's ×1.13 line step, half-leading vertical
// centering per line box, decorations, alignment, background + border rects,
// descender-buffered clip.
function drawText(context, object) {
  const scaleX = Math.abs(toNumber(object.scaleX, 1) || 1);
  const scaleY = Math.abs(toNumber(object.scaleY, 1) || 1);
  const fontSize = Math.max(1, toNumber(object.fontSize, 16));
  const fontFamily = String(object.fontFamily || 'sans-serif').split(',')[0].replace(/["']/g, '');
  const fontShorthand = `${object.fontStyle || 'normal'} ${object.fontWeight || 'normal'} ${fontSize}px ${fontFamily}`;
  const text = String(object.text || '');
  const objType = String(object.type || '').toLowerCase();

  // Sizing twin of renderText:980-991 — textboxes trust their stored dims;
  // i-text / text without stored bounds get a measure pass. The shared
  // measureTextBounds helper is DOM-bound (document.createElement), so this
  // worker-safe painter measures with its own live context instead: same
  // wrap-at-container-width walk, same +4px anti-clip padding, same 20px /
  // one-line floors. Without this fallback, dimensionless text annotations
  // silently vanished from eraser/proxy frames.
  let effectiveWidth;
  let effectiveHeight;
  if (objType === 'textbox' && object.width && object.height) {
    effectiveWidth = Math.abs(toNumber(object.width)) * scaleX;
    effectiveHeight = Math.abs(toNumber(object.height)) * scaleY;
  } else {
    const lineHeightRaw = toNumber(object.lineHeight, 1.16) || 1.16;
    const containerWidth = toNumber(object.width, 100) || 100;
    const singleLineH = fontSize * lineHeightRaw;
    if (!text.trim()) {
      effectiveWidth = 20 * scaleX;
      effectiveHeight = singleLineH * scaleY;
    } else {
      context.save();
      context.font = fontShorthand;
      let maxLineWidth = 0;
      let totalVisualLines = 0;
      for (const line of text.split('\n')) {
        if (line === '') {
          totalVisualLines += 1;
          continue;
        }
        const naturalWidth = context.measureText(line).width;
        if (naturalWidth <= containerWidth) {
          maxLineWidth = Math.max(maxLineWidth, naturalWidth);
          totalVisualLines += 1;
        } else {
          maxLineWidth = containerWidth;
          // Same word-boundary walk as measureTextBounds — a ceil(width /
          // container) approximation under-counts and the block jumps a line.
          totalVisualLines += countWrappedLines(context, line, containerWidth);
        }
      }
      context.restore();
      effectiveWidth = Math.max(maxLineWidth + 4, 20) * scaleX;
      effectiveHeight = Math.max(totalVisualLines * singleLineH + 4, singleLineH) * scaleY;
    }
  }
  if (effectiveWidth <= 0 || effectiveHeight <= 0) return;

  context.save();
  applyBlendAndOpacity(context, object);
  context.translate(toNumber(object.left), toNumber(object.top));
  applyRotation(context, toNumber(object.angle), effectiveWidth / 2, effectiveHeight / 2);

  if (isVisiblePaint(object.backgroundColor)) {
    context.fillStyle = object.backgroundColor;
    context.fillRect(0, 0, effectiveWidth, effectiveHeight);
  }
  if (toNumber(object.strokeWidth) > 0 && isVisiblePaint(object.stroke)) {
    context.strokeStyle = object.stroke;
    context.lineWidth = toNumber(object.strokeWidth);
    if (typeof context.setLineDash === 'function') context.setLineDash([]);
    context.strokeRect(0, 0, effectiveWidth, effectiveHeight);
  }

  const pad = TEXT_PADDING;
  const innerWidth = Math.max(0, effectiveWidth - 2 * pad);
  const innerHeight = Math.max(0, effectiveHeight - 2 * pad);
  const descenderBuffer = fontSize * 0.35;
  const innerDisplayHeight = innerHeight + descenderBuffer;
  context.font = fontShorthand;

  // break-all wrap — cluster-by-cluster breaks, mirroring the foreignObject CSS.
  const lines = [];
  text.split(/\r?\n/).forEach((paragraph) => {
    if (!paragraph) { lines.push(''); return; }
    lines.push(...wrapByGraphemeBreakAll(context, paragraph, innerWidth));
  });

  const lineHeightPx = fontSize * (toNumber(object.lineHeight, 1.16) || 1.16) * 1.13;
  const blockHeight = lines.length * lineHeightPx;
  const verticalAlign = object.verticalAlign || 'top';
  const freeSpace = Math.max(0, innerDisplayHeight - blockHeight);
  const blockTop = pad + (verticalAlign === 'middle' ? freeSpace / 2 : verticalAlign === 'bottom' ? freeSpace : 0);

  const textAlign = object.textAlign || 'left';
  context.textAlign = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'right' : 'left';
  const anchorX = textAlign === 'center' ? pad + innerWidth / 2
    : textAlign === 'right' ? pad + innerWidth
      : pad;
  // Glyph baseline correction (2026-07-14): anchoring 'middle' at the line-box
  // center sat glyphs ~0.5px above the SVG foreignObject (16px Helvetica) —
  // text nudged on every eraser-mode toggle. Anchor 'alphabetic' at the CSS
  // first baseline instead; keep the legacy 'middle' anchor only when no
  // baseline is resolvable (no DOM and no font metrics).
  const baselineInLine = cssFirstBaseline(context, fontShorthand, lineHeightPx);
  const anchorInLine = baselineInLine ?? lineHeightPx / 2;
  context.textBaseline = baselineInLine == null ? 'middle' : 'alphabetic';
  context.fillStyle = isVisiblePaint(object.fill) ? object.fill : '#000';
  // Blink paint-offset snap parity (2026-07-14, probe-verified): Chromium
  // PAINTS foreignObject text with the text block's paint offset snapped to
  // an integer in the fo's LOCAL px space — painted baseline_i =
  // round(foY + blockTop) + i*lineHeightPx + baselineInLine — while DOM
  // geometry APIs report the unrounded layout position. Anchoring at the
  // unrounded blockTop left canvas glyphs up to 0.5 page units off the SVG's
  // painted glyphs, a zoom-PROPORTIONAL drift (0.5 css px at fit-page, 1 css
  // px at 233%) on every eraser toggle. The SVG g translate(left, top) is a
  // raster transform OUTSIDE the snap — mirrored here by context.translate —
  // and painter blockTop = fo y (pad) + align offset, so rounding blockTop is
  // exactly Blink's snap. Only valid with the real baseline anchor; the
  // legacy 'middle' fallback keeps unsnapped placement.
  const paintBlockTop = baselineInLine == null ? blockTop : Math.round(blockTop);

  // Clip like the foreignObject (overflow hidden at padded box + descender).
  context.beginPath();
  context.rect(pad, pad, innerWidth, innerDisplayHeight);
  context.clip();

  const decorationWidth = Math.max(1, fontSize / 14);
  // Decorations keep the exact visual positions they were tuned to — offsets
  // from the old line-box center (centerY = lineTop + lineHeightPx/2) —
  // re-expressed relative to the baseline anchor. Only the glyphs move by the
  // baseline correction; the decorations must not shift to new absolute spots.
  const underlineOffset = (lineHeightPx / 2 - anchorInLine) + fontSize * 0.36;
  const linethroughOffset = (lineHeightPx / 2 - anchorInLine) - fontSize * 0.08;
  lines.forEach((line, index) => {
    const lineTop = paintBlockTop + index * lineHeightPx;
    if (lineTop > pad + innerDisplayHeight) return;
    const glyphY = lineTop + anchorInLine;
    context.fillText(line, anchorX, glyphY);
    if ((object.underline || object.linethrough) && line) {
      const lineWidthPx = context.measureText(line).width;
      const startX = textAlign === 'center' ? anchorX - lineWidthPx / 2
        : textAlign === 'right' ? anchorX - lineWidthPx
          : anchorX;
      context.save();
      context.strokeStyle = context.fillStyle;
      context.lineWidth = decorationWidth;
      if (typeof context.setLineDash === 'function') context.setLineDash([]);
      if (object.underline) {
        const y = glyphY + underlineOffset;
        context.beginPath();
        context.moveTo(startX, y);
        context.lineTo(startX + lineWidthPx, y);
        context.stroke();
      }
      if (object.linethrough) {
        const y = glyphY + linethroughOffset;
        context.beginPath();
        context.moveTo(startX, y);
        context.lineTo(startX + lineWidthPx, y);
        context.stroke();
      }
      context.restore();
    }
  });
  context.restore();
}

// Counter pins — already the exact twin of renderCounter
// (svgAnnotationRenderers.jsx:1562-1627): Shottr-style single filled path
// (bubble + tangent nubbin) with a centered number, built from `radius`
// (hand-built counter JSON has NO width/height).
function drawCounter(context, object) {
  const radius = Math.max(1, toNumber(object?.radius, 14) * Math.abs(toNumber(object?.scaleX, 1) || 1));
  const centerX = toNumber(object?.left) + radius;
  const centerY = toNumber(object?.top) + radius;
  const color = isVisiblePaint(object?.fill)
    ? object.fill
    : (isVisiblePaint(object?.data?.color) ? object.data.color : '#ef4444');
  const pointerAngleDeg = object?.data?.pointerAngle != null ? toNumber(object.data.pointerAngle, 225) : 225;

  const angleRad = (pointerAngleDeg * Math.PI) / 180;
  const tipExtension = radius * 0.5;
  const tipDistance = radius + tipExtension;
  const tipX = centerX + Math.cos(angleRad) * tipDistance;
  const tipY = centerY + Math.sin(angleRad) * tipDistance;
  const tangentHalfAngle = Math.acos(radius / tipDistance);
  const t1Angle = angleRad + tangentHalfAngle;
  const t2Angle = angleRad - tangentHalfAngle;

  context.save();
  applyBlendAndOpacity(context, object);
  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(centerX + Math.cos(t1Angle) * radius, centerY + Math.sin(t1Angle) * radius);
  // Sweep the bubble the long way around (away from the nubbin) — the canvas
  // clockwise arc from t1 to t2 matches the SVG large-arc/sweep=1 path.
  context.arc(centerX, centerY, radius, t1Angle, t2Angle, false);
  context.closePath();
  context.fillStyle = color;
  context.fill();

  const label = String(object?.data?.displayNumber ?? 1);
  if (label) {
    const { fontSize, maxWidth } = getCounterLabelLayout(radius, label);
    context.font = `700 ${fontSize}px -apple-system, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.fillStyle = isVisiblePaint(object?.data?.numberColor) ? object.data.numberColor : '#ffffff';
    // SVG centers the number with dominant-baseline='central', which Blink
    // resolves to the alphabetic baseline sitting (layoutAscent −
    // layoutDescent)/2 below the anchor. Canvas textBaseline='middle' anchors
    // the em-square midpoint instead — ~0.8px higher for this font stack — so
    // the number nudged whenever eraser mode swapped presentations. Reproduce
    // the SVG math from the measured font metrics (must measure AFTER
    // context.font is set); old runtimes without fontBoundingBox metrics keep
    // the legacy 'middle' anchor.
    const metrics = typeof context.measureText === 'function'
      ? context.measureText(label)
      : null;
    const ascent = metrics?.fontBoundingBoxAscent;
    const descent = metrics?.fontBoundingBoxDescent;
    if (Number.isFinite(ascent) && Number.isFinite(descent)) {
      context.textBaseline = 'alphabetic';
      context.fillText(label, centerX, centerY + (ascent - descent) / 2, maxWidth);
    } else {
      context.textBaseline = 'middle';
      context.fillText(label, centerX, centerY, maxWidth);
    }
  }
  context.restore();
}

// Legacy arrow groups — twin of renderArrow (svgAnnotationRenderers.jsx:618-675).
// SVG drops every other group kind from the unified loop, so the canvas must too.
function drawGroup(context, object) {
  const children = Array.isArray(object?.objects) ? object.objects : [];
  const lineChild = children.find((child) => {
    const type = String(child?.type || '').toLowerCase();
    return type === 'line' || type === 'polyline' || type === 'path';
  });
  if (!lineChild) return;
  const arrowHead = children.find(
    (child) => child && (child.name === 'arrowHead' || String(child.type || '').toLowerCase() === 'triangle'),
  );

  const x1 = toNumber(object.left) + toNumber(lineChild.x1);
  const y1 = toNumber(object.top) + toNumber(lineChild.y1);
  const x2 = toNumber(object.left) + toNumber(lineChild.x2);
  const y2 = toNumber(object.top) + toNumber(lineChild.y2);
  const angleRad = Math.atan2(y2 - y1, x2 - x1);
  const strokeWidth = toNumber(object.strokeWidth, 2) || 2;
  const headSize = Math.max(6, strokeWidth * 3);
  const lineEndX = arrowHead ? x2 - (headSize / 3) * Math.cos(angleRad) : x2;
  const lineEndY = arrowHead ? y2 - (headSize / 3) * Math.sin(angleRad) : y2;
  const stroke = isVisiblePaint(object.stroke) ? object.stroke : '#000';

  context.save();
  applyBlendAndOpacity(context, object);
  if (typeof context.setLineDash === 'function') {
    context.setLineDash(Array.isArray(object.strokeDashArray) && object.strokeDashArray.length > 0
      ? object.strokeDashArray
      : []);
  }
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(lineEndX, lineEndY);
  context.strokeStyle = stroke;
  context.lineWidth = strokeWidth;
  context.lineCap = 'round';
  context.stroke();
  if (arrowHead) {
    if (typeof context.setLineDash === 'function') context.setLineDash([]);
    context.translate(x2, y2);
    context.rotate(angleRad);
    context.beginPath();
    context.moveTo(-headSize / 3, -headSize / 2);
    context.lineTo((headSize * 2) / 3, 0);
    context.lineTo(-headSize / 3, headSize / 2);
    context.closePath();
    context.fillStyle = stroke;
    context.fill();
  }
  context.restore();
}

export function drawAnnotationObject(context, object, displayScale = 1) {
  if (!context || !object) return;
  // Dual-rep callout projections live in the callouts[] pipeline — the SVG
  // dispatch skips them (SVGAnnotationLayer.jsx:1791-1802) and so must we, or
  // they double-paint over drawCallout.
  if (object?.data?.type === 'callout') return;
  if (object?.data?.type === 'counter') {
    drawCounter(context, object);
    return;
  }
  const type = String(object.type || '').toLowerCase();
  if (type === 'path') {
    drawPath(context, object, displayScale);
    return;
  }
  if (type === 'line') {
    drawLine(context, object);
    return;
  }
  if (type === 'polygon') {
    drawPoints(context, object, true);
    return;
  }
  if (type === 'polyline') {
    drawPoints(context, object, false);
    return;
  }
  if (type === 'group') {
    drawGroup(context, object);
    return;
  }
  if (type === 'textbox' || type === 'i-text' || type === 'itext' || type === 'text') {
    drawText(context, object);
    return;
  }

  // Rect / ellipse / circle / triangle — twin of renderRect / renderEllipse:
  // draw at EFFECTIVE (pre-scaled) dims with the RAW strokeWidth so strokes do
  // not scale with the object (SVG never puts these under a scale transform),
  // honor the inset-stroke contract, dash rects (never ellipses), and rebuild
  // cloud rects from live geometry.
  const scaleX = toNumber(object.scaleX, 1) || 1;
  const scaleY = toNumber(object.scaleY, 1) || 1;
  const effectiveWidth = Math.abs(toNumber(object.width)) * Math.abs(scaleX);
  const effectiveHeight = Math.abs(toNumber(object.height)) * Math.abs(scaleY);
  const isHighlight = object.globalCompositeOperation === 'multiply';
  const strokeWidth = Math.max(0, toNumber(object.strokeWidth, 0));

  // UX 2026-09-09: rect AND ellipse/circle clouds paint here (triangle has no
  // Cloud style, and resolveAnnotationCloudSpec is what says so - the painter
  // no longer keeps its own suppression list). The shared resolver sizes an
  // ellipse cloud off the LIVE rx/ry (radius for a circle) exactly as
  // renderEllipse does, so the two layers can never disagree.
  const cloudGeometry = type !== 'triangle' && resolveAnnotationCloudSpec(object)
    ? resolveCloudAnnotationGeometry(object)
    : null;
  if (cloudGeometry) {
    drawCloud(context, object, cloudGeometry);
    return;
  }

  context.save();
  applyBlendAndOpacity(context, object);
  context.translate(toNumber(object.left), toNumber(object.top));
  applyRotation(context, toNumber(object.angle), effectiveWidth / 2, effectiveHeight / 2);

  const isEllipse = type === 'circle' || type === 'ellipse';
  context.beginPath();

  // Inset-stroke contract (renderRect:324-393 / renderEllipse:933-952): drawn
  // shapes tagged drawn-centered-stroke keep a centered stroke; everything
  // else shrinks by sw/2 so the stroke's OUTER edge lands on the stored box.
  const inset = !isHighlight
    && strokeWidth > 0
    && object?.data?.strokeRenderContract !== DRAWN_CENTERED_STROKE_CONTRACT;
  const half = inset ? strokeWidth / 2 : 0;
  if (isEllipse) {
    const rx = object.radius != null
      ? Math.abs(toNumber(object.radius)) * Math.abs(scaleX)
      : Math.abs(toNumber(object.rx)) * Math.abs(scaleX);
    const ry = object.radius != null
      ? Math.abs(toNumber(object.radius)) * Math.abs(scaleY)
      : Math.abs(toNumber(object.ry)) * Math.abs(scaleY);
    context.ellipse(
      rx,
      ry,
      Math.max(0.5, rx - half),
      Math.max(0.5, ry - half),
      0,
      0,
      Math.PI * 2,
    );
  } else if (type === 'triangle') {
    context.moveTo(effectiveWidth / 2, 0);
    context.lineTo(effectiveWidth, effectiveHeight);
    context.lineTo(0, effectiveHeight);
    context.closePath();
  } else {
    context.rect(half, half, Math.max(0, effectiveWidth - 2 * half), Math.max(0, effectiveHeight - 2 * half));
  }
  if (typeof context.setLineDash === 'function' && !isEllipse) {
    // SVG never emits strokeDasharray on ellipses — rects/triangles only.
    if (Array.isArray(object.strokeDashArray) && object.strokeDashArray.length > 0) {
      context.setLineDash(object.strokeDashArray);
    }
  }
  // Survey-marker pseudo-rects mimic SVG vectorEffect non-scaling-stroke.
  const lineWidth = object?.nonScalingStroke
    ? strokeWidth / Math.max(0.01, displayScale)
    : strokeWidth;
  paintCurrentPath(context, {
    fill: object.fill,
    stroke: isVisiblePaint(object.stroke) ? object.stroke : null,
    strokeWidth: lineWidth,
  });
  context.restore();
}

// Twin of renderCallout (svgAnnotationRenderers.jsx:1197-1436).
function drawCallout(context, callout, pageWidth, pageHeight, displayScale = 1) {
  if (!callout || !callout.arrowTip || !callout.knee) return;
  const arrowTip = {
    x: toNumber(callout.arrowTip.x) * pageWidth,
    y: toNumber(callout.arrowTip.y) * pageHeight,
  };
  const knee = {
    x: toNumber(callout.knee.x) * pageWidth,
    y: toNumber(callout.knee.y) * pageHeight,
  };
  const textBox = {
    x: toNumber(callout.textBoxPosition?.x ?? callout.textBox?.x) * pageWidth,
    y: toNumber(callout.textBoxPosition?.y ?? callout.textBox?.y) * pageHeight,
    width: Math.max(18, toNumber(callout.textBoxWidth ?? callout.textBox?.width, 0.1) * pageWidth),
    height: Math.max(18, toNumber(callout.textBoxHeight ?? callout.textBox?.height, 0.05) * pageHeight),
  };
  const lineColor = callout.style?.borderColor || callout.style?.lineColor || DEFAULT_CALLOUT_COLOR;
  const lineThickness = Math.max(1, toNumber(callout.style?.lineThickness, 2));
  const fillColor = callout.style?.fillColor || 'transparent';
  const fillOpacity = Math.max(0.08, Math.min(1, toNumber(callout.style?.fillOpacity, 0.4)));
  const borderOpacity = Math.max(0.2, Math.min(1, toNumber(callout.style?.borderOpacity, 1)));
  const fontSize = Math.max(1, toNumber(callout.style?.fontSize, 12));
  const descenderBuffer = fontSize * 0.35;
  const boxHeightWithDescenders = textBox.height + descenderBuffer;

  // borderWidth 0 — stored box dims ARE the outer border rect (renderCallout:1282).
  const connection = calculateCalloutConnection(
    textBox.x,
    textBox.y,
    textBox.width,
    boxHeightWithDescenders,
    knee,
    arrowTip,
    0,
  );

  const arrowheadStyle = callout.style?.arrowheadStyle ?? ARROWHEAD_STYLES.SOLID_TRIANGLE;
  const arrowAngleDeg = (
    Math.atan2(arrowTip.y - connection.line2Start.y, arrowTip.x - connection.line2Start.x)
    * 180) / Math.PI;
  const arrowheadSpec = buildArrowheadRenderSpec(
    arrowheadStyle, arrowTip.x, arrowTip.y, arrowAngleDeg, lineColor, lineThickness,
  );
  let line2EndX = arrowTip.x;
  let line2EndY = arrowTip.y;
  if (arrowheadStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE
    || arrowheadStyle === ARROWHEAD_STYLES.OPEN_TRIANGLE) {
    const headSize = Math.max(8, lineThickness * 3);
    const angleRad = (arrowAngleDeg * Math.PI) / 180;
    line2EndX = arrowTip.x - (headSize / 3) * Math.cos(angleRad);
    line2EndY = arrowTip.y - (headSize / 3) * Math.sin(angleRad);
  }

  // UX 2026-07-14 (zoom-scaling unification): connector lines + box border
  // are page-unit strokes in SVG now (no vector-effect pin), so the painter
  // uses the raw widths too — thickness scales with zoom on both surfaces.

  // UX (2026-07-17): leader line style twin of renderCallout — style.lineStyle
  // dashes line1/line2 AND the box border; the arrowhead stays solid
  // (paintArrowheadSpec resets the dash itself). Absent lineStyle → solid.
  const leaderDash = calloutLineDashArray(callout.style?.lineStyle) || [];

  context.save();
  // Group opacity (SVG <g opacity={borderOpacity}>) multiplies EVERYTHING.
  context.globalAlpha = borderOpacity;
  context.strokeStyle = lineColor;
  context.lineWidth = lineThickness;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (typeof context.setLineDash === 'function') context.setLineDash(leaderDash);
  context.beginPath();
  if (!connection.shouldHideLine1) {
    context.moveTo(connection.line1Start.x, connection.line1Start.y);
    context.lineTo(connection.effectiveKnee.x, connection.effectiveKnee.y);
  }
  context.moveTo(connection.line2Start.x, connection.line2Start.y);
  context.lineTo(line2EndX, line2EndY);
  context.stroke();
  // Real arrowhead via the shared spec (the old dot was the "arrow looks like
  // a circle" bug). Painted RAW, same as the connector lines and box border —
  // every callout stroke scales with zoom now.
  paintArrowheadSpec(context, arrowheadSpec);

  if (isVisiblePaint(fillColor)) {
    context.save();
    context.globalAlpha = borderOpacity * fillOpacity;
    context.fillStyle = fillColor;
    context.fillRect(textBox.x, textBox.y, textBox.width, boxHeightWithDescenders);
    context.restore();
  }
  context.strokeStyle = lineColor;
  context.lineWidth = Math.max(1, lineThickness * 0.7);
  // The leader lines above set lineJoin 'round'; the SVG box rect is SQUARE
  // (rx=0, default miter joins). Without this reset every corner of the box
  // rounds off by lineWidth/2 the moment the eraser presentation opens.
  context.lineJoin = 'miter';
  // Box border shares the leader's line style (paintArrowheadSpec restored
  // its own dash state, so re-assert before the rect stroke).
  if (typeof context.setLineDash === 'function') context.setLineDash(leaderDash);
  context.strokeRect(textBox.x, textBox.y, textBox.width, boxHeightWithDescenders);
  if (typeof context.setLineDash === 'function') context.setLineDash([]);

  const text = String(callout.text || '');
  if (text) {
    const fontFamily = String(callout.style?.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '');
    // UX (2026-07-17): honor the callout's stored bold/italic flags so the
    // eraser presentation matches the SVG view, which now renders them
    // (buildCalloutTextContentStyle parity fix). Same shorthand order as
    // drawText: style weight size family.
    const calloutFontStyle = callout.style?.italic ? 'italic' : 'normal';
    const calloutFontWeight = callout.style?.bold ? 'bold' : 'normal';
    const fontShorthand = `${calloutFontStyle} ${calloutFontWeight} ${fontSize}px ${fontFamily}`;
    context.font = fontShorthand;
    // SVG callout text renders with text-rendering: geometricPrecision
    // (buildCalloutTextContentStyle) — ~13% less ink than Chromium's default
    // canvas rasterization, so without this the eraser view paints visibly
    // BOLDER callout glyphs. Set before the measure loop so wrap points use
    // the same metrics. Plain text boxes use the default on BOTH surfaces —
    // drawText must NOT get this.
    if ('textRendering' in context) context.textRendering = 'geometricPrecision';
    const maxTextWidth = Math.max(1, textBox.width - 2 * TEXT_PADDING);
    const lines = [];
    text.split(/\r?\n/).forEach((paragraph) => {
      if (!paragraph) {
        lines.push('');
        return;
      }
      lines.push(...wrapByGraphemeBreakAll(context, paragraph, maxTextWidth));
    });
    const lineHeightPx = fontSize * (toNumber(callout.style?.lineHeight, 1) || 1) * 1.13;
    const availableHeight = boxHeightWithDescenders;
    const maxLines = Math.max(1, Math.floor(availableHeight / lineHeightPx));
    const paintedLines = lines.slice(0, maxLines);
    const blockHeight = paintedLines.length * lineHeightPx;
    const startY = textBox.y + Math.max(0, (availableHeight - blockHeight) / 2);
    const textAlign = callout.style?.textAlign || 'left';
    context.textAlign = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'right' : 'left';
    const anchorX = textAlign === 'center' ? textBox.x + textBox.width / 2
      : textAlign === 'right' ? textBox.x + textBox.width - TEXT_PADDING
        : textBox.x + TEXT_PADDING;
    // Same glyph-baseline correction as drawText: canvas 'middle' sits ~0.9px
    // above the CSS first baseline for 12px Arial, so callout text nudged on
    // every eraser-mode toggle. Anchor 'alphabetic' at the CSS baseline; keep
    // the legacy 'middle' anchor when no baseline is resolvable.
    const baselineInLine = cssFirstBaseline(context, fontShorthand, lineHeightPx);
    const anchorInLine = baselineInLine ?? lineHeightPx / 2;
    context.textBaseline = baselineInLine == null ? 'middle' : 'alphabetic';
    context.fillStyle = callout.style?.fontColor || callout.style?.textColor || '#000000';
    // Blink paint-offset snap parity (2026-07-14, probe-verified — see the
    // drawText twin comment): the SVG callout's foreignObject sits at
    // textBox.y with a flex-centered text block, and Chromium paints its
    // glyphs at round(textBox.y + flexTop) + i*lineHeightPx + baselineInLine,
    // NOT at the unrounded layout position. startY = textBox.y + flexTop, so
    // round(startY) is exactly Blink's snap (in-app: layout 263.328 →
    // painted 263.000; unsnapped canvas text sat 1 css px low at 233% zoom —
    // the "callout text jumps when I switch to the eraser" report).
    const paintStartY = baselineInLine == null ? startY : Math.round(startY);
    // UX (2026-07-17): underline/strikethrough decorations — same offsets as
    // drawText (tuned from the old line-box center, re-expressed against the
    // baseline anchor) so the eraser view matches the SVG's text-decoration
    // rendering, which now draws these stored callout flags.
    const calloutUnderline = !!callout.style?.underline;
    const calloutLinethrough = !!callout.style?.strikethrough;
    const decorationWidth = Math.max(1, fontSize / 14);
    const underlineOffset = (lineHeightPx / 2 - anchorInLine) + fontSize * 0.36;
    const linethroughOffset = (lineHeightPx / 2 - anchorInLine) - fontSize * 0.08;
    paintedLines.forEach((line, index) => {
      const glyphY = paintStartY + index * lineHeightPx + anchorInLine;
      context.fillText(line, anchorX, glyphY);
      if ((calloutUnderline || calloutLinethrough) && line) {
        const lineWidthPx = context.measureText(line).width;
        const startX = context.textAlign === 'center' ? anchorX - lineWidthPx / 2
          : context.textAlign === 'right' ? anchorX - lineWidthPx
            : anchorX;
        context.save();
        context.strokeStyle = context.fillStyle;
        context.lineWidth = decorationWidth;
        if (typeof context.setLineDash === 'function') context.setLineDash([]);
        if (calloutUnderline) {
          const y = glyphY + underlineOffset;
          context.beginPath();
          context.moveTo(startX, y);
          context.lineTo(startX + lineWidthPx, y);
          context.stroke();
        }
        if (calloutLinethrough) {
          const y = glyphY + linethroughOffset;
          context.beginPath();
          context.moveTo(startX, y);
          context.lineTo(startX + lineWidthPx, y);
          context.stroke();
        }
        context.restore();
      }
    });
  }
  context.restore();
}

export function paintAnnotationCanvas(context, {
  canvasWidth,
  canvasHeight,
  drawScale,
  // Y scale re-derived from the integer backing height — defaults to the X
  // scale for callers without a rounded backing store (tests, ad-hoc paints).
  drawScaleY = drawScale,
  displayScale,
  pageWidth,
  pageHeight,
  offsetX = 0,
  offsetY = 0,
  objects = [],
  callouts = [],
}) {
  if (!context) return { objectCount: 0, calloutCount: 0 };
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.setTransform(
    drawScale,
    0,
    0,
    drawScaleY,
    -toNumber(offsetX) * drawScale,
    -toNumber(offsetY) * drawScaleY,
  );
  objects.forEach((object) => drawAnnotationObject(context, object, displayScale));
  callouts.forEach((callout) => drawCallout(context, callout, pageWidth, pageHeight, displayScale));
  context.setTransform(1, 0, 0, 1, 0, 0);
  return { objectCount: objects.length, calloutCount: callouts.length };
}
