/**
 * SVG Annotation Renderers
 *
 * Pure render functions that convert Fabric.js JSON annotation objects
 * into React SVG elements. Used by SVGAnnotationLayer for display-only
 * rendering with viewBox-based auto-scaling.
 *
 * Each function takes a Fabric.js JSON object and returns a React SVG element.
 */
import React from 'react';
import { measureTextBounds, getLineEndpoints } from './svgBoundingBox';
// Phase 14 CALL-10: renderCallout delegates to a pure data-spec builder in
// calloutEditAdapter.js so the contract can be unit-tested without loading
// .jsx from Node --test. sanitizeFontFamily strips CSS fallback stacks at
// the render surface (CLAUDE.md 2026-04-08 gotcha) — kept imported here for
// any future direct use at this layer.
import { buildCalloutRenderSpec, sanitizeFontFamily } from './calloutEditAdapter';
// Phase 15 LINE-01/02/ARROW-01/02/04: pure-JS spec builders for line/arrow
// rendering. Same .jsx-vs-Node-test strategy as calloutEditAdapter — tests
// import the spec shape from a .js module; this .jsx wraps the spec 1:1 via
// React.createElement so the SVG output is locked by the unit tests.
import {
  buildLineRenderSpec,
  buildArrowheadRenderSpec,
  ARROWHEAD_STYLES,
} from './lineRenderHelpers.js';
// Fill-bleed diagnostics (2026-04-16). Off by default; the wrapper calls are
// cheap no-ops when disabled. Toggle in DevTools console:
//   __shapeSpyOn()  __shapeSpyOff()  __captureAllShapes()
// Cmd/Ctrl+Shift+click on a shape (with spy on) captures it to disk.
// See src/utils/shapeBleedDiagnostics.js for details.
import {
  logShapeRender as __logShapeRender,
  captureShape as __captureShape,
} from './shapeBleedDiagnostics';

const __shapeClick = (e) => __captureShape(e.currentTarget, e);

// UX (Plan 15-04 Issue 4, 2026-04-17): text gutter inside the textbox / callout
// border. Chosen value 6 — breathier than the pre-fix 0 (text hugged border,
// descenders cut through bottom edge) without becoming a visually large margin.
// PDF imports are exempt (obj.isPdfImported) so authored PDFs render
// edge-to-edge as intended. Kept as module-level constant so FabricEditCanvas
// imports it and the edit-side Fabric wrap width stays in lockstep with the
// renderer's CSS wrap width.
export const TEXT_PADDING = 6;

/**
 * UX fix (2026-04-16): "fill bleeds past border" on Square/Circle/Polygon
 * annotations.
 *
 * SVG strokes are centered on the shape edge by default — half paints inside
 * the shape, half paints outside. The outside half is a strokeWidth/2-wide
 * ring that extends past the shape's geometric edge. When the border color
 * has the same tone as the fill (e.g. PDF /C and /IC both set with /CA
 * opacity baked in, so both colors are rgba(..., 0.3)), that outer ring is
 * visually indistinguishable from the fill — the user perceives the fill as
 * "bleeding" past where the border sits.
 *
 * Fix: clip the shape to its own geometric outline. The clip path mirrors the
 * shape exactly (same coords + transform). The fill is unaffected (fill is
 * already inside the shape). The inner half of the stroke is kept. The outer
 * half of the stroke is removed by the clip.
 *
 * Side effect: visible stroke width is effectively halved (inner half only).
 * Acceptable trade — the user's original complaint was the bleed, not the
 * thickness. If thickness becomes a problem we can compensate by doubling
 * strokeWidth before rendering.
 *
 * Only called when strokeWidth > 0 — no point clipping a shape without a
 * border, and skipping the clip keeps the DOM smaller for the common case.
 */
const shouldInsetStroke = (obj) => Number(obj?.strokeWidth) > 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safe numeric coercion with fallback.
 * @param {*} value - Value to coerce
 * @param {number} fallback - Fallback if not finite
 * @returns {number}
 */
export const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

/**
 * Detect erased outline paths. After boolean eraser subtraction, the path is
 * converted from stroke to fill (strokeWidth: 0, fill: originalColor).
 * @param {object} obj - Fabric.js JSON object
 * @returns {boolean}
 */
export const isErasedOutline = (obj) =>
  obj.strokeWidth === 0 && obj.fill && obj.fill !== 'transparent';

// ---------------------------------------------------------------------------
// Render Functions
// ---------------------------------------------------------------------------

/**
 * Render a Fabric.js path object (pen strokes, highlighter strokes, erased paths)
 * as an SVG <path> element.
 *
 * CRITICAL: Includes pathOffset handling to prevent 50-200px positioning errors.
 * Transform chain: translate(left, top) rotate(angle) scale(scaleX, scaleY) translate(-pathOffset.x, -pathOffset.y)
 *
 * @param {object} obj - Fabric.js path JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement|null}
 */
export const renderPath = (obj, index) => {
  if (!Array.isArray(obj.path) || obj.path.length === 0) return null;

  const d = obj.path.map((seg) => seg.join(' ')).join(' ');

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const angle = obj.angle ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;

  // Build transform: position -> rotate -> scale -> pathOffset
  let transform = `translate(${left}, ${top})`;
  if (angle !== 0) transform += ` rotate(${angle})`;
  if (scaleX !== 1 || scaleY !== 1) transform += ` scale(${scaleX}, ${scaleY})`;
  transform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;

  const isHighlight = obj.globalCompositeOperation === 'multiply';
  const erased = isErasedOutline(obj);

  const key = `path-${obj.id || obj.highlightId || obj.pdfAnnotationId || index}`;

  return (
    <path
      key={key}
      d={d}
      transform={transform}
      stroke={erased ? 'none' : (obj.stroke || '#000')}
      strokeWidth={erased ? 0 : (obj.strokeWidth || 1)}
      fill={erased ? obj.fill : 'none'}
      fillRule={erased ? 'evenodd' : undefined}
      opacity={obj.opacity ?? 1}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect={obj.strokeUniform ? 'non-scaling-stroke' : undefined}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
};

/**
 * Render a Fabric.js rect object as an SVG <rect> element.
 * Handles highlights (mix-blend-mode: multiply) and shape borders.
 *
 * @param {object} obj - Fabric.js rect JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderRect = (obj, index) => {
  const effectiveWidth = Math.abs((obj.width || 0) * (obj.scaleX || 1));
  const effectiveHeight = Math.abs((obj.height || 0) * (obj.scaleY || 1));
  const isHighlight = obj.globalCompositeOperation === 'multiply';

  const key = `rect-${obj.id || obj.highlightId || index}`;
  const shapeId = obj.id || obj.pdfAnnotationId || obj.highlightId || key;
  __logShapeRender(obj, 'rect');

  const rotateTransform = obj.angle
    ? `rotate(${obj.angle}, ${obj.left + effectiveWidth / 2}, ${obj.top + effectiveHeight / 2})`
    : undefined;
  const inset = !isHighlight && shouldInsetStroke(obj);
  const clipId = inset ? `clip-${shapeId}` : undefined;

  const rectEl = (
    <rect
      x={obj.left}
      y={obj.top}
      width={effectiveWidth}
      height={effectiveHeight}
      transform={rotateTransform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 0}
      opacity={obj.opacity ?? 1}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      data-shape-id={shapeId}
      data-shape-kind="rect"
      onClick={__shapeClick}
    />
  );

  if (!inset) return React.cloneElement(rectEl, { key });

  // UX 2026-04-20: draw the inset-stroke rect as a shrunken path with a
  // centered stroke so the outer edge of the stroke lands exactly at the
  // original (left, top, effectiveWidth, effectiveHeight) box. The prior
  // approach clipped a full-size rect against a matching clipPath, which
  // worked at 0° but shaved miter joins at the corners once rotated
  // (clipPath + transform composition trimmed the 0.41·sw overhang at each
  // 90° corner). Shrinking the path by sw/2 per side keeps the mitered
  // corners inside the visible area, so the full corner paints at every
  // angle AND the border still sits flush with the shape's edge.
  const sw = Math.max(0, Number(obj.strokeWidth) || 0);
  const shrunkL = (obj.left ?? 0) + sw / 2;
  const shrunkT = (obj.top ?? 0) + sw / 2;
  const shrunkW = Math.max(0, effectiveWidth - sw);
  const shrunkH = Math.max(0, effectiveHeight - sw);
  return (
    <rect
      key={key}
      x={shrunkL}
      y={shrunkT}
      width={shrunkW}
      height={shrunkH}
      transform={rotateTransform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={sw}
      opacity={obj.opacity ?? 1}
      data-shape-id={shapeId}
      data-shape-kind="rect"
      onClick={__shapeClick}
    />
  );
};

/**
 * Dispatch a pre-built arrowhead spec to its SVG primitive.
 *
 * Module-scoped (not exported). Used by both renderArrowhead (external,
 * spec-builder wrapper) and renderLine (internal, spec already built via
 * buildLineRenderSpec). Single source of truth for kind → React element
 * mapping — adding a new arrowhead style means adding one case here + one
 * branch in buildArrowheadRenderSpec.
 *
 * @param {object} spec - buildArrowheadRenderSpec output (has `.kind` + one
 *   of `.polygon`/`.polyline`/`.circle`/`.line`)
 * @returns {React.ReactElement|null}
 */
const renderArrowheadFromSpec = (spec) => {
  switch (spec.kind) {
    case 'none': return null;
    case 'solidTriangle': return <polygon {...spec.polygon} />;
    case 'openTriangle': return <polygon {...spec.polygon} />;
    case 'openCircle': return <circle {...spec.circle} />;
    case 'vShape': return <polyline {...spec.polyline} />;
    case 'horizontalLine': return <line {...spec.line} />;
    default: return null;
  }
};

/**
 * Render one of 6 arrowhead styles (ARROW-04) as a standalone SVG element.
 *
 * UX: Head-size uses max(8, sw*3) to preserve pre-Phase-15 arrow visuals per
 * 15-UI-SPEC §D. Stroke-width floor of 2 on non-SOLID_TRIANGLE styles ensures
 * visibility on 1px base lines.
 *
 * Exported for external callers (e.g. future mini-toolbar style-picker
 * previews, selection overlays) that don't already hold a buildLineRenderSpec
 * result. The internal renderLine path uses renderArrowheadFromSpec directly
 * because buildLineRenderSpec has already produced the arrowhead spec — this
 * avoids double-building the spec and keeps kind→element mapping DRY.
 *
 * @param {string} style - ARROWHEAD_STYLES value
 * @param {number} tipX - Absolute X of the arrowhead tip
 * @param {number} tipY - Absolute Y of the arrowhead tip
 * @param {number} angleDeg - Rotation angle in degrees
 * @param {string} color - Stroke/fill color
 * @param {number} sw - Base line strokeWidth
 * @returns {React.ReactElement|null}
 */
export const renderArrowhead = (style, tipX, tipY, angleDeg, color, sw) => {
  const spec = buildArrowheadRenderSpec(style, tipX, tipY, angleDeg, color, sw);
  return renderArrowheadFromSpec(spec);
};

/**
 * Render a Fabric.js line/arrow as SVG primitives.
 *
 * Branches:
 *   - Straight (<line>): when obj.data.midpoint is absent or within 1px of
 *     the straight baseline (render hysteresis per 15-UI-SPEC §B).
 *   - Curved (<path d="M sx,sy Q cx,cy ex,ey">): when obj.data.midpoint is
 *     set AND distance > 1px from baseline.
 *
 * Arrowhead dispatched via renderArrowheadFromSpec (unified for all 6 styles
 * across straight and curved branches — ARROW-04). Curved-arrow arrowhead
 * rotates to the curve tangent at t=1 via getCurveEndAngle (ARROW-01/02),
 * NOT Math.atan2(dy, dx).
 *
 * Preserves pre-Phase-15 byte-identical rendering when obj.data.midpoint is
 * absent: the straight branch emits the same line.x1/y1/x2=lineEndX/y2=lineEndY
 * coords and the same <polygon> at the same <transform> as the pre-Phase-15
 * implementation (svgLineRenderer.test.mjs #1 + #2 lock this).
 *
 * @param {object} obj - Fabric.js Line toJSON (tool: 'line' | 'arrow',
 *   optional data: { midpoint, arrowheadStyle })
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderLine = (obj, index) => {
  const spec = buildLineRenderSpec(obj);
  const isArrow = obj.tool === 'arrow';
  const key = `${isArrow ? 'arrow' : 'line'}-${obj.id || index}`;
  const opacity = obj.opacity ?? 1;

  // UX 2026-04-20: apply obj.angle as a rotation wrapper around the line's
  // geometric midpoint. Deriving the center from the actual rendered
  // endpoints (via the spec the renderer is about to draw) handles both
  // storage conventions — Fabric-constructed lines with left/top/width/
  // height + offset-from-center x1..y2, AND PDF-imported lines with left/
  // top/width/height undefined and absolute x1..y2. The prior `obj.left +
  // obj.width/2` formula collapsed to (0,0) on imported lines, which made
  // them spin around the page origin and visually disappear on rotate.
  const angle = obj.angle ?? 0;
  let rotateTransform;
  if (angle !== 0) {
    // UX 2026-04-20: use the RAW endpoint midpoint (pre arrowhead shortening)
    // as the rotation center so the post-release position exactly matches
    // the live-preview wrapper, which rotates around the bbox center from
    // getLineBBox. spec.line.x2 for arrow shapes is shortened to sit at the
    // arrowhead base — using that midpoint biased the center toward the
    // tail and caused a subpixel-to-1px jump between drag and commit.
    const rawEp = getLineEndpoints(obj);
    const cx = (rawEp.x1 + rawEp.x2) / 2;
    const cy = (rawEp.y1 + rawEp.y2) / 2;
    rotateTransform = `rotate(${angle}, ${cx}, ${cy})`;
  }

  if (spec.kind === 'curved') {
    // UX: Curved line/arrow — <path> + optional arrowhead inside <g>.
    // fill='none' on <path> is CRITICAL (Pitfall 5) — otherwise the bezier
    // fills black between the curve and the start-to-end chord. Emitted
    // explicitly by buildLineRenderSpec.
    return (
      <g key={key} opacity={opacity} transform={rotateTransform}>
        <path {...spec.path} />
        {renderArrowheadFromSpec(spec.arrowhead)}
      </g>
    );
  }

  // Straight branch — byte-identical to pre-Phase-15 when no data.midpoint
  // and no rotation. A rotation wrapper is added whenever obj.angle !== 0.
  if (spec.arrowhead.kind !== 'none') {
    return (
      <g key={key} opacity={opacity} transform={rotateTransform}>
        <line {...spec.line} />
        {renderArrowheadFromSpec(spec.arrowhead)}
      </g>
    );
  }
  if (rotateTransform) {
    return (
      <g key={key} transform={rotateTransform}>
        <line {...spec.line} opacity={opacity} />
      </g>
    );
  }
  return <line key={key} {...spec.line} opacity={opacity} />;
};

/**
 * Render a Fabric.js arrow group (line + triangle arrowhead) as SVG elements.
 * The group contains a line child and an optional triangle arrowhead child.
 *
 * @param {object} obj - Fabric.js group JSON object containing line + arrowhead
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement|null}
 */
export const renderArrow = (obj, index) => {
  if (!Array.isArray(obj.objects) || obj.objects.length === 0) return null;

  const lineChild = obj.objects.find(
    (o) => o && (o.type === 'line' || o.type === 'polyline' || o.type === 'path')
  );
  const arrowHead = obj.objects.find(
    (o) => o && (o.name === 'arrowHead' || o.type === 'triangle')
  );

  if (!lineChild) return null;

  const x1 = (obj.left || 0) + (lineChild.x1 || 0);
  const y1 = (obj.top || 0) + (lineChild.y1 || 0);
  const x2 = (obj.left || 0) + (lineChild.x2 || 0);
  const y2 = (obj.top || 0) + (lineChild.y2 || 0);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = angleRad * (180 / Math.PI);
  const headSize = Math.max(6, (obj.strokeWidth || 2) * 3);

  // Shorten line so it ends at the back of the centered arrowhead
  const lineEndX = arrowHead ? x2 - (headSize / 3) * Math.cos(angleRad) : x2;
  const lineEndY = arrowHead ? y2 - (headSize / 3) * Math.sin(angleRad) : y2;

  const key = `arrow-${obj.id || index}`;

  return (
    <g key={key} opacity={obj.opacity ?? 1}>
      <line
        x1={x1}
        y1={y1}
        x2={lineEndX}
        y2={lineEndY}
        stroke={obj.stroke || '#000'}
        strokeWidth={obj.strokeWidth || 2}
        strokeLinecap="round"
      />
      {arrowHead && (
        <polygon
          points={`${-headSize / 3},${-headSize / 2} ${headSize * 2 / 3},0 ${-headSize / 3},${headSize / 2}`}
          fill={obj.stroke || '#000'}
          transform={`translate(${x2},${y2}) rotate(${angleDeg})`}
        />
      )}
    </g>
  );
};

/**
 * Render a Fabric.js polygon object as an SVG <polygon> element.
 *
 * Fabric.js Polygon stores `points[]` in local unscaled space and uses the
 * same transform chain as Path: translate(left, top) → rotate → scale →
 * translate(-pathOffset). PDF-imported polygons arrive here with a populated
 * `points` array but no `path`/`objects`, which is why the main dispatch
 * previously couldn't draw them (causing the eraser↔selector mismatch).
 *
 * @param {object} obj - Fabric.js polygon JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement|null}
 */
export const renderPolygon = (obj, index) => {
  if (!Array.isArray(obj.points) || obj.points.length === 0) return null;

  const pointsStr = obj.points
    .map((p) => `${toNumber(p?.x)},${toNumber(p?.y)}`)
    .join(' ');

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const angle = obj.angle ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;

  // UX: rotation must happen around the visual center of the shape, not the
  // top-left corner. Compute the center in pre-rotation local space (after
  // scale + pathOffset, before rotate) so it matches the rotation center
  // used by useSVGInteraction's drag preview.
  const pointXs = obj.points.map(p => toNumber(p?.x));
  const pointYs = obj.points.map(p => toNumber(p?.y));
  const rawCenterX = (Math.min(...pointXs) + Math.max(...pointXs)) / 2;
  const rawCenterY = (Math.min(...pointYs) + Math.max(...pointYs)) / 2;
  const rotCenterX = scaleX * (rawCenterX - pathOffsetX);
  const rotCenterY = scaleY * (rawCenterY - pathOffsetY);

  let transform = `translate(${left}, ${top})`;
  if (angle !== 0) transform += ` rotate(${angle}, ${rotCenterX}, ${rotCenterY})`;
  if (scaleX !== 1 || scaleY !== 1) transform += ` scale(${scaleX}, ${scaleY})`;
  transform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;

  const isHighlight = obj.globalCompositeOperation === 'multiply';
  const key = `polygon-${obj.id || obj.pdfAnnotationId || index}`;
  const shapeId = obj.id || obj.pdfAnnotationId || key;
  __logShapeRender(obj, 'polygon');

  // 2026-04-17: inset-clip disabled for polygon — the clipPath + polygon +
  // nested-translate transform combination renders as invisible in Chromium
  // even when wrapped in <g transform>. The fill-bleed fix (2026-04-16) is
  // restored here to the pre-clip state so PDF-imported polygons remain
  // visible. Re-apply a stroke-inset fix for polygons via a different
  // mechanism (e.g. pre-transformed absolute points, or paint-order + fill
  // + transparent stroke) once a non-clipPath approach is proven.
  return (
    <polygon
      key={key}
      points={pointsStr}
      transform={transform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 1}
      opacity={obj.opacity ?? 1}
      strokeLinejoin="round"
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
      data-shape-id={shapeId}
      data-shape-kind="polygon"
      onClick={__shapeClick}
    />
  );
};

/**
 * Render a Fabric.js polyline object as an SVG <polyline> element.
 *
 * Same transform chain as renderPolygon; fill defaults to "none" for polylines
 * since they represent open paths (e.g. PDF PolyLine annotations).
 *
 * @param {object} obj - Fabric.js polyline JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement|null}
 */
export const renderPolyline = (obj, index) => {
  if (!Array.isArray(obj.points) || obj.points.length === 0) return null;

  const pointsStr = obj.points
    .map((p) => `${toNumber(p?.x)},${toNumber(p?.y)}`)
    .join(' ');

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const angle = obj.angle ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;

  // UX: same rotation-center fix as renderPolygon — rotate around visual
  // center, not the top-left corner.
  const pointXs = obj.points.map(p => toNumber(p?.x));
  const pointYs = obj.points.map(p => toNumber(p?.y));
  const rawCenterX = (Math.min(...pointXs) + Math.max(...pointXs)) / 2;
  const rawCenterY = (Math.min(...pointYs) + Math.max(...pointYs)) / 2;
  const rotCenterX = scaleX * (rawCenterX - pathOffsetX);
  const rotCenterY = scaleY * (rawCenterY - pathOffsetY);

  let transform = `translate(${left}, ${top})`;
  if (angle !== 0) transform += ` rotate(${angle}, ${rotCenterX}, ${rotCenterY})`;
  if (scaleX !== 1 || scaleY !== 1) transform += ` scale(${scaleX}, ${scaleY})`;
  transform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;

  // Polylines are open paths — treat fill="transparent" (from Fabric JSON) and
  // missing fill as "none" so the SVG renderer doesn't close and fill the shape.
  const rawFill = obj.fill;
  const fill = !rawFill || rawFill === 'transparent' ? 'none' : rawFill;

  const key = `polyline-${obj.id || obj.pdfAnnotationId || index}`;
  const shapeId = obj.id || obj.pdfAnnotationId || key;
  __logShapeRender(obj, 'polyline');

  return (
    <polyline
      key={key}
      points={pointsStr}
      transform={transform}
      fill={fill}
      stroke={obj.stroke || '#000'}
      strokeWidth={obj.strokeWidth || 1}
      opacity={obj.opacity ?? 1}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-shape-id={shapeId}
      data-shape-kind="polyline"
      onClick={__shapeClick}
    />
  );
};

/**
 * Render a Fabric.js circle or ellipse object as an SVG <ellipse> element.
 * Handles both circle (radius) and ellipse (rx/ry) JSON types.
 *
 * @param {object} obj - Fabric.js circle/ellipse JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderEllipse = (obj, index) => {
  let rx, ry;

  if (obj.type === 'circle' || obj.radius != null) {
    // Circle type: radius with scaleX/scaleY
    rx = (obj.radius || 0) * Math.abs(obj.scaleX || 1);
    ry = (obj.radius || 0) * Math.abs(obj.scaleY || 1);
  } else {
    // Ellipse type: rx/ry with scaleX/scaleY
    rx = (obj.rx || 0) * Math.abs(obj.scaleX || 1);
    ry = (obj.ry || 0) * Math.abs(obj.scaleY || 1);
  }

  const cx = (obj.left || 0) + rx;
  const cy = (obj.top || 0) + ry;

  const key = `ellipse-${obj.id || index}`;
  const isHighlight = obj.globalCompositeOperation === 'multiply';
  const shapeId = obj.id || obj.pdfAnnotationId || key;
  __logShapeRender(obj, 'ellipse');

  const rotateTransform = obj.angle ? `rotate(${obj.angle}, ${cx}, ${cy})` : undefined;
  const inset = !isHighlight && shouldInsetStroke(obj);
  const clipId = inset ? `clip-${shapeId}` : undefined;

  const ellEl = (
    <ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      transform={rotateTransform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 0}
      opacity={obj.opacity ?? 1}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      data-shape-id={shapeId}
      data-shape-kind="ellipse"
      onClick={__shapeClick}
    />
  );

  if (!inset) return React.cloneElement(ellEl, { key });

  // UX: clip the ellipse to its own outline so the stroke's outer half is
  // removed. See shouldInsetStroke doc.
  return (
    <g key={key}>
      <clipPath id={clipId}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={rotateTransform} />
      </clipPath>
      {ellEl}
    </g>
  );
};

/**
 * Render a Fabric.js text object as an SVG <foreignObject> element.
 * Uses foreignObject with an inner HTML div to support full CSS text layout
 * including word-wrap, font properties, and text alignment.
 *
 * @param {object} obj - Fabric.js textbox/i-text/text JSON object
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement}
 */
export const renderText = (obj, index, liveBounds = null) => {
  const scaleX = Math.abs(obj.scaleX ?? 1);
  const scaleY = Math.abs(obj.scaleY ?? 1);
  const objType = String(obj.type || '').toLowerCase();

  // Textbox sizing: trust stored width/height for all textboxes. PDF imports
  // now carry Fabric-measured dims (see pdfAnnotationImporter.js
  // convertFreeTextToFabricTextbox) and user-edited textboxes carry committed
  // dims, so both are authoritative. i-text / text without stored bounds fall
  // through to measureTextBounds.
  //
  // Plan 15-04 Step 3 — during edit, liveBounds overrides stored dims + text.
  // The Fabric textbox is painted transparently so only the SVG is visible;
  // feeding Fabric-measured width/height and the live text string here keeps
  // the SVG in lockstep with the caret per keystroke without a background
  // Fabric overlay doubling the glyphs.
  let effectiveWidth, effectiveHeight;
  if (liveBounds && liveBounds.width > 0 && liveBounds.height > 0) {
    effectiveWidth = liveBounds.width;
    effectiveHeight = liveBounds.height;
  } else if (objType === 'textbox' && obj.width && obj.height) {
    effectiveWidth = obj.width * scaleX;
    effectiveHeight = obj.height * scaleY;
  } else {
    const measured = measureTextBounds(obj);
    effectiveWidth = measured.width;
    effectiveHeight = measured.height;
  }
  const left = (liveBounds && typeof liveBounds.left === 'number') ? liveBounds.left : (obj.left || 0);
  const top = (liveBounds && typeof liveBounds.top === 'number') ? liveBounds.top : (obj.top || 0);
  const angle = obj.angle || 0;
  // Live text string wins during edit; stored text is used for non-edit paint
  // and also as the fallback when liveBounds omits text (e.g. initial frame).
  const displayedText = (liveBounds && typeof liveBounds.text === 'string')
    ? liveBounds.text
    : (obj.text || '');

  const key = `text-${obj.id || index}`;
  // Add buffer for descenders (j,p,g,q,y) + bottom breathing room
  const fontSize = obj.fontSize || 16;
  const descenderBuffer = fontSize * 0.35;
  const displayHeight = effectiveHeight + descenderBuffer;
  // UX (Plan 15-04 Issue 4, 2026-04-17): gutter between the border and text
  // content so text doesn't hug the border and descenders don't cut the
  // bottom edge. Applied uniformly — PDF imports included — so all textboxes
  // share one visual contract. (Earlier draft exempted `obj.isPdfImported`;
  // removed after user UAT confirmed imports look better with the padding too.)
  const pad = TEXT_PADDING;
  const innerWidth = Math.max(0, effectiveWidth - 2 * pad);
  const innerHeight = Math.max(0, effectiveHeight - 2 * pad);
  const innerDisplayHeight = innerHeight + descenderBuffer;
  // UX 2026-04-20: rotate around the textbox's logical center, NOT the
  // displayHeight center (which adds descenderBuffer / 2 below the logical
  // center). The live-preview wrapper + selection overlay both pivot around
  // bbox center (left + width/2, top + height/2), so renderText must too,
  // otherwise the text snaps vertically/horizontally on release when the
  // commit angle swaps the outer wrapper rotation for renderText's own.
  const rotateTransform = angle !== 0
    ? `rotate(${angle}, ${left + effectiveWidth / 2}, ${top + effectiveHeight / 2})`
    : undefined;

  return (
    <g key={key} opacity={obj.opacity ?? 1} transform={rotateTransform}>
      {/* Border rect: drawn only when the textbox carries a positive strokeWidth.
          PDF-imported FreeText annotations with BS.W>0 (see
          pdfAnnotationImporter.convertFreeTextToFabricTextbox) and user-created
          textboxes (FabricTextCanvas/FabricEditCanvas default: 1px black) both
          land here. Textboxes with strokeWidth=0 render borderless. Uses
          effectiveHeight (not displayHeight with descenderBuffer) so the border
          hugs Fabric's logical bounds and matches the eraser-canvas render. */}
      {obj.strokeWidth > 0 && obj.stroke ? (
        <rect
          x={left}
          y={top}
          width={effectiveWidth}
          height={effectiveHeight}
          fill="none"
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          vectorEffect={obj.strokeUniform ? 'non-scaling-stroke' : undefined}
        />
      ) : null}
      <foreignObject
        data-annotation-text-bounds=""
        x={left + pad}
        y={top + pad}
        width={innerWidth}
        height={innerDisplayHeight}
        // UX 2026-04-19 — overflow:hidden so text that doesn't fit inside
        // the resized textbox gets clipped at the border (matches Drawboard
        // PDF). Live wrap still happens via word-break:break-all inside the
        // flex width; this setting only hides the lines that spill past the
        // visible box height when the user drags the bottom up.
        overflow="hidden"
      >
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            // UX 2026-04-20: explicit px sizes instead of 100%. SVG
            // foreignObject does not reliably establish a containing
            // block for percentage heights across Chromium versions, so
            // the inner div stayed pinned at its first-render size while
            // the foreignObject attribute grew during typing. Pinning
            // the div to innerWidth/innerDisplayHeight keeps CSS layout
            // in lockstep with the live-broadcast text bounds so newly
            // typed lines stop disappearing behind the border.
            width: innerWidth,
            height: innerDisplayHeight,
            fontSize: `${fontSize}px`,
            fontFamily: obj.fontFamily || 'sans-serif',
            fontWeight: obj.fontWeight || 'normal',
            fontStyle: obj.fontStyle || 'normal',
            color: obj.fill || '#000',
            textAlign: obj.textAlign || 'left',
            // UX: Fabric 5.x textbox per-line pixel step =
            // `fontSize × lineHeight × _fontSizeMult` where `_fontSizeMult` is
            // the hard-coded 1.13 on Fabric.Text.prototype. CSS unitless
            // line-height on the SVG foreignObject skips that multiplier, so
            // without compensation the SVG stepped shorter than Fabric and
            // the caret drifted ~2.88 px further down per wrapped line during
            // edit. Multiplying by 1.13 here aligns the two rulers so the
            // caret stays glued to the rendered letters no matter how many
            // lines wrap. (Plan 15-04 Issue 1, verified 2026-04-17.)
            lineHeight: (obj.lineHeight || 1.16) * 1.13,
            // UX 2026-04-19 — hidden on the inner div too so if the box is
            // resized narrower than a single character can fit, nothing
            // leaks out the side.
            overflow: 'hidden',
            wordWrap: 'break-word',
            // UX: Fabric Textbox wraps with `splitByGrapheme: true` — break at
            // any character regardless of word boundaries. CSS `word-wrap:
            // break-word` alone prefers word boundaries and only breaks inside
            // a word when the word itself overflows, so dense punctuation like
            // `.` `;` `'` creates extra break opportunities the browser
            // exploits and Fabric does not. The count diverges (23 Fabric
            // lines ↔ 30 SVG lines in the worst case), visual lines spill past
            // the foreignObject border, and Option+Arrow cursor jumps land on
            // word boundaries Fabric sees but the user does not. `break-all`
            // forces CSS to break per-character so wrap points line up 1:1.
            // (Plan 15-04 Issue 1 follow-up, 2026-04-17.)
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
            padding: 0,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          }}
        >
          {displayedText}
        </div>
      </foreignObject>
    </g>
  );
};

/**
 * Render a callout annotation as SVG elements (lines + circle + rect + text).
 *
 * Phase 14 CALL-10 revision: signature takes a `pageSize` object instead of
 * separate pageWidth/pageHeight numbers. This lets callers pre-compute the
 * conversion boundary without a signature churn across later phases.
 *
 * Emits data-callout-id on the outer <g> and data-callout-part on every child
 * (arrowTip, knee overlay via Plan 14-03, textBox, line1, line2, text) so
 * Phases 17-18 can event-delegate hit-testing via e.target.closest() — same
 * pattern as v2.2 EDIT-13 `data-rotation-handle="mtr"` delegation at
 * SVGAnnotationLayer.jsx:215-312.
 *
 * FontFamily is sanitized to a single font name via sanitizeFontFamily(). A
 * CSS fallback stack like 'Inter, Arial, sans-serif' is reduced to the first
 * token ('Inter'). Required because Fabric.js Textbox measures characters at
 * CACHE_FONT_SIZE=400px and the browser may resolve different fonts at 400px
 * than at display size, producing cursor drift. See CLAUDE.md 2026-04-08
 * gotcha and Phase 14-RESEARCH.md Pitfall 2.
 *
 * @param {object} callout - Callout data object with normalized coordinates
 * @param {number} index - Array index for key fallback
 * @param {{width:number, height:number}} pageSize - Unscaled PDF page dims
 * @param {Function} calculateConnection - calculateCalloutConnection function
 * @returns {React.ReactElement|null}
 */
export const renderCallout = (callout, index, pageSize, calculateConnection, hideText = false, liveBounds = null, rawKnee = false) => {
  if (!callout || !callout.arrowTip || !callout.knee) return null;
  const { width: pageWidth = 0, height: pageHeight = 0 } = pageSize || {};

  // Convert normalized (0-1) coordinates to page coordinates
  const arrowTip = {
    x: callout.arrowTip.x * pageWidth,
    y: callout.arrowTip.y * pageHeight,
  };
  const knee = {
    x: callout.knee.x * pageWidth,
    y: callout.knee.y * pageHeight,
  };
  // UX: Phase 15 UAT-2 — when editing this callout, liveBounds carries the
  // page-space textbox bounds from Fabric.Textbox (updated on every 'changed'
  // event). Using live bounds for calculateConnection makes line1 retract to
  // the live edge as the textbox auto-grows, preventing the visible
  // disconnect users saw while typing. liveBounds is null when not editing,
  // or when App.jsx hasn't yet received the first changed event. Falls back
  // to the stored normalized dims so initial paint before any edit still works.
  const textBox = liveBounds ? {
    x: liveBounds.left,
    y: liveBounds.top,
    width: Math.max(18, liveBounds.width),
    height: Math.max(18, liveBounds.height),
  } : {
    x: (callout.textBoxPosition?.x ?? callout.textBox?.x ?? 0) * pageWidth,
    y: (callout.textBoxPosition?.y ?? callout.textBox?.y ?? 0) * pageHeight,
    width: Math.max(18, (callout.textBoxWidth ?? callout.textBox?.width ?? 0.1) * pageWidth),
    height: Math.max(18, (callout.textBoxHeight ?? callout.textBox?.height ?? 0.05) * pageHeight),
  };

  // Style extraction. Phase 15 UAT-2 (2026-04-17): defaults aligned with
  // Fabric edit overlay so view and edit render identically without a user
  // style override. lineColor default '#1e293b' matches defaultCalloutStyle
  // (types.js :116) + calloutEditAdapter toFabricGroup stroke (:92). fillColor
  // default 'transparent' matches Fabric textbox backgroundColor: '' (:171).
  const lineColor = callout.style?.borderColor || callout.style?.lineColor || '#1e293b';
  const lineThickness = Math.max(1, callout.style?.lineThickness || 2);
  const fillColor = callout.style?.fillColor || 'transparent';
  const fillOpacity = Math.max(0.08, Math.min(1, callout.style?.fillOpacity ?? 0.4));
  const borderOpacity = Math.max(0.2, Math.min(1, callout.style?.borderOpacity ?? 1));
  // UX: single-name fontFamily prevents Fabric.js cursor drift (see CLAUDE.md
  // 2026-04-08 gotcha). sanitizeFontFamily strips CSS fallback stacks.
  const safeFontFamily = sanitizeFontFamily(callout.style?.fontFamily);

  // UX: borderWidth passed as 0 — stored textBox x/y/w/h already represent
  // the OUTER visible border rect (the <rect> below paints at the same dims).
  // Passing lineThickness here would nudge the line's box-end inward by that
  // amount, leaving a visible bleed inside the textbox (Phase 15 UAT-3 Issue 2).
  // The connection math still uses lineThickness for its internal stroke-safe
  // calculations elsewhere — it doesn't need it as a geometric offset here.
  //
  // Phase 15 UAT-3 (2026-04-18) — rawKnee mode: during an active knee drag
  // the user wants to see the line bending at THEIR cursor, not at an
  // auto-routed midpoint. Compute a raw connection that skips the
  // bad-geometry branch entirely: line1 starts at the closest textbox edge
  // to the raw knee, line2 goes straight from raw knee to arrow. If the
  // user drops here on release the rollback logic handles "knee inside
  // textbox" separately.
  let connection;
  if (rawKnee) {
    const boxRight = textBox.x + textBox.width;
    const boxBottom = textBox.y + textBox.height;
    const clampedX = Math.max(textBox.x, Math.min(knee.x, boxRight));
    const clampedY = Math.max(textBox.y, Math.min(knee.y, boxBottom));
    connection = {
      line1Start: { x: clampedX, y: clampedY },
      line2Start: { x: knee.x, y: knee.y },
      effectiveKnee: { x: knee.x, y: knee.y },
      shouldHideLine1: false,
    };
  } else {
    connection = calculateConnection(
      textBox.x, textBox.y, textBox.width, textBox.height,
      knee, arrowTip, 0
    );
  }

  // UX: arrowhead style resolution — explicit style wins, else default to
  // solid triangle so callouts share the arrow tool's default look. Callers
  // can force 'none' via an explicit style override.
  const arrowheadStyle = callout.style?.arrowheadStyle ?? ARROWHEAD_STYLES.SOLID_TRIANGLE;
  // UX: arrowhead rotates to the tangent of line2 (knee → arrowTip), same
  // convention the straight-branch arrow tool uses. line2Start is the
  // constrained / effective knee so the arrowhead aligns with the visible
  // segment even after knee clamping.
  const arrowAngleDeg = (
    Math.atan2(arrowTip.y - connection.line2Start.y, arrowTip.x - connection.line2Start.x)
    * 180 / Math.PI
  );
  const arrowheadSpec = buildArrowheadRenderSpec(
    arrowheadStyle, arrowTip.x, arrowTip.y, arrowAngleDeg, lineColor, lineThickness
  );
  // UX: shorten line2 into the back of the arrowhead for SOLID_TRIANGLE /
  // OPEN_TRIANGLE so the line tail doesn't poke through — same formula the
  // arrow tool uses (lineEndX/Y offset by headSize/3).
  let line2EndX = arrowTip.x;
  let line2EndY = arrowTip.y;
  if (arrowheadStyle === ARROWHEAD_STYLES.SOLID_TRIANGLE
      || arrowheadStyle === ARROWHEAD_STYLES.OPEN_TRIANGLE) {
    const headSize = Math.max(8, lineThickness * 3);
    const angleRad = arrowAngleDeg * Math.PI / 180;
    line2EndX = arrowTip.x - (headSize / 3) * Math.cos(angleRad);
    line2EndY = arrowTip.y - (headSize / 3) * Math.sin(angleRad);
  }
  // UX: render the arrowhead spec via the same primitive mapping the arrow
  // tool uses. Keeps callout and arrow tool visually identical when styles
  // match.
  const renderArrowheadEl = () => {
    switch (arrowheadSpec.kind) {
      case 'none': return null;
      case 'solidTriangle': return <polygon {...arrowheadSpec.polygon} />;
      case 'openTriangle': return <polygon {...arrowheadSpec.polygon} />;
      case 'openCircle': return <circle {...arrowheadSpec.circle} />;
      case 'vShape': return <polyline {...arrowheadSpec.polyline} />;
      case 'horizontalLine': return <line {...arrowheadSpec.line} />;
      default: return null;
    }
  };

  const key = `callout-${callout.id || index}`;

  // Shared stroke attributes for both connector line segments. vectorEffect
  // non-scaling-stroke keeps the line visually consistent across zoom levels.
  const lineStyle = {
    stroke: lineColor,
    strokeWidth: lineThickness,
    strokeLinecap: 'round',
    vectorEffect: 'non-scaling-stroke',
  };

  // Reference the pure spec builder so any future inline-JSX drift against
  // the testable contract is detectable. (The unit tests target the spec
  // directly; this call is a noop placeholder kept for code-parity.)
  // eslint-disable-next-line no-unused-vars
  const _specPreview = buildCalloutRenderSpec(callout, index, pageSize, calculateConnection);

  return (
    // UX: data-callout-id enables Phase 17/18 event delegation for hit-testing
    // (same pattern as v2.2 EDIT-13 data-rotation-handle='mtr' delegation).
    // (CALL-10)
    <g key={key} data-callout-id={callout.id} opacity={borderOpacity}>
      {/* Line 1: textbox-edge to knee (skip if shouldHideLine1) */}
      {!connection.shouldHideLine1 && (
        <line
          // UX: data-callout-part='line1' — Phase 17 collision math hit-tests
          // the first connector segment for clamp logic. (CALL-10)
          data-callout-part="line1"
          x1={connection.line1Start.x}
          y1={connection.line1Start.y}
          x2={connection.effectiveKnee.x}
          y2={connection.effectiveKnee.y}
          {...lineStyle}
        />
      )}
      {/* Line 2: knee to arrowTip (shortened into back of arrowhead for
          triangle styles so the line tail doesn't poke through the point). */}
      <line
        // UX: data-callout-part='line2' — Phase 18 Liang-Barsky auto-routing
        // identifies the tip-direction segment via this marker. (CALL-10)
        data-callout-part="line2"
        x1={connection.line2Start.x}
        y1={connection.line2Start.y}
        x2={line2EndX}
        y2={line2EndY}
        {...lineStyle}
      />
      {/* UX: real arrowhead via the same arrow-tool renderer path
          (buildArrowheadRenderSpec) — solid triangle by default, or whichever
          of the 6 styles the callout style specifies. Replaces the earlier
          placeholder dot (Phase 15 UAT-3 Issue 1). (CALL-10) */}
      {renderArrowheadEl()}
      {/* Text box rect + text foreignObject — rendered as a pair when
          hideText=false. Both hide together when the callout is being edited
          (hideText=true): FabricEditCanvas mounts a Fabric.Textbox over the
          bbox that carries its own stroke/rx/ry (see calloutEditAdapter.js
          toFabricGroup post-Phase-15-UAT-2), so a static SVG rect below would
          double up with the edit overlay's border. Phase 15 UAT-2 (2026-04-17):
          rect + foreignObject share source-of-truth with the Fabric Textbox
          during edit, so the unified textbox-IS-the-box model preserves the
          auto-sized growth the user sees while typing. */}
      {!hideText && (() => {
        // UX: 2026-04-19 — give the visible box a descender buffer so letters
        // like j / g / p / y / q that hang below the baseline stay inside the
        // border instead of clipping against the bottom edge. Mirrors the
        // `descenderBuffer = fontSize * 0.35` approach used by renderText
        // for plain text annotations. Both the border rect and the inner
        // foreignObject grow together so the text anchor stays at the top
        // and the bottom stretches just enough to contain descenders.
        const calloutFs = Number(callout.style?.fontSize || 12);
        const descenderBuffer = calloutFs * 0.35;
        const boxHeightWithDescenders = textBox.height + descenderBuffer;
        return (
        <>
          <rect
            // UX: data-callout-part='textBox' — Phase 14 drag target + Phase 17
            // collision clamp hit-test surface. (CALL-10)
            data-callout-part="textBox"
            x={textBox.x}
            y={textBox.y}
            width={textBox.width}
            height={boxHeightWithDescenders}
            fill={fillColor}
            fillOpacity={fillOpacity}
            stroke={lineColor}
            strokeWidth={Math.max(1, lineThickness * 0.7)}
            rx={0}
            ry={0}
            vectorEffect="non-scaling-stroke"
          />
          <foreignObject
            // UX: data-callout-part='text' — double-click edit-mode entry
            // hit-test surface. Phase 14 Area 2c dispatches
            // onRequestEditMode(id, 'callout') when this is double-clicked.
            // (CALL-10)
            //
            // Plan 15-04 Issue 4 (2026-04-17): inset by TEXT_PADDING so text
            // doesn't hug the callout border and descenders don't cut the
            // bottom edge. Border rect above stays at the full textBox dims;
            // only the foreignObject shrinks. CSS word-break: break-all wraps
            // at this narrower inner width, so Fabric edit-mode Textbox wrap
            // width must also subtract 2*TEXT_PADDING to stay in lockstep
            // (see calloutEditAdapter / FabricEditCanvas callout edit path).
            data-callout-part="text"
            // UX: 2026-04-19 — clamp the 6px text inset down for tight
            // imported boxes. Acrobat/Drawboard store FreeTextCallouts
            // with the border fit snug to the text (sometimes only a
            // couple of px above/below the glyphs). A flat 6px inset
            // crushes the text to the bottom on those. Scale the inset
            // so text never gets less than one line-box worth of room,
            // and always let the foreign object cover the full height
            // for tight boxes so the flex-centered child lays out
            // properly.
            // UX: 2026-04-19 — add the same TEXT_PADDING gutter renderText
            // uses for plain text annotations so callout letters don't hug
            // the left border. Fabric's callout edit path applies the same
            // inset, so cursor and glyphs stay pixel-aligned side-to-side.
            // overflow:hidden hides any text that doesn't fit when the user
            // resizes the callout narrower than the content can wrap, or
            // shorter than the wrapped lines — matches Drawboard PDF.
            x={textBox.x + TEXT_PADDING}
            y={textBox.y}
            width={Math.max(0, textBox.width - 2 * TEXT_PADDING)}
            height={Math.max(0, boxHeightWithDescenders)}
            overflow="hidden"
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              // UX: inner div style mirrors renderText at :457. Single-name
              // fontFamily prevents Fabric.js cursor drift (CLAUDE.md 2026-04-08
              // gotcha). antialiased + grayscale smoothing matches renderText
              // visual parity. (CALL-10)
              //
              // Phase 15 UAT-2 (2026-04-17): padding dropped to 0 so SVG view
              // text position matches the Fabric edit overlay's flush-left
              // default — prevents the "text jump" a user saw when entering
              // edit mode under the old +8/+4 offset model.
              style={{
                // UX 2026-04-20: explicit px sizes so the inner div
                // tracks the live-growing foreignObject. SVG
                // foreignObject doesn't reliably resolve percentage
                // heights during auto-grow, which left new lines
                // invisible past the imported height.
                width: Math.max(0, textBox.width - 2 * TEXT_PADDING),
                height: Math.max(0, boxHeightWithDescenders),
                // UX: 2026-04-19 — vertically center the text inside the
                // (descender-padded) box in every state. Fabric's edit-mode
                // cursor is shifted down by the same center offset so the
                // blinking caret lines up with the visible glyphs whether
                // the user is typing or not. Multi-line content that
                // overflows the box top-aligns naturally (`justify-content:
                // center` only uses free space).
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                textAlign: callout.style?.textAlign || 'left',
                fontKerning: 'none',
                textRendering: 'geometricPrecision',
                fontVariantLigatures: 'none',
                fontSize: `${callout.style?.fontSize || 12}px`,
                fontFamily: safeFontFamily,
                color: callout.style?.fontColor || callout.style?.textColor || '#000',
                // UX 2026-04-19 — hidden on the inner div as well so tight
                // boxes clip cleanly at the border.
                overflow: 'hidden',
                wordWrap: 'break-word',
                // UX: match renderText — Fabric's `splitByGrapheme: true`
                // breaks at any character, CSS default prefers word
                // boundaries + only breaks inside a word on overflow.
                // `break-all` keeps SVG wrap points aligned with Fabric's,
                // preventing visual-line-count drift (and the resulting
                // border overflow) during callout edit.
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
                boxSizing: 'border-box',
                padding: 0,
                // UX: match renderText's line-height fix (Plan 15-04 Issue 1).
                // Fabric textbox per-line step = fontSize * lineHeight *
                // _fontSizeMult (1.13). The callout edit adapter now pins
                // Fabric lineHeight = 1 so cursor and glyphs use the same
                // per-line step (fixes 2026-04-20 drift report). Browser
                // CSS line-height here mirrors that: lineHeight * 1.13 so
                // view and edit show identical line spacing.
                lineHeight: (callout.style?.lineHeight || 1) * 1.13,
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
              }}
            >
              {(liveBounds && typeof liveBounds.text === 'string')
                ? liveBounds.text
                : (callout.text || '')}
            </div>
          </foreignObject>
        </>
        );
      })()}
    </g>
  );
};

/**
 * [COUNTER WIP — DO NOT TOUCH] Counter feature is mid-debug as of 2026-04-14.
 * Another session: leave renderCounter and all counter-related code alone
 * until the human owner gives explicit say-so. Coordinate via the user.
 *
 * Render a counter annotation (Shottr-style numbered badge): filled circle
 * with a small triangular nubbin pointing in the configured direction, and
 * a centered number derived from `data.displayNumber` (set by renumberCounters).
 *
 * Storage shape: Fabric Circle with `data: { type: 'counter', createdAt,
 * pointerAngle, displayNumber }`. The Circle's own `fill` is the visual color,
 * which the FabricEditCanvas color picker can change directly.
 *
 * @param {object} obj - Fabric.js circle JSON object with counter data
 * @param {number} index - Array index for key fallback
 * @returns {React.ReactElement|null}
 */
export const renderCounter = (obj, index) => {
  const radius = (obj.radius || 14) * Math.abs(obj.scaleX || 1);
  // Default Fabric Circle origin is left/top, so center = left+radius, top+radius.
  const centerX = (obj.left || 0) + radius;
  const centerY = (obj.top || 0) + radius;

  const color = obj.fill || (obj.data && obj.data.color) || '#ef4444';
  const displayNumber =
    (obj.data && obj.data.displayNumber != null) ? obj.data.displayNumber : 1;
  const pointerAngleDeg =
    (obj.data && obj.data.pointerAngle != null) ? obj.data.pointerAngle : 225;

  // UX (Shottr cohesion): render the pin as a SINGLE filled SVG path that combines
  // the bubble body and the nub via two tangent lines from the nub tip to the
  // circle. One filled path = no AA seam, no z-order tricks, and a smooth tangent
  // transition (no visible kink) where the nub meets the bubble — which matches
  // Shottr's counter pin. Previous polygon+circle composite left a visible
  // separation no matter how the two shapes were overlapped.
  const angleRad = (pointerAngleDeg * Math.PI) / 180;
  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);
  const tipExtension = Math.max(5, radius * 0.5);
  const tipDistance = radius + tipExtension;
  const tipX = centerX + dirX * tipDistance;
  const tipY = centerY + dirY * tipDistance;

  // Tangent points on the circle from the tip: the tangent lines from an external
  // point P touch a circle at the two points where CT ⟂ PT. Half-angle at center
  // between CP and CT is acos(r/d) where d = |CP|.
  const tangentHalfAngle = Math.acos(radius / tipDistance);
  const t1Angle = angleRad + tangentHalfAngle;
  const t2Angle = angleRad - tangentHalfAngle;
  const t1x = centerX + Math.cos(t1Angle) * radius;
  const t1y = centerY + Math.sin(t1Angle) * radius;
  const t2x = centerX + Math.cos(t2Angle) * radius;
  const t2y = centerY + Math.sin(t2Angle) * radius;

  // Path: tip → T1 (tangent line) → arc the LONG way around the circle through the
  // back (opposite the nub) → T2 → close back to tip. large-arc-flag=1 picks the
  // >180° arc; sweep-flag=1 sweeps through increasing SVG angles, which in y-down
  // screen space traces the bubble body away from the nub side.
  const pathD = `M ${tipX},${tipY} L ${t1x},${t1y} A ${radius},${radius} 0 1 1 ${t2x},${t2y} Z`;

  const fontSize = Math.max(11, radius * 1.05);
  const key = `counter-${obj.id || index}`;

  return (
    <g key={key} opacity={obj.opacity ?? 1}>
      <path d={pathD} fill={color} stroke="none" />
      <text
        x={centerX}
        y={centerY}
        fill={obj.data?.numberColor || '#ffffff'}
        fontSize={fontSize}
        fontWeight={700}
        fontFamily="-apple-system, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        pointerEvents="none"
        style={{ userSelect: 'none' }}
      >
        {displayNumber}
      </text>
    </g>
  );
};
