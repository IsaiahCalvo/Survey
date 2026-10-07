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
  pdfLineEndingToArrowheadStyle,
  ARROWHEAD_STYLES,
  calloutLineDashArray,
  resolveLineEndingStyles,
  insetOpenPolylinePoints,
  lineEndingBodyInset,
} from './lineRenderHelpers.js';
// UX 2026-04-21: Imported revision-clouds rebuild their scalloped geometry
// from the live effective box/points on every render so the number of humps
// grows/shrinks with the shape instead of staying baked at import size.
import {
  buildStickyNoteGlyphSpec,
  isStickyNoteGlyphObject,
  resolveAnnotationCloudSpec,
  stickyNoteOutlineColor,
} from './pdfAnnotationAppearance.js';
// UX 2026-09-09: every cloud shape resolves its engine vertices, frame and
// both painted paths (crown outline + scalloped fill region) through the one
// shared resolver, so the SVG ink, the hit target, the canvas painter and the
// pdf-lib flattener can never disagree about what a cloud looks like.
import { resolveCloudAnnotationGeometry } from './cloudAnnotationGeometry.js';
// UX 2026-09-09: the cloud's SVG paint (fill knockout mask + one path per
// run) is one shared model, serialised identically by the fidelity tests.
import { buildCloudSvgPaint, cloudMaskIdFor } from './cloudSvgPaint.js';
// Fill-bleed diagnostics (2026-04-16). Off by default; the wrapper calls are
// cheap no-ops when disabled. Toggle in DevTools console:
//   __shapeSpyOn()  __shapeSpyOff()  __captureAllShapes()
// Cmd/Ctrl+Shift+click on a shape (with spy on) captures it to disk.
// See src/utils/shapeBleedDiagnostics.js for details.
import {
  logShapeRender as __logShapeRender,
  captureShape as __captureShape,
} from './shapeBleedDiagnostics';
import { DRAWN_CENTERED_STROKE_CONTRACT } from './shapeCommitGeometry.js';
import { insetRectForFill, shouldKnockOutShapeFill } from './shapeFillKnockout.js';
// UX 2026-04-21 (import-normalization Chunk 2): pure attr derivation for
// path-type Fabric objects lives in svgPathAttrs.js so node-test suites
// can import it without the JSX loader. The renderer uses it too to
// guarantee import vs internal paths produce byte-identical SVG output
// when their Fabric input fields match.
import { renderPathToSvgAttrs, renderPathToSvgD } from './svgPathAttrs.js';
import { calloutBoxCloudStandIn, colorWithAlpha, textboxCloudStandIn } from './textCloudBorder.js';
import { getCounterLabelLayout } from './counterGeometry.js';
import { getTextMarkupUnderlineInset } from './pdfTextMarkup.js';

const __shapeClick = (e) => __captureShape(e.currentTarget, e);

// UX 2026-09-09: a cloud paints exactly as the approved studio does — the
// engine's crowns stroked with fill:none, round caps and joins, ONE <path> PER
// RUN (the studio's cloud-ink group), so every crown keeps its rounded
// separator tail and a translucent stroke composites per run — placed by
// translate + rotate only (scale is already baked into the engine vertices,
// so crowns never stretch).
// A FILLED cloud paints the whole region bounded by the scalloped outline,
// humps included, as one nonzero path under the crowns (the professional
// Drawboard/Bluebeam look), KNOCKED OUT under the stroke band exactly as
// Drawboard PDF does (mask = the region filled white with the outline stroked
// black at the ink width): a translucent stroke never tints with the fill
// beneath it, and the fill colour carries its own alpha, independent of the
// stroke. An OPEN polyline cloud has no interior and never fills.
// See cloudSvgPaint.js for the shared paint model.
const CloudOutline = ({
  shapeId,
  shapeKind,
  geometryKind,
  geometry,
  fill,
  stroke,
  opacity,
  // 2026-09-10: a cloud honours globalCompositeOperation:'multiply' exactly
  // like every other shape here (the plain rect/ellipse/polygon branches all
  // set mixBlendMode from the same flag). The canvas painter
  // (applyBlendAndOpacity) and the exported /AP (a /BM /Multiply ExtGState in
  // buildCloudAppearance) already did; only this renderer did not, so a
  // multiply cloud over a coloured backdrop rasterised (74,89,26) on screen
  // against (0,82,0) in every other lane.
  multiply,
  onClick,
}) => {
  // useId keeps the mask id unique per mounted cloud even when the same shape
  // id renders in more than one SVG (page + thumbnail).
  const maskId = cloudMaskIdFor(React.useId());
  if (!geometry) return null;
  const paint = buildCloudSvgPaint(geometry, { fill, stroke: stroke || 'transparent', maskId });
  if (!paint) return null;
  return (
    <g
      transform={paint.transform}
      opacity={opacity}
      style={multiply ? { mixBlendMode: 'multiply' } : undefined}
      data-shape-id={shapeId}
      data-shape-kind={shapeKind}
      data-cloud-geometry={geometryKind}
      onClick={onClick}
    >
      {paint.mask && (
        <mask
          id={paint.mask.id}
          maskUnits="userSpaceOnUse"
          x={paint.mask.x}
          y={paint.mask.y}
          width={paint.mask.width}
          height={paint.mask.height}
        >
          <path d={paint.fillD} fill="#fff" fillRule="nonzero" stroke="none" />
          <path
            d={paint.outlineD}
            fill="none"
            stroke="#000"
            strokeWidth={paint.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      )}
      {paint.fillD && (
        <path
          d={paint.fillD}
          fill={paint.fill}
          fillRule="nonzero"
          stroke="none"
          mask={paint.mask ? `url(#${paint.mask.id})` : undefined}
          data-cloud-fill="true"
        />
      )}
      <g
        fill="none"
        stroke={paint.stroke}
        strokeWidth={paint.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-cloud-ink="true"
      >
        {paint.runDs.map((d, index) => (
          <path key={index} d={d} data-run={index} />
        ))}
      </g>
    </g>
  );
};

// Owner Test 15 (2026-10-02): a see-through border must not show the fill
// under its inner half (shapeFillKnockout.js). These two paint a shape whose
// fill stops at the stroke's inner edge; they are used ONLY when
// shouldKnockOutShapeFill says so, so every opaque border renders as before.
//
// Rect / text box: the fill is the stroke rect pulled in by half the stroke
// width - exact for any join, so no mask is needed.
const KnockoutRect = ({
  x, y, width, height, transform, fill, stroke, strokeWidth, strokeDasharray,
  opacity, style, shapeId, shapeKind, onClick,
}) => {
  const inner = insetRectForFill({ x, y, width, height }, strokeWidth);
  return (
    <g
      transform={transform}
      opacity={opacity}
      style={style}
      data-shape-id={shapeId}
      data-shape-kind={shapeKind}
      data-fill-knockout="inset"
      onClick={onClick}
    >
      <rect x={inner.x} y={inner.y} width={inner.width} height={inner.height} fill={fill} stroke="none" data-knockout-fill="true" />
      <rect x={x} y={y} width={width} height={height} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
    </g>
  );
};

// Ellipse / polygon: the fill carries a mask = the shape filled white with its
// outline stroked black at the ink width (the cloud's knockout), so the fill
// ends exactly on the stroke's inner edge for any curve or join.
const KnockoutMaskedShape = ({
  tag: Tag, geometry, bounds, transform, fill, stroke, strokeWidth, strokeDasharray,
  strokeLinejoin, opacity, style, shapeId, shapeKind, onClick,
}) => {
  const maskId = `shape-fill-knockout-${String(React.useId()).replace(/[^a-zA-Z0-9_-]/g, '') || 'x'}`;
  const pad = strokeWidth + 2;
  return (
    <g
      transform={transform}
      opacity={opacity}
      style={style}
      data-shape-id={shapeId}
      data-shape-kind={shapeKind}
      data-fill-knockout="mask"
      onClick={onClick}
    >
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x={bounds.minX - pad}
        y={bounds.minY - pad}
        width={bounds.maxX - bounds.minX + pad * 2}
        height={bounds.maxY - bounds.minY + pad * 2}
      >
        <Tag {...geometry} fill="#fff" stroke="#000" strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      </mask>
      <Tag {...geometry} fill={fill} stroke="none" mask={`url(#${maskId})`} data-knockout-fill="true" />
      <Tag
        {...geometry}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinejoin={strokeLinejoin}
      />
    </g>
  );
};

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
const shouldInsetStroke = (obj) => (
  Number(obj?.strokeWidth) > 0
  && obj?.data?.strokeRenderContract !== DRAWN_CENTERED_STROKE_CONTRACT
);

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

const paperCutsToSvgD = (polygons) => (polygons || [])
  .flatMap((polygon) => polygon || [])
  .map((ring) => {
    if (!Array.isArray(ring) || ring.length < 3) return '';
    const end = (
      ring.length > 1
      && ring[0]?.[0] === ring.at(-1)?.[0]
      && ring[0]?.[1] === ring.at(-1)?.[1]
    ) ? ring.length - 1 : ring.length;
    if (end < 3) return '';
    return ring.slice(0, end).map((point, index) => (
      `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`
    )).join(' ') + ' Z';
  })
  .filter(Boolean)
  .join(' ');

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

  const attrs = renderPathToSvgAttrs(obj);
  const d = renderPathToSvgD(obj, attrs);

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const angle = obj.angle ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;

  // UX 2026-04-21: rotate around the path's OWN bbox center — matches the
  // convention used by polygon/polyline (renderPolygon below). Prior to
  // this, path rotation used SVG's default pivot (the local origin at
  // translate(left, top) → world corner), so an imported pen stroke at
  // world coords (left=worldMinX, pathMinX=0) and an internal pen stroke
  // at local coords (left=0, pathMinX=worldX) both rotated around the
  // WRONG point — the selection overlay and bbox helpers rotate around
  // the bbox center, but this <path> rotated around the corner, producing
  // visible drift during any rotate. Scan the path commands for raw
  // min/max, compute the center in the object's own coord space after
  // pathOffset + scale are applied (mirroring the polygon formula).
  let rawMinX = Infinity, rawMinY = Infinity, rawMaxX = -Infinity, rawMaxY = -Infinity;
  for (const seg of obj.path) {
    for (let j = 1; j + 1 < seg.length; j += 2) {
      const x = seg[j];
      const y = seg[j + 1];
      if (typeof x === 'number' && typeof y === 'number') {
        if (x < rawMinX) rawMinX = x;
        if (x > rawMaxX) rawMaxX = x;
        if (y < rawMinY) rawMinY = y;
        if (y > rawMaxY) rawMaxY = y;
      }
    }
  }
  const hasPathBounds = Number.isFinite(rawMinX) && Number.isFinite(rawMinY);
  const rotCenterX = hasPathBounds
    ? scaleX * ((rawMinX + rawMaxX) / 2 - pathOffsetX)
    : 0;
  const rotCenterY = hasPathBounds
    ? scaleY * ((rawMinY + rawMaxY) / 2 - pathOffsetY)
    : 0;

  // Build transform: position -> rotate-around-bbox-center -> scale -> pathOffset
  let transform = `translate(${left}, ${top})`;
  if (angle !== 0) transform += ` rotate(${angle}, ${rotCenterX}, ${rotCenterY})`;
  if (scaleX !== 1 || scaleY !== 1) transform += ` scale(${scaleX}, ${scaleY})`;
  transform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;

  const isHighlight = obj.globalCompositeOperation === 'multiply';
  const erased = isErasedOutline(obj);

  const key = `path-${obj.id || obj.annotationId || obj.pdfAnnotationId || index}`;

  // UX 2026-04-21 (import-normalization Chunk 2): derive the visual attrs
  // via renderPathToSvgAttrs so imported Ink and internal pen strokes
  // produce byte-identical <path> output given identical Fabric inputs.
  // No branch on isPdfImported/pdfAnnotationType — those are metadata only.
  // UX 2026-04-21: diagnostic log gated behind window.__INK_NORM_DIAG = true.
  // Dumps the actual render attrs per draw call alongside the import-time
  // log in convertInkToFabricPath — together they give the user a full
  // audit trail for one yes/no artifact. Zero-cost when the flag is off.
  if (typeof window !== 'undefined' && window.__INK_NORM_DIAG && obj.type === 'path') {
    try {
      console.log(
        '[InkNormDiag render]',
        JSON.stringify(
          {
            pdfAnnotationId: obj.pdfAnnotationId,
            // Source-of-truth fields the renderer keys off of for the
            // 2026-04-28 visibility fix — surfaced together with the
            // computed visual attrs so the user can confirm whether the
            // import flag survived the cloud round-trip.
            sourceFlags: {
              isPdfImported: obj.isPdfImported,
              pdfAnnotationType: obj.pdfAnnotationType,
              rawStrokeWidth: obj.strokeWidth,
            },
            renderedAttrs: {
              stroke: attrs.stroke,
              strokeWidth: attrs.strokeWidth,
              fill: attrs.fill,
              strokeLinecap: attrs.strokeLinecap,
              strokeLinejoin: attrs.strokeLinejoin,
              vectorEffect: attrs.vectorEffect ?? 'none',
              opacity: attrs.opacity,
            },
          },
          null,
          0
        )
      );
    } catch (err) {
      console.warn('[InkNormDiag render] log failed:', err);
    }
  }

  const paperSource = obj?.paperSourceStroke;
  const paperSurvivorD = paperCutsToSvgD(obj?.polygons);
  if (
    paperSurvivorD
    && Array.isArray(paperSource?.path)
    && paperSource.path.length > 0
  ) {
    // Partially erased authored curve (imported PDF ink, legacy curves): fill
    // the SURVIVOR polygons, the eraser's own verified output (even-odd).
    // 2026-10-06 (test plan 68): this used to paint the authored source curve
    // under a clipPath of those same polygons. The clip's edge lies exactly on
    // the curve's own edge along the whole line, so every edge pixel was
    // anti-aliased twice (coverage x coverage): thin imported lines came out
    // 10-30% lighter than the untouched original. One filled outline has one
    // anti-aliased edge, like the original paint. The survivor follows the
    // authored curve to its 0.05 pt flattening tolerance; the clipped curve
    // was already cut to those chords on its outer side.
    const sourceIsFill = paperSource.paintMode === 'fill';
    return (
      <path
        key={key}
        d={paperSurvivorD}
        transform={transform}
        stroke="none"
        strokeWidth={0}
        fill={obj.fill || attrs.fill || (sourceIsFill ? paperSource.fill : paperSource.stroke)}
        fillRule="evenodd"
        opacity={attrs.opacity}
        shapeRendering="geometricPrecision"
        style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
      />
    );
  }

  return (
    <path
      key={key}
      d={d}
      transform={transform}
      stroke={erased ? 'none' : attrs.stroke}
      strokeWidth={erased ? 0 : attrs.strokeWidth}
      fill={erased ? obj.fill : attrs.fill}
      fillRule={erased ? 'evenodd' : attrs.fillRule}
      opacity={attrs.opacity}
      strokeLinecap={attrs.strokeLinecap}
      strokeLinejoin={attrs.strokeLinejoin}
      strokeMiterlimit={attrs.strokeMiterlimit}
      strokeDasharray={attrs.strokeDasharray?.join(' ')}
      strokeDashoffset={attrs.strokeDashoffset}
      vectorEffect={attrs.vectorEffect}
      shapeRendering="geometricPrecision"
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

  const key = `rect-${obj.id || obj.annotationId || index}`;
  const shapeId = obj.id || obj.pdfAnnotationId || obj.annotationId || key;
  __logShapeRender(obj, 'rect');

  // Zoom-position fix (BUG 2): position the rect via a transform CHAIN
  // (translate → rotate-about-local-center) with the rect drawn at the local
  // origin (x=0, y=0), instead of absolute x/y SVG attributes. Pen strokes
  // (renderPath/renderLine) and cloud rects above already position this way,
  // and absolute-x/y elements do not ride the parent `transform: scale(liveZoom)`
  // consistently through a zoom gesture — they drift while transform-chained
  // elements hold position. This is a positioning-MECHANISM change only:
  //   old: rect @ (left,top,w,h) + rotate(angle, left+w/2, top+h/2)
  //   new: rect @ (0,0,w,h)     + translate(left,top) rotate(angle, w/2, h/2)
  // which is the identical world geometry at rest and at any angle.
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const positionTransform = `translate(${left}, ${top})${
    obj.angle ? ` rotate(${obj.angle}, ${effectiveWidth / 2}, ${effectiveHeight / 2})` : ''
  }`;

  if (isStickyNoteGlyphObject(obj)) {
    const glyph = buildStickyNoteGlyphSpec({ width: effectiveWidth, height: effectiveHeight });
    const linePath = glyph.textLines
      .map((line) => `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`)
      .join(' ');
    const outline = stickyNoteOutlineColor(obj.fill);
    const glyphStrokeWidth = Math.max(1, Math.min(effectiveWidth, effectiveHeight) * 0.06);
    return (
      <g
        key={key}
        transform={positionTransform}
        data-shape-id={shapeId}
        data-shape-kind="sticky-note"
        onClick={__shapeClick}
      >
        <path
          d={glyph.bubblePath}
          fill={obj.fill || '#ffeb3b'}
          stroke={outline}
          strokeWidth={glyphStrokeWidth}
          strokeLinejoin="round"
        />
        <path
          d={linePath}
          fill="none"
          stroke={outline}
          strokeWidth={glyphStrokeWidth}
          strokeLinecap="round"
        />
      </g>
    );
  }

  // UX 2026-04-21: Revision-cloud rectangles rebuild their scalloped path
  // from the current effective box size on every render. That way when the
  // user resizes the cloud, more humps appear as the box grows and fewer as
  // it shrinks — matching how Bluebeam, Acrobat, and similar pro tools
  // behave. The data.pdfCloudIntensity signal (set at import) is what
  // flags a box as a cloud; the original baked path is ignored.
  const cloudSpec = resolveAnnotationCloudSpec(obj);
  const cloudGeometry = cloudSpec ? resolveCloudAnnotationGeometry(obj) : null;
  if (cloudGeometry) {
    return (
      <CloudOutline
        key={key}
        shapeId={shapeId}
        shapeKind="cloud-rect"
        geometryKind={cloudSpec.kind}
        geometry={cloudGeometry}
        fill={obj.fill}
        stroke={obj.stroke}
        opacity={obj.opacity ?? 1}
        multiply={obj.globalCompositeOperation === 'multiply'}
        onClick={__shapeClick}
      />
    );
  }

  const inset = !isHighlight && shouldInsetStroke(obj);
  const clipId = inset ? `clip-${shapeId}` : undefined;

  // UX 2026-04-21: honor the Border Style picker's "dashed" choice by
  // mapping Fabric's strokeDashArray onto the SVG strokeDasharray attr.
  // Cloud rects skip this path entirely (cloud + dashed are mutually
  // exclusive in the picker), so we only need to emit it here on the
  // straight-stroke outline. Empty/missing arrays render solid.
  const dashArrayAttr = Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.join(' ')
    : undefined;

  // Owner Test 15 (2026-10-02): a see-through border over a fill - the fill
  // stops at the stroke's inner edge (shapeFillKnockout.js). The stroke keeps
  // the exact rect it has below (inset contract or centred), so its outer
  // edge does not move.
  if (shouldKnockOutShapeFill({ fill: obj.fill, stroke: obj.stroke, strokeWidth: obj.strokeWidth })) {
    const knockSw = Math.max(0, Number(obj.strokeWidth) || 0);
    const off = inset ? knockSw / 2 : 0;
    return (
      <KnockoutRect
        key={key}
        x={off}
        y={off}
        width={Math.max(0, effectiveWidth - 2 * off)}
        height={Math.max(0, effectiveHeight - 2 * off)}
        transform={positionTransform}
        fill={obj.fill}
        stroke={obj.stroke}
        strokeWidth={knockSw}
        strokeDasharray={dashArrayAttr}
        opacity={obj.opacity ?? 1}
        style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
        shapeId={shapeId}
        shapeKind="rect"
        onClick={__shapeClick}
      />
    );
  }

  const rectEl = (
    <rect
      x={0}
      y={0}
      width={effectiveWidth}
      height={effectiveHeight}
      transform={positionTransform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 0}
      strokeDasharray={dashArrayAttr}
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
  // BUG 2: transform-chain positioning — the translate in positionTransform
  // already places the box at (left, top), so the inset shrink is expressed in
  // LOCAL coords (sw/2 from the local origin) instead of absolute (left+sw/2).
  // World result is identical to the previous absolute-x/y version at rest.
  const shrunkL = sw / 2;
  const shrunkT = sw / 2;
  const shrunkW = Math.max(0, effectiveWidth - sw);
  const shrunkH = Math.max(0, effectiveHeight - sw);
  return (
    <rect
      key={key}
      x={shrunkL}
      y={shrunkT}
      width={shrunkW}
      height={shrunkH}
      transform={positionTransform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={sw}
      strokeDasharray={dashArrayAttr}
      opacity={obj.opacity ?? 1}
      data-shape-id={shapeId}
      data-shape-kind="rect"
      onClick={__shapeClick}
    />
  );
};

export const renderTextMarkup = (obj, index) => {
  const data = obj?.data || {};
  const type = String(data.markupType || obj?.exportType || '').toLowerCase();
  const quads = Array.isArray(data.quads) ? data.quads : [];
  if (data.type !== 'text-markup' || quads.length === 0) return null;
  const color = (obj.fill && obj.fill !== 'transparent' ? obj.fill : null)
    || (obj.stroke && obj.stroke !== 'transparent' ? obj.stroke : null)
    || '#f4d35e';
  const opacity = Math.max(0, Math.min(1, Number(obj.opacity ?? 0.3)));
  const key = `text-markup-${obj.id || data.id || index}`;
  const shapeId = obj.id || data.id || key;
  // UX: authored weights must survive import, including strokes below our default.
  const lineWidth = Number.isFinite(data.lineWidth) ? Math.max(0, data.lineWidth) : 1.2;

  const isUnappliedImportedRedaction = type === 'redact'
    && obj?.isPdfImported
    && data.applied !== true;
  if (type === 'highlight' || type === 'redact') {
    const d = quads.map((q) => (
      `M ${q.x1} ${q.y1} L ${q.x2} ${q.y2} L ${q.x4} ${q.y4} L ${q.x3} ${q.y3} Z`
    )).join(' ');
    return (
      <path
        key={key}
        d={d}
        fill={isUnappliedImportedRedaction ? 'none' : type === 'redact' ? '#000000' : color}
        stroke={isUnappliedImportedRedaction ? UNAPPLIED_REDACTION_WARNING_COLOR : undefined}
        strokeWidth={isUnappliedImportedRedaction ? lineWidth : undefined}
        fillRule="nonzero"
        opacity={type === 'redact' ? 1 : opacity}
        style={data.overlapMode === 'layered' ? { mixBlendMode: 'multiply' } : undefined}
        data-shape-id={shapeId}
        data-shape-kind={`text-markup-${type}`}
        data-overlap-mode={data.overlapMode || 'layered'}
      />
    );
  }

  if (type === 'link' && obj?.isPdfImported) return null;

  const paths = quads.map((q) => {
    const height = Math.max(1, Math.hypot(q.x3 - q.x1, q.y3 - q.y1));
    // PDF underline imports paint a thin rect whose center sits just inside
    // the text quad. Match that baseline instead of putting our stroke center
    // on the quad edge, which left the whole stroke too far below the text.
    const underlineInset = type === 'underline'
      ? getTextMarkupUnderlineInset(obj, height, lineWidth)
      : 0;
    const startX = type === 'strikeout' ? (q.x1 + q.x3) / 2 : q.x3;
    const startY = type === 'strikeout' ? (q.y1 + q.y3) / 2 : q.y3 - underlineInset;
    const endX = type === 'strikeout' ? (q.x2 + q.x4) / 2 : q.x4;
    const endY = type === 'strikeout' ? (q.y2 + q.y4) / 2 : q.y4 - underlineInset;
    if (type !== 'squiggly') return `M ${startX} ${startY} L ${endX} ${endY}`;
    const length = Math.max(1, Math.hypot(endX - startX, endY - startY));
    const ux = (endX - startX) / length;
    const uy = (endY - startY) / length;
    const nx = -uy;
    const ny = ux;
    const amplitude = Math.max(0.7, Math.min(1.8, height * 0.12));
    const segments = Math.max(6, Math.ceil(length / 2.5));
    let d = `M ${startX} ${startY}`;
    for (let i = 1; i <= segments; i += 1) {
      const along = length * i / segments;
      const wave = i % 2 === 0 ? -amplitude : amplitude;
      d += ` L ${startX + ux * along + nx * wave} ${startY + uy * along + ny * wave}`;
    }
    return d;
  }).join(' ');
  return (
    <path
      key={key}
      d={paths}
      fill="none"
      stroke={color}
      strokeWidth={lineWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      data-shape-id={shapeId}
      data-shape-kind={`text-markup-${type}`}
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
    case 'diamond': return <polygon {...spec.polygon} />;
    case 'square': return <polygon {...spec.polygon} />;
    case 'slash': return <line {...spec.line} />;
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

  // UX 2026-04-20: rotate around the CURVE-INCLUSIVE BBOX CENTER. Matches
  // what the user perceives as "the middle of the selection frame" for
  // both straight and curved lines, and it is the same pivot the
  // SVGSelectionOverlay uses by default, the resize math uses for its
  // rotation-aware anchor projection, and (with compensation) the
  // endpoint + midpoint drag handlers use to keep the non-dragged
  // points pinned in world. Curve extrema are included so a bent line
  // pivots around the visual center of the bent shape instead of the
  // straight chord midpoint, otherwise the selection frame would
  // rotate around a point noticeably off-center to the user. Derived
  // from getLineEndpoints so both Fabric-constructed and PDF-imported
  // line storage conventions resolve to the correct absolute points.
  const angle = obj.angle ?? 0;
  let rotateTransform;
  let pivotDiag = null;
  if (angle !== 0) {
    const rawEp = getLineEndpoints(obj);
    const midPt = obj.data?.midpoint;
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
    rotateTransform = `rotate(${angle}, ${cx}, ${cy})`;
    pivotDiag = { angle, cx, cy };
  }

  // UX 2026-04-20 diag: emit the renderer's choice of pivot + spec kind
  // + arrowhead presence per line render, throttled ~6x/sec per object
  // via the same clock used by getLineBBox. Pairs with [LineBboxDiag]
  // so the user can hand back one log slice and we can see whether the
  // render pivot and the selection-bbox pivot agreed at that moment —
  // the common source of frame-vs-shape drift.
  if (globalThis?.__LINE_BBOX_DIAG) try {
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!renderLine._lastLog) renderLine._lastLog = new Map();
    const rid = obj && obj.id != null ? obj.id : (obj ? obj : null);
    const keyForMap = rid ?? `idx:${index}`;
    const last = renderLine._lastLog.get(keyForMap) || 0;
    if (nowMs - last >= 150) {
      renderLine._lastLog.set(keyForMap, nowMs);
      const payload = {
        ts: new Date().toISOString(),
        objId: obj?.id ?? null,
        index,
        objType: obj?.type ?? null,
        tool: obj?.tool ?? null,
        isArrow,
        angle,
        hasMidpoint: !!obj?.data?.midpoint,
        dataMidpoint: obj?.data?.midpoint ? { x: obj.data.midpoint.x, y: obj.data.midpoint.y } : null,
        storageSnapshot: {
          left: obj?.left ?? null,
          top: obj?.top ?? null,
          width: obj?.width ?? null,
          height: obj?.height ?? null,
          x1: obj?.x1 ?? null,
          y1: obj?.y1 ?? null,
          x2: obj?.x2 ?? null,
          y2: obj?.y2 ?? null,
        },
        specKind: spec?.kind ?? null,
        specLine: spec?.line ? { x1: spec.line.x1, y1: spec.line.y1, x2: spec.line.x2, y2: spec.line.y2 } : null,
        specArrowheadKind: spec?.arrowhead?.kind ?? null,
        rotationApplied: !!rotateTransform,
        pivotDiag,
      };
      console.log('[LineBboxDiag] renderLine ' + JSON.stringify(payload));
    }
  } catch (err) { /* swallow diag errors */ }

  // UX 2026-04-21: Border Style picker dashed support. Apply strokeDasharray
  // only to the main line/curve outline — arrowheads (filled or open
  // triangles, v-shapes, etc.) must stay solid so the tip still reads as a
  // crisp arrow even when the shaft is dashed. React merges this prop
  // AFTER {...spec.line}/{...spec.path} so it doesn't clobber anything
  // else in the spec.
  const lineDashArrayAttr = Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.join(' ')
    : undefined;

  if (spec.kind === 'curved') {
    // UX: Curved line/arrow — <path> + optional arrowhead inside <g>.
    // fill='none' on <path> is CRITICAL (Pitfall 5) — otherwise the bezier
    // fills black between the curve and the start-to-end chord. Emitted
    // explicitly by buildLineRenderSpec.
    return (
      <g key={key} opacity={opacity} transform={rotateTransform}>
        <path {...spec.path} strokeDasharray={lineDashArrayAttr} />
        {renderArrowheadFromSpec(spec.startArrowhead || { kind: 'none' })}
        {renderArrowheadFromSpec(spec.arrowhead)}
      </g>
    );
  }

  // Straight branch — byte-identical to pre-Phase-15 when no data.midpoint
  // and no rotation. A rotation wrapper is added whenever obj.angle !== 0.
  if (spec.arrowhead.kind !== 'none' || spec.startArrowhead?.kind !== 'none') {
    return (
      <g key={key} opacity={opacity} transform={rotateTransform}>
        <line {...spec.line} strokeDasharray={lineDashArrayAttr} />
        {renderArrowheadFromSpec(spec.startArrowhead || { kind: 'none' })}
        {renderArrowheadFromSpec(spec.arrowhead)}
      </g>
    );
  }
  if (rotateTransform) {
    return (
      <g key={key} transform={rotateTransform}>
        <line {...spec.line} strokeDasharray={lineDashArrayAttr} opacity={opacity} />
      </g>
    );
  }
  return <line key={key} {...spec.line} strokeDasharray={lineDashArrayAttr} opacity={opacity} />;
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

  // Child types compare case-insensitively: fabric 7's toObject() emits
  // capitalized class names ('Line', 'Triangle'), so a legacy arrow group
  // that round-trips once through an edit/eraser canvas would otherwise
  // stop matching here and vanish from the SVG while the canvas painter
  // (which lowercases child types) still draws it.
  const childType = (o) => String(o?.type || '').toLowerCase();
  const lineChild = obj.objects.find(
    (o) => o && (childType(o) === 'line' || childType(o) === 'polyline' || childType(o) === 'path')
  );
  const arrowHead = obj.objects.find(
    (o) => o && (o.name === 'arrowHead' || childType(o) === 'triangle')
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

  // UX 2026-04-21: dashed support on the arrow's shaft only — the polygon
  // arrowhead below is a filled tip and must stay solid regardless of
  // strokeDashArray so the arrow still reads as a crisp pointer.
  const arrowDashArrayAttr = Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.join(' ')
    : undefined;

  return (
    <g key={key} opacity={obj.opacity ?? 1}>
      <line
        x1={x1}
        y1={y1}
        x2={lineEndX}
        y2={lineEndY}
        stroke={obj.stroke || '#000'}
        strokeWidth={obj.strokeWidth || 2}
        strokeDasharray={arrowDashArrayAttr}
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
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of obj.points) {
    const x = toNumber(p?.x), y = toNumber(p?.y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rawCenterX = (minX + maxX) / 2;
  const rawCenterY = (minY + maxY) / 2;
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

  // UX 2026-04-21 / 2026-09-09: Cloud-polygons rebuild scalloped geometry from
  // the live points on every render, same pattern as cloud-rects. Any Fabric
  // scale is baked into the vertices BEFORE the engine runs (a group resize or
  // an imported scale re-fits constant-size crowns exactly as the studio's
  // resize does) and the <g> carries translate + rotate only — never scale,
  // which would stretch every crown. A vertex drag replays the studio's
  // moveVertex memory (data.pdfCloudVertexState) through the same resolver.
  const cloudSpec = resolveAnnotationCloudSpec(obj);
  const cloudGeometry = cloudSpec ? resolveCloudAnnotationGeometry(obj) : null;
  if (cloudGeometry) {
    return (
      <CloudOutline
        key={key}
        shapeId={shapeId}
        shapeKind="cloud-polygon"
        geometryKind={cloudSpec.kind}
        geometry={cloudGeometry}
        fill={obj.fill}
        stroke={obj.stroke}
        opacity={obj.opacity ?? 1}
        multiply={obj.globalCompositeOperation === 'multiply'}
        onClick={__shapeClick}
      />
    );
  }

  // 2026-04-17: inset-clip disabled for polygon — the clipPath + polygon +
  // nested-translate transform combination renders as invisible in Chromium
  // even when wrapped in <g transform>. The fill-bleed fix (2026-04-16) is
  // restored here to the pre-clip state so PDF-imported polygons remain
  // visible. Re-apply a stroke-inset fix for polygons via a different
  // mechanism (e.g. pre-transformed absolute points, or paint-order + fill
  // + transparent stroke) once a non-clipPath approach is proven.
  // UX 2026-04-21: Border Style picker dashed support. Cloud polygons go
  // through the path branch above (cloud + dashed mutually exclusive), so
  // we only emit strokeDasharray on the plain polygon outline here.
  const polyDashArrayAttr = Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.join(' ')
    : undefined;

  // Owner Test 15 (2026-10-02): a see-through border over a fill - the fill
  // is masked off under the stroke band (shapeFillKnockout.js), round joins
  // like the stroke.
  if (shouldKnockOutShapeFill({ fill: obj.fill, stroke: obj.stroke, strokeWidth: obj.strokeWidth || 1 })) {
    return (
      <KnockoutMaskedShape
        key={key}
        tag="polygon"
        geometry={{ points: pointsStr }}
        bounds={{ minX, minY, maxX, maxY }}
        transform={transform}
        fill={obj.fill}
        stroke={obj.stroke}
        strokeWidth={Number(obj.strokeWidth) || 1}
        strokeDasharray={polyDashArrayAttr}
        strokeLinejoin="round"
        opacity={obj.opacity ?? 1}
        style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
        shapeId={shapeId}
        shapeKind="polygon"
        onClick={__shapeClick}
      />
    );
  }

  return (
    <polygon
      key={key}
      points={pointsStr}
      transform={transform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 1}
      strokeDasharray={polyDashArrayAttr}
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
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of obj.points) {
    const x = toNumber(p?.x), y = toNumber(p?.y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rawCenterX = (minX + maxX) / 2;
  const rawCenterY = (minY + maxY) / 2;
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

  // UX 2026-09-09: an OPEN polyline can carry the Cloud style too - it traces a
  // run of scallops along the path and stops with a rounded tail at each end,
  // exactly as the approved studio draws an open cloud. Same live-rebuild rule
  // as cloud rects and cloud polygons: the crowns are recomputed from the
  // current points every render, so dragging a vertex re-fits them in frame.
  // No fill body - an open path has no interior to fill.
  const plCloudSpec = resolveAnnotationCloudSpec(obj);
  const plCloudGeometry = plCloudSpec ? resolveCloudAnnotationGeometry(obj) : null;
  if (plCloudGeometry) {
    return (
      <CloudOutline
        key={key}
        shapeId={shapeId}
        shapeKind="cloud-polyline"
        geometryKind={plCloudSpec.kind}
        geometry={plCloudGeometry}
        fill={null}
        stroke={obj.stroke || '#000'}
        opacity={obj.opacity ?? 1}
        multiply={obj.globalCompositeOperation === 'multiply'}
        onClick={__shapeClick}
      />
    );
  }

  // UX 2026-04-21: Border Style picker dashed support for open polylines.
  const plDashArrayAttr = Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length > 0
    ? obj.strokeDashArray.join(' ')
    : undefined;

  // Endings resolve through the shared resolver (imported /LE incl. the
  // interior-colour rule) and the body's first / last segment is pulled back
  // so it stops at the edge of a hollow ending — same rule as lines, and the
  // print flattener uses the same helpers.
  const { startStyle: plStartStyle, endStyle: plEndStyle, interiorColor: plInterior } = resolveLineEndingStyles(obj);
  const plHeadOptions = { fill: plInterior };
  const first = obj.points[0];
  const second = obj.points[1];
  const beforeLast = obj.points[obj.points.length - 2];
  const last = obj.points[obj.points.length - 1];
  const stroke = obj.stroke || '#000';
  const strokeWidth = obj.strokeWidth || 1;
  const bodyPointsStr = insetOpenPolylinePoints(
    obj.points,
    lineEndingBodyInset(plStartStyle, strokeWidth),
    lineEndingBodyInset(plEndStyle, strokeWidth),
  ).map((p) => `${p.x},${p.y}`).join(' ');
  const startSpec = buildArrowheadRenderSpec(
    plStartStyle,
    toNumber(first?.x),
    toNumber(first?.y),
    Math.atan2(toNumber(first?.y) - toNumber(second?.y), toNumber(first?.x) - toNumber(second?.x)) * 180 / Math.PI,
    stroke,
    strokeWidth,
    plHeadOptions,
  );
  const endSpec = buildArrowheadRenderSpec(
    plEndStyle,
    toNumber(last?.x),
    toNumber(last?.y),
    Math.atan2(toNumber(last?.y) - toNumber(beforeLast?.y), toNumber(last?.x) - toNumber(beforeLast?.x)) * 180 / Math.PI,
    stroke,
    strokeWidth,
    plHeadOptions,
  );
  const body = (
    <polyline
      points={bodyPointsStr}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={plDashArrayAttr}
      opacity={obj.opacity ?? 1}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-shape-id={shapeId}
      data-shape-kind="polyline"
      onClick={__shapeClick}
    />
  );
  if (startSpec.kind === 'none' && endSpec.kind === 'none') {
    return React.cloneElement(body, { key, transform });
  }
  return (
    <g key={key} transform={transform} opacity={obj.opacity ?? 1}>
      {React.cloneElement(body, { opacity: 1 })}
      {renderArrowheadFromSpec(startSpec)}
      {renderArrowheadFromSpec(endSpec)}
    </g>
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

  // UX 2026-09-09: ellipse and circle annotations take the Cloud border style
  // like rectangles do. The approved engine fits the scallops to the ellipse
  // itself (not its bounding box) from the four box corners, and rebuilds them
  // from the LIVE rx/ry every render, so resizing adds/removes humps in frame
  // instead of stretching a baked path. Fill = the whole scalloped region,
  // edge = the engine outline stroked with fill:none (CloudOutline contract).
  const ellipseCloudSpec = resolveAnnotationCloudSpec(obj);
  const ellipseCloudGeometry = ellipseCloudSpec ? resolveCloudAnnotationGeometry(obj) : null;
  if (ellipseCloudGeometry) {
    return (
      <CloudOutline
        key={key}
        shapeId={shapeId}
        shapeKind="cloud-ellipse"
        geometryKind={ellipseCloudSpec.kind}
        geometry={ellipseCloudGeometry}
        fill={obj.fill}
        stroke={obj.stroke}
        opacity={obj.opacity ?? 1}
        multiply={obj.globalCompositeOperation === 'multiply'}
        onClick={__shapeClick}
      />
    );
  }

  const rotateTransform = obj.angle ? `rotate(${obj.angle}, ${cx}, ${cy})` : undefined;
  const inset = !isHighlight && shouldInsetStroke(obj);
  const clipId = inset ? `clip-${shapeId}` : undefined;

  // Owner Test 15 (2026-10-02): a see-through border over a fill - the fill
  // is masked off under the stroke band (shapeFillKnockout.js); the stroke
  // keeps the exact radii it has below, so its outer edge does not move.
  if (shouldKnockOutShapeFill({ fill: obj.fill, stroke: obj.stroke, strokeWidth: obj.strokeWidth })) {
    const knockSw = Math.max(0, Number(obj.strokeWidth) || 0);
    const off = inset ? knockSw / 2 : 0;
    const krx = Math.max(0, rx - off);
    const kry = Math.max(0, ry - off);
    return (
      <KnockoutMaskedShape
        key={key}
        tag="ellipse"
        geometry={{ cx, cy, rx: krx, ry: kry }}
        bounds={{ minX: cx - krx, minY: cy - kry, maxX: cx + krx, maxY: cy + kry }}
        transform={rotateTransform}
        fill={obj.fill}
        stroke={obj.stroke}
        strokeWidth={knockSw}
        strokeDasharray={Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length ? obj.strokeDashArray.join(' ') : undefined}
        opacity={obj.opacity ?? 1}
        style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
        shapeId={shapeId}
        shapeKind="ellipse"
        onClick={__shapeClick}
      />
    );
  }

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
      strokeDasharray={Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length ? obj.strokeDashArray.join(' ') : undefined}
      opacity={obj.opacity ?? 1}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
      data-shape-id={shapeId}
      data-shape-kind="ellipse"
      onClick={__shapeClick}
    />
  );

  if (!inset) return React.cloneElement(ellEl, { key });

  // UX 2026-04-22: shrink rx/ry by strokeWidth/2 so the outer edge of the
  // centered stroke lands at the original (cx, cy, rx, ry) bounds. Matches
  // the rect inset approach (renderRect :334-365). The prior clipPath +
  // transform composition worked at 0° but visibly clipped the tilted
  // ellipse's fill once obj.angle was non-zero — the clipPath's own rotate
  // transform doesn't compose with the clipped element's transform the way
  // Safari / Chromium paint rotated content, so the visible ellipse got
  // cropped by an axis-aligned bbox mask. Shrink-instead-of-clip sidesteps
  // the issue entirely and works at every angle, matching how rect behaves.
  const sw = Math.max(0, Number(obj.strokeWidth) || 0);
  const shrunkRx = Math.max(0, rx - sw / 2);
  const shrunkRy = Math.max(0, ry - sw / 2);
  return (
    <ellipse
      key={key}
      cx={cx}
      cy={cy}
      rx={shrunkRx}
      ry={shrunkRy}
      transform={rotateTransform}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={sw}
      strokeDasharray={Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length ? obj.strokeDashArray.join(' ') : undefined}
      opacity={obj.opacity ?? 1}
      data-shape-id={shapeId}
      data-shape-kind="ellipse"
      onClick={__shapeClick}
    />
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
/**
 * THE text-content style contract — single source of truth for how annotation
 * text lays out, shared by the SVG view renderers AND the same-surface text
 * editor (TextEditOverlay). Caret/glyph alignment depends on the editor and
 * the view feeding IDENTICAL style objects into the same CSS engine, so
 * neither may fork these fields locally. Two variants exist because plain
 * text and callout text historically diverge (kerning/rendering flags,
 * decoration support); each mirrors its renderer exactly.
 */
export const buildPlainTextContentStyle = ({
  innerWidth,
  innerDisplayHeight,
  fontSize,
  fontFamily,
  fontWeight,
  fontStyle,
  color,
  textAlign,
  verticalAlign,
  underline,
  linethrough,
  lineHeight,
}) => ({
  width: innerWidth,
  height: innerDisplayHeight,
  fontSize: `${fontSize}px`,
  fontFamily: fontFamily || 'sans-serif',
  fontWeight: fontWeight || 'normal',
  fontStyle: fontStyle || 'normal',
  color: color || '#000',
  textAlign: textAlign || 'left',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: (() => {
    const v = verticalAlign || 'top';
    return v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
  })(),
  textDecoration: [
    underline ? 'underline' : null,
    linethrough ? 'line-through' : null,
  ].filter(Boolean).join(' ') || 'none',
  lineHeight: (lineHeight || 1.16) * 1.13,
  overflow: 'hidden',
  wordWrap: 'break-word',
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
  padding: 0,
});

export const buildCalloutTextContentStyle = ({
  innerWidth,
  boxHeightWithDescenders,
  textAlign,
  fontSize,
  fontFamily,
  fontWeight,
  fontStyle,
  underline,
  linethrough,
  color,
  lineHeight,
}) => ({
  width: Math.max(0, innerWidth),
  height: Math.max(0, boxHeightWithDescenders),
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  textAlign: textAlign || 'left',
  fontKerning: 'none',
  textRendering: 'geometricPrecision',
  fontVariantLigatures: 'none',
  fontSize: `${fontSize || 12}px`,
  fontFamily,
  // UX (2026-07-17): bold/italic/underline/strikethrough now RENDER on the
  // committed callout, matching buildPlainTextContentStyle. The toolbar
  // toggles stored these flags all along but the view dropped them, so text
  // visibly lost its styling the moment the user left edit mode.
  fontWeight: fontWeight || 'normal',
  fontStyle: fontStyle || 'normal',
  textDecoration: [
    underline ? 'underline' : null,
    linethrough ? 'line-through' : null,
  ].filter(Boolean).join(' ') || 'none',
  color: color || '#000',
  overflow: 'hidden',
  wordWrap: 'break-word',
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
  boxSizing: 'border-box',
  padding: 0,
  lineHeight: (lineHeight || 1) * 1.13,
});

export const renderText = (obj, index, liveBounds = null, hideText = false) => {
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
  // Add buffer for descenders (j,p,g,q,y) + bottom breathing room.
  // During edit, liveBounds carries the current toolbar font size.
  const fontSize = (liveBounds && Number.isFinite(Number(liveBounds.fontSize)) && Number(liveBounds.fontSize) > 0)
    ? Number(liveBounds.fontSize)
    : (obj.fontSize || 16);
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
  // Zoom-position fix (BUG 2): position the whole textbox via a transform
  // CHAIN on the wrapper <g> — translate(left, top) then rotate about the
  // LOCAL logical center — and draw every child (bg rect, border rect,
  // foreignObject) in LOCAL coords (origin 0,0) instead of absolute x/y SVG
  // attributes. Pen strokes (renderPath/renderLine) position this way; absolute
  // x/y elements do not ride the parent `transform: scale(liveZoom)` consistently
  // during a zoom gesture, so highlights/textboxes drifted while pen strokes held.
  //   old: children @ absolute (left+…, top+…) + rotate(angle, left+w/2, top+h/2)
  //   new: children @ local (0+…, 0+…)          + translate(left,top) rotate(angle, w/2, h/2)
  // which is identical world geometry at rest and at any angle.
  //
  // UX 2026-04-20 (preserved): rotate around the textbox's logical center, NOT the
  // displayHeight center (which adds descenderBuffer / 2 below the logical
  // center). The live-preview wrapper + selection overlay both pivot around
  // bbox center (left + width/2, top + height/2), so renderText must too,
  // otherwise the text snaps vertically/horizontally on release when the
  // commit angle swaps the outer wrapper rotation for renderText's own.
  const positionTransform = `translate(${left}, ${top})${
    angle !== 0 ? ` rotate(${angle}, ${effectiveWidth / 2}, ${effectiveHeight / 2})` : ''
  }`;

  // w43 (2026-09-26, owner request): a text box whose line style is Cloud
  // draws its border as the house revision cloud - the same rectangle cloud a
  // clouded rect draws (utils/textCloudBorder.js) - in this group's LOCAL
  // frame (the group already carries translate + rotate + opacity). Its
  // background fills the scalloped region, humps included, like a filled
  // cloud rect; the text keeps its box.
  const cloudBorder = textboxCloudStandIn(obj, { left: 0, top: 0, width: effectiveWidth, height: effectiveHeight });
  if (cloudBorder) {
    cloudBorder.angle = 0;
    cloudBorder.opacity = 1;
  }
  const cloudBorderGeometry = cloudBorder && resolveAnnotationCloudSpec(cloudBorder)
    ? resolveCloudAnnotationGeometry(cloudBorder)
    : null;

  return (
    <g key={key} opacity={obj.opacity ?? 1} transform={positionTransform}>
      {cloudBorderGeometry ? (
        <CloudOutline
          shapeId={obj.id || key}
          shapeKind="cloud-text-border"
          geometryKind="rectangle"
          geometry={cloudBorderGeometry}
          fill={cloudBorder.fill}
          stroke={cloudBorder.stroke}
          opacity={1}
        />
      ) : null}
      {!cloudBorderGeometry && obj.backgroundColor && obj.backgroundColor !== 'transparent' ? (
        // Owner Test 15 (2026-10-02): under a see-through border the
        // background stops at the border's inner edge (shapeFillKnockout.js).
        <rect
          {...(obj.strokeWidth > 0 && obj.stroke && shouldKnockOutShapeFill({
            fill: obj.backgroundColor, stroke: obj.stroke, strokeWidth: obj.strokeWidth,
          })
            ? { ...insetRectForFill({ x: 0, y: 0, width: effectiveWidth, height: effectiveHeight }, obj.strokeWidth), 'data-knockout-fill': 'true' }
            : { x: 0, y: 0, width: effectiveWidth, height: effectiveHeight })}
          fill={obj.backgroundColor}
        />
      ) : null}
      {/* Border rect: drawn only when the textbox carries a positive strokeWidth.
          PDF-imported FreeText annotations with BS.W>0 (see
          pdfAnnotationImporter.convertFreeTextToFabricTextbox) and user-created
          textboxes (FabricTextCanvas/FabricEditCanvas default: 1px black) both
          land here. Textboxes with strokeWidth=0 render borderless. Uses
          effectiveHeight (not displayHeight with descenderBuffer) so the border
          hugs Fabric's logical bounds and matches the eraser-canvas render. */}
      {!cloudBorderGeometry && obj.strokeWidth > 0 && obj.stroke ? (
        <rect
          x={0}
          y={0}
          width={effectiveWidth}
          height={effectiveHeight}
          fill="none"
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          data-stroke-uniform={obj.strokeUniform ? 'true' : undefined}
        />
      ) : null}
      {!hideText && (
      <foreignObject
        // UX 2026-04-20: force remount whenever the logical line count or
        // the foreignObject's pixel height changes. Chromium's foreignObject
        // does not reliably re-layout its inner HTML when width/height
        // attributes change dynamically, so a line typed past the imported
        // height ended up clipped against the originally-laid-out inner box.
        // Re-keying makes React mount a fresh foreignObject with the new
        // dimensions, forcing the browser to lay out from scratch.
        key={`fo-${Math.round(innerDisplayHeight)}-${(displayedText || '').length}`}
        data-annotation-text-bounds=""
        x={pad}
        y={pad}
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
          // Style contract lives in buildPlainTextContentStyle (top of file) —
          // shared verbatim with the same-surface text editor so caret and
          // glyphs can never disagree. Historical rationale for the individual
          // fields (explicit px sizes for foreignObject, the ×1.13 Fabric line
          // step, break-all wrap parity, no font-smoothing overrides) lives in
          // git history at this site (Plan 15-04 / KAL-34 / 2026-04-19/20).
          style={buildPlainTextContentStyle({
            innerWidth,
            innerDisplayHeight,
            fontSize,
            fontFamily: (liveBounds && liveBounds.fontFamily) || obj.fontFamily,
            fontWeight: (liveBounds && liveBounds.fontWeight) || obj.fontWeight,
            fontStyle: (liveBounds && liveBounds.fontStyle) || obj.fontStyle,
            color: (liveBounds && liveBounds.fill) || obj.fill,
            textAlign: (liveBounds && liveBounds.textAlign) || obj.textAlign,
            verticalAlign: (liveBounds && liveBounds.verticalAlign) || obj.verticalAlign,
            underline: ((liveBounds && liveBounds.underline != null) ? liveBounds.underline : obj.underline),
            linethrough: ((liveBounds && liveBounds.linethrough != null) ? liveBounds.linethrough : obj.linethrough),
            lineHeight: obj.lineHeight,
          })}
        >
          {displayedText}
        </div>
      </foreignObject>
      )}
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

  // UX: 2026-05-18 — the visible textbox <rect> is drawn taller than the
  // stored textBox.height by `descenderBuffer` (fontSize * 0.35) so low-
  // hanging letters (g/j/p/q/y) clear the bottom border. The leader-line
  // connection math MUST use this same buffered height, otherwise it keeps
  // the line off the shorter (math-only) box and the line visibly bleeds
  // through the descender strip at the bottom of the box the user sees.
  const calloutFs = Number(callout.style?.fontSize || 12);
  const descenderBuffer = calloutFs * 0.35;
  const boxHeightWithDescenders = textBox.height + descenderBuffer;

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
    // UX: clamp against the buffered (visible) bottom edge, not the shorter
    // stored height — same reason as the connection math below.
    const boxBottom = textBox.y + boxHeightWithDescenders;
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
      textBox.x, textBox.y, textBox.width, boxHeightWithDescenders,
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
      case 'diamond': return <polygon {...arrowheadSpec.polygon} />;
      case 'square': return <polygon {...arrowheadSpec.polygon} />;
      case 'slash': return <line {...arrowheadSpec.line} />;
      default: return null;
    }
  };

  const key = `callout-${callout.id || index}`;

  // Shared stroke attributes for both connector line segments.
  // UX 2026-07-14 (zoom-scaling unification): page-unit stroke, no
  // vector-effect pin — the leader lines now thicken/thin with zoom exactly
  // like rect/ellipse strokes (and like this callout's own arrowhead and
  // text, which always scaled — the mismatch was the reported bug).
  const lineStyle = {
    stroke: lineColor,
    strokeWidth: lineThickness,
    strokeLinecap: 'round',
  };
  // UX (2026-07-17): leader line style — the toolbar's Style picker
  // (solid/dashed/dotted) now applies to callouts. Semantics follow the
  // shapes' precedent: on a rect the picker dashes the shape's outline, on a
  // line/arrow it dashes the shaft while the head stays solid. The callout is
  // both at once, so the dash applies to line1 + line2 AND the text-box
  // border, while the arrowhead stays solid (exactly like the arrow tool's
  // filled/open heads). Absent style.lineStyle renders solid — legacy
  // callouts unchanged. Page-unit dashes: they scale with zoom via the SVG
  // viewBox (locked zoom convention 2026-07-14; no non-scaling-stroke).
  const leaderDash = calloutLineDashArray(callout.style?.lineStyle);
  const leaderDashAttr = leaderDash ? leaderDash.join(' ') : undefined;
  if (leaderDashAttr) lineStyle.strokeDasharray = leaderDashAttr;

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
      {(() => {
        // UX: 2026-04-19 — give the visible box a descender buffer so letters
        // like j / g / p / y / q that hang below the baseline stay inside the
        // border instead of clipping against the bottom edge. Mirrors the
        // `descenderBuffer = fontSize * 0.35` approach used by renderText
        // for plain text annotations. Both the border rect and the inner
        // foreignObject grow together so the text anchor stays at the top
        // and the bottom stretches just enough to contain descenders.
        // UX 2026-04-20: the border rect always renders so the user sees
        // the growing box while editing. Only the inner text foreignObject
        // is gated by hideText — Fabric paints the live letters during
        // edit and the SVG copy would just create a ghost behind them.
        // w43 (2026-09-26, owner request): line style Cloud clouds ONLY the
        // text box - the house rectangle cloud (utils/textCloudBorder.js) on
        // the same visible box, border width and fill. The leaders above stay
        // straight and solid and the arrowhead stays a head
        // (calloutLineDashArray has no dash for 'cloud'). The plain rect is
        // kept, unpainted, as the textBox drag / hit surface.
        const boxCloud = calloutBoxCloudStandIn(callout, {
          x: textBox.x, y: textBox.y, width: textBox.width, height: boxHeightWithDescenders,
        }, {
          stroke: lineColor,
          strokeWidth: Math.max(1, lineThickness * 0.7),
          fill: colorWithAlpha(fillColor, fillOpacity),
        });
        const boxCloudGeometry = boxCloud && resolveAnnotationCloudSpec(boxCloud)
          ? resolveCloudAnnotationGeometry(boxCloud)
          : null;
        return (
        <>
          {boxCloudGeometry && (
            // The crowns stand past the box; a press on one acts on the text
            // box part (drag the box), the same as a press inside it.
            <g data-callout-part="textBox">
              <CloudOutline
                shapeId={callout.id || key}
                shapeKind="cloud-callout-box"
                geometryKind="rectangle"
                geometry={boxCloudGeometry}
                fill={boxCloud.fill}
                stroke={boxCloud.stroke}
                opacity={1}
              />
            </g>
          )}
          <rect
            // UX: data-callout-part='textBox' — Phase 14 drag target + Phase 17
            // collision clamp hit-test surface. (CALL-10)
            data-callout-part="textBox"
            data-callout-box-cloud={boxCloudGeometry ? 'true' : undefined}
            x={textBox.x}
            y={textBox.y}
            width={textBox.width}
            height={boxHeightWithDescenders}
            fill={boxCloudGeometry ? 'transparent' : fillColor}
            fillOpacity={boxCloudGeometry ? undefined : fillOpacity}
            stroke={boxCloudGeometry ? 'none' : lineColor}
            // UX 2026-07-14 (zoom-scaling unification): page-unit border that
            // scales with zoom (no vector-effect pin). The 0.7 ratio keeps the
            // box border visually lighter than the leader lines at any zoom.
            strokeWidth={Math.max(1, lineThickness * 0.7)}
            // UX (2026-07-17): box border shares the leader's line style —
            // shapes' precedent (the Style picker dashes a rect's outline).
            strokeDasharray={leaderDashAttr}
            rx={0}
            ry={0}
          />
          {!hideText && (
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
            // UX 2026-04-20: force remount when the callout box height or
            // text length changes. Chromium's foreignObject does not reliably
            // re-layout its inner HTML on dynamic attribute changes, so a
            // line typed past the imported callout height ended up clipped.
            // Re-keying makes React drop the stale foreignObject and mount a
            // fresh one, letting the browser lay out the grown box from
            // scratch so new lines become visible during live edit.
            key={`fo-callout-${Math.round(boxHeightWithDescenders)}-${((liveBounds && liveBounds.text) || callout.text || '').length}`}
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
              // Style contract lives in buildCalloutTextContentStyle (top of
              // file) — shared verbatim with the same-surface text editor so
              // caret and glyphs can never disagree. Field-level rationale
              // (explicit px sizes, flex-centering with descender buffer,
              // break-all wrap parity, ×1.13 line step) lives in git history
              // at this site (CALL-10 / Plan 15-04 / 2026-04-19/20).
              style={buildCalloutTextContentStyle({
                innerWidth: textBox.width - 2 * TEXT_PADDING,
                boxHeightWithDescenders,
                textAlign: callout.style?.textAlign,
                fontSize: callout.style?.fontSize,
                fontFamily: safeFontFamily,
                // UX (2026-07-17): style flags now render on the committed
                // callout to match the edit overlay — bold/italic/underline/
                // strikethrough were stored + round-tripped but never drawn,
                // so text silently "unstyled" itself on leaving edit mode.
                // Callout storage uses boolean flags (types.js
                // defaultCalloutStyle); map to CSS the same way freetext does.
                fontWeight: callout.style?.bold ? 'bold' : 'normal',
                fontStyle: callout.style?.italic ? 'italic' : 'normal',
                underline: !!callout.style?.underline,
                linethrough: !!callout.style?.strikethrough,
                color: callout.style?.fontColor || callout.style?.textColor,
                lineHeight: callout.style?.lineHeight,
              })}
            >
              {(liveBounds && typeof liveBounds.text === 'string')
                ? liveBounds.text
                : (callout.text || '')}
            </div>
          </foreignObject>
          )}
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
  const tipExtension = radius * 0.5;
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

  const labelLayout = getCounterLabelLayout(radius, displayNumber);
  const key = `counter-${obj.id || index}`;

  return (
    <g key={key} opacity={obj.opacity ?? 1}>
      <path d={pathD} fill={color} stroke="none" />
      <text
        x={centerX}
        y={centerY}
        fill={obj.data?.numberColor || '#ffffff'}
        fontSize={labelLayout.fontSize}
        fontWeight={700}
        fontFamily="-apple-system, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        pointerEvents="none"
        style={{ userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}
      >
        {displayNumber}
      </text>
    </g>
  );
};
export const UNAPPLIED_REDACTION_WARNING_COLOR = '#d0021b';
