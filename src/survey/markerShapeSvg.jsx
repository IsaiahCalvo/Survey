/**
 * markerShapeSvg.jsx — how a freehand / smart-fill Survey Marker paints on the
 * page's SVG layer (SVGAnnotationLayer's renderSurveyMarkerEntry).
 *
 * Everything is drawn in page units inside the page's viewBox, so zoom scales
 * it with no JavaScript (CLAUDE.md invariant). A plain box marker never comes
 * here — it keeps its <rect>.
 *
 * Look (owner 2026-10-13): a freehand marker is a highlighter stroke in the
 * marker's Entity colour (the same translucent colour, multiply blend, round
 * ends a highlighter has); a smart-fill marker is that colour filling its
 * outline (holes stay clear). With no Entity yet, the stroke is a soft blue
 * band and the outline a dashed blue line — the box marker's "needs an
 * Entity" look.
 */
import { getMarkerShape, markerShapePathData, projectMarkerShape } from './markerShapes.js';

export const MARKER_NEEDS_ENTITY_BLUE = '#4A90E2';
export const MARKER_FREEHAND_PREVIEW_COLOR = 'rgba(74, 144, 226, 0.35)';

/**
 * The marker's outline mapped onto the box it is drawn at right now (its live
 * move / resize preview included), or null for a plain box marker.
 * `bbox` is the layer's pseudo-rect: { left, top, width, height }.
 */
export function projectSurveyMarkerEntryShape(surveyMarker, bbox) {
  const shape = getMarkerShape(surveyMarker);
  if (!shape || !bbox) return null;
  const projected = projectMarkerShape(shape, {
    x: bbox.left,
    y: bbox.top,
    width: bbox.width,
    height: bbox.height,
  });
  if (!projected) return null;
  return { ...projected, d: markerShapePathData(projected) };
}

/** The visible paint. */
export function SurveyMarkerShapePaint({ projected, needsEntity, color, opacity = 1, transform }) {
  if (!projected?.d) return null;
  const multiply = { pointerEvents: 'none', mixBlendMode: 'multiply' };
  if (projected.type === 'stroke') {
    return (
      <path
        data-survey-marker-shape="stroke"
        d={projected.d}
        fill="none"
        stroke={needsEntity ? MARKER_FREEHAND_PREVIEW_COLOR : (color || 'rgba(255,235,59,0.25)')}
        strokeWidth={projected.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        transform={transform}
        style={multiply}
      />
    );
  }
  return (
    <path
      data-survey-marker-shape="polygon"
      d={projected.d}
      fillRule="evenodd"
      fill={needsEntity ? 'transparent' : (color || 'rgba(255,235,59,0.25)')}
      stroke={needsEntity ? MARKER_NEEDS_ENTITY_BLUE : 'none'}
      strokeWidth={needsEntity ? 2 : 0}
      strokeDasharray={needsEntity ? '5,5' : undefined}
      strokeLinejoin="round"
      opacity={opacity}
      transform={transform}
      style={multiply}
    />
  );
}

/** The hover glow — the same page-unit blue halo a box marker gets. */
export function SurveyMarkerShapeGlow({ projected, transform }) {
  if (!projected?.d) return null;
  return (
    <path
      d={projected.d}
      fill="none"
      stroke="#4a90e2"
      strokeOpacity={0.4}
      strokeWidth={projected.type === 'stroke' ? projected.width + 6 : 6}
      strokeLinecap="round"
      strokeLinejoin="round"
      transform={transform}
      style={{ pointerEvents: 'none' }}
    />
  );
}

/**
 * Props for the hit target: the outline itself takes the press, not its box,
 * so a press in the empty part of a freehand marker's box reaches what lies
 * under it. `hitBand` is the layer's minimum grab width (page units).
 */
export function surveyMarkerShapeHitProps(projected, { interactive, hitBand = 10 }) {
  if (projected.type === 'stroke') {
    return {
      d: projected.d,
      fill: 'none',
      stroke: 'rgba(0,0,0,0.001)',
      strokeWidth: Math.max(projected.width, hitBand),
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      pointerEvents: interactive ? 'stroke' : 'none',
    };
  }
  return {
    d: projected.d,
    fill: 'rgba(0,0,0,0.001)',
    fillRule: 'evenodd',
    stroke: 'rgba(0,0,0,0.001)',
    strokeWidth: hitBand / 2,
    pointerEvents: interactive ? 'all' : 'none',
  };
}
