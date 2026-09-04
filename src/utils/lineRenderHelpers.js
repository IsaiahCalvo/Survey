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

export function pdfLineEndingToArrowheadStyle(value) {
  const ending = String(value || '').replace(/^\//, '');
  if (ending === 'OpenArrow' || ending === 'ROpenArrow') return ARROWHEAD_STYLES.OPEN_TRIANGLE;
  if (ending === 'ClosedArrow' || ending === 'RClosedArrow') return ARROWHEAD_STYLES.SOLID_TRIANGLE;
  if (ending === 'Circle') return ARROWHEAD_STYLES.OPEN_CIRCLE;
  if (ending === 'Butt' || ending === 'Square') return ARROWHEAD_STYLES.HORIZONTAL_LINE;
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
export function buildArrowheadRenderSpec(style, tipX, tipY, angleDeg, color, sw) {
  if (style === ARROWHEAD_STYLES.NONE || style == null) {
    return { kind: 'none' };
  }
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
          fill: 'none',
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
          fill: 'none',
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
  const endStyle = explicitEnd
    ?? (pdfLineEndings ? pdfLineEndingToArrowheadStyle(pdfLineEndings[1]) : null)
    ?? (obj?.lineEnding2 ? pdfLineEndingToArrowheadStyle(obj.lineEnding2) : null)
    ?? (isArrow ? ARROWHEAD_STYLES.SOLID_TRIANGLE : ARROWHEAD_STYLES.NONE);
  const startStyle = explicitStart
    ?? (pdfLineEndings ? pdfLineEndingToArrowheadStyle(pdfLineEndings[0]) : null)
    ?? (obj?.lineEnding1 ? pdfLineEndingToArrowheadStyle(obj.lineEnding1) : null)
    ?? ARROWHEAD_STYLES.NONE;
  return { startStyle, endStyle };
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
  return 0;
}

export function buildLineRenderSpec(obj) {
  const { start, end } = getAbsoluteEndpoints(obj);
  const { x: x1, y: y1 } = start;
  const { x: x2, y: y2 } = end;
  const strokeColor = obj.stroke || '#000';
  const sw = obj.strokeWidth || 2;
  const { startStyle, endStyle: effectiveStyle } = resolveLineEndingStyles(obj);

  const midpoint = obj.data?.midpoint;
  const isCurved = !!midpoint
    && distanceToLineSegment(midpoint, start, end) > 1;

  if (isCurved) {
    // UX: Curved arrow arrowhead rotates to the curve's tangent at t=1
    // (ARROW-01/02) — use getCurveEndAngle, NOT Math.atan2(dy, dx).
    const angleDeg = getCurveEndAngle(start, end, midpoint);
    return {
      kind: 'curved',
      path: {
        d: getCurvedPath(start, end, midpoint),
        stroke: strokeColor,
        strokeWidth: sw,
        strokeLinecap: 'round',
        // CRITICAL (Pitfall 5): <path> must have fill='none' or the quadratic
        // bezier fills solid black between the curve and the start-to-end
        // chord. Always emit this explicitly.
        fill: 'none',
      },
      arrowhead: buildArrowheadRenderSpec(
        effectiveStyle, x2, y2, angleDeg, strokeColor, sw
      ),
      startArrowhead: buildArrowheadRenderSpec(
        startStyle, x1, y1, angleDeg + 180, strokeColor, sw
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
      effectiveStyle, x2, y2, angleDeg, strokeColor, sw
    ),
    startArrowhead: buildArrowheadRenderSpec(
      startStyle, x1, y1, angleDeg + 180, strokeColor, sw
    ),
  };
}
