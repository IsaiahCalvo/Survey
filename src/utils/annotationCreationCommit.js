/**
 * annotationCreationCommit.js — commit-JSON builders for SVG-native creation.
 *
 * The unified renderer draws creation previews inside SVGAnnotationLayer and
 * commits page JSON directly (no Fabric canvas in the loop). These builders
 * replicate what `new fabric.Rect/Ellipse/Line(...).toObject(CUSTOM_PROPS)`
 * plus FabricDrawingCanvas.commitShape() used to emit, field for field, so
 * downstream consumers (SVG renderers, serializers, sync fingerprints, PDF
 * export, undo deltas) see byte-stable shapes across the migration.
 *
 * Pure JS — Node test runner imports this directly.
 */
import {
  computeDrawnBoundaryShapePreviewGeometry,
  tagDrawnCenteredStrokeGeometry,
} from './shapeCommitGeometry.js';
import { createProductionPaperInk } from './productionPaperInk.js';
import { toolSupportsCloudBorderStyle } from './pdfAnnotationAppearance.js';

// fabric 7 base-object serialization envelope (Object.mjs toObject defaults,
// NUM_FRACTION_DIGITS rounding upstream of these constants). Deliberately
// frozen: if the fabric dependency is upgraded, new envelope fields should be
// added here CONSCIOUSLY, not silently.
export const FABRIC_BASE_ENVELOPE = Object.freeze({
  version: '7.4.0',
  originX: 'left',
  originY: 'top',
  strokeDashOffset: 0,
  strokeMiterLimit: 4,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  shadow: null,
  visible: true,
  backgroundColor: '',
  fillRule: 'nonzero',
  paintFirst: 'fill',
  globalCompositeOperation: 'source-over',
  skewX: 0,
  skewY: 0,
  strokeLineCap: 'butt',
  strokeLineJoin: 'miter',
});

// Residue the old pen path carried through `e.path.toObject(CUSTOM_PROPS)` —
// mostly inert residue kept so pen-commit JSON stays diff-stable. The
// production paper-ink builder strips originX/originY because its commands
// already live in page space; retaining those fields makes SVG apply Fabric's
// center-offset transform a second time.
// (PencilBrush paths serialize strokeMiterLimit 10; createProductionPaperInk
// overrides cap/join to round and owns all geometry/paint fields.)
export const PEN_FABRIC_RESIDUE = Object.freeze({
  version: '7.4.0',
  originX: 'left',
  originY: 'top',
  strokeDashArray: null,
  strokeDashOffset: 0,
  strokeMiterLimit: 10,
  strokeUniform: false,
  opacity: 1,
  shadow: null,
  visible: true,
  backgroundColor: '',
  paintFirst: 'fill',
  flipX: false,
  flipY: false,
  skewX: 0,
  skewY: 0,
});

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

/**
 * hex + opacity% → rgba() string. Ported verbatim from
 * FabricDrawingCanvas.composeColor: 'transparent' and non-6-digit-hex values
 * pass through untouched.
 */
export function composeAnnotationColor(hex, opacityPct) {
  if (!hex || hex === 'transparent') return 'transparent';
  const alpha = Math.max(0, Math.min(1, (opacityPct ?? 100) / 100));
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

// UX 2026-09-09: the Cloud border style is available on every closed/open
// SHAPE tool - rectangle, ellipse/circle, polygon and polyline - because a
// revision cloud marks out a REGION. It is never available on arrow, counter or
// a single straight line, so those tools can never stamp the cloud field even
// if the picker were left on 'cloud' when switching tools.
// toolSupportsCloudBorderStyle is the same predicate the toolbar menu uses, so
// what the user can pick and what a new shape stores can never drift apart.
const applyBorderStyle = (json, { tool, lineBorderStyle, cloudIntensity }) => {
  if (lineBorderStyle === 'cloud' && toolSupportsCloudBorderStyle(tool)) {
    json.strokeDashArray = null;
    json.data = {
      ...(json.data || {}),
      pdfCloudIntensity: Math.max(1, Number(cloudIntensity) || 2),
    };
  } else if (lineBorderStyle === 'dashed') {
    json.strokeDashArray = [6, 4];
  } else if (lineBorderStyle === 'dotted') {
    json.strokeDashArray = [2, 4];
  } else {
    json.strokeDashArray = null;
  }
  return json;
};

// Decision 11 companion — the ONE place creation commits stamp survey/region
// scope. Exported so every creation surface (shape/line/freehand builders
// below, buildNewTextCommitJSON in textEditCommit.js, and the PDFViewer
// counter drop) stamps identically; the stampRegionId decision itself comes
// from shouldStampActiveRegionId in annotationVisibilityRules.js.
export const applyScope = (json, { selectedModuleId, stampRegionId, activeRegionId }) => {
  if (selectedModuleId) json.moduleId = selectedModuleId;
  if (stampRegionId) json.regionId = activeRegionId;
  return json;
};

/**
 * Rect / ellipse drag-out commit JSON. Geometry comes from the SAME
 * computeDrawnBoundaryShapePreviewGeometry the preview renders, tagged with
 * the drawn-centered-stroke contract exactly like the fabric path did.
 * Returns null when the drag is below the 2pt size gate.
 */
export function buildBoundaryShapeCommitJSON({
  tool, // 'rect' | 'ellipse'
  id,
  start,
  end,
  strokeColor,
  strokeOpacity,
  fillColor,
  fillOpacity,
  strokeWidth,
  lineBorderStyle,
  cloudIntensity,
  selectedModuleId,
  stampRegionId,
  activeRegionId,
}) {
  const geometry = computeDrawnBoundaryShapePreviewGeometry({
    tool,
    startX: start.x,
    startY: start.y,
    pointerX: end.x,
    pointerY: end.y,
    strokeWidth,
  });
  if (!(geometry.outerBounds.width > 2 && geometry.outerBounds.height > 2)) return null;

  let json;
  if (tool === 'ellipse') {
    const rx = round2(geometry.fabricProps.rx);
    const ry = round2(geometry.fabricProps.ry);
    json = {
      ...FABRIC_BASE_ENVELOPE,
      type: 'Ellipse',
      left: round2(geometry.fabricProps.left),
      top: round2(geometry.fabricProps.top),
      width: round2(rx * 2),
      height: round2(ry * 2),
      rx,
      ry,
      fill: composeAnnotationColor(fillColor, fillOpacity),
      stroke: composeAnnotationColor(strokeColor, strokeOpacity),
      strokeWidth,
      strokeUniform: true,
      id,
      data: { id },
    };
  } else {
    json = {
      ...FABRIC_BASE_ENVELOPE,
      type: 'Rect',
      left: round2(geometry.fabricProps.left),
      top: round2(geometry.fabricProps.top),
      width: round2(geometry.fabricProps.width),
      height: round2(geometry.fabricProps.height),
      rx: 0,
      ry: 0,
      fill: composeAnnotationColor(fillColor, fillOpacity),
      stroke: composeAnnotationColor(strokeColor, strokeOpacity),
      strokeWidth,
      strokeUniform: true,
      id,
      data: { id },
    };
  }
  json = tagDrawnCenteredStrokeGeometry(json);
  applyScope(json, { selectedModuleId, stampRegionId, activeRegionId });
  applyBorderStyle(json, { tool, lineBorderStyle, cloudIntensity });
  return json;
}

/**
 * Line / arrow drag commit JSON. fabric Line stores x1..y2 CENTER-relative
 * (calcLinePoints contract) — getting this wrong mis-places every new line
 * for renderLine, endpoint editing, and bbox edit. Returns null below the
 * 3pt length gate.
 */
export function buildLineCommitJSON({
  tool, // 'line' | 'arrow'
  id,
  start,
  end,
  strokeColor,
  strokeOpacity,
  strokeWidth,
  arrowheadStyle,
  arrowStartStyle = null,
  lineBorderStyle,
  cloudIntensity,
  selectedModuleId,
  stampRegionId,
  activeRegionId,
}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!(Math.hypot(dx, dy) > 3)) return null;
  const width = Math.abs(dx);
  const height = Math.abs(dy);
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  const json = {
    ...FABRIC_BASE_ENVELOPE,
    type: 'Line',
    left: round2(left),
    top: round2(top),
    width: round2(width),
    height: round2(height),
    // fabric's default Line fill — inert but present in today's saves.
    fill: 'rgb(0,0,0)',
    stroke: composeAnnotationColor(strokeColor, strokeOpacity),
    strokeWidth,
    strokeUniform: true,
    x1: start.x - centerX,
    y1: start.y - centerY,
    x2: end.x - centerX,
    y2: end.y - centerY,
    id,
    tool,
    // UX (Bug fix 2026-07-17): only the ARROW tool stamps the toolbar's
    // arrowheadStyle at creation. The renderer's fallback is tool-based
    // (buildLineRenderSpec: 'arrow' → SOLID_TRIANGLE, 'line' → NONE), so a
    // plain line must NOT inherit the shared toolbar default (SOLID_TRIANGLE)
    // or every new line draws an arrowhead. Bluebeam model (owner-endorsed):
    // Line and Arrow are separate tools — line starts with plain ends, arrow
    // starts with the picked head; both stay editable via the ending picker,
    // which writes data.arrowheadStyle explicitly on the committed object.
    data: (tool === 'arrow' && arrowheadStyle)
      ? { id, arrowheadStyle, ...(arrowStartStyle && arrowStartStyle !== 'none' ? { startArrowheadStyle: arrowStartStyle } : {}) }
      : { id },
  };
  applyScope(json, { selectedModuleId, stampRegionId, activeRegionId });
  applyBorderStyle(json, { tool, lineBorderStyle, cloudIntensity });
  return json;
}

/**
 * Pen / highlighter commit JSON via the production paper-ink pipeline (the
 * same createProductionPaperInk call the fabric path handler used — it owns
 * all geometry/paint fields and only reads points/color/width/tool from us).
 * Returns null when the sampled points compact to nothing (sub-0.01pt click).
 */
export function buildFreehandCommitJSON({
  tool, // 'pen' | 'highlighter'
  id,
  authorId,
  points,
  strokeColor,
  highlightColor,
  strokeWidth,
  selectedModuleId,
  stampRegionId,
  activeRegionId,
}) {
  const json = createProductionPaperInk({
    ...PEN_FABRIC_RESIDUE,
    id,
    tool,
    // KAL-417: highlighters are permission-gated at partial-erase time.
    // Stamp their creator before the first collaborative publish so an editor
    // can modify their own stroke. Keep this narrow: KAL-435 owns the general
    // text/shape identity boundary.
    ...(tool === 'highlighter' && typeof authorId === 'string' && authorId
      ? { meta: { authorId } }
      : {}),
    points,
    // Parity quirk preserved: the fabric brush color was never composed with
    // strokeOpacity for pen, and highlighter used the fixed highlightColor.
    color: tool === 'highlighter' ? highlightColor : strokeColor,
    width: tool === 'highlighter' ? Math.max(strokeWidth, 8) : strokeWidth,
    data: { id },
  });
  if (!json) return null;
  applyScope(json, { selectedModuleId, stampRegionId, activeRegionId });
  return json;
}
