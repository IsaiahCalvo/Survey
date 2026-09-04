/**
 * Line/arrow render-spec helpers.
 *
 * Pure-JS (no React, no JSX) — Node test runner can import directly.
 * The .jsx renderer (svgAnnotationRenderers.jsx) wraps these specs 1:1
 * via React.createElement, so visual output is locked here.
 *
 * Phase 15 contract:
 *   - LINE-01 / LINE-02: curved path branch + 1px render hysteresis.
 *   - ARROW-01 / ARROW-02: curved-arrow tangent via getCurveEndAngle at t=1.
 *   - ARROW-04: 6-style arrowhead dispatch with fallback + style override.
 *
 * Public API (consumed by tests/svgLineRenderer.test.mjs +
 * tests/renderArrowhead.test.mjs + src/utils/svgAnnotationRenderers.jsx):
 *   export function buildLineRenderSpec(obj): Spec
 *   export function buildArrowheadRenderSpec(style, tipX, tipY, angleDeg, color, sw): ArrowheadSpec
 *   export { ARROWHEAD_STYLES }  // re-exported from the Callout types module
 */

import {
  getCurvedPath,
  getCurveEndAngle,
  distanceToLineSegment,
} from './lineGeometry.js';
import {
  ARROWHEAD_STYLES,
  CALLOUT_LINE_STYLES,
  calloutLineDashArray,
  calloutLineStyleFromDash,
} from '../components/Callout/types.js';

// Re-exported (same pattern as ARROWHEAD_STYLES) so every render surface —
// SVG renderer, canvas painter, pdf-lib export/flatten, edit adapter — pulls
// the callout leader line-style vocabulary from one import site.
export {
  ARROWHEAD_STYLES,
  CALLOUT_LINE_STYLES,
  calloutLineDashArray,
  calloutLineStyleFromDash,
};

/**
 * Map a PDF /LE name onto the app's arrowhead styles, exactly as the spec and
 * Acrobat draw them (owner ruling 2026-09-04: the mark on screen must be what
 * the author drew):
 *   OpenArrow   → V-shape ("two short lines meeting at an acute angle", no base)
 *   ClosedArrow → solid triangle when the line has an interior colour (/IC),
 *                 hollow triangle when it has none
 *   Circle / Butt / Square / Diamond / Slash → themselves.
 * `hasInteriorColor` defaults to true so app-authored lines (which never carry
 * /IC) keep their classic filled head.
 */
export function pdfLineEndingToArrowheadStyle(value, { hasInteriorColor = true } = {}) {
  const ending = String(value || '').replace(/^\//, '');
  if (ending === 'OpenArrow' || ending === 'ROpenArrow') return ARROWHEAD_STYLES.V_SHAPE;
  if (ending === 'ClosedArrow' || ending === 'RClosedArrow') {
    return hasInteriorColor ? ARROWHEAD_STYLES.SOLID_TRIANGLE : ARROWHEAD_STYLES.OPEN_TRIANGLE;
  }
  if (ending === 'Circle') return ARROWHEAD_STYLES.OPEN_CIRCLE;
  if (ending === 'Butt') return ARROWHEAD_STYLES.HORIZONTAL_LINE;
  if (ending === 'Square') return ARROWHEAD_STYLES.SQUARE;
  if (ending === 'Diamond') return ARROWHEAD_STYLES.DIAMOND;
  if (ending === 'Slash') return ARROWHEAD_STYLES.SLASH;
  return ARROWHEAD_STYLES.NONE;
}

/**
 * Resolve absolute endpoint coords from a Fabric.Line toJSON shape.
 * Fabric stores x1/y1/x2/y2 as offsets from the bounding box CENTER, and
 * left/top as the bounding box TOP-LEFT. This matches renderLine's existing
 * coordinate derivation (svgAnnotationRenderers.jsx:145-150) exactly so the
 * straight branch remains byte-identical pre-vs-post Phase 15.
 *
 * @param {object} obj - Fabric.Line toJSON output
 * @returns {{ start: {x:number, y:number}, end: {x:number, y:number} }}
 */
function getAbsoluteEndpoints(obj) {
  const centerX = (obj.left || 0) + (obj.width || 0) / 2;
  const centerY = (obj.top || 0) + (obj.height || 0) / 2;
  return {
    start: { x: centerX + (obj.x1 || 0), y: centerY + (obj.y1 || 0) },
    end: { x: centerX + (obj.x2 || 0), y: centerY + (obj.y2 || 0) },
  };
}

/**
 * Build an arrowhead render spec for one of 6 styles.
 *
 * Geometry locked per 15-UI-SPEC §"Section C.1-C.6". Head-size formula
 * max(8, sw*3) per UI-SPEC §"Section D" — preserves pre-Phase-15 arrow visuals
 * (legacy PAL createArrowhead used max(12, sw*3); we intentionally DO NOT
 * inherit that 12-floor — Phase 15 standardizes on the 8-floor used at
 * svgAnnotationRenderers.jsx:163 pre-Phase-15).
 *
 * Stroke-width floor of 2 on the 5 non-SOLID_TRIANGLE styles ensures visibility
 * on 1px base lines (lifted from legacy PAL createArrowhead). SOLID_TRIANGLE
 * is a filled polygon so it needs no stroke floor.
 *
 * @param {string} style - One of ARROWHEAD_STYLES values (or null/NONE)
 * @param {number} tipX - Absolute X of the arrowhead tip (line endpoint 2)
 * @param {number} tipY - Absolute Y of the arrowhead tip
 * @param {number} angleDeg - Rotation angle in degrees (tangent at t=1 for curved)
 * @param {string} color - Stroke/fill color
 * @param {number} sw - Base line strokeWidth
 * @returns {object} - Spec with `.kind` ∈ {none, solidTriangle, openTriangle,
 *                     openCircle, vShape, horizontalLine, diamond, slash} + primitive attrs
 */
export function buildArrowheadRenderSpec(style, tipX, tipY, angleDeg, color, sw, options = {}) {
  if (style === ARROWHEAD_STYLES.NONE || style == null) {
    return { kind: 'none' };
  }
  // Interior colour (PDF /IC, ruled 2026-09-04): Circle, Diamond and Square
  // endings are FILLED with it when the file carries one, hollow otherwise.
  const interiorFill = typeof options?.fill === 'string' && options.fill && options.fill !== 'transparent'
    ? options.fill : 'none';
  // UX: Head-size formula floors at 8 (not 12) to preserve pre-Phase-15 arrow
  // visuals per UI-SPEC §D. Stroke-width floor of 2 on the 5 non-SOLID_TRIANGLE
  // styles ensures visibility on 1px lines (lifted from legacy PAL createArrowhead).
  const headSize = Math.max(8, sw * 3);
  const strokeWidth = Math.max(2, sw);
  const angleRad = (angleDeg * Math.PI) / 180;
  const transform = `translate(${tipX},${tipY}) rotate(${angleDeg})`;

  // Shared imperative args embedded on every spec — useful for tests that want
  // to re-derive geometry without duplicating the inputs.
  const shared = { tipX, tipY, angleDeg, color, sw };

  switch (style) {
    case ARROWHEAD_STYLES.SOLID_TRIANGLE:
      return {
        kind: 'solidTriangle',
        ...shared,
        polygon: {
          points: `${-headSize / 3},${-headSize / 2} ${headSize * 2 / 3},0 ${-headSize / 3},${headSize / 2}`,
          fill: color,
          transform,
        },
      };
    case ARROWHEAD_STYLES.OPEN_TRIANGLE:
      return {
        kind: 'openTriangle',
        ...shared,
        polygon: {
          points: `${-headSize / 3},${-headSize / 2} ${headSize * 2 / 3},0 ${-headSize / 3},${headSize / 2}`,
          fill: 'none',
          stroke: color,
          strokeWidth,
          strokeLinejoin: 'round',
          transform,
        },
      };
    case ARROWHEAD_STYLES.OPEN_CIRCLE:
      return {
        kind: 'openCircle',
        ...shared,
        circle: {
          cx: tipX,
          cy: tipY,
          r: headSize / 2,
          fill: interiorFill,
          stroke: color,
          strokeWidth,
        },
      };
    case ARROWHEAD_STYLES.V_SHAPE: {
      // UX: V-shape has 30° half-spread off the line axis — reads as a lighter,
      // sharper arrowhead. Lifted from legacy PAL createArrowhead V_SHAPE branch.
      const armLength = headSize;
      const armSpread = Math.PI / 6; // 30°
      const arm1X = tipX - armLength * Math.cos(angleRad - armSpread);
      const arm1Y = tipY - armLength * Math.sin(angleRad - armSpread);
      const arm2X = tipX - armLength * Math.cos(angleRad + armSpread);
      const arm2Y = tipY - armLength * Math.sin(angleRad + armSpread);
      return {
        kind: 'vShape',
        ...shared,
        polyline: {
          points: `${arm1X},${arm1Y} ${tipX},${tipY} ${arm2X},${arm2Y}`,
          fill: 'none',
          stroke: color,
          strokeWidth,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
      };
    }
    case ARROWHEAD_STYLES.HORIZONTAL_LINE: {
      // UX: Perpendicular tick at the tip — reads as a "stop" or
      // "measurement end" marker. Half-length = headSize/2 on each side of the
      // tip along the +90° perpendicular direction.
      const halfL = headSize / 2;
      const perp = angleRad + Math.PI / 2;
      return {
        kind: 'horizontalLine',
        ...shared,
        line: {
          x1: tipX + halfL * Math.cos(perp),
          y1: tipY + halfL * Math.sin(perp),
          x2: tipX - halfL * Math.cos(perp),
          y2: tipY - halfL * Math.sin(perp),
          stroke: color,
          strokeWidth,
          strokeLinecap: 'round',
        },
      };
    }
    case ARROWHEAD_STYLES.DIAMOND: {
      // PDF /LE Diamond: a rhombus centred on the endpoint, oriented along the
      // line, spanning headSize tip-to-tip (same footprint as the open circle).
      // Drawn hollow in the stroke colour; the shaft stops at its near vertex.
      const half = headSize / 2;
      return {
        kind: 'diamond',
        ...shared,
        polygon: {
          points: `${half},0 0,${half} ${-half},0 0,${-half}`,
          fill: interiorFill,
          stroke: color,
          strokeWidth,
          strokeLinejoin: 'round',
          transform,
        },
      };
    }
    case ARROWHEAD_STYLES.SQUARE: {
      // PDF /LE Square: a square centred on the endpoint, sides along and
      // across the line, headSize wide; filled with the interior colour if any.
      const half = headSize / 2;
      return {
        kind: 'square',
        ...shared,
        polygon: {
          points: `${-half},${-half} ${half},${-half} ${half},${half} ${-half},${half}`,
          fill: interiorFill,
          stroke: color,
          strokeWidth,
          strokeLinejoin: 'round',
          transform,
        },
      };
    }
    case ARROWHEAD_STYLES.SLASH: {
      // PDF /LE Slash: a short stroke crossing the endpoint, 30° clockwise
      // from the perpendicular (PDF 32000 §12.5.6.7), headSize long.
      const halfL = headSize / 2;
      const dir = angleRad + Math.PI / 2 + Math.PI / 6;
      return {
        kind: 'slash',
        ...shared,
        line: {
          x1: tipX + halfL * Math.cos(dir),
          y1: tipY + halfL * Math.sin(dir),
          x2: tipX - halfL * Math.cos(dir),
          y2: tipY - halfL * Math.sin(dir),
          stroke: color,
          strokeWidth,
          strokeLinecap: 'round',
        },
      };
    }
    default:
      return { kind: 'none' };
  }
}

/**
 * Build a full line/arrow render spec from a Fabric.Line toJSON shape.
 *
 * Branches:
 *   - 'straight': obj.data.midpoint absent OR midpoint distance ≤ 1px from
 *     the straight baseline (render hysteresis — prevents visible "1-pixel
 *     curve" artifacts from floating-point noise in the midpoint handle).
 *   - 'curved': obj.data.midpoint present AND distance > 1px from baseline.
 *     Emits <path d="M sx,sy Q cx,cy ex,ey"> per getCurvedPath.
 *
 * Arrowhead style resolution priority:
 *   1. obj.data.arrowheadStyle (explicit override, including 'none')
 *   2. Fallback: tool === 'arrow' ? SOLID_TRIANGLE : NONE
 *
 * Straight-branch output is byte-identical to the pre-Phase-15 renderLine
 * (svgAnnotationRenderers.jsx:141-199) when no data.midpoint is set.
 *
 * @param {object} obj - Fabric.Line toJSON output with optional
 *   `data: { midpoint, arrowheadStyle }` (Fabric CUSTOM_PROPS-persisted).
 * @returns {object} - Spec with `.kind` ∈ {straight, curved}, `.line` or
 *   `.path`, and `.arrowhead` (always present, may be { kind: 'none' }).
 */
/**
 * Single source of truth for which ending sits on each end of a line (screen,
 * print and export all call this). Precedence per end:
 *   1. an explicit app choice — data.arrowheadStyle (end) /
 *      data.startArrowheadStyle (start): the user picked it, so it wins even on
 *      an imported line (that is how the "both ends" toggle and the picker edit
 *      one end of an imported line without touching the other);
 *   2. the file's own /LE names in data.pdfLineEndings (imported lines);
 *   3. legacy lineEnding1/lineEnding2 fields;
 *   4. the arrow tool's default solid triangle at the end, nothing at the start.
 */
export function resolveLineEndingStyles(obj) {
  const pdfLineEndings = Array.isArray(obj?.data?.pdfLineEndings) ? obj.data.pdfLineEndings : null;
  const isArrow = obj?.tool === 'arrow' || obj?.data?.type === 'arrow' || obj?.data?.annotationType === 'arrow';
  const explicitEnd = obj?.data?.arrowheadStyle;
  const explicitStart = obj?.data?.startArrowheadStyle;
  // Imported lines: a ClosedArrow is filled only when the file gives an
  // interior colour (/IC → data.pdfInteriorColor). App-drawn lines never
  // carry /IC and keep the classic filled head.
  const isImported = Boolean(obj?.isPdfImported || obj?.pdfAnnotationId);
  const leOptions = { hasInteriorColor: isImported ? Boolean(obj?.data?.pdfInteriorColor) : true };
  const endStyle = explicitEnd
    ?? (pdfLineEndings ? pdfLineEndingToArrowheadStyle(pdfLineEndings[1], leOptions) : null)
    ?? (obj?.lineEnding2 ? pdfLineEndingToArrowheadStyle(obj.lineEnding2, leOptions) : null)
    ?? (isArrow ? ARROWHEAD_STYLES.SOLID_TRIANGLE : ARROWHEAD_STYLES.NONE);
  const startStyle = explicitStart
    ?? (pdfLineEndings ? pdfLineEndingToArrowheadStyle(pdfLineEndings[0], leOptions) : null)
    ?? (obj?.lineEnding1 ? pdfLineEndingToArrowheadStyle(obj.lineEnding1, leOptions) : null)
    ?? ARROWHEAD_STYLES.NONE;
  // Interior colour for Circle / Diamond / Square endings (imported /IC).
  const interiorColor = typeof obj?.data?.pdfInteriorColor === 'string' ? obj.data.pdfInteriorColor : null;
  return { startStyle, endStyle, interiorColor };
}

// ---- Geometry shared by the screen renderer and the print flattener --------
// Both must agree exactly on where the shaft stops, on straight, bent and
// multi-segment lines, or the printed sheet will not match the screen.

const quadControlPoint = (start, end, midpoint) => ({
  x: 2 * midpoint.x - 0.5 * start.x - 0.5 * end.x,
  y: 2 * midpoint.y - 0.5 * start.y - 0.5 * end.y,
});
const quadPointAt = (p0, c, p2, t) => {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
  };
};
// Parameter at which the arc length measured from t=0 reaches `distance`
// (numeric march; 256 samples is well under 0.05px on any on-page curve).
const quadParamAtArcLength = (p0, c, p2, distance) => {
  if (!(distance > 0)) return 0;
  const steps = 256;
  let prev = p0;
  let travelled = 0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const pt = quadPointAt(p0, c, p2, t);
    const seg = Math.hypot(pt.x - prev.x, pt.y - prev.y);
    if (travelled + seg >= distance) {
      const frac = seg > 0 ? (distance - travelled) / seg : 0;
      return (i - 1 + frac) / steps;
    }
    travelled += seg;
    prev = pt;
  }
  return 1;
};

/**
 * Body of a bent (quadratic) line with each end pulled back along the curve by
 * an inset so it stops at the edge of a hollow ending. Returns the sub-curve
 * path plus the OUTWARD tangent angle at each true endpoint (start angle
 * already reversed for a start arrowhead).
 */
export function buildCurvedLineBody(start, end, midpoint, startInset = 0, endInset = 0) {
  const c = quadControlPoint(start, end, midpoint);
  let t0 = quadParamAtArcLength(start, c, end, startInset);
  let t1 = 1 - quadParamAtArcLength(end, c, start, endInset);
  if (t0 > t1) { const mid = (t0 + t1) / 2; t0 = mid; t1 = mid; }
  // de Casteljau blossom: control point of the sub-curve [t0, t1].
  const subC = {
    x: (1 - t0) * (1 - t1) * start.x + ((1 - t0) * t1 + t0 * (1 - t1)) * c.x + t0 * t1 * end.x,
    y: (1 - t0) * (1 - t1) * start.y + ((1 - t0) * t1 + t0 * (1 - t1)) * c.y + t0 * t1 * end.y,
  };
  const p0 = quadPointAt(start, c, end, t0);
  const p2 = quadPointAt(start, c, end, t1);
  return {
    d: `M ${p0.x},${p0.y} Q ${subC.x},${subC.y} ${p2.x},${p2.y}`,
    bodyStart: p0,
    bodyEnd: p2,
    startAngleDeg: (Math.atan2(start.y - c.y, start.x - c.x) * 180) / Math.PI,
    endAngleDeg: (Math.atan2(end.y - c.y, end.x - c.x) * 180) / Math.PI,
  };
}

/**
 * Open polyline body with its first / last point pulled back along the first /
 * last segment by an inset (never past that segment's other end).
 */
export function insetOpenPolylinePoints(points, startInset = 0, endInset = 0) {
  if (!Array.isArray(points) || points.length < 2) return Array.isArray(points) ? points.slice() : [];
  const out = points.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
  const pull = (from, towards, inset) => {
    const dx = towards.x - from.x;
    const dy = towards.y - from.y;
    const len = Math.hypot(dx, dy);
    if (!(inset > 0) || len === 0) return from;
    const k = Math.min(inset, len) / len;
    return { x: from.x + dx * k, y: from.y + dy * k };
  };
  out[0] = pull(out[0], out[1], startInset);
  out[out.length - 1] = pull(out[out.length - 1], out[out.length - 2], endInset);
  return out;
}

/**
 * How far the line body stops short of the tip so it does not run into a
 * hollow ending (owner, 2026-09-02: "the circle should read as a clean ring on
 * the end of the line, not a circle with a line stabbed through it"). Solid
 * heads hide the shaft, so they keep the classic headSize/3 tuck; the open
 * triangle stops at its base plus the round cap; the open circle stops at its
 * near edge plus the round cap. V and bar endings meet the shaft at the tip by
 * design (an open "->" or a "-|" terminator).
 */
export function lineEndingBodyInset(style, sw) {
  const width = Number(sw) || 2;
  const headSize = Math.max(8, width * 3);
  if (style === ARROWHEAD_STYLES.SOLID_TRIANGLE) return headSize / 3;
  if (style === ARROWHEAD_STYLES.OPEN_TRIANGLE) return headSize / 3 + width / 2;
  if (style === ARROWHEAD_STYLES.OPEN_CIRCLE) return headSize / 2 + width / 2;
  if (style === ARROWHEAD_STYLES.DIAMOND) return headSize / 2 + width / 2;
  if (style === ARROWHEAD_STYLES.SQUARE) return headSize / 2 + width / 2;
  return 0;
}

export function buildLineRenderSpec(obj) {
  const { start, end } = getAbsoluteEndpoints(obj);
  const { x: x1, y: y1 } = start;
  const { x: x2, y: y2 } = end;
  const strokeColor = obj.stroke || '#000';
  const sw = obj.strokeWidth || 2;
  const { startStyle, endStyle: effectiveStyle, interiorColor } = resolveLineEndingStyles(obj);
  const headOptions = { fill: interiorColor };

  const midpoint = obj.data?.midpoint;
  const isCurved = !!midpoint
    && distanceToLineSegment(midpoint, start, end) > 1;

  if (isCurved) {
    // UX: each arrowhead sits on the tangent of the curve at ITS OWN end (the
    // start head is not the end head rotated 180° — on a bent arrow those
    // differ), and the body is trimmed along the curve so it stops at the
    // edge of hollow endings exactly like the straight branch (owner,
    // 2026-09-04: "bend an arrow with an open circle and the line cuts into
    // the circle again").
    const body = buildCurvedLineBody(
      start, end, midpoint,
      lineEndingBodyInset(startStyle, sw), lineEndingBodyInset(effectiveStyle, sw),
    );
    const angleDeg = body.endAngleDeg;
    return {
      kind: 'curved',
      path: {
        d: body.d,
        stroke: strokeColor,
        strokeWidth: sw,
        strokeLinecap: 'round',
        // CRITICAL (Pitfall 5): <path> must have fill='none' or the quadratic
        // bezier fills solid black between the curve and the start-to-end
        // chord. Always emit this explicitly.
        fill: 'none',
      },
      arrowhead: buildArrowheadRenderSpec(
        effectiveStyle, x2, y2, angleDeg, strokeColor, sw, headOptions
      ),
      startArrowhead: buildArrowheadRenderSpec(
        startStyle, x1, y1, body.startAngleDeg, strokeColor, sw, headOptions
      ),
    };
  }

  // Straight branch — byte-identical to pre-Phase-15 renderLine when no
  // data.midpoint is set. Line-shortening when the arrowhead is a filled
  // triangle (polygon) prevents the line tail poking through the arrowhead —
  // see svgAnnotationRenderers.jsx:165-167 pre-Phase-15.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = angleRad * (180 / Math.PI);

  const startInset = lineEndingBodyInset(startStyle, sw);
  const endInset = lineEndingBodyInset(effectiveStyle, sw);
  const lineStartX = x1 + startInset * Math.cos(angleRad);
  const lineStartY = y1 + startInset * Math.sin(angleRad);
  const lineEndX = x2 - endInset * Math.cos(angleRad);
  const lineEndY = y2 - endInset * Math.sin(angleRad);

  return {
    kind: 'straight',
    line: {
      x1: lineStartX,
      y1: lineStartY,
      x2: lineEndX,
      y2: lineEndY,
      stroke: strokeColor,
      strokeWidth: sw,
      strokeLinecap: 'round',
    },
    arrowhead: buildArrowheadRenderSpec(
      effectiveStyle, x2, y2, angleDeg, strokeColor, sw, headOptions
    ),
    startArrowhead: buildArrowheadRenderSpec(
      startStyle, x1, y1, angleDeg + 180, strokeColor, sw, headOptions
    ),
  };
}
